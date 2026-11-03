const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv-log');
const { LOG_DIR, displayRunResult } = require('./run-log');
const { processBatch } = require('./batch');
const { validateVendorCode, readStartupOptions } = require('./vendor-input');


// ============================================================
// CONFIGURATION
// ============================================================

const BASE_DIR = __dirname;

const PENDING_DIR = path.join(BASE_DIR, 'pending');
const MAPPING_FILE = path.join(BASE_DIR, 'billing-company.csv');
const EDGE_PROFILE = path.join(BASE_DIR, 'edge-profile');
const UPLOAD_URL = 'http://192.168.1.249/MSILInvoice/Digital_Invoice_Upload.aspx';


// ============================================================
// LOAD FOLDER TO BILLING COMPANY MAPPING
// ============================================================

function loadBillingMapping(mappingFile = MAPPING_FILE) {
    if (!fs.existsSync(mappingFile)) throw new Error(`Mapping file not found: ${mappingFile}`);
    const rows = parseCsv(fs.readFileSync(mappingFile, 'utf8')).filter(row => row.some(cell => cell.trim()));
    const header = rows.shift()?.map(cell => cell.trim());
    if (!header || header.join(',') !== 'FolderName,BillingCompanyCode') {
        throw new Error('Expected CSV header: FolderName,BillingCompanyCode');
    }
    const mapping = Object.create(null);
    for (const [index, row] of rows.entries()) {
        const [folderName, companyCode] = row.map(cell => cell.trim());
        if (row.length !== 2 || !folderName || folderName === '.' || folderName === '..' ||
            /[<>:"/\\|?*\x00-\x1f]/.test(folderName) || !/^\d{1,2}$/.test(companyCode)) {
            throw new Error(`Invalid folder mapping at CSV line ${index + 2}`);
        }
        const key = folderName.toLowerCase();
        const code = companyCode.padStart(2, '0');
        if (Object.hasOwn(mapping, key) && mapping[key] !== code) {
            throw new Error(`Conflicting billing mappings for folder ${folderName}`);
        }
        mapping[key] = code;
    }
    return mapping;
}

function resolveBillingCompany(folderName, mapping) {
    if (!folderName) throw new Error('Place the PDF inside a mapped subfolder of pending.');
    const key = folderName.toLowerCase();
    if (!Object.hasOwn(mapping, key)) throw new Error(`Folder "${folderName}" is not mapped in billing-company.csv. Invoice will not be uploaded.`);
    return { billingCompany: mapping[key] };
}

async function openInvoicePage(context, vendorCode, existingPage) {
    const page = existingPage || context.pages().at(-1) || await context.newPage();
    const url = new URL(UPLOAD_URL);
    url.searchParams.set('Vendors', validateVendorCode(vendorCode));
    console.log('Opening MSIL upload page:', url.href);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return page;
}

// Detect the upload page, including a new tab or frame after manual login.
async function waitForInvoicePage(context, timeout = 10 * 60 * 1000, targetPage) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (context.pages().length === 0) throw new Error('Edge was closed while waiting for manual login.');
        for (const page of targetPage ? [targetPage] : context.pages()) {
            for (const frame of page.frames()) {
                if (!/^http:\/\/192\.168\.1\.249\/MSILInvoice\/Digital_Invoice_Upload\.aspx(?:[?#]|$)/i.test(frame.url())) continue;
                try {
                    if (await frame.locator('#drpVend').isVisible() &&
                        await frame.locator('#drpComp').isVisible()) return frame;
                } catch (error) {
                    if (page.isClosed() || frame.isDetached()) continue;
                    throw error;
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Timed out waiting for manual login and the Digital Invoice Uploading page.');
}

// MAIN
// ============================================================

async function uploadInvoicePreview(page, invoice, billingCompany, invoicePath) {
    // ASP.NET dropdowns may post back and repopulate the next dropdown.
    async function selectWithPostback(selector, value) {
        const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 3000 })
            .catch(error => { if (error.name !== 'TimeoutError') throw error; });
        await Promise.all([navigation, page.locator(selector).selectOption(value)]);
        await page.waitForFunction(
            ({ selector, value }) => document.querySelector(selector)?.value === value,
            { selector, value }
        );
    }

    console.log('Selecting Vendor:', invoice.vendorCode);
    await selectWithPostback('#drpVend', invoice.vendorCode);
    console.log('Selecting Billing Company:', billingCompany);
    await selectWithPostback('#drpComp', billingCompany);

    async function verifySelections() {
        if (await page.locator('#drpVend').inputValue() !== invoice.vendorCode ||
            await page.locator('#drpComp').inputValue() !== billingCompany) {
            throw new Error('Dropdown values do not match expected values. Invoice will NOT be uploaded.');
        }
    }

    await verifySelections();
    console.log('Company Name:', (await page.locator('#drpComp option:checked').textContent()).trim());
    const manualSubmit = await page.locator('#btnView').isVisible();
    await page.locator('#fUpload').setInputFiles(invoicePath);
    if (manualSubmit) {
        await verifySelections();
        console.log('Clicking Submit for preview...');
        await page.locator('#btnView').click();
    } else {
        // The live MSIL change handler clicks its hidden Submit automatically.
        // Clicking it again would submit the same file twice.
        console.log('MSIL automatically submits the selected file for preview. Waiting for Confirm...');
    }
}

async function confirmInvoice(page, timeout = 60000, run = {}) {
    const confirm = page.locator('#btnSave');
    let saveAttempted = false;

    // Legacy pages may show a JavaScript confirmation or a result alert.
    const browserPage = typeof page.page === 'function' ? page.page() : page;
    const dialogTasks = [];
    const handleDialog = dialog => {
        console.log(`MSIL ${dialog.type()}:`, dialog.message());
        dialogTasks.push(dialog.accept());
    };
    browserPage.on('dialog', handleDialog);
    async function waitForReady(selectors) {
        const result = await page.waitForFunction(selectors => {
            const errors = ['Invoice Document already exists against the selected MSIL Company.',
                'Seller GSTIN not matched with Vendor GSTIN available in MSIL Vendor Master.'];
            const message = errors.find(message => document.body.innerText.includes(message));
            if (message) return message;
            return selectors.some(selector => {
                const button = document.querySelector(selector);
                return button && !button.disabled && button.getClientRects().length > 0;
            }) ? 'READY' : false;
        }, selectors, { timeout });
        const state = await result.jsonValue();
        await result.dispose();
        if (state !== 'READY') throw new Error(`MSIL: ${state}`);
    }
    try {
        await waitForReady(['#MyPopup #btnCOnfirm', '#btnSave']);
        const previewConfirm = page.locator('#MyPopup #btnCOnfirm');
        if (await previewConfirm.isVisible()) {
            console.log('Confirming the invoice preview popup...');
            await previewConfirm.click({ timeout });
        }
        await waitForReady(['#btnSave']);
        const previewText = await page.locator('body').innerText();
        const documentNumber = previewText.match(/\bDocument[ \t]+No[ \t]+((?=[A-Za-z0-9\/-]*\d)[A-Za-z0-9][A-Za-z0-9\/-]*)/i);
        if (documentNumber) run.invoiceNumber = documentNumber[1];
        console.log('Clicking final Save...');
        run.stage = 'FINAL_SAVE';
        // Record the attempt before clicking: a timeout can happen after the server saves.
        saveAttempted = true;
        run.finalSaveClicked = true;
        await confirm.click({ timeout });
        await Promise.all(dialogTasks);
        run.stage = 'VERIFY_SAVE';
        await page.waitForFunction(() => /^\s*Data saved successfully\.\s*$/im.test(document.body.innerText), null, { timeout });
        const screenText = await page.locator('body').innerText();
        console.log('MSIL verified: Data saved successfully.');
        return { finalSaveClicked: true, screenText, invoiceNumber: run.invoiceNumber || null };
    } catch (error) {
        const failure = new Error(saveAttempted
            ? `Final Save was attempted but success could not be verified. Check MSIL before retrying this invoice. ${error.message}`
            : `Could not reach the final Save stage: ${error.message}`);
        failure.finalSaveClicked = saveAttempted;
        throw failure;
    } finally {
        browserPage.off('dialog', handleDialog);
    }
}

async function main({
    dryRun = false, mappingFile = MAPPING_FILE, pendingDir = PENDING_DIR,
    uploadedDir = path.join(BASE_DIR, 'uploaded'), failedDir = path.join(BASE_DIR, 'failed'),
    logDir = LOG_DIR, keepBrowserOpen = true, processInvoice, vendorCode, limit = Infinity
} = {}) {
    if (vendorCode !== undefined) vendorCode = validateVendorCode(vendorCode);
    let context;
    let uploadTab;
    let activePage;
    let lastRecord;
    console.log(dryRun ? 'MSIL INVOICE AUTOMATION - DRY RUN' : 'MSIL INVOICE AUTOMATION - ALL PENDING PDFs (FINAL SAVE ENABLED)');

    async function uploadOnMsil(invoice, billingCompany, invoicePath, run) {
        if (!context) {
            run.stage = 'LAUNCH_EDGE';
            context = await chromium.launchPersistentContext(EDGE_PROFILE, {
                channel: 'msedge', headless: false, viewport: null
            });
        }
        run.stage = 'OPEN_UPLOAD_PAGE';
        // Reopen a clean form for each PDF, reusing the same authenticated tab.
        activePage = null;
        uploadTab = await openInvoicePage(context, vendorCode || invoice.vendorCode, uploadTab);
        run.stage = 'WAIT_FOR_LOGIN';
        console.log('Using the saved Edge session. Log in manually if MSIL requests it.');
        activePage = await waitForInvoicePage(context, 10 * 60 * 1000, uploadTab);
        run.stage = 'VERIFY_LOGIN_VENDOR';
        const allowedVendors = await activePage.locator('#drpVend option').evaluateAll(options => options.map(option => option.value));
        if (!allowedVendors.includes(vendorCode || invoice.vendorCode)) {
            throw new Error(`Vendor ${vendorCode || invoice.vendorCode} is not available for the current MSIL login. Log in with the correct user and restart.`);
        }
        run.stage = 'UPLOAD_PREVIEW';
        await uploadInvoicePreview(activePage, invoice, billingCompany, invoicePath);
        run.stage = 'CONFIRM_PREVIEW';
        return await confirmInvoice(activePage, 60000, run);
    }

    async function captureFailure(run) {
        if (!activePage) return {};
        const evidence = {};
        try {
            evidence.screenText = await activePage.locator('body').innerText({ timeout: 5000 });
            const documentNumber = evidence.screenText.match(/\bDocument[ \t]+No[ \t]+((?=[A-Za-z0-9\/-]*\d)[A-Za-z0-9][A-Za-z0-9\/-]*)/i);
            if (documentNumber) run.invoiceNumber = documentNumber[1];
        }
        catch (_) { /* Browser may have closed. */ }
        try {
            fs.mkdirSync(logDir, { recursive: true });
            const screenshot = `${run.runId}-error.png`;
            const page = typeof activePage.page === 'function' ? activePage.page() : activePage;
            await page.screenshot({ path: path.join(logDir, screenshot), fullPage: true, timeout: 5000 });
            evidence.screenshot = screenshot;
        } catch (_) { /* Keep the original invoice error. */ }
        return evidence;
    }

    try {
        const summary = await processBatch({
            pendingDir, uploadedDir, failedDir, mappingFile, logDir, dryRun, vendorCode, limit,
            loadBillingMapping, resolveBillingCompany,
            processInvoice: processInvoice || uploadOnMsil, captureFailure,
            onResult: async record => {
                lastRecord = record;
                await displayRunResult(record, context, activePage, logDir, { openReport: false });
            }
        });
        if (context && lastRecord) {
            await displayRunResult(lastRecord, context, activePage, logDir);
            if (keepBrowserOpen && context.pages().length) {
                console.log('Batch finished. Close the bot Edge window when done reviewing to release the profile.');
                await new Promise(resolve => context.once('close', resolve));
            }
        }
        return summary;
    } finally {
        if (context && !keepBrowserOpen) await context.close();
    }
}

module.exports = { loadBillingMapping, resolveBillingCompany, openInvoicePage, waitForInvoicePage, uploadInvoicePreview, confirmInvoice, main };

if (require.main === module) {
    readStartupOptions(process.argv.slice(2)).then(options => main(options)).then(result => {
        if (result?.status === 'FAILED') process.exitCode = 1;
    }).catch(error => { console.error(error); process.exitCode = 1; });
}



