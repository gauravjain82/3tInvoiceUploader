const test = require('node:test');
const assert = require('node:assert/strict');
const { returnToForm, withRetries } = require('./run');

const home = new URL('https://vendorextranet.maruti.co.in/');
const plant = { code: '01', name: 'TEST', homeUrl: 'https://vendorextranet.maruti.co.in/MainMenu.aspx' };

test('reopens the verified plant through navigation when Back times out', async () => {
    let clicks = 0;
    const driver = {
        getCurrentUrl: async () => home.origin + '/Delivery/Queries/UnloadNoGeneration.aspx',
        findElements: async () => [{ click: async () => { clicks++; } }],
        wait: async () => { const error = new Error('Timed out'); error.name = 'TimeoutError'; throw error; }
    };
    const recovered = { ...plant, displayName: 'Recovered' };
    const result = await returnToForm(driver, home, plant, async (actualDriver, actualHome, actualPlant, options) => {
        assert.equal(actualDriver, driver);
        assert.equal(actualHome, home);
        assert.equal(actualPlant, plant);
        assert.deepEqual(options, { fromCurrent: true });
        return recovered;
    });
    assert.equal(clicks, 1);
    assert.equal(result, recovered);
});

test('does not hide other browser errors or retry navigation', async () => {
    const driver = {
        getCurrentUrl: async () => home.origin + '/Delivery/Queries/UnloadNoGeneration.aspx',
        findElements: async () => [{ click: async () => {} }],
        wait: async () => { throw new Error('Browser closed'); }
    };
    await assert.rejects(returnToForm(driver, home, plant, async () => assert.fail('must not recover')), /Browser closed/);
});

test('retries a temporary failure after returning through recovery', async () => {
    const events = [];
    const result = await withRetries(async () => {
        events.push('query');
        if (events.length === 1) { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; }
        return 'ok';
    }, async () => events.push('home'), { delay: async () => {} });
    assert.equal(result, 'ok');
    assert.deepEqual(events, ['query', 'home', 'query']);
});

test('limits retries and does not retry invalid reports', async () => {
    let attempts = 0;
    await assert.rejects(withRetries(async () => { attempts++; const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; }, async () => {}, { delay: async () => {} }), /timeout/);
    assert.equal(attempts, 3);
    attempts = 0;
    await assert.rejects(withRetries(async () => { attempts++; throw new Error('Report columns changed'); }, async () => {}, { delay: async () => {} }), /columns changed/);
    assert.equal(attempts, 1);
});
