const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');

const LOG_DIR = path.join(__dirname, 'logs');
const { STATUS_FILES, initializeCsvLogs, appendCsvRecord, readCsvRecords, resetCsvLogs } = require('./csv-log');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function renderReport(records) {
    const labels = { SUCCESS: 'Success', FAILED: 'Error', PREVIEW_ONLY: 'Preview only', DRY_RUN: 'Dry run', SKIPPED: 'Skipped' };
    const counts = Object.keys(STATUS_FILES).map(status =>
        `<span class="count ${status}">${labels[status]}: ${records.filter(row => row.status === status).length}</span>`
    ).join('');
    const rows = records.slice().reverse().map(row => `<tr class="${escapeHtml(row.status)}" data-status="${escapeHtml(row.status)}">
        <td><strong>${escapeHtml(row.invoiceNumber || 'Not available')}</strong><br><small>${escapeHtml(row.fileName)}</small></td>
        <td><strong>${escapeHtml(labels[row.status] || row.status)}</strong></td>
        <td class="message">${escapeHtml(row.message)}${row.archiveError ? `<br>${escapeHtml(row.archiveError)}` : ''}${row.manualCheckRequired ? '<br><strong>Check MSIL before retrying this invoice.</strong>' : ''}<details><summary>Details</summary><p>Stage: ${escapeHtml(row.stage)}<br>Vendor: ${escapeHtml(row.vendorCode)}<br>Receiver: ${escapeHtml(row.receiverGSTIN)}</p>${row.error ? `<pre>${escapeHtml(row.error)}</pre>` : ''}
        ${row.screenText ? `<details><summary>MSIL page message</summary><pre>${escapeHtml(row.screenText)}</pre></details>` : ''}
        ${row.screenshot ? `<br><a href="${escapeHtml(path.basename(row.screenshot))}">View error screenshot</a>` : ''}</details></td>
        <td>${escapeHtml(row.billingCompany)}</td>
        <td class="location">${escapeHtml(row.destinationPath || row.fileDisposition || 'pending')}</td>
        <td>${escapeHtml(new Date(row.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }))}</td>
    </tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>InvoiceBot run log</title><style>
    body{font:15px system-ui,sans-serif;margin:32px;color:#172338;background:#f5f7fa}h1{margin-bottom:8px}
    .note{color:#43516a;max-width:900px}.counts{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.count{padding:10px 16px;background:white;border:1px solid #d7deea;border-radius:8px}
    .SUCCESS{color:#126638}.FAILED{color:#a51d28}.PREVIEW_ONLY,.DRY_RUN{color:#705000}tr.SUCCESS{background:#eaf7ee}tr.FAILED{background:#fff0f0}tr.PREVIEW_ONLY,tr.DRY_RUN{background:#fffbea}tr[hidden]{display:none}table{border-collapse:collapse;width:100%;background:white}
    th,td{text-align:left;vertical-align:top;padding:14px;border-bottom:1px solid #d7deea}th{background:#e7edf5}.message,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{max-width:600px;font-size:12px}
    .table{overflow:auto}button,select{padding:8px 16px;cursor:pointer}a{color:#174d9f}.toolbar{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:20px 0}small{color:#43516a}.location{overflow-wrap:anywhere;max-width:260px}
    </style></head><body><h1>InvoiceBot run log</h1>
    <p class="note">Final Save is enabled. Billing company comes from the pending subfolder mapping. Verified uploads move to uploaded and failures to failed, preserving the company subfolder. Invoice numbers are read from MSIL's preview; before then, identify the file by its folder and filename. Dry-run PDFs stay in pending. Check MSIL before retrying any invoice with an unverified Save result.</p>
    <p class="note">Times shown in India Standard Time. Reload this page after another run.</p>
    <div class="toolbar"><label for="statusFilter">Show </label><select id="statusFilter"><option value="ALL">All</option><option value="SUCCESS">Success</option><option value="FAILED">Error</option><option value="PREVIEW_ONLY">Preview only</option><option value="DRY_RUN">Dry run</option><option value="SKIPPED">Skipped</option></select>
    <button type="button" onclick="location.reload()">Refresh results</button><a href="invoices.csv" download>Download CSV</a><a href="success.csv" download>Success CSV</a><a href="failed.csv" download>Error CSV</a><button type="button" id="clearReportHelp" aria-expanded="false" aria-controls="clearInstructions">Clear report...</button></div>
    <div id="clearInstructions" hidden><p>After the batch finishes, double-click <strong>clear-report.cmd</strong> in the InvoiceBot folder, or run <code>npm run clear-report</code> there. This archives the report history and resets the active report. Invoice PDFs and the saved login are kept.</p></div><div class="counts">${counts}</div>
    <p id="resultCount" role="status"></p><div class="table"><table><thead><tr><th>Invoice number / File</th><th>Result</th><th>Reason</th><th>Company</th><th>File location</th><th>Time (IST)</th></tr></thead>
    <tbody>${rows}</tbody></table></div><p id="emptyResults" hidden>No results match this filter.</p>
    <script>
    const filter = document.getElementById('statusFilter');
    function applyFilter() {
        let visible = 0;
        const rows = document.querySelectorAll('tbody tr[data-status]');
        for (const row of rows) {
            row.hidden = filter.value !== 'ALL' && row.dataset.status !== filter.value;
            if (!row.hidden) visible++;
        }
        document.getElementById('resultCount').textContent = visible + ' of ' + rows.length + ' results';
        document.getElementById('emptyResults').hidden = visible > 0;
    }
    filter.addEventListener('change', applyFilter);
    document.getElementById('clearReportHelp').addEventListener('click', event => {
        const instructions = document.getElementById('clearInstructions');
        instructions.hidden = !instructions.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!instructions.hidden));
    });
    applyFilter();
    </script></body></html>`;
}

function writeRunResult(details, logDir = LOG_DIR) {
    const record = { ...details, runId: details.runId || randomUUID(), timestamp: new Date().toISOString() };
    const result = appendCsvRecord(record, logDir);
    const records = result.records;
    fs.writeFileSync(path.join(logDir, 'report.html'), renderReport(records), 'utf8');
    return result.record;
}

function refreshReport(logDir = LOG_DIR) {
    const records = initializeCsvLogs(logDir);
    fs.writeFileSync(path.join(logDir, 'report.html'), renderReport(records), 'utf8');
    return records;
}

function clearReport(logDir = LOG_DIR) {
    const result = resetCsvLogs(logDir);
    fs.writeFileSync(path.join(logDir, 'report.html'), renderReport([]), 'utf8');
    // Referenced screenshots have been copied alongside the archived report.
    for (const name of result.screenshots) {
        const screenshot = path.join(logDir, name);
        if (fs.existsSync(screenshot)) fs.unlinkSync(screenshot);
    }
    return result;
}

async function displayRunResult(record, context, activePage, logDir = LOG_DIR, { openReport = true } = {}) {
    console.log(`[${record.status}] ${record.message}`);
    console.log('Run report:', path.join(logDir, 'report.html'));
    if (activePage) {
        try {
            await activePage.evaluate(record => {
                document.getElementById('invoicebot-status')?.remove();
                const panel = document.createElement('aside');
                panel.id = 'invoicebot-status';
                panel.setAttribute('role', record.status === 'FAILED' ? 'alert' : 'status');
                Object.assign(panel.style, { position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647',
                    maxWidth: '440px', maxHeight: '45vh', overflow: 'auto', padding: '18px', background: '#fff',
                    color: record.status === 'FAILED' ? '#a51d28' : '#172338', border: '2px solid currentColor',
                    borderRadius: '8px', boxShadow: '0 4px 24px #0003', font: '15px system-ui', whiteSpace: 'pre-wrap' });
                const text = document.createElement('div');
                text.textContent = `InvoiceBot: ${record.status.replaceAll('_', ' ')}\nInvoice: ${record.invoiceNumber || 'Not available'}\nFile: ${record.fileName || '-'}\nStage: ${record.stage}\n${record.message}`;
                panel.append(text);
                const close = document.createElement('button');
                close.type = 'button'; close.textContent = 'Dismiss';
                close.addEventListener('click', () => panel.remove());
                panel.append(close);
                document.body.append(panel);
            }, record);
        } catch (error) { console.error('Could not display status on MSIL page:', error.message); }
    }
    if (context && openReport) {
        try {
            const tab = await context.newPage();
            await tab.goto(pathToFileURL(path.join(logDir, 'report.html')).href, { timeout: 5000 });
        } catch (error) { console.error('Could not open report tab:', error.message); }
    }
}

module.exports = { LOG_DIR, writeRunResult, renderReport, displayRunResult, refreshReport, readCsvRecords, clearReport };

if (require.main === module) {
    try {
        if (process.argv.includes('--clear')) {
            const result = clearReport();
            console.log(`Cleared ${result.cleared} report entries. History archived at: ${result.archiveDir}`);
        } else refreshReport();
        console.log('Updated CSV logs and report:', path.join(LOG_DIR, 'report.html'));
    } catch (error) {
        console.error('Could not update report:', error.message);
        console.error('Close CSV files in Excel and retry. Existing history or its archive is preserved.');
        process.exitCode = 1;
    }
}
