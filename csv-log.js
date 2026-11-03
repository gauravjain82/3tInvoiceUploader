const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const STATUS_FILES = {
    SUCCESS: 'success.csv', FAILED: 'failed.csv', PREVIEW_ONLY: 'preview.csv',
    DRY_RUN: 'dry-run.csv', SKIPPED: 'skipped.csv'
};
const COLUMNS = [
    ['invoiceNumber', 'InvoiceNumber'], ['status', 'Result'], ['message', 'Reason'],
    ['timestamp', 'TimestampUTC'], ['fileName', 'FileName'], ['vendorCode', 'VendorCode'],
    ['billingCompany', 'BillingCompanyCode'], ['receiverGSTIN', 'ReceiverGSTIN'],
    ['stage', 'Stage'], ['fileDisposition', 'FileDisposition'], ['destinationPath', 'FileLocation'],
    ['screenshot', 'Screenshot'], ['runId', 'RunId'], ['batchId', 'BatchId'],
    ['finalSaveClicked', 'FinalSaveClicked'], ['manualCheckRequired', 'ManualCheckRequired'],
    ['error', 'ErrorDetails'], ['screenText', 'MSILPageText'], ['archiveError', 'ArchiveError']
];

function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
}
function csvRow(record) { return COLUMNS.map(([key]) => csvCell(record[key])).join(',') + '\r\n'; }
function csvHeader() { return '\uFEFF' + COLUMNS.map(([, title]) => csvCell(title)).join(',') + '\r\n'; }

// Read quoted commas, double quotes and multiline error messages without losing text.
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') { field += '"'; index++; }
            else quoted = !quoted;
        } else if (!quoted && char === ',') { row.push(field); field = ''; }
        else if (!quoted && (char === '\r' || char === '\n')) {
            if (char === '\r' && text[index + 1] === '\n') index++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += char;
    }
    if (quoted) throw new Error('CSV log has an incomplete quoted value.');
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

function readCsvRecords(logDir, fileName = 'invoices.csv') {
    const rows = parseCsv(fs.readFileSync(path.join(logDir, fileName), 'utf8'));
    const header = rows.shift();
    if (!header || header.join(',') !== COLUMNS.map(([, title]) => title).join(',')) throw new Error(`Unexpected CSV header in ${fileName}`);
    return rows.filter(row => row.some(Boolean)).map(row => {
        if (row.length !== COLUMNS.length) throw new Error(`Incomplete CSV record in ${fileName}`);
        const record = Object.fromEntries(COLUMNS.map(([key], index) => [key, row[index]]));
        for (const key of ['finalSaveClicked', 'manualCheckRequired']) record[key] = record[key] === 'true';
        return record;
    });
}

function normalizeReason(record) {
    const errors = ['Invoice Document already exists against the selected MSIL Company.',
        'Seller GSTIN not matched with Vendor GSTIN available in MSIL Vendor Master.'];
    const message = errors.find(message => record.screenText?.includes(message));
    const pageErrorStage = !record.stage || ['CONFIRM_PREVIEW', 'FINAL_SAVE', 'VERIFY_SAVE'].includes(record.stage);
    return record.status === 'FAILED' && pageErrorStage && message ? { ...record, message } : record;
}

function refreshStatusCsvs(logDir, records) {
    for (const [status, name] of Object.entries(STATUS_FILES)) {
        fs.writeFileSync(path.join(logDir, name), csvHeader() + records.filter(row => row.status === status).map(csvRow).join(''), 'utf8');
    }
}

function initializeCsvLogs(logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    const primary = path.join(logDir, 'invoices.csv');
    if (!fs.existsSync(primary)) {
        // Preserve the existing history. Legacy JSONL files are retained as backups.
        const legacy = path.join(logDir, 'runs.jsonl');
        const records = fs.existsSync(legacy)
            ? fs.readFileSync(legacy, 'utf8').split(/\r?\n/).filter(Boolean).map(line => normalizeReason(JSON.parse(line))) : [];
        fs.writeFileSync(primary, csvHeader() + records.map(csvRow).join(''), 'utf8');
    }
    const records = readCsvRecords(logDir);
    refreshStatusCsvs(logDir, records);
    return records;
}

function appendCsvRecord(record, logDir) {
    if (!Object.hasOwn(STATUS_FILES, record.status)) throw new Error(`Unknown run status: ${record.status}`);
    initializeCsvLogs(logDir);
    record = normalizeReason(record);
    fs.appendFileSync(path.join(logDir, 'invoices.csv'), csvRow(record));
    const records = readCsvRecords(logDir);
    refreshStatusCsvs(logDir, records);
    return { record, records };
}

function resetCsvLogs(logDir) {
    const records = initializeCsvLogs(logDir);
    const archiveDir = path.join(logDir, 'archive', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(archiveDir, { recursive: true });
    const screenshots = [...new Set(records.map(row => row.screenshot).filter(name =>
        name && name === path.basename(name) && /\.png$/i.test(name)))];
    const files = ['invoices.csv', ...Object.values(STATUS_FILES), 'report.html', ...screenshots];
    for (const name of files) {
        const source = path.join(logDir, name);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(archiveDir, name), fs.constants.COPYFILE_EXCL);
    }
    // Copy the entire history before replacing it. A locked CSV leaves its backup intact.
    const replacement = path.join(logDir, `report-reset-${randomUUID()}.tmp`);
    try {
        fs.writeFileSync(replacement, csvHeader(), 'utf8');
        fs.renameSync(replacement, path.join(logDir, 'invoices.csv'));
    } finally {
        if (fs.existsSync(replacement)) fs.unlinkSync(replacement);
    }
    refreshStatusCsvs(logDir, []);
    return { archiveDir, cleared: records.length, screenshots };
}

module.exports = { STATUS_FILES, COLUMNS, csvCell, parseCsv, readCsvRecords, initializeCsvLogs, appendCsvRecord, resetCsvLogs };
