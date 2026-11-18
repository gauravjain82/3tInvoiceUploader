const test = require('node:test');
const assert = require('node:assert/strict');
const { readResultDocument, submitReport } = require('./probe');

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
