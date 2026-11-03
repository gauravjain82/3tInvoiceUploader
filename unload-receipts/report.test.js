const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readRequests, parseDate, formatDate } = require('./config');
const { parseReport, writeCsv } = require('./export');
const { parseCsv } = require('../csv-log');

function tempFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unload-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'test.csv');
}
test('includes both date endpoints, leap day and both types without duplicates', t => {
    const file = tempFile(t);
    fs.writeFileSync(file, 'CompCode,FromDate,ToDate,VendorCode,SRVType\n2,28-FEB-2024,01-MAR-2024,R487,Both\n02,29-FEB-2024,29-FEB-2024,R487,OE\n');
    const jobs = readRequests(file);
    assert.equal(jobs.length, 6);
    assert.deepEqual(jobs.map(job => job.date), ['28-FEB-2024', '28-FEB-2024', '29-FEB-2024', '29-FEB-2024', '01-MAR-2024', '01-MAR-2024']);
    assert.equal(jobs[0].code, '02');
    assert.equal(jobs.at(-1).srvType, 'Spares');
    assert.equal(formatDate(parseDate('31-OCT-2026')), '31-OCT-2026');
});
test('rejects impossible dates, reversed ranges, invalid type and missing vendor before browser launch', t => {
    const file = tempFile(t);
    for (const row of ['02,31-FEB-2026,31-MAR-2026,R487,OE', '02,02-OCT-2026,01-OCT-2026,R487,Both',
        '02,01-OCT-2026,01-OCT-2026,R487,Anything', '02,01-OCT-2026,01-OCT-2026,,OE']) {
        fs.writeFileSync(file, 'CompCode,FromDate,ToDate,VendorCode,SRVType\n' + row);
        assert.throws(() => readRequests(file));
    }
});
const result = () => ({ url: 'https://vendorextranet.maruti.co.in/Delivery/Queries/UnloadNoGeneration.aspx', text: '', reportText: '', links: [], tables: [] });
const cell = (text, tag = 'TD') => ({ text, tag, colspan: 1, rowspan: 1 });
test('keeps all report values and makes duplicate/metadata headers distinct', () => {
    const data = result();
    data.tables = [{ id: 'tbl', visible: true, inReport: true, rows: [
        [cell('Date', 'TH'), cell('Unload No', 'TH'), cell('Unload No', 'TH')],
        [cell('01-OCT-2026'), cell('0000123'), cell('A, "B"\nC')]
    ] }];
    const parsed = parseReport(data);
    assert.equal(parsed.status, 'SUCCESS');
    assert.deepEqual(parsed.records, [{ Date_2: '01-OCT-2026', 'Unload No': '0000123', 'Unload No_2': 'A, "B"\nC' }]);
});
test('no data is explicit; unknown and paginated layouts cannot pass as success', () => {
    const data = result();
    data.text = 'No Data Found !.';
    assert.equal(parseReport(data).status, 'NO_DATA');
    data.text = '';
    assert.throws(() => parseReport(data), /unrecognized/);
    data.tables = [{ id: 'tbl', visible: true, inReport: true, rows: [[cell('Invoice'), cell('Quantity')], [cell('001'), cell('20')]] }];
    data.links = [{ href: "javascript:__doPostBack('grid','Page$2')", text: '2' }];
    assert.throws(() => parseReport(data), /paging/);
});
test('CSV preserves commas, quotes, multiline text, zero prefixes and adds new report columns', t => {
    const file = tempFile(t);
    writeCsv(file, [{ PlantName: 'Manesar, Vehicle', Date: '01-OCT-2026', VendorCode: 'R487', SRVType: 'OE', Invoice: '000123', Note: 'A "quoted"\nline' }]);
    const parsed = parseCsv(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed[1][parsed[0].indexOf('Invoice')], '000123');
    assert.equal(parsed[1][parsed[0].indexOf('Note')], 'A "quoted"\nline');
});
