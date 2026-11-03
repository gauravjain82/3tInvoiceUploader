// Read-only discovery: opens the page and records its DOM. Never clicks or submits.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const PORTAL_HOME = 'https://vendorextranet.maruti.co.in/';
const OUTPUT_DIR = path.join(__dirname, 'logs', 'unload-receipt-inspection');

async function inspectFrame(frame) {
    return frame.evaluate(() => {
        function labelFor(element) {
            const label = Array.from(document.querySelectorAll('label')).find(label => label.htmlFor === element.id);
            if (label) return label.innerText.trim();
            const cell = element.closest('td');
            return (cell?.previousElementSibling?.innerText || element.getAttribute('aria-label') || element.title || '').trim().slice(0, 200);
        }
        const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="password"]), select, textarea, button')).map(element => ({
            tag: element.tagName.toLowerCase(), id: element.id, name: element.name || '',
            type: element.type || '', label: labelFor(element),
            text: element.tagName === 'BUTTON' ? element.innerText.trim() : '',
            value: /password|passwd|token|otp|captcha|verification|username|user.?id|login.?id|email/i.test([element.id, element.name].join(' ')) ? '[redacted]' : element.value || '', visible: !!element.getClientRects().length,
            disabled: !!element.disabled, readOnly: !!element.readOnly, required: !!element.required,
            min: element.getAttribute('min'), max: element.getAttribute('max'), pattern: element.getAttribute('pattern'),
            maxLength: element.getAttribute('maxlength'), placeholder: element.getAttribute('placeholder'),
            onchange: element.getAttribute('onchange'), onclick: element.getAttribute('onclick'),
            options: element.tagName === 'SELECT' ? Array.from(element.options).slice(0, 100).map(option => ({
                value: option.value, text: option.textContent.trim(), selected: option.selected, disabled: option.disabled
            })) : undefined
        }));
        return {
            title: document.title, url: location.href, text: document.body.innerText,
            forms: Array.from(document.forms).map(form => ({ id: form.id, method: form.method,
                action: form.getAttribute('action'), hiddenFieldNames: Array.from(form.querySelectorAll('input[type="hidden"]')).map(input => input.name)
            })),
            controls,
            validators: Array.from(window.Page_Validators || []).map(validator => ({
                id: validator.id, controlToValidate: validator.controltovalidate,
                message: validator.errormessage || validator.innerText, validationGroup: validator.validationGroup,
                enabled: validator.enabled !== false, initialValue: validator.initialvalue
            })),
            reportLinks: Array.from(document.querySelectorAll('a')).filter(link =>
                /download|print|pdf|excel|export|unload|receipt|generate|search|view/i.test(link.innerText)
            ).map(link => ({ id: link.id, text: link.innerText.trim(), href: link.getAttribute('href'), onclick: link.getAttribute('onclick') })),
            plantLinks: Array.from(document.querySelectorAll('a[href]')).filter(link => /[?&]CompCode=/i.test(link.getAttribute('href')))
                .map(link => ({ id: link.id, text: link.innerText.trim(), href: link.getAttribute('href') })),
            navigationLinks: Array.from(document.querySelectorAll('a, [role="menuitem"]')).filter(link => link.getClientRects().length)
                .slice(0, 200).map(link => ({ id: link.id, text: link.innerText.trim(), href: link.getAttribute('href'), onclick: link.getAttribute('onclick') }))
        };
    });
}

async function main() {
    const homeIndex = process.argv.indexOf('--home-url');
    if (homeIndex !== -1 && !process.argv[homeIndex + 1]) throw new Error('Supply the working portal home URL after --home-url.');
    const homeUrl = new URL(homeIndex === -1 ? PORTAL_HOME : process.argv[homeIndex + 1]);
    if (!['https:', 'http:'].includes(homeUrl.protocol)) throw new Error('The home URL must use http or https.');
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'edge-profile'), {
        channel: 'msedge', headless: false, viewport: null, acceptDownloads: false
    });
    try {
        const page = await context.newPage();
        console.log('READ-ONLY: opening the vendor portal home/login page. No automated clicks, submissions or downloads.');
        try {
            await page.goto(homeUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (error) {
            if (!/ERR_CERT_/.test(error.message)) throw error;
            console.error('Portal certificate validation failed. Certificate checks remain enabled.');
            console.error('Resolve the portal certificate/trust problem before login. Edge is left open so you can see the error.');
        }
        const initial = new URL(page.url());
        console.log('Current page:', initial.origin + initial.pathname);
        console.log('1. Log in manually to the vendor portal in this Edge window.');
        console.log('2. Pause on the logged-in home page; its navigation controls will be recorded.');
        console.log('3. Open the relevant menus normally, then the plant and unload receipt page. Each new menu state is recorded.');
        console.log('Waiting up to 15 minutes. The inspector will not directly navigate to the protected receipt URL.');
        const deadline = Date.now() + 15 * 60 * 1000;
        const captured = new Set();
        const sessionDir = path.join(OUTPUT_DIR, new Date().toISOString().replace(/[:.]/g, '-'));
        while (Date.now() < deadline) {
            if (!context.pages().length) throw new Error('Edge was closed before inspection completed.');
            for (const tab of context.pages()) {
                for (const frame of tab.frames()) {
                    if (!/^https:\/\/vendorextranet\.maruti\.co\.in(?:\/|$)/i.test(frame.url())) continue;
                    const receiptPage = /^https:\/\/vendorextranet\.maruti\.co\.in\/Delivery\/Queries\/ParamUnloadNoGeneration\.aspx(?:[?#]|$)/i.test(frame.url());
                    try {
                        if (await frame.locator('input[type="password"]:visible').count()) continue;
                        const text = await frame.locator('body').innerText({ timeout: 2000 });
                        if (/session.{0,30}expired|please.{0,30}log.?in|access denied|unauthori[sz]ed/i.test(text)) continue;
                        if (receiptPage && !await frame.locator('input:not([type="hidden"]), select, button').count()) continue;
                        const inspection = await inspectFrame(frame);
                        const signature = createHash('sha256').update(JSON.stringify({ url: inspection.url,
                            controls: inspection.controls.filter(control => control.visible), links: inspection.navigationLinks })).digest('hex');
                        if (captured.has(signature)) continue;
                        if (captured.size >= 50) throw new Error('Captured 50 navigation states. Restart inspection if more are needed.');
                        fs.mkdirSync(sessionDir, { recursive: true });
                        const prefix = receiptPage ? 'page' : `navigation-${String(captured.size + 1).padStart(2, '0')}`;
                        fs.writeFileSync(path.join(sessionDir, `${prefix}-controls.json`), JSON.stringify(inspection, null, 2));
                        fs.writeFileSync(path.join(sessionDir, `${prefix}-text.txt`), inspection.text);
                        await tab.screenshot({ path: path.join(sessionDir, `${prefix}.png`), fullPage: true });
                        captured.add(signature);
                        console.log('Navigation snapshot saved:', path.join(sessionDir, `${prefix}-controls.json`));
                        console.log('Page title:', inspection.title);
                        if (!receiptPage) {
                            console.log('Visible menu links:', JSON.stringify(inspection.navigationLinks.map(link => ({ id: link.id, text: link.text }))));
                            continue;
                        }
                        console.log('Controls:', JSON.stringify(inspection.controls));
                        console.log('Validation rules:', JSON.stringify(inspection.validators));
                        console.log('Report links:', JSON.stringify(inspection.reportLinks));
                        console.log('Plant links:', JSON.stringify(inspection.plantLinks));
                        console.log('Inspection complete. Edge remains open for review; close it when finished.');
                        await new Promise(resolve => context.once('close', resolve));
                        return;
                    } catch (error) {
                        if (tab.isClosed() || frame.isDetached() || error.name === 'TimeoutError' || /Execution context was destroyed/.test(error.message)) continue;
                        throw error;
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('Timed out waiting for the unload receipt page. Any home/menu snapshots are retained for inspection.');
    } finally {
        await context.close();
    }
}

module.exports = { inspectFrame };
if (require.main === module) main().catch(error => { console.error('Inspection error:', error.message); process.exitCode = 1; });
