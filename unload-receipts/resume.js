const fs = require('fs');
const path = require('path');
const { parseCsv } = require('../csv-log');
const { parseReport } = require('./export');
const { addResult } = require('./workbook');
const { parseDate } = require('./config');

function jobKey(job) { return JSON.stringify([job.code, job.date, job.vendor, job.srvType]); }

function findLatestRun(root) {
    if (!fs.existsSync(root)) throw new Error('No saved unload receipt runs were found.');
    const names = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(entry.name))
        .map(entry => entry.name).sort().reverse();
    if (!names.length) throw new Error('No saved unload receipt runs were found.');
    return path.join(root, names[0]);
}

function loadResume(directory) {
    const jobs = JSON.parse(fs.readFileSync(path.join(directory, 'requests.json'), 'utf8'));
    if (!Array.isArray(jobs) || !jobs.length) throw new Error('Saved request plan is empty or invalid.');
    for (const job of jobs) {
        if (!job || !/^\d{2}$/.test(job.code) || !/^[A-Z0-9-]+$/.test(job.vendor) || !['OE', 'Spares'].includes(job.srvType) || !/^\d{2}-[A-Z]{3}-\d{4}$/.test(job.date)) throw new Error('Saved request plan contains an invalid query.');
        parseDate(job.date);
    }
    const keys = new Set(jobs.map(jobKey));
    if (keys.size !== jobs.length) throw new Error('Saved request plan contains duplicate queries.');
    const [header, ...rows] = parseCsv(fs.readFileSync(path.join(directory, 'query-status.csv'), 'utf8'));
    const expected = ['PlantName', 'Date', 'VendorCode', 'SRVType', 'CompCode', 'Result', 'Reason', 'Records', 'DetailsFolder'];
    if (!header || expected.some(key => !header.includes(key))) throw new Error('Saved query status has missing columns.');
    const plants = new Map(), statuses = [], completed = new Set();
    for (const values of rows.filter(row => row.some(Boolean))) {
        const row = Object.fromEntries(header.map((key, index) => [key, values[index]]));
        const key = jobKey({ code: row.CompCode, date: row.Date, vendor: row.VendorCode, srvType: row.SRVType });
        if (!keys.has(key)) throw new Error('Saved status contains a query outside the saved plan.');
        if (!['SUCCESS', 'NO_DATA'].includes(row.Result)) continue;
        if (completed.has(key)) throw new Error('Saved status contains duplicate completed queries.');
        const index = jobs.findIndex(job => jobKey(job) === key);
        const job = jobs[index];
        const details = path.join(directory, `${String(index + 1).padStart(3, '0')}-${job.code}-${job.date}-${job.vendor}-${job.srvType}`);
        const result = row.Result === 'NO_DATA' ? { status: 'NO_DATA' }
            : parseReport(JSON.parse(fs.readFileSync(path.join(details, 'page.json'), 'utf8')));
        if (result.status !== row.Result || (row.Result === 'SUCCESS' && result.records.length !== Number(row.Records))) {
            throw new Error('Saved report does not match its recorded status.');
        }
        addResult(plants, { code: row.CompCode, displayName: row.PlantName }, result, row.SRVType);
        statuses.push({ ...row, DetailsFolder: details });
        completed.add(key);
    }
    return { jobs, plants, statuses, completed };
}
module.exports = { jobKey, loadResume, findLatestRun };
