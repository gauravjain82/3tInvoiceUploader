const fs = require('fs');
const path = require('path');
const { By } = require('selenium-webdriver');
const { parseCsv } = require('../csv-log');

function readPlants(csvPath = path.join(__dirname, '..', 'unload-plants.csv')) {
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter(row => row.some(value => value.trim()));
    const header = (rows.shift() || []).map(value => value.trim());
    if (header.join(',') !== 'CompCode,CompName') throw new Error('unload-plants.csv must have columns CompCode,CompName.');
    const plants = rows.map((row, index) => {
        const code = (row[0] || '').trim();
        const name = (row[1] || '').trim();
        if (row.length !== 2 || !/^\d{1,2}$/.test(code) || !/^[A-Za-z0-9_-]+$/.test(name)) {
            throw new Error(`Invalid plant on CSV row ${index + 2}. Supply a code and exact portal CompName.`);
        }
        return { code: code.padStart(2, '0'), name };
    });
    if (!plants.length) throw new Error('Add a plant to unload-plants.csv before running.');
    return plants;
}

function isReceiptUrl(value, plant, origin) {
    const url = new URL(value);
    return url.origin === origin && /\/Delivery\/Queries\/ParamUnloadNoGeneration\.aspx$/i.test(url.pathname)
        && url.searchParams.get('CompCode') === plant.code && url.searchParams.get('CompName') === plant.name;
}

async function navigateToReceipt(driver, home, plant, { fromCurrent = false } = {}) {
    async function waitPage(pathname, timeout = 60000) {
        return driver.wait(async () => {
            for (const handle of await driver.getAllWindowHandles()) {
                try {
                    await driver.switchTo().window(handle);
                    await driver.switchTo().defaultContent();
                    const url = new URL(await driver.getCurrentUrl());
                    if (url.origin === home.origin && url.pathname.toLowerCase() === pathname.toLowerCase()) return url;
                } catch (error) {
                    if (!/NoSuchWindow|StaleElementReference/.test(error.name)) throw error;
                }
            }
            return false;
        }, timeout, `Did not reach ${pathname}. Check the browser for a login/session error.`, 1000);
    }
    async function clickLink(fragment) {
        const link = await driver.findElement(By.css(`a[href*="${fragment}"]`));
        const href = await link.getAttribute('href');
        if (new URL(href, home).origin !== home.origin) throw new Error('Unexpected external menu link; navigation stopped.');
        // Legacy hover menus can hide their anchors. Invoke the actual captured
        // anchor's click handler rather than constructing a protected page URL.
        if (await link.isDisplayed()) await link.click();
        else await driver.executeScript('arguments[0].click();', link);
    }
    if (!fromCurrent) {
        console.log('Waiting for manual login and the logged-in Home page (up to 15 minutes).');
        await waitPage('/MainMenu.aspx', 15 * 60 * 1000);
    } else {
        const current = new URL(await driver.getCurrentUrl());
        if (current.origin !== home.origin) throw new Error('Portal session is unavailable.');
    }
    console.log('Home detected. Opening Delivery → Queries.');
    await clickLink('Delivery/Queries/comp_code3.aspx');
    await waitPage('/Delivery/Queries/comp_code3.aspx');
    console.log(`Selecting plant ${plant.code}${plant.name ? ' / ' + plant.name : ''} from the portal list.`);
    const candidates = await driver.findElements(By.css(`input[type="submit"][id^="${plant.code}_"]`));
    if (candidates.length !== 1) throw new Error(`Plant ${plant.code} was not uniquely found in the portal plant list.`);
    const button = candidates[0];
    if (!await button.isDisplayed() || !await button.isEnabled()) throw new Error('Configured plant is unavailable for this login.');
    const plantId = await button.getAttribute('id');
    const plantName = await button.getAttribute('value');
    const portalName = plantId.slice(plant.code.length + 1);
    if (plant.name && portalName !== plant.name) throw new Error('Plant code/name does not match the portal list.');
    plant = { ...plant, name: portalName, displayName: plantName };
    await button.click();
    await waitPage('/Delivery/Queries/Querymenu3.aspx');
    const receiptLink = await driver.findElement(By.css('a[href*="ParamUnloadNoGeneration.aspx"]'));
    const receiptUrl = new URL(await receiptLink.getAttribute('href'), await driver.getCurrentUrl());
    if (receiptUrl.origin !== home.origin || receiptUrl.searchParams.get('CompCode') !== plant.code
        || receiptUrl.searchParams.get('CompName') !== plant.name) throw new Error('Receipt link plant differs from CSV. Navigation stopped.');
    console.log('Opening Supply: Unload Number Wise Receipt Report.');
    await clickLink('ParamUnloadNoGeneration.aspx');
    const finalUrl = await waitPage('/Delivery/Queries/ParamUnloadNoGeneration.aspx');
    if (!isReceiptUrl(finalUrl.href, plant, home.origin)) throw new Error('The receipt page opened for a different plant.');
    await driver.findElement(By.id('ctl00_ContentPlaceHolderBody_txtUnloadDate'));
    console.log(`READY: Unload receipt page for ${plant.code} / ${plant.name}. No report submitted.`);
    return plant;
}

module.exports = { readPlants, isReceiptUrl, navigateToReceipt };
