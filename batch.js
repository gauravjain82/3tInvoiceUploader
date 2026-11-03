const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { writeRunResult } = require('./run-log');
const { validateVendorCode } = require('./vendor-input');

function canRetryUpload(error, run) {
    // A failed click/response can happen after MSIL commits the invoice.
    if (run.finalSaveClicked || error.finalSaveClicked || ['FINAL_SAVE', 'VERIFY_SAVE'].includes(run.stage)) return false;
    if (!['OPEN_UPLOAD_PAGE', 'UPLOAD_PREVIEW', 'CONFIRM_PREVIEW'].includes(run.stage)) return false;
    const message = error.message || '';
    if (/already exists|GSTIN|invalid IRN|MSIL rejected|MSIL:|Dropdown values do not match/i.test(message)) return false;
    if (/browser.*closed|context.*closed|Target.*closed/i.test(message)) return false;
    return error.name === 'TimeoutError' || /\btimeout\b|timed out|net::ERR_(?:CONNECTION|NETWORK|TIMED_OUT|EMPTY_RESPONSE|NAME_NOT_RESOLVED)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_NETWORK/i.test(message);
}

function archiveInvoice(source, status, { uploadedDir, failedDir, runId = randomUUID(), relativePath = path.basename(source) }) {
    const archiveRoot = status === 'SUCCESS' ? uploadedDir : status === 'FAILED' ? failedDir : null;
    if (!archiveRoot) return null;
    const root = path.resolve(archiveRoot);
    const resolved = path.resolve(root, relativePath);
    if (path.isAbsolute(relativePath) || !resolved.startsWith(root + path.sep)) throw new Error('Archive path must stay inside its destination folder.');
    const destinationDir = path.dirname(resolved);
    if (path.resolve(destinationDir) === path.dirname(path.resolve(source))) {
        throw new Error('Archive folder must be different from pending.');
    }
    fs.mkdirSync(destinationDir, { recursive: true });
    const name = path.basename(source);
    const ext = path.extname(name);
    let destination = path.join(destinationDir, name);
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            // COPYFILE_EXCL prevents overwriting any previously processed invoice.
            fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
            try { fs.unlinkSync(source); }
            catch (error) { throw new Error(`Copied to ${destination}, but could not remove ${source}: ${error.message}. Check both copies before retrying.`); }
            return destination;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            destination = path.join(destinationDir, `${path.basename(name, ext)}--${runId}-${attempt + 1}${ext}`);
        }
    }
    throw new Error(`Could not find an unused archive filename for ${name}`);
}

async function processBatch(options) {
    const { pendingDir, uploadedDir, failedDir, logDir, mappingFile, dryRun, vendorCode, limit = Infinity,
        loadBillingMapping, resolveBillingCompany, processInvoice,
        onResult = async () => {}, captureFailure = async () => ({}), maxRetries = 3, retryDelayMs = 5000 } = options;
    const batchId = randomUUID();
    const records = [];
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Invoice limit must be a positive integer.');
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error('Retry count must be a non-negative integer.');
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error('Retry delay must be a non-negative integer.');
    async function record(details) {
        const result = writeRunResult({ batchId, ...details }, logDir);
        records.push(result);
        try { await onResult(result); }
        catch (error) { console.error('Could not display result:', error.message); }
        return result;
    }
    let mapping;
    let files;
    let setupStage = 'LOAD_MAPPING';
    try {
        mapping = loadBillingMapping(mappingFile);
        setupStage = 'VALIDATE_VENDOR';
        if (!dryRun) validateVendorCode(vendorCode);
        setupStage = 'SCAN_PENDING';
        files = [];
        for (const entry of fs.readdirSync(pendingDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
                files.push({ folderName: null, name: entry.name, relativePath: entry.name });
            } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
                for (const file of fs.readdirSync(path.join(pendingDir, entry.name), { withFileTypes: true })) {
                    if (file.isFile() && file.name.toLowerCase().endsWith('.pdf')) {
                        files.push({ folderName: entry.name, name: file.name, relativePath: path.join(entry.name, file.name) });
                    }
                }
            }
        }
        files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    } catch (error) {
        return record({ status: 'FAILED', stage: setupStage, message: error.message, error: error.stack,
            finalSaveClicked: false, fileDisposition: 'pending' });
    }
    if (files.length === 0) return record({ status: 'SKIPPED', stage: 'SCAN_PENDING', message: 'No PDF files found in pending folder.' });
    const pendingTotal = files.length;
    files = files.slice(0, limit);
    if (limit !== Infinity) console.log(`Single-run limit: processing ${files.length} of ${pendingTotal} pending PDFs.`);
    console.log(`Found ${files.length} invoice(s). Processing sequentially. ${dryRun ? 'Dry run: no submissions.' : 'Final Save is enabled.'}`);

    let stopped = false;
    for (const [index, file] of files.entries()) {
        const fileName = file.relativePath;
        const source = path.join(pendingDir, fileName);
        const run = { runId: randomUUID(), fileName, invoiceNumber: null, vendorCode: vendorCode || null,
            receiverGSTIN: null, billingCompany: null, stage: 'RESOLVE_FOLDER', finalSaveClicked: false,
            fileDisposition: 'pending' };
        console.log(`\n[${index + 1}/${files.length}] ${fileName}`);
        let outcome;
        let stopBatch = false;
        try {
            const invoice = { invoiceNumber: null, vendorCode: vendorCode || null, fileName, folderName: file.folderName };
            const billing = resolveBillingCompany(file.folderName, mapping);
            Object.assign(run, billing);
            console.log(`File: ${fileName} | Vendor: ${vendorCode || 'Not supplied (dry run)'} | Company: ${billing.billingCompany}`);
            if (dryRun) {
                outcome = { status: 'DRY_RUN', message: 'Folder billing mapping passed. PDF contents were not parsed; no browser opened or files moved.' };
            } else {
                let result;
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    run.attempt = attempt + 1;
                    try {
                        result = await processInvoice(invoice, billing.billingCompany, source, run);
                        break;
                    } catch (error) {
                        run.finalSaveClicked = run.finalSaveClicked || error.finalSaveClicked === true;
                        if (attempt === maxRetries || !canRetryUpload(error, run)) throw error;
                        const delay = retryDelayMs * (attempt + 1);
                        console.warn(`Retry ${attempt + 1}/${maxRetries} for ${fileName} in ${delay / 1000}s: ${error.message}`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        // The uploader reopens a clean form and verifies selections
                        // on every attempt; no file is moved or logged as failed yet.
                    }
                }
                if (result?.invoiceNumber) run.invoiceNumber = result.invoiceNumber;
                run.finalSaveClicked = run.finalSaveClicked || result?.finalSaveClicked === true;
                if (run.finalSaveClicked) {
                    run.stage = 'VERIFY_SAVE';
                    if (!/^\s*Data saved successfully\.\s*$/im.test(result.screenText || '')) {
                        throw new Error('Final Save was clicked but MSIL success could not be verified. Check MSIL before retrying.');
                    }
                    outcome = { status: 'SUCCESS', message: 'MSIL confirmed: Data saved successfully.', screenText: result.screenText };
                } else {
                    run.stage = 'READY_FOR_FINAL_SAVE';
                    outcome = { status: 'PREVIEW_ONLY', message: 'Preview completed without final Save; PDF remains in pending.', screenText: result?.screenText };
                }
            }
        } catch (error) {
            run.finalSaveClicked = run.finalSaveClicked || error.finalSaveClicked === true;
            // Shared browser/login/network problems must not reject every remaining PDF.
            stopBatch = ['LAUNCH_EDGE', 'OPEN_UPLOAD_PAGE', 'WAIT_FOR_LOGIN', 'VERIFY_LOGIN_VENDOR'].includes(run.stage) ||
                /net::|ERR_NETWORK|browser.*closed|context.*closed|Target.*closed/i.test(error.message);
            let evidence = {};
            try { evidence = await captureFailure(run); } catch (_) { /* Evidence must not hide the original error. */ }
            outcome = { status: 'FAILED', message: error.message, error: error.stack,
                manualCheckRequired: run.finalSaveClicked, ...evidence };
        }

        if (run.attempt > 1) outcome.message += ` Attempts: ${run.attempt} (${run.attempt - 1} retries).`;

        // Never move files during a dry run or for shared infrastructure failures.
        if (!dryRun && !stopBatch && ['SUCCESS', 'FAILED'].includes(outcome.status)) {
            try {
                run.destinationPath = archiveInvoice(source, outcome.status, { uploadedDir, failedDir, runId: run.runId, relativePath: fileName });
                run.fileDisposition = outcome.status === 'SUCCESS' ? 'uploaded' : 'failed';
            } catch (error) {
                outcome.archiveError = error.message;
                outcome.message += ` Archive error: ${error.message}`;
                stopBatch = true;
            }
        }
        const result = await record({ ...run, ...outcome });
        console.log(`[${result.status}] ${result.message}`);
        if (result.destinationPath) console.log('Moved to:', result.destinationPath);
        if (stopBatch) {
            stopped = true;
            console.error('Batch stopped. Remaining PDFs are untouched in pending.');
            break;
        }
    }
    const counts = records.reduce((counts, row) => { counts[row.status] = (counts[row.status] || 0) + 1; return counts; }, {});
    console.log('\nBatch results:', JSON.stringify(counts));
    return { batchId, status: records.some(row => row.status === 'FAILED' || row.archiveError) ? 'FAILED' : 'COMPLETED',
        records, counts, stopped, total: pendingTotal, selected: files.length, processed: records.length, remaining: pendingTotal - records.length };
}

module.exports = { processBatch, archiveInvoice, canRetryUpload };
