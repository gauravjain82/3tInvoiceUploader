// One report query to discover its actual output format before batch extraction.
const fs = require('fs');
const path = require('path');
const { By } = require('selenium-webdriver');
const { launchBrowser } = require('./browser');
const { navigateToReceipt } = require('./navigation');
const { readRequests } = require('./config');
const { cleanUrl } = require('./inspect');

async function fillForm(driver, job) {
    const vendor = await driver.findElement(By.id('ctl00_ContentPlaceHolderBody_drpVend'));
    const options = await vendor.findElements(By.css('option'));
    let found = false;
    for (const option of options) {
        if (await option.getAttribute('value') === job.vendor) { await option.click(); found = true; break; }
    }
    if (!found) throw new Error(`Vendor ${job.vendor} is unavailable for this login/plant.`);
    await driver.findElement(By.css(`#drpSrvType option[value="${job.srvType === 'OE' ? 'O' : 'S'}"]`)).click();
    const srv = await driver.findElement(By.id('ctl00_ContentPlaceHolderBody_txtSRVno'));
    await srv.clear(); await srv.sendKeys('ALL');
    // The portal calendar sets this read-only text field through JavaScript.
    await driver.executeScript('var el=document.getElementById("ctl00_ContentPlaceHolderBody_txtUnloadDate"); el.value=arguments[0]; if(el.onchange) el.onchange();', job.date);
    const actual = await driver.executeScript('return [document.getElementById("ctl00_ContentPlaceHolderBody_txtUnloadDate").value,document.getElementById("ctl00_ContentPlaceHolderBody_txtSRVno").value,document.getElementById("ctl00_ContentPlaceHolderBody_drpVend").value,document.getElementById("drpSrvType").value];');
    if (actual.join('|') !== [job.date, 'ALL', job.vendor, job.srvType === 'OE' ? 'O' : 'S'].join('|')) throw new Error('Form fields did not retain the requested values.');
}

function readResultDocument() {
    function list(nodes) { return Array.prototype.slice.call(nodes); }
    if (list(document.querySelectorAll('input[type="password"]')).some(function (el) { return el.getClientRects().length; })) return null;
    return { title: document.title, url: location.href, ready: document.readyState,
        text: document.body ? document.body.innerText : '', mode: document.documentMode,
        reportText: document.getElementById('tbl') ? document.getElementById('tbl').innerText : '',
        tables: list(document.querySelectorAll('table')).map(function (table, index) {
            var parent = table;
            var inReport = false;
            while (parent) { if (parent.id === 'tbl') inReport = true; parent = parent.parentElement; }
            return { id: table.id, index: index, visible: !!table.getClientRects().length,
                inReport: inReport,
                rows: list(table.rows).map(function (row) { return list(row.cells).map(function (cell) {
                    return { text: cell.innerText, tag: cell.tagName, colspan: cell.colSpan, rowspan: cell.rowSpan };
                }); }) };
        }), links: list(document.querySelectorAll('a')).map(function (el) { return { id: el.id, text: el.innerText, href: el.getAttribute('href') }; }),
        inputs: list(document.querySelectorAll('input:not([type="hidden"]):not([type="password"]),select')).map(function (el) { return { id: el.id, type: el.type, value: el.value }; }) };
}

async function main() {
    const jobs = readRequests();
    const dateIndex = process.argv.indexOf('--date');
    const job = dateIndex === -1 ? jobs[0] : jobs.find(item => item.date === process.argv[dateIndex + 1]);
    if (!job) throw new Error('Probe date must be inside the configured date range.');
    const home = new URL('https://vendorextranet.maruti.co.in/');
    const driver = await launchBrowser();
    const output = path.join(__dirname, '..', 'logs', 'unload-receipt-probe', new Date().toISOString().replace(/[:.]/g, '-'));
    process.once('SIGINT', () => { driver.quit().catch(() => {}); });
    try {
        await driver.get(home.href);
        const plant = await navigateToReceipt(driver, home, { code: job.code });
        await fillForm(driver, job);
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'request.json'), JSON.stringify({ ...job, plant }, null, 2));
        console.log('Submitting ONE report query:', job.date, job.vendor, job.srvType, 'SRV=ALL');
        await driver.findElement(By.id('ctl00_ContentPlaceHolderBody_btnSubmit')).click();
        await new Promise(resolve => setTimeout(resolve, 5000));
        let count = 0;
        async function capture(depth) {
            const url = new URL(await driver.executeScript('return location.href;'));
            if (url.origin === home.origin) {
                const data = await driver.executeScript(readResultDocument);
                if (data) {
                    data.url = cleanUrl(data.url);
                    data.links.forEach(link => { link.href = cleanUrl(link.href); });
                    const prefix = `result-${++count}`;
                    fs.writeFileSync(path.join(output, prefix + '.json'), JSON.stringify(data, null, 2));
                    fs.writeFileSync(path.join(output, prefix + '.txt'), data.text);
                    fs.writeFileSync(path.join(output, prefix + '.png'), await driver.takeScreenshot(), 'base64');
                    console.log('Captured:', data.title, data.url, 'Tables:', data.tables.length);
                }
            }
            if (depth >= 5) return;
            for (const frame of await driver.findElements(By.css('frame,iframe'))) {
                try { await driver.switchTo().frame(frame); await capture(depth + 1); }
                finally { await driver.switchTo().parentFrame(); }
            }
        }
        for (const handle of await driver.getAllWindowHandles()) {
            await driver.switchTo().window(handle);
            await driver.switchTo().defaultContent();
            await capture(0);
        }
        console.log('Probe saved:', output);
        console.log('Browser remains open for review for up to 15 minutes.');
        await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
    } finally { await driver.quit().catch(() => {}); }
}
module.exports = { fillForm, readResultDocument };
if (require.main === module) main().catch(error => { console.error('Probe error:', error.message); process.exitCode = 1; });
