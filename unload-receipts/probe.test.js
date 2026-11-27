const test = require('node:test');
const assert = require('node:assert/strict');
const { readResultDocument, submitReport, selectVendor } = require('./probe');

test('waits for a vendor option to load before selecting it', async () => {
    const oldDocument = global.document;
    const select = { disabled: false, options: [], selectedIndex: -1, onchange: () => { select.changed = true; } };
    global.document = { getElementById: () => select };
    let polls = 0;
    const driver = {
        executeScript: async (fn, value) => fn(value),
        wait: async fn => {
            assert.equal(await fn(), false);
            polls++;
            select.options.push({ value: 'O099', disabled: false });
            assert.equal(await fn(), true);
        }
    };
    try {
        await selectVendor(driver, 'O099');
        assert.equal(polls, 1);
        assert.equal(select.selectedIndex, 0);
        assert.equal(select.changed, true);
    } finally { global.document = oldDocument; }
});

test('reads a legacy report document without selector APIs', () => {
    const oldDocument = global.document;
    const oldLocation = global.location;
    const report = { id: 'tbl', parentElement: null, rows: [], getClientRects: () => [1], innerText: 'Report' };
    global.location = { href: 'https://example.test/report' };
    global.document = {
        title: 'Report', readyState: 'complete', documentMode: 7, body: { innerText: 'Report' },
        getElementById: id => id === 'tbl' ? report : null,
        getElementsByTagName: tag => tag === 'table' ? [report] : []
    };
    try {
        const result = readResultDocument();
        assert.equal(result.tables[0].id, 'tbl');
        assert.equal(result.tables[0].inReport, true);
    } finally { global.document = oldDocument; global.location = oldLocation; }
});

test('submits through the page button exactly once', async () => {
    let clicks = 0;
    const oldDocument = global.document;
    global.document = { getElementById: () => ({ disabled: false, click: () => { clicks++; } }) };
    try {
        await submitReport({ executeScript: async script => Function(script)() });
        assert.equal(clicks, 1);
    } finally { global.document = oldDocument; }
});
