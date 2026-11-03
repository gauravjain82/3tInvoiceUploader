const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { loadBillingMapping,
    resolveBillingCompany, openInvoicePage, waitForInvoicePage, uploadInvoicePreview, confirmInvoice } = require('./bot');

const fs = require('fs');
const fixtureDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'invoicebot-browser-test-'));
const invoicePath = path.join(fixtureDir, 'oldinvoice1000000001_2000_1.pdf');
const mappingPath = path.join(fixtureDir, 'billing-company.csv');
fs.writeFileSync(mappingPath, 'FolderName,BillingCompanyCode\nManesar Vehicle,2\n');
fs.writeFileSync(invoicePath, require('./test-fixture').invoicePdf());
after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

test('folder mapping resolves company names without looking inside a PDF', () => {
    assert.deepEqual(resolveBillingCompany('MANESAR VEHICLE', loadBillingMapping(mappingPath)), { billingCompany: '02' });
    assert.throws(() => resolveBillingCompany('Unknown', loadBillingMapping(mappingPath)), /not mapped/);
    assert.throws(() => resolveBillingCompany(null, loadBillingMapping(mappingPath)), /inside a mapped subfolder/);
});

test('folder mapping supports quoted names and single-digit company codes', () => {
    const mapping = path.join(fixtureDir, 'company-2.csv');
    fs.writeFileSync(mapping, 'FolderName,BillingCompanyCode\n"Manesar, Vehicle",2\n');
    assert.equal(loadBillingMapping(mapping)['manesar, vehicle'], '02');
});

test('invalid, conflicting and old GSTIN mapping formats are rejected', () => {
    const mapping = path.join(fixtureDir, 'invalid.csv');
    for (const [contents, expected] of [
        ['GSTIN,BillingCompanyCode\n06BBBBB0000B1Z5,42\n', /FolderName,BillingCompanyCode/],
        ['FolderName,BillingCompanyCode\nManesar,2\nMANESAR,42\n', /Conflicting/],
        ['FolderName,BillingCompanyCode\n..,2\n', /Invalid/],
        ['FolderName,BillingCompanyCode\nA/B,2\n', /Invalid/]
    ]) {
        fs.writeFileSync(mapping, contents);
        assert.throws(() => loadBillingMapping(mapping), expected);
    }
});

for (const autoPreview of [false, true]) {
test(`Edge handles postbacks, ${autoPreview ? 'automatic' : 'manual'} preview, and final Save exactly once`, async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext();
        const invoiceDetails = '<table><tr><td>Document No</td><td>1000000001</td></tr></table>';
        let previewRequests = 0;
        let confirmRequests = 0;
        let previewConfirmRequests = 0;
        let uploadedBody;
        let recordFile;
        const fileRead = new Promise(resolve => { recordFile = resolve; });
        await context.exposeFunction('recordFile', recordFile);
        await context.addInitScript(autoPreview => {
            document.addEventListener('change', async event => {
                if (event.target.id !== 'fUpload') return;
                const file = event.target.files[0];
                if (autoPreview) window.recordFile({ size: file.size });
                else window.recordFile({ size: file.size, header: await file.slice(0, 5).text() });
            });
        }, autoPreview);
        await context.route('http://192.168.1.249/**', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.pathname.endsWith('/confirm')) {
                confirmRequests++;
                return route.fulfill({ contentType: 'text/html', body: '<p id="result">Data saved successfully.</p>' });
            }
            if (url.pathname.endsWith('/approve-preview')) {
                previewConfirmRequests++;
                return route.fulfill({ contentType: 'text/html', body: invoiceDetails + '<button id="btnSave" onclick="if(confirm(\'Save invoice?\')) location.href=\'/confirm\'">Confirm</button>' });
            }
            if (request.method() === 'POST') {
                previewRequests++;
                uploadedBody = request.postDataBuffer().toString('latin1');
                return route.fulfill({ contentType: 'text/html', body: autoPreview
                    ? '<div id="MyPopup"><p>PDF preview</p><button id="btnCOnfirm" onclick="this.disabled=true;location.href=\'/approve-preview\'">Confirm</button></div><button id="btnSave" disabled>Confirm</button>'
                    : invoiceDetails + '<button id="btnSave" onclick="if(confirm(\'Save invoice?\')) location.href=\'/confirm\'">Confirm</button>' });
            }
            const vendor = url.searchParams.get('vendor') || '';
            const company = url.searchParams.get('company') || '';
            return route.fulfill({ contentType: 'text/html', body: `
                <form method="post" enctype="multipart/form-data">
                <select id="drpVend" name="vendor" onchange="location.search='?vendor='+this.value">
                <option value="">Choose</option><option value="R487" ${vendor ? 'selected' : ''}>R487</option></select>
                <select id="drpComp" name="company" onchange="location.search='?vendor=R487&company='+this.value">
                <option value="">Choose</option>${vendor ? `<option value="42" ${company ? 'selected' : ''}>Manesar</option>` : ''}</select>
                <input type="file" name="invoice" id="fUpload" ${autoPreview ? 'onchange="document.getElementById(\'btnView\').click()"' : ''}><button id="btnView" ${autoPreview ? 'style="display:none"' : ''}>Preview</button>
                <button id="btnSave" type="button" onclick="location.href='/confirm'">Confirm</button></form>` });
        });
        await context.newPage(); // Login may leave an unrelated first tab open.
        const tab = await context.newPage();
        await openInvoicePage(context, 'S123', tab);
        assert.equal(tab.url(), 'http://192.168.1.249/MSILInvoice/Digital_Invoice_Upload.aspx?Vendors=S123');
        assert.equal(await openInvoicePage(context, 'R487'), tab);
        assert.equal(tab.url(), 'http://192.168.1.249/MSILInvoice/Digital_Invoice_Upload.aspx?Vendors=R487');
        const page = await waitForInvoicePage(context, 5000);
        assert.equal(page, tab.mainFrame());
        const stale = context.pages()[0];
        await stale.setContent('<select id="drpVend"><option>A-893</option></select><select id="drpComp"></select>');
        assert.equal(await waitForInvoicePage(context, 5000, tab), tab.mainFrame());
        await uploadInvoicePreview(page, { vendorCode: 'R487' }, '42', invoicePath);
        await tab.locator('#btnSave').waitFor();
        assert.equal(previewRequests, 1);
        assert.equal(confirmRequests, 0);
        assert.match(uploadedBody, /name="vendor"\r\n\r\nR487/);
        assert.match(uploadedBody, /name="company"\r\n\r\n42/);
        assert.match(uploadedBody, /filename="oldinvoice1000000001_2000_1.pdf"/);
        // Chromium's intercepted postData omits file bytes; check the actual File in the DOM.
        const file = await fileRead;
        assert.equal(file.size, require('fs').statSync(invoicePath).size);
        if (!autoPreview) assert.equal(file.header, '%PDF-');
        const result = await confirmInvoice(page);
        assert.equal(result.finalSaveClicked, true);
        assert.equal(result.invoiceNumber, '1000000001');
        assert.match(result.screenText, /Data saved successfully\./);
        assert.equal(confirmRequests, 1);
        assert.equal(previewRequests, 1);
        assert.equal(previewConfirmRequests, autoPreview ? 1 : 0);

        // A missing Confirm control must stop rather than click another control.
        await tab.goto('about:blank');
        await assert.rejects(confirmInvoice(page, 200), /Timeout/);
        assert.equal(confirmRequests, 1);
        await tab.setContent('<p>Invoice Document already exists against the selected MSIL Company.</p><button id="btnSave" disabled>Confirm</button>');
        await assert.rejects(confirmInvoice(page, 1000), /MSIL: Invoice Document already exists/);
        assert.equal(confirmRequests, 1);
        await tab.setContent('<p>Seller GSTIN not matched with Vendor GSTIN available in MSIL Vendor Master.</p><button id="btnSave" disabled>Confirm</button>');
        await assert.rejects(confirmInvoice(page, 1000), /MSIL: Seller GSTIN not matched/);
        assert.equal(confirmRequests, 1);
    } finally {
        await browser.close();
    }
});
}

test('an unverified final Save is attempted once and marked for manual checking', async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<p id="result"></p><button id="btnSave" onclick="window.saveCount=(window.saveCount||0)+1;document.getElementById('result').textContent='MSIL response unavailable'">Confirm</button>`);
        const run = {};
        await assert.rejects(confirmInvoice(page, 500, run), error => {
            assert.equal(error.finalSaveClicked, true);
            assert.match(error.message, /Check MSIL before retrying/);
            return true;
        });
        assert.equal(await page.evaluate(() => window.saveCount), 1);
        assert.equal(run.finalSaveClicked, true);
        assert.equal(run.stage, 'VERIFY_SAVE');
    } finally { await browser.close(); }
});

test('save verification waits through a temporarily missing document body without repeating Save', async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<p>Document No 1000000002</p><button id="btnSave" onclick="
            window.saveCount=(window.saveCount||0)+1;
            document.body.remove();
            setTimeout(function(){var body=document.createElement('body');body.textContent='Data saved successfully.';document.documentElement.appendChild(body);},300);
        ">Save</button>`);
        const result = await confirmInvoice(page.mainFrame(), 5000, {});
        assert.equal(result.finalSaveClicked, true);
        assert.equal(result.invoiceNumber, '1000000002');
        assert.match(result.screenText, /Data saved successfully\./);
        assert.equal(await page.evaluate(() => window.saveCount), 1);
    } finally { await browser.close(); }
});

test('a Save click error is reconciled as success when the current MSIL response confirms the save', async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<p id="result">Document No 1000000003</p><button id="btnSave" onclick="window.saveCount=(window.saveCount||0)+1;document.getElementById('result').textContent='Data saved successfully.'">Save</button>`);
        const frame = page.mainFrame();
        const originalLocator = frame.locator.bind(frame);
        frame.locator = selector => {
            const locator = originalLocator(selector);
            if (selector === '#btnSave') {
                const click = locator.click.bind(locator);
                locator.click = async options => { await click(options); throw new Error('Simulated click timeout after server saved'); };
            }
            return locator;
        };
        const run = {};
        const result = await confirmInvoice(frame, 5000, run);
        assert.equal(result.finalSaveClicked, true);
        assert.equal(result.invoiceNumber, '1000000003');
        assert.equal(run.stage, 'VERIFY_SAVE');
        assert.match(result.screenText, /Data saved successfully\./);
        assert.equal(await page.evaluate(() => window.saveCount), 1);
    } finally { await browser.close(); }
});
