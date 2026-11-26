const fs = require('fs');
const path = require('path');
const { By } = require('selenium-webdriver');
const { launchBrowser } = require('./browser');
const { navigateToReceipt, isReceiptUrl } = require('./navigation');
const { readRequests } = require('./config');
const { fillForm, readResultDocument, submitReport } = require('./probe');
const { cleanUrl } = require('./inspect');
const { META, parseReport, writeCsv } = require('./export');
const { addResult, writeWorkbook } = require('./workbook');
const { jobKey, loadResume } = require('./resume');

function isRetryable(error) {
    return error.name === 'TimeoutError' || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION|network error/i.test(error.message || '');
}

async function withRetries(operation, recover, { attempts = 3, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            if (attempt > 1) await recover();
            return await operation();
        } catch (error) {
            if (attempt >= attempts || !isRetryable(error)) throw error;
            console.log(`Temporary error: ${error.message}. Returning to Home and retrying (${attempt + 1}/${attempts}).`);
            await delay(attempt * 3000);
        }
    }
}

async function waitForResult(driver, home, job, plant) {
    return driver.wait(async () => {
        try {
            const alert = await driver.switchTo().alert();
            const message = await alert.getText();
            await alert.accept();
            throw new Error(`Portal validation: ${message}`);
        } catch (error) { if (error.name !== 'NoSuchAlertError') throw error; }
        for (const handle of await driver.getAllWindowHandles()) {
            await driver.switchTo().window(handle);
            await driver.switchTo().defaultContent();
            const url = new URL(await driver.getCurrentUrl());
            if (url.origin !== home.origin) continue;
            if (!/\/Delivery\/Queries\/UnloadNoGeneration\.aspx$/i.test(url.pathname)) {
                if (/login|default\.aspx/i.test(url.pathname)) throw new Error('Portal session expired. Log in and run again.');
                continue;
            }
            const actual = [url.searchParams.get('UnDt')?.toUpperCase(), url.searchParams.get('SRVno')?.toUpperCase(),
                url.searchParams.get('VCode')?.toUpperCase(), url.searchParams.get('SRVType')];
            const expected = [job.date, 'ALL', job.vendor, job.srvType === 'OE' ? 'O' : 'S'];
            if (actual.join('|') !== expected.join('|')) throw new Error('Result parameters differ from the requested date/vendor/type.');
            const data = await driver.executeScript(readResultDocument);
            if (!data) throw new Error('Portal returned a login page.');
            if (data.ready !== 'complete') continue;
            if (!data.text.includes(`Company : ${plant.name}`)) throw new Error('Result company differs from the selected plant.');
            if (!data.tables.some(table => table.id === 'tbl')) continue;
            return data;
        }
        return false;
    }, 90000, 'Timed out waiting for the receipt report. See saved page details.', 1000);
}

async function returnToForm(driver, home, plant, navigate = navigateToReceipt) {
    const url = await driver.getCurrentUrl();
    if (isReceiptUrl(url, plant, home.origin)) return plant;
    const back = await driver.findElements(By.id('ctl00_ContentPlaceHolderBody_imgBack'));
    if (back.length === 1) {
        await back[0].click();
        try {
            await driver.wait(async () => isReceiptUrl(await driver.getCurrentUrl(), plant, home.origin), 60000, 'Back did not return to the receipt form.', 1000);
            return plant;
        } catch (error) {
            if (error.name !== 'TimeoutError') throw error;
            console.log('Back did not reach the receipt form. Reopening it through the portal menu.');
        }
    }
    return await navigate(driver, home, plant, { fromCurrent: true });
}

async function saveArtifacts(driver, directory, data) {
    fs.mkdirSync(directory, { recursive: true });
    if (data) {
        data = structuredClone(data);
        data.url = cleanUrl(data.url);
        data.links.forEach(link => { link.href = cleanUrl(link.href); });
        fs.writeFileSync(path.join(directory, 'page.json'), JSON.stringify(data, null, 2));
        fs.writeFileSync(path.join(directory, 'page.txt'), data.text);
    }
    try { fs.writeFileSync(path.join(directory, 'page.png'), await driver.takeScreenshot(), 'base64'); }
    catch { /* Browser may have been closed. The CSV still records the error. */ }
}

async function main() {
    const args = process.argv.slice(2);
    const csvIndex = args.indexOf('--csv');
    if (csvIndex !== -1 && !args[csvIndex + 1]) throw new Error('Supply a file after --csv.');
    const resumeIndex = args.indexOf('--resume');
    if (resumeIndex !== -1 && (!args[resumeIndex + 1] || args[resumeIndex + 1].startsWith('--'))) throw new Error('Supply the saved run folder after --resume.');
    if (resumeIndex !== -1 && (csvIndex !== -1 || args.includes('--first') || args.includes('--plan') || args.includes('--until-data'))) throw new Error('--resume cannot be combined with --csv, --first, --plan or --until-data.');
    const directory = resumeIndex === -1 ? path.join(__dirname, '..', 'unload-reports', new Date().toISOString().replace(/[:.]/g, '-')) : path.resolve(args[resumeIndex + 1]);
    const resumed = resumeIndex === -1 ? null : loadResume(directory);
    let jobs = resumed ? resumed.jobs : readRequests(csvIndex === -1 ? undefined : path.resolve(args[csvIndex + 1]));
    if (args.includes('--first')) jobs = jobs.slice(0, 1);
    console.log(`Report queries: ${jobs.length}. SRV number is always ALL. Both runs OE and Spares separately.`);
    if (args.includes('--plan')) {
        console.table(jobs.map(job => ({ PlantCode: job.code, Date: job.date, VendorCode: job.vendor, SRVType: job.srvType })));
        return;
    }
    const home = new URL('https://vendorextranet.maruti.co.in/');
    fs.mkdirSync(directory, { recursive: true });
    const reportFile = path.join(directory, 'receipts.xlsx');
    const statusFile = path.join(directory, 'query-status.csv');
    const plants = resumed?.plants || new Map(), statuses = resumed?.statuses || [];
    const completed = resumed?.completed || new Set();
    if (!resumed) {
        fs.writeFileSync(path.join(directory, 'requests.json'), JSON.stringify(jobs, null, 2));
        writeCsv(statusFile, statuses, [...META, 'Records', 'DetailsFolder']);
    } else console.log(`Resuming: ${completed.size} completed queries will be skipped.`);
    if (completed.size === jobs.length) { console.log('All saved queries are already complete.'); return; }
    console.log('Output:', reportFile);
    const driver = await launchBrowser();
    let cancelled = false;
    let plant;
    let failures = 0;
    let foundData = false;
    process.once('SIGINT', () => { cancelled = true; driver.quit().catch(() => {}); });
    try {
        await driver.get(home.href);
        for (const [index, job] of jobs.entries()) {
            if (cancelled) break;
            if (completed.has(jobKey(job))) continue;
            let data;
            let metadata = { PlantName: '', Date: job.date, VendorCode: job.vendor, SRVType: job.srvType, CompCode: job.code };
            const details = path.join(directory, `${String(index + 1).padStart(3, '0')}-${job.code}-${job.date}-${job.vendor}-${job.srvType}`);
            try {
                console.log(`[${index + 1}/${jobs.length}] ${job.code} ${job.date} ${job.vendor} ${job.srvType}`);
                await withRetries(async () => {
                    if (cancelled) throw new Error('Stopped by user.');
                    if (!plant || plant.code !== job.code) {
                        plant = await navigateToReceipt(driver, home, { code: job.code, homeUrl: plant?.homeUrl }, { fromCurrent: !!plant });
                    } else plant = await returnToForm(driver, home, plant);
                    metadata.PlantName = plant.displayName;
                    await fillForm(driver, job);
                    await submitReport(driver);
                    data = await waitForResult(driver, home, job, plant);
                }, async () => {
                    if (cancelled) throw new Error('Stopped by user.');
                    if (!plant?.homeUrl) throw new Error('Cannot recover automatically without a logged-in Home page. Restart and resume the run.');
                    plant = await navigateToReceipt(driver, home, { code: job.code, homeUrl: plant.homeUrl }, { fromCurrent: true });
                });
                const parsed = parseReport(data);
                await saveArtifacts(driver, details, data);
                addResult(plants, plant, parsed, job.srvType);
                const common = { ...metadata, Result: parsed.status, Reason: parsed.reason };
                statuses.push({ ...common, Records: parsed.records.length, DetailsFolder: details });
                console.log(`  ${parsed.status}: ${parsed.records.length} records`);
                if (args.includes('--until-data') && parsed.records.length) {
                    foundData = true;
                    console.log('First non-empty report exported. Stopping this test run.');
                    break;
                }
            } catch (error) {
                failures++;
                const common = { ...metadata, Result: 'FAILED', Reason: cancelled ? 'Stopped by user.' : error.message };
                statuses.push({ ...common, Records: 0, DetailsFolder: details });
                await saveArtifacts(driver, details, data).catch(() => {});
                console.error('  FAILED:', common.Reason);
                // Stop on unknown layouts/session problems so a batch cannot silently
                // produce incomplete data or attach a stale report to another date.
                console.error('Batch stopped. Remaining requests are unprocessed; see requests.json.');
                break;
            } finally {
                writeCsv(statusFile, statuses, [...META, 'Records', 'DetailsFolder']);
                await writeWorkbook(reportFile, plants);
            }
            if (index < jobs.length - 1) await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } finally { await driver.quit().catch(() => {}); }
    console.log(`Completed ${statuses.length}/${jobs.length} queries; failures: ${failures}.`);
    console.log('Excel workbook:', reportFile);
    console.log('Query status:', statusFile);
    if (failures || (!foundData && statuses.length !== jobs.length)) process.exitCode = 1;
}
module.exports = { waitForResult, returnToForm, saveArtifacts, isRetryable, withRetries };
if (require.main === module) main().catch(error => { console.error('Receipt bot error:', error.message); process.exitCode = 1; });
