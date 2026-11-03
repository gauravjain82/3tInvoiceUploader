const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('./bot');
const { archiveInvoice } = require('./batch');
const { readCsvRecords } = require('./run-log');

function fixture(t, folders = { Manesar: ['a.pdf'] }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'invoicebot-folder-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const options = { pendingDir: path.join(root, 'pending'), uploadedDir: path.join(root, 'uploaded'),
        failedDir: path.join(root, 'failed'), logDir: path.join(root, 'logs'),
        mappingFile: path.join(root, 'billing-company.csv'), keepBrowserOpen: false, vendorCode: 'A893' };
    fs.writeFileSync(options.mappingFile, 'FolderName,BillingCompanyCode\nManesar,2\nGurgaon,1\n');
    fs.mkdirSync(options.pendingDir);
    for (const [folder, names] of Object.entries(folders)) {
        const dir = path.join(options.pendingDir, folder);
        fs.mkdirSync(dir, { recursive: true });
        for (const name of names) fs.writeFileSync(path.join(dir, name), 'No parseable PDF text. Only the MSIL server reads this file.');
    }
    return options;
}

function saved(invoiceNumber = '12345') {
    return { finalSaveClicked: true, screenText: 'Data saved successfully.', invoiceNumber };
}

test('all company folders are processed sequentially without parsing PDFs and retain their archive folders', async t => {
    const options = fixture(t, { Manesar: ['a.pdf', 'b-rejected.pdf', 'c-preview.pdf'], Gurgaon: ['a.pdf'] });
    let active = 0;
    const calls = [];
    const summary = await main({ ...options, processInvoice: async (invoice, company, source, run) => {
        assert.equal(++active, 1);
        calls.push(invoice.fileName);
        try {
            assert.equal(invoice.invoiceNumber, null);
            assert.equal(invoice.vendorCode, 'A893');
            assert.equal(company, invoice.folderName === 'Gurgaon' ? '01' : '02');
            await new Promise(resolve => setTimeout(resolve, 5));
            run.stage = 'UPLOAD_PREVIEW';
            if (source.endsWith('b-rejected.pdf')) throw new Error('MSIL rejected invoice: invalid IRN');
            if (source.endsWith('c-preview.pdf')) return { finalSaveClicked: false };
            return saved();
        } finally { active--; }
    } });
    assert.deepEqual(calls, ['Gurgaon', 'Manesar', 'Manesar', 'Manesar'].map((folder, index) => path.join(folder, ['a.pdf', 'a.pdf', 'b-rejected.pdf', 'c-preview.pdf'][index])));
    assert.deepEqual(summary.counts, { SUCCESS: 2, FAILED: 1, PREVIEW_ONLY: 1 });
    assert.ok(fs.existsSync(path.join(options.uploadedDir, 'Gurgaon', 'a.pdf')));
    assert.ok(fs.existsSync(path.join(options.uploadedDir, 'Manesar', 'a.pdf')));
    assert.ok(fs.existsSync(path.join(options.failedDir, 'Manesar', 'b-rejected.pdf')));
    assert.ok(fs.existsSync(path.join(options.pendingDir, 'Manesar', 'c-preview.pdf')));
    assert.equal(summary.records[0].invoiceNumber, '12345');
    assert.equal(summary.records[0].billingCompany, '01');
    assert.match(readCsvRecords(options.logDir, 'failed.csv')[0].message, /invalid IRN/);
});

test('unmapped company folders and loose PDFs fail without opening MSIL', async t => {
    const options = fixture(t, { Unmapped: ['unknown.pdf'] });
    fs.writeFileSync(path.join(options.pendingDir, 'loose.pdf'), 'No PDF parsing');
    const summary = await main({ ...options, processInvoice: () => assert.fail('Unmapped files must never reach MSIL') });
    assert.equal(summary.records.length, 2);
    assert.ok(summary.records.every(row => row.status === 'FAILED' && row.stage === 'RESOLVE_FOLDER'));
    assert.ok(fs.existsSync(path.join(options.failedDir, 'Unmapped', 'unknown.pdf')));
    assert.ok(fs.existsSync(path.join(options.failedDir, 'loose.pdf')));
});

test('dry-run validates folders only, skips other files and deeper folders, and moves nothing', async t => {
    const options = fixture(t, { Manesar: ['a.pdf', 'ignore.txt'], Unknown: ['b.pdf'] });
    fs.mkdirSync(path.join(options.pendingDir, 'Manesar', 'nested'));
    fs.writeFileSync(path.join(options.pendingDir, 'Manesar', 'nested', 'ignored.pdf'), 'Not a direct company-folder PDF');
    const summary = await main({ ...options, dryRun: true, vendorCode: undefined, processInvoice: () => assert.fail('Dry-run must not open MSIL') });
    assert.deepEqual(summary.counts, { DRY_RUN: 1, FAILED: 1 });
    assert.ok(fs.existsSync(path.join(options.pendingDir, 'Manesar', 'a.pdf')));
    assert.ok(fs.existsSync(path.join(options.pendingDir, 'Unknown', 'b.pdf')));
    assert.equal(fs.existsSync(options.uploadedDir), false);
    assert.equal(fs.existsSync(options.failedDir), false);
});

for (const failFirst of [false, true]) {
    test(`--first is enforced across folders after ${failFirst ? 'failure' : 'success'}`, async t => {
        const options = fixture(t, { Manesar: ['a.pdf'], Gurgaon: ['b.pdf', 'a.pdf'] });
        const summary = await main({ ...options, limit: 1, processInvoice: async invoice => {
            assert.equal(invoice.fileName, path.join('Gurgaon', 'a.pdf'));
            if (failFirst) throw new Error('First invoice rejected');
            return saved();
        } });
        assert.equal(summary.total, 3);
        assert.equal(summary.processed, 1);
        assert.equal(summary.remaining, 2);
        assert.ok(fs.existsSync(path.join(options.pendingDir, 'Gurgaon', 'b.pdf')));
        assert.ok(fs.existsSync(path.join(options.pendingDir, 'Manesar', 'a.pdf')));
        assert.ok(fs.existsSync(path.join(failFirst ? options.failedDir : options.uploadedDir, 'Gurgaon', 'a.pdf')));
    });
}

test('shared login/browser failures stop and leave remaining PDFs pending', async t => {
    const options = fixture(t, { Manesar: ['a.pdf', 'b.pdf'] });
    const summary = await main({ ...options, processInvoice: async (invoice, company, source, run) => {
        run.stage = 'VERIFY_LOGIN_VENDOR';
        throw new Error('Vendor is not available for current login');
    } });
    assert.equal(summary.stopped, true);
    assert.equal(summary.remaining, 1);
    assert.equal(fs.readdirSync(path.join(options.pendingDir, 'Manesar')).length, 2);
    assert.equal(fs.existsSync(options.failedDir), false);
});

test('an unverified Save is not archived as uploaded and carries a manual-check flag', async t => {
    const options = fixture(t);
    const summary = await main({ ...options, processInvoice: async () => ({ finalSaveClicked: true, screenText: 'No success message' }) });
    assert.equal(summary.records[0].status, 'FAILED');
    assert.equal(summary.records[0].manualCheckRequired, true);
    assert.equal(fs.existsSync(options.uploadedDir), false);
    assert.ok(fs.existsSync(path.join(options.failedDir, 'Manesar', 'a.pdf')));
});

test('a live run requires the explicitly entered vendor ID', async t => {
    const options = fixture(t);
    const result = await main({ ...options, vendorCode: undefined, processInvoice: () => assert.fail('Vendor is required') });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.stage, 'VALIDATE_VENDOR');
    assert.ok(fs.existsSync(path.join(options.pendingDir, 'Manesar', 'a.pdf')));
});

test('archiving avoids collisions and rejects paths outside the archive', t => {
    const options = fixture(t);
    fs.mkdirSync(path.join(options.uploadedDir, 'Manesar'), { recursive: true });
    fs.writeFileSync(path.join(options.uploadedDir, 'Manesar', 'a.pdf'), 'Existing invoice');
    const source = path.join(options.pendingDir, 'Manesar', 'a.pdf');
    assert.throws(() => archiveInvoice(source, 'SUCCESS', { ...options, relativePath: path.join('..', 'outside.pdf') }), /inside its destination/);
    const destination = archiveInvoice(source, 'SUCCESS', { ...options, relativePath: path.join('Manesar', 'a.pdf'), runId: 'collision' });
    assert.equal(path.basename(destination), 'a--collision-1.pdf');
    assert.equal(fs.readFileSync(path.join(options.uploadedDir, 'Manesar', 'a.pdf'), 'utf8'), 'Existing invoice');
});