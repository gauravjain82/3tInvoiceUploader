const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { worksheetName, addResult, writeWorkbook } = require('./workbook');

test('sheet names retain plant names within Excel limits and remain unique', () => {
    const used = new Set();
    const name = worksheetName('MARUTI SUZUKI INDIA LTD - MANESAR POWERTRAIN PLANT - ENGINE', used);
    assert.ok(name.length <= 31);
    assert.match(name, /MANESAR.*ENGINE/);
    assert.notEqual(worksheetName('MARUTI SUZUKI INDIA LTD - MANESAR POWERTRAIN PLANT - ENGINE', used), name);
    assert.doesNotMatch(worksheetName('Plant / Test: [A]*?', used), /[\\/*?:\[\]]/);
});

test('xlsx has one sheet per plant, exact source headers and no added metadata or no-data rows', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unload-excel-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'receipts.xlsx');
    const plants = new Map();
    const plant = { code: '20', displayName: 'MANESAR ENGINE' };
    const columns = ['VENDOR_CODE', 'Date', 'BILL_NUMBER', 'Notes'];
    addResult(plants, plant, { status: 'SUCCESS', columns, values: [['R487', '01-OCT-2026', '000123456789012345', '=1+1']] });
    addResult(plants, plant, { status: 'NO_DATA' });
    addResult(plants, plant, { status: 'SUCCESS', columns, values: [['R487', '02-OCT-2026', '000124', 'A, "B"\nC']] });
    addResult(plants, { code: '02', displayName: 'MANESAR VEHICLE' }, { status: 'NO_DATA' });
    await writeWorkbook(file, plants);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(file);
    assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['MANESAR ENGINE', 'MANESAR VEHICLE']);
    const sheet = book.worksheets[0];
    assert.deepEqual(sheet.getRow(1).values.slice(1), columns);
    assert.equal(sheet.columnCount, 4);
    assert.equal(sheet.rowCount, 3);
    assert.equal(sheet.getCell('C2').value, '000123456789012345');
    assert.equal(sheet.getCell('D2').value, '=1+1');
    assert.equal(sheet.getCell('D2').type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell('D3').value, 'A, "B"\nC');
    assert.equal(book.worksheets[1].rowCount, 0);
});

test('inconsistent source columns stop before mixing mismatched rows', () => {
    const plants = new Map();
    const plant = { code: '20', displayName: 'MANESAR ENGINE' };
    addResult(plants, plant, { status: 'SUCCESS', columns: ['BILL_NUMBER'], values: [['001']] });
    assert.throws(() => addResult(plants, plant, { status: 'SUCCESS', columns: ['OTHER'], values: [['002']] }), /columns changed/);
    assert.equal(plants.get('20').values.length, 1);
});
