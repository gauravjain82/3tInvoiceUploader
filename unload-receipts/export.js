const fs = require('fs');
const path = require('path');
const META = ['PlantName', 'Date', 'VendorCode', 'SRVType', 'CompCode', 'Result', 'Reason'];

function parseReport(data) {
    if (!data || !/\/Delivery\/Queries\/UnloadNoGeneration\.aspx(?:[?#]|$)/i.test(data.url)) throw new Error('The expected receipt result page was not reached.');
    if (/session.{0,30}expired|please.{0,30}log.?in|access denied|unauthori[sz]ed/i.test(data.text)) throw new Error('Portal session expired or access was denied.');
    const noData = /no\s+data\s+found/i.test(data.reportText || data.text);
    if (noData) return { status: 'NO_DATA', records: [], headers: [], reason: 'No Data Found' };
    const candidates = data.tables.filter(table => table.visible && (table.inReport || /grid|datagrid/i.test(table.id))
        && table.rows.length > 1 && table.rows.some(row => row.length > 1));
    const grid = candidates.find(table => table.rows[0].some(cell => cell.tag === 'TH'))
        || candidates.find(table => table.id === 'tbl') || (candidates.length === 1 ? candidates[0] : null);
    if (!grid) throw new Error('Report table layout is unrecognized. Page details saved for inspection.');
    const rows = grid.rows.filter(row => row.some(cell => cell.text.trim()));
    const headings = rows.shift();
    if (!headings || headings.length < 2 || headings.some(cell => cell.colspan > 1 || cell.rowspan > 1)) throw new Error('Report has a merged or unrecognized header. Page details saved.');
    const used = new Set(META);
    const headers = headings.map((cell, index) => {
        const original = cell.text.replace(/\s+/g, ' ').trim() || `Column${index + 1}`;
        let name = original;
        let suffix = 2;
        while (used.has(name)) name = `${original}_${suffix++}`;
        used.add(name);
        return name;
    });
    const records = [];
    const values = [];
    for (const row of rows) {
        if (row.every((cell, index) => cell.text.trim() === headings[index]?.text.trim())) continue;
        if (row.length !== headers.length || row.some(cell => cell.colspan > 1 || cell.rowspan > 1)) throw new Error('Report contains merged rows or pagination that needs inspection. No partial result exported.');
        records.push(Object.fromEntries(row.map((cell, index) => [headers[index], cell.text.trim()])));
        values.push(row.map(cell => cell.text.trim()));
    }
    if (!records.length) throw new Error('Report is empty without an explicit No Data Found message.');
    const paging = data.links.some(link => /Page\$|Page%24|Page\(|NextPage|LastPage/i.test(link.href || '') || /^(next|last|[›»])$/i.test(link.text.trim()));
    if (paging) throw new Error('Report has paging controls. Page details saved; refusing to export an incomplete result.');
    return { status: 'SUCCESS', records, headers, columns: headings.map(cell => cell.text.trim()), values, reason: '' };
}

function csvCell(value) {
    let text = String(value ?? '');
    // Keep data cells from executing as formulas when the report is opened in Excel.
    if (/^[\s]*[=+@]/.test(text) || /^\s*-[^\d.]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
}
function writeCsv(file, rows, initialColumns = META) {
    const columns = [...initialColumns];
    for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    const text = '\uFEFF' + columns.map(csvCell).join(',') + '\r\n' + rows.map(row => columns.map(key => csvCell(row[key])).join(',') + '\r\n').join('');
    const temp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
}
module.exports = { META, parseReport, writeCsv };
