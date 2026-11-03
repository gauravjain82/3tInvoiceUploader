// Separate, read-only IE-mode inspector. Never clicks or submits portal forms.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Builder, By } = require('selenium-webdriver');
const ie = require('selenium-webdriver/ie');

// This function executes in IE11: keep its syntax compatible with ES5.
function readPage() {
    function list(nodes) { return Array.prototype.slice.call(nodes); }
    function visible(el) { return !!el.getClientRects().length; }
    if (list(document.querySelectorAll('input[type="password"]')).some(visible)) return null;
    function text(el) { return (el.innerText || el.textContent || '').replace(/^\s+|\s+$/g, ''); }
    var body = document.body ? text(document.body) : '';
    if (/session.{0,30}expired|please.{0,30}log.?in|access denied|unauthori[sz]ed/i.test(body)) return null;
    return {
        title: document.title, url: location.href, documentMode: document.documentMode || null, text: body,
        controls: list(document.querySelectorAll('input,select,textarea,button')).filter(function (el) {
            return el.type !== 'hidden' && el.type !== 'password';
        }).map(function (el) {
            var label = document.querySelector('label[for="' + el.id.replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
            var cell = el.parentElement;
            while (cell && cell.tagName !== 'TD') cell = cell.parentElement;
            return { tag: el.tagName, id: el.id, name: el.name, type: el.type,
                label: label ? text(label) : (cell && cell.previousElementSibling ? text(cell.previousElementSibling) : el.title || ''),
                value: /pass|token|otp|captcha|verification|user|login|email/i.test(el.id + ' ' + el.name) ? '[redacted]' : el.value,
                visible: visible(el), disabled: el.disabled, readOnly: el.readOnly,
                required: el.required, onchange: el.getAttribute('onchange'), onclick: el.getAttribute('onclick'),
                options: el.tagName === 'SELECT' ? list(el.options).map(function (option) {
                    return { value: option.value, text: text(option), selected: option.selected };
                }) : null };
        }),
        links: list(document.querySelectorAll('a,[role="menuitem"]')).filter(visible).slice(0, 200).map(function (el) {
            return { id: el.id, text: text(el), href: el.getAttribute('href'), onclick: el.getAttribute('onclick') };
        }),
        forms: list(document.forms).map(function (form) {
            return { id: form.id, method: form.method, action: form.getAttribute('action'),
                hiddenFieldNames: list(form.querySelectorAll('input[type="hidden"]')).map(function (el) { return el.name; }) };
        }),
        validators: list(window.Page_Validators || []).map(function (el) {
            return { id: el.id, control: el.controltovalidate, message: el.errormessage || text(el), enabled: el.enabled !== false };
        })
    };
}

function cleanUrl(value) {
    if (!value || /^(javascript:|#)/i.test(value)) return value;
    try {
        const url = new URL(value, 'https://vendorextranet.maruti.co.in/');
        for (const key of [...url.searchParams.keys()]) {
            if (!/^(CompCode|CompName)$/i.test(key)) url.searchParams.set(key, '[redacted]');
        }
        url.hash = '';
        return url.href;
    } catch { return '[unreadable URL]'; }
}

async function main() {
    const autoNavigate = process.argv.includes('--navigate');
    const navigation = autoNavigate ? require('./navigation') : null;
    const plant = autoNavigate ? navigation.readPlants()[0] : null;
    const index = process.argv.indexOf('--home-url');
    if (index !== -1 && !process.argv[index + 1]) throw new Error('Supply a URL after --home-url.');
    const home = new URL(index === -1 ? 'https://vendorextranet.maruti.co.in/' : process.argv[index + 1]);
    if (!/^https?:$/.test(home.protocol)) throw new Error('Home URL must use http or https.');
    const edgePath = [process.env.UNLOAD_EDGE_EXE,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(value => value && fs.existsSync(value));
    if (!edgePath) throw new Error('Edge not found. Set UNLOAD_EDGE_EXE to msedge.exe.');
    const driverPath = process.env.UNLOAD_IE_DRIVER || path.join(__dirname, 'drivers', 'IEDriverServer.exe');
    if (!fs.existsSync(driverPath)) throw new Error('IEDriver missing. See unload-receipts/README.md.');
    const options = new ie.Options().setEdgeChromium(true).setEdgePath(edgePath);
    options.set('pageLoadStrategy', 'eager');
    const service = new ie.ServiceBuilder(driverPath);
    console.log('Starting separate IE-mode receipt bot. Invoice uploader files and profile are not used.');
    if (plant) console.log(`Navigation only: first configured plant ${plant.code} / ${plant.name}.`);
    const driver = await new Builder().forBrowser('ie').setIeOptions(options).setIeService(service).build();
    let stopping = false;
    process.once('SIGINT', () => { stopping = true; driver.quit().catch(() => {}); });
    const output = path.join(__dirname, '..', 'logs', 'unload-receipt-inspection', new Date().toISOString().replace(/[:.]/g, '-'));
    const seen = new Set();
    let deadline = Date.now() + 15 * 60 * 1000;
    async function capture(depth) {
        const current = await driver.executeScript('return location.href;');
        if (new URL(current).origin === home.origin) {
            const data = await driver.executeScript(readPage);
            if (data) {
                data.url = cleanUrl(data.url);
                data.links.forEach(link => { link.href = cleanUrl(link.href); });
                data.forms.forEach(form => { form.action = cleanUrl(form.action); });
                const hash = crypto.createHash('sha256').update(JSON.stringify({ url: data.url, controls: data.controls, links: data.links })).digest('hex');
                if (!seen.has(hash) && seen.size < 50) {
                    fs.mkdirSync(output, { recursive: true });
                    const prefix = `navigation-${String(seen.size + 1).padStart(2, '0')}`;
                    fs.writeFileSync(path.join(output, prefix + '-controls.json'), JSON.stringify(data, null, 2));
                    fs.writeFileSync(path.join(output, prefix + '-text.txt'), data.text);
                    try { fs.writeFileSync(path.join(output, prefix + '.png'), await driver.takeScreenshot(), 'base64'); }
                    catch (error) { console.log('Screenshot unavailable:', error.name); }
                    seen.add(hash);
                    console.log(`Captured: ${data.title} | IE document mode: ${data.documentMode} | ${prefix}`);
                    console.log('Saved:', output);
                }
            }
        }
        if (depth >= 5) return;
        const frames = await driver.findElements(By.css('iframe,frame'));
        for (const frame of frames) {
            try { await driver.switchTo().frame(frame); await capture(depth + 1); }
            finally { await driver.switchTo().parentFrame(); }
        }
    }
    try {
        await driver.manage().setTimeouts({ pageLoad: 60000, script: 10000, implicit: 0 });
        await driver.get(home.href);
        if (autoNavigate) {
            await navigation.navigateToReceipt(driver, home, plant);
            deadline = Date.now() + 15 * 60 * 1000;
        }
        if (!autoNavigate) {
        console.log('Log in manually. Pause on Home, then navigate through menus to plant selection and unload receipts.');
        console.log('Read-only capture for 15 minutes. No automatic selection, submission or download yet. Press Ctrl+C to stop.');
        } else console.log('Stopped on the receipt form. Capturing page details for review; close this window or press Ctrl+C when finished.');
        while (!stopping && Date.now() < deadline) {
            const handles = await driver.getAllWindowHandles();
            if (!handles.length) break;
            for (const handle of handles) {
                try { await driver.switchTo().window(handle); await driver.switchTo().defaultContent(); await capture(0); }
                catch (error) {
                    if (/NoSuchWindow|StaleElementReference|NoSuchFrame|Javascript|UnexpectedAlertOpen/.test(error.name)) continue;
                    if (!stopping) throw error;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        console.log('Inspection ended. Saved snapshots remain in:', output);
    } finally { await driver.quit().catch(() => {}); }
}

module.exports = { readPage, cleanUrl };
if (require.main === module) main().catch(error => {
    console.error('IE-mode inspection error:', error.message);
    console.error('If IEDriver reports Protected Mode or zoom settings, see unload-receipts/README.md.');
    process.exitCode = 1;
});
