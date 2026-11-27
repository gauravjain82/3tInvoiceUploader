const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeCsv, META } = require('./export');
const { loadResume, jobKey, findLatestRun } = require('./resume');

test('selects the latest timestamped run, including incomplete folders', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-latest-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.throws(() => findLatestRun(root), /No saved/);
    for (const name of ['2026-11-26T10-26-56-928Z', '2026-11-27T12-28-26-792Z', 'other']) fs.mkdirSync(path.join(root, name));
    const latest = findLatestRun(root);
    assert.equal(path.basename(latest), '2026-11-27T12-28-26-792Z');
    assert.throws(() => loadResume(latest), /ENOENT/);
});

test('resume reconstructs successful sheets and leaves failed queries to retry', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-resume-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const jobs = [
        { code: '01', date: '01-NOV-2026', vendor: 'O099', srvType: 'OE' },
        { code: '01', date: '01-NOV-2026', vendor: 'O099', srvType: 'Spares' },
        { code: '01', date: '02-NOV-2026', vendor: 'O099', srvType: 'OE' }
    ];
    fs.writeFileSync(path.join(directory, 'requests.json'), JSON.stringify(jobs));
    const details = path.join(directory, '001-01-01-NOV-2026-O099-OE');
    fs.mkdirSync(details);
    const cell = text => ({ text, tag: 'TD', colspan: 1, rowspan: 1 });
    fs.writeFileSync(path.join(details, 'page.json'), JSON.stringify({
        url: 'https://vendorextranet.maruti.co.in/Delivery/Queries/UnloadNoGeneration.aspx', text: '', reportText: '', links: [],
        tables: [{ id: 'tbl', visible: true, inReport: true, rows: [[cell('Number'), cell('Value')], [cell('001'), cell('A')]] }]
    }));
    const row = (job, Result, Records) => ({ PlantName: 'GURGAON', Date: job.date, VendorCode: job.vendor, SRVType: job.srvType, CompCode: job.code, Result, Reason: '', Records, DetailsFolder: 'old path' });
    writeCsv(path.join(directory, 'query-status.csv'), [row(jobs[0], 'SUCCESS', 1), row(jobs[1], 'NO_DATA', 0), row(jobs[2], 'FAILED', 0)], [...META, 'Records', 'DetailsFolder']);
    const resumed = loadResume(directory);
    assert.equal(resumed.completed.size, 2);
    assert.equal(resumed.completed.has(jobKey(jobs[2])), false);
    assert.equal(resumed.statuses.length, 2);
    assert.deepEqual(resumed.plants.get(JSON.stringify(['01', 'OE'])).values, [['001', 'A']]);
    fs.unlinkSync(path.join(details, 'page.json'));
    assert.throws(() => loadResume(directory), /ENOENT/);
});
