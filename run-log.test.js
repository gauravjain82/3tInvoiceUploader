const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { writeRunResult, displayRunResult, readCsvRecords, refreshReport, clearReport } = require('./run-log');
const { main } = require('./bot');

function tempLogs(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoicebot-log-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('logs append separate outcomes and safely render error messages', t => {
    const dir = tempLogs(t);
    writeRunResult({ status: 'PREVIEW_ONLY', invoiceNumber: '1000000001', message: 'Final Save disabled' }, dir);
    writeRunResult({ status: 'FAILED', invoiceNumber: '1000000001', stage: 'RESOLVE_RECEIVER',
        message: '<script>bad()</script>\nMissing mapping', error: 'Error: missing mapping',
        screenText: 'Receiver not configured', screenshot: 'error.png' }, dir);
    assert.equal(readCsvRecords(dir, 'success.csv').length, 0);
    assert.equal(readCsvRecords(dir, 'failed.csv')[0].stage, 'RESOLVE_RECEIVER');
    assert.equal(readCsvRecords(dir, 'preview.csv')[0].status, 'PREVIEW_ONLY');
    // A simulated saved result exercises the separate success file, not a live upload.
    writeRunResult({ status: 'SUCCESS', message: 'Simulated verified saved result' }, dir);
    assert.equal(readCsvRecords(dir, 'success.csv')[0].status, 'SUCCESS');
    const runs = readCsvRecords(dir);
    assert.equal(runs.length, 3);
    assert.equal(new Set(runs.map(row => row.runId)).size, 3);
    const report = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
    assert.match(report, /Success: 1/);
    assert.match(report, /Error: 1/);
    assert.match(report, /Preview only: 1/);
    assert.match(report, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(report, /<script>bad/);
    assert.match(report, /Receiver not configured/);
    assert.match(report, /href="error.png"/);
});

test('an error before launching Edge is logged with its stage and report', async t => {
    const dir = tempLogs(t);
    const result = await main({ mappingFile: path.join(dir, 'missing.csv'), logDir: dir });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.stage, 'LOAD_MAPPING');
    assert.match(result.message, /Mapping file not found/);
    assert.equal(readCsvRecords(dir, 'failed.csv')[0].runId, result.runId);
    assert.match(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), /Mapping file not found/);
});

test('browser shows the failure on the page and in the report tab without form submission', async t => {
    const dir = tempLogs(t);
    const record = writeRunResult({ status: 'FAILED', invoiceNumber: '1000000001', stage: 'UPLOAD_PREVIEW',
        message: 'Receiver GSTIN does not match billing company. <details>' }, dir);
    writeRunResult({ status: 'SUCCESS', invoiceNumber: '12345', message: 'Saved successfully' }, dir);
    writeRunResult({ status: 'PREVIEW_ONLY', invoiceNumber: '67890', message: 'Final Save disabled' }, dir);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent('<form><p>MSIL invoice page</p><button id="btnSave">Confirm</button></form>');
        await displayRunResult(record, context, page, dir);
        assert.match(await page.locator('[role="alert"]').innerText(), /Receiver GSTIN does not match/);
        assert.equal(await page.locator('#invoicebot-status button').getAttribute('type'), 'button');
        const report = context.pages().at(-1);
        assert.match(await report.locator('tbody').innerText(), /1000000001/);
        assert.match(await report.locator('tbody').innerText(), /Receiver GSTIN does not match billing company. <details>/);
        assert.equal(await report.locator('tbody tr:visible').count(), 3);
        await report.selectOption('#statusFilter', 'FAILED');
        assert.equal(await report.locator('tbody tr:visible').count(), 1);
        assert.match(await report.locator('tbody tr:visible').innerText(), /1000000001/);
        assert.equal(await report.locator('tr.FAILED').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 240, 240)');
        await report.selectOption('#statusFilter', 'SUCCESS');
        assert.equal(await report.locator('tbody tr:visible').count(), 1);
        assert.match(await report.locator('tbody tr:visible').innerText(), /12345/);
        assert.doesNotMatch(await report.locator('tbody tr:visible').innerText(), /67890/);
        assert.equal(await report.locator('tr.SUCCESS').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(234, 247, 238)');
        await report.selectOption('#statusFilter', 'DRY_RUN');
        assert.equal(await report.locator('#emptyResults').isVisible(), true);
        await report.selectOption('#statusFilter', 'ALL');
        assert.equal(await report.locator('tbody tr:visible').count(), 3);
        assert.equal(await report.locator('a[download]').first().getAttribute('href'), 'invoices.csv');
        await report.locator('#clearReportHelp').click();
        assert.equal(await report.locator('#clearInstructions').isVisible(), true);
        assert.match(await report.locator('#clearInstructions').innerText(), /clear-report.cmd/);
        await page.locator('#invoicebot-status button').click();
        assert.equal(await page.locator('#invoicebot-status').count(), 0);
    } finally { await browser.close(); }
});

test('clear report archives history and screenshots, resets counts, and preserves invoice folders', t => {
    const dir = tempLogs(t);
    const invoices = path.join(dir, 'pending');
    fs.mkdirSync(invoices);
    fs.writeFileSync(path.join(invoices, 'invoice.pdf'), 'invoice untouched');
    fs.writeFileSync(path.join(dir, 'sample-error.png'), 'screenshot');
    fs.writeFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify({ status: 'FAILED', runId: 'legacy',
        timestamp: '2026-10-25T01:00:00Z', message: 'Legacy failure' }) + '\n');
    writeRunResult({ status: 'FAILED', invoiceNumber: '1000000001', message: 'Invoice already exists', screenshot: 'sample-error.png' }, dir);
    const result = clearReport(dir);
    assert.equal(result.cleared, 2);
    assert.equal(readCsvRecords(dir).length, 0);
    assert.equal(readCsvRecords(dir, 'failed.csv').length, 0);
    assert.equal(readCsvRecords(result.archiveDir).length, 2);
    assert.equal(fs.readFileSync(path.join(result.archiveDir, 'sample-error.png'), 'utf8'), 'screenshot');
    assert.equal(fs.existsSync(path.join(dir, 'sample-error.png')), false);
    assert.equal(fs.readFileSync(path.join(invoices, 'invoice.pdf'), 'utf8'), 'invoice untouched');
    assert.match(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), /Error: 0/);
    refreshReport(dir); // Legacy backups must not reappear after a reset.
    assert.equal(readCsvRecords(dir).length, 0);
    writeRunResult({ status: 'PREVIEW_ONLY', message: 'New run' }, dir);
    assert.equal(readCsvRecords(dir).length, 1);
});

test('CSV preserves commas, quotes and multiline errors and migration does not duplicate history', t => {
    const dir = tempLogs(t);
    const reason = 'Receiver, "Gurgaon"\r\nMissing mapping';
    const legacy = { status: 'FAILED', invoiceNumber: '1000000001', runId: 'legacy',
        timestamp: '2026-10-25T01:00:00Z', message: reason, error: 'Error:\nline 2' };
    fs.writeFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify(legacy) + '\n');
    refreshReport(dir);
    assert.equal(readCsvRecords(dir)[0].message, reason);
    assert.equal(readCsvRecords(dir)[0].error, legacy.error);
    assert.equal(readCsvRecords(dir)[0].runId, 'legacy');
    refreshReport(dir);
    writeRunResult({ status: 'PREVIEW_ONLY', message: 'Preview complete' }, dir);
    assert.equal(readCsvRecords(dir).length, 2);
    assert.equal(fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8'), JSON.stringify(legacy) + '\n');
    assert.equal(fs.existsSync(path.join(dir, 'preview.jsonl')), false);
    assert.ok(fs.readFileSync(path.join(dir, 'invoices.csv'), 'utf8').startsWith('\uFEFF"InvoiceNumber","Result","Reason"'));
});
