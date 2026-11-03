const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPlants, isReceiptUrl, navigateToReceipt } = require('./navigation');

test('reads configured plant and rejects empty or malformed CSV', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unload-plants-'));
    const file = path.join(dir, 'plants.csv');
    try {
        fs.writeFileSync(file, '\uFEFFCompCode,CompName\r\n2,MSILM\r\n');
        assert.deepEqual(readPlants(file), [{ code: '02', name: 'MSILM' }]);
        fs.writeFileSync(file, 'CompCode,CompName\n');
        assert.throws(() => readPlants(file), /Add a plant/);
        fs.writeFileSync(file, 'CompCode,CompName\n02,\n');
        assert.throws(() => readPlants(file), /Invalid plant/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('receipt verification rejects wrong plant and foreign origin', () => {
    const origin = 'https://vendorextranet.maruti.co.in';
    const plant = { code: '02', name: 'MSILM' };
    const route = '/Delivery/Queries/ParamUnloadNoGeneration.aspx?CompCode=02&CompName=MSILM';
    assert.equal(isReceiptUrl(origin + route, plant, origin), true);
    assert.equal(isReceiptUrl(origin + route.replace('02', '01'), plant, origin), false);
    assert.equal(isReceiptUrl('https://example.com' + route, plant, origin), false);
});

function fixture(wrongPlant = false) {
    const origin = 'https://vendorextranet.maruti.co.in';
    let url = origin + '/MainMenu.aspx';
    const clicked = [];
    const driver = {
        getAllWindowHandles: async () => ['main'],
        switchTo: () => ({ window: async () => {}, defaultContent: async () => {} }),
        getCurrentUrl: async () => url,
        wait: async fn => { const result = await fn(); assert.ok(result); return result; },
        findElements: async () => [await driver.findElement({ value: '02_MSILM' })],
        findElement: async locator => {
            const value = locator.value;
            let target;
            if (value.includes('comp_code3')) target = '/Delivery/Queries/comp_code3.aspx';
            else if (value.includes('02_MSILM')) target = '/Delivery/Queries/Querymenu3.aspx';
            else if (value.includes('ParamUnloadNoGeneration')) target = '/Delivery/Queries/ParamUnloadNoGeneration.aspx?CompCode=' + (wrongPlant ? '01' : '02') + '&CompName=MSILM';
            else assert.match(value, /txtUnloadDate/);
            return { getAttribute: async name => name === 'id' ? '02_MSILM' : name === 'value' ? 'MARUTI SUZUKI INDIA LTD - MANESAR VEHICLE' : origin + target, isDisplayed: async () => true, isEnabled: async () => true,
                click: async () => { clicked.push(value); url = origin + target; } };
        }
    };
    return { driver, clicked };
}

test('navigation performs only the three menu/plant clicks and stops before report submission', async () => {
    const { driver, clicked } = fixture();
    await navigateToReceipt(driver, new URL('https://vendorextranet.maruti.co.in/'), { code: '02', name: 'MSILM' });
    assert.equal(clicked.length, 3);
    assert.match(clicked[1], /02_MSILM/);
    assert.match(clicked[2], /ParamUnloadNoGeneration/);
    assert.ok(clicked.every(value => !/btnSubmit|btnSave/.test(value)));
});

test('wrong plant in menu stops before clicking the receipt link', async () => {
    const { driver, clicked } = fixture(true);
    await assert.rejects(navigateToReceipt(driver, new URL('https://vendorextranet.maruti.co.in/'), { code: '02', name: 'MSILM' }), /differs from CSV/);
    assert.equal(clicked.length, 2);
});
