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

function fixture(wrongPlant = false, initialPath = '/MainMenu.aspx', homeClickWorks = true) {
    const origin = 'https://vendorextranet.maruti.co.in';
    let url = origin + initialPath;
    const clicked = [];
    const driver = {
        getAllWindowHandles: async () => ['main'],
        switchTo: () => ({ window: async () => {}, defaultContent: async () => {} }),
        getCurrentUrl: async () => url,
        wait: async fn => { const result = await fn(); if (!result) { const error = new Error('Timed out'); error.name = 'TimeoutError'; throw error; } return result; },
        get: async target => { clicked.push('saved Home'); url = target; },
        findElements: async () => [await driver.findElement({ value: '02_MSILM' })],
        findElement: async locator => {
            const value = locator.value;
            let target;
            if (value.includes('comp_code3')) target = '/Delivery/Queries/comp_code3.aspx';
            else if (value.includes('02_MSILM')) target = '/Delivery/Queries/Querymenu3.aspx';
            else if (value.includes('ParamUnloadNoGeneration')) target = '/Delivery/Queries/ParamUnloadNoGeneration.aspx?CompCode=' + (wrongPlant ? '01' : '02') + '&CompName=MSILM';
            else assert.match(value, /txtUnloadDate/);
            return { href: origin + target,
                click: async () => { clicked.push(value); url = origin + target; } };
        },
        executeScript: async (script, element) => {
            if (typeof script === 'function') { clicked.push('Home'); if (homeClickWorks) url = origin + '/MainMenu.aspx'; return true; }
            if (script.includes('getClientRects')) return { id: '02_MSILM', value: 'MARUTI SUZUKI INDIA LTD - MANESAR VEHICLE', available: true };
            if (script.includes('.click()')) return element.click();
            if (script.includes('.href')) return element.href;
            throw new Error('Unexpected script');
        },
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

test('returns to Home before selecting a different plant from a report page', async () => {
    const { driver, clicked } = fixture(false, '/Delivery/Queries/UnloadNoGeneration.aspx');
    await navigateToReceipt(driver, new URL('https://vendorextranet.maruti.co.in/'), { code: '02', name: 'MSILM' }, { fromCurrent: true });
    assert.equal(clicked[0], 'Home');
    assert.match(clicked[1], /comp_code3/);
});

test('uses the previously observed logged-in Home URL if the Home control does not navigate', async () => {
    const { driver, clicked } = fixture(false, '/Delivery/Queries/UnloadNoGeneration.aspx', false);
    const homeUrl = 'https://vendorextranet.maruti.co.in/MainMenu.aspx?session=example';
    const result = await navigateToReceipt(driver, new URL('https://vendorextranet.maruti.co.in/'), { code: '02', name: 'MSILM', homeUrl }, { fromCurrent: true });
    assert.deepEqual(clicked.slice(0, 2), ['Home', 'saved Home']);
    assert.equal(result.homeUrl, homeUrl);
});

test('rejects an external saved Home URL', async () => {
    const { driver, clicked } = fixture(false, '/Delivery/Queries/UnloadNoGeneration.aspx', false);
    await assert.rejects(navigateToReceipt(driver, new URL('https://vendorextranet.maruti.co.in/'), { code: '02', homeUrl: 'https://example.com/MainMenu.aspx' }, { fromCurrent: true }), /invalid/);
    assert.deepEqual(clicked, ['Home']);
});

test('wrong plant in menu stops before clicking the receipt link', async () => {
    const { driver, clicked } = fixture(true);
    await assert.rejects(navigateToReceipt(driver, new URL('https://vendorextranet.maruti.co.in/'), { code: '02', name: 'MSILM' }), /differs from CSV/);
    assert.equal(clicked.length, 2);
});
