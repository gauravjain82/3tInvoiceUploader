const fs = require('fs');
const path = require('path');
const { parseCsv } = require('../csv-log');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function parseDate(value) {
    const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(value.toUpperCase());
    if (!match) throw new Error(`Invalid date "${value}". Use DD-MON-YYYY.`);
    const month = MONTHS.indexOf(match[2]);
    const day = Number(match[1]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day));
    if (month < 0 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) throw new Error(`Invalid date "${value}".`);
    return date;
}
function formatDate(date) {
    return `${String(date.getUTCDate()).padStart(2, '0')}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}
function readRequests(file = path.join(__dirname, '..', 'unload-requests.csv')) {
    const rows = parseCsv(fs.readFileSync(file, 'utf8')).filter(row => row.some(value => value.trim()));
    if ((rows.shift() || []).map(value => value.trim()).join(',') !== 'CompCode,FromDate,ToDate,VendorCode,SRVType') {
        throw new Error('Expected CSV columns: CompCode,FromDate,ToDate,VendorCode,SRVType');
    }
    const jobs = [];
    const seen = new Set();
    for (const [index, raw] of rows.entries()) {
        const [code, from, to, vendor, type] = raw.map(value => value.trim());
        if (raw.length !== 5 || !/^\d{1,2}$/.test(code) || !/^[A-Za-z0-9-]+$/.test(vendor || '') || !/^(BOTH|OE|SPARES)$/i.test(type || '')) {
            throw new Error(`Invalid request CSV row ${index + 2}. Check plant, vendor and SRVType (Both, OE or Spares).`);
        }
        const start = parseDate(from), end = parseDate(to);
        if (start > end) throw new Error(`FromDate is after ToDate on CSV row ${index + 2}.`);
        const types = type.toUpperCase() === 'BOTH' ? ['OE', 'Spares'] : [type.toUpperCase() === 'OE' ? 'OE' : 'Spares'];
        for (let current = start.getTime(); current <= end.getTime(); current += 86400000) {
            for (const srvType of types) {
                const job = { code: code.padStart(2, '0'), date: formatDate(new Date(current)), vendor: vendor.toUpperCase(), srvType };
                const key = JSON.stringify(job);
                if (!seen.has(key)) { jobs.push(job); seen.add(key); }
            }
        }
    }
    if (!jobs.length) throw new Error('No report requests found in CSV.');
    return jobs;
}
module.exports = { parseDate, formatDate, readRequests };
