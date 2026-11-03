const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { validateVendorCode, readStartupOptions } = require('./vendor-input');

test('vendor ID is normalized and invalid input is rejected', () => {
    assert.equal(validateVendorCode(' s123 '), 'S123');
    assert.equal(validateVendorCode('AB123'), 'AB123');
    assert.equal(validateVendorCode(' a-893 '), 'A-893');
    for (const invalid of ['', undefined, 'R 487', 'R487&Vendors=X', '../R487']) {
        assert.throws(() => validateVendorCode(invalid), /valid MSIL vendor ID/);
    }
});

test('CLI supports vendor parameter and offline checks without prompting', async () => {
    assert.deepEqual(await readStartupOptions(['--vendor', 's123']), { dryRun: false, vendorCode: 'S123' });
    assert.deepEqual(await readStartupOptions(['--dry-run']), { dryRun: true });
    assert.deepEqual(await readStartupOptions(['--first', '--vendor', 'a-893']), { dryRun: false, limit: 1, vendorCode: 'A-893' });
    await assert.rejects(readStartupOptions(['--vendor']), /valid MSIL vendor ID/);
    await assert.rejects(readStartupOptions([], { isTTY: false }), /Vendor ID is required/);
});

test('interactive startup asks for the login vendor ID', async () => {
    const input = new PassThrough();
    input.isTTY = true;
    const output = new PassThrough();
    let prompt = '';
    output.on('data', chunk => { prompt += chunk; });
    const answer = readStartupOptions([], input, output);
    setImmediate(() => input.write('s123\n'));
    assert.deepEqual(await answer, { dryRun: false, vendorCode: 'S123' });
    assert.match(prompt, /vendor ID for the user logging in/);
    input.end(); output.end();
});
