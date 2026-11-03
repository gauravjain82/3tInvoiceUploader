const { chromium } = require('playwright');

(async () => {

    const context = await chromium.launchPersistentContext(
        'C:\\InvoiceBot\\edge-profile',
        {
            channel: 'msedge',
            headless: false,
            viewport: null
        }
    );

    const pages = context.pages();
    const page = pages.length ? pages[0] : await context.newPage();

    console.log('========================================');
    console.log('      MSIL AUTOMATION TEST');
    console.log('========================================');
    console.log('');
    console.log('1. Insert pen drive');
    console.log('2. Login to MSIL manually');
    console.log('3. Open Digital Invoice Uploading');
    console.log('');
    console.log('Waiting 2 minutes...');
    console.log('');

    // Give you time to login manually
    await page.waitForTimeout(120000);

    console.log('========================================');
    console.log('PAGE INFORMATION');
    console.log('========================================');

    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    // --------------------------------------------------
    // Find controls
    // --------------------------------------------------

    const controls = page.locator(
        'button, input[type="button"], input[type="submit"], input[type="file"], select'
    );

    const count = await controls.count();

    console.log('');
    console.log('========================================');
    console.log('CONTROLS FOUND:', count);
    console.log('========================================');

    for (let i = 0; i < count; i++) {

        const el = controls.nth(i);

        try {

            console.log(
                i,
                'tag:', await el.evaluate(e => e.tagName),
                'type:', await el.getAttribute('type'),
                'id:', await el.getAttribute('id'),
                'name:', await el.getAttribute('name'),
                'value:', await el.getAttribute('value')
            );

        } catch (e) {

            console.log(i, 'Unable to inspect element');

        }
    }


    // --------------------------------------------------
    // Read Vendor dropdown
    // --------------------------------------------------

    console.log('');
    console.log('========================================');
    console.log('AVAILABLE VENDORS');
    console.log('========================================');

    const vendorDropdown = page.locator('#drpVend');

    if (await vendorDropdown.count() > 0) {

        const vendors = await vendorDropdown
            .locator('option')
            .evaluateAll(options =>
                options.map(o => ({
                    text: o.textContent.trim(),
                    value: o.value,
                    selected: o.selected
                }))
            );

        vendors.forEach((vendor, index) => {

            console.log(
                `${index}:`,
                `Text="${vendor.text}"`,
                `Value="${vendor.value}"`,
                vendor.selected ? '<-- CURRENTLY SELECTED' : ''
            );

        });

    } else {

        console.log('Vendor dropdown (#drpVend) NOT FOUND');

    }


    // --------------------------------------------------
    // Read Billing Company dropdown
    // --------------------------------------------------

    console.log('');
    console.log('========================================');
    console.log('AVAILABLE BILLING COMPANIES');
    console.log('========================================');

    const companyDropdown = page.locator('#drpComp');

    if (await companyDropdown.count() > 0) {

        const companies = await companyDropdown
            .locator('option')
            .evaluateAll(options =>
                options.map(o => ({
                    text: o.textContent.trim(),
                    value: o.value,
                    selected: o.selected
                }))
            );

        companies.forEach((company, index) => {

            console.log(
                `${index}:`,
                `Text="${company.text}"`,
                `Value="${company.value}"`,
                company.selected ? '<-- CURRENTLY SELECTED' : ''
            );

        });

    } else {

        console.log('Billing Company dropdown (#drpComp) NOT FOUND');

    }


    // --------------------------------------------------
    // Current selections
    // --------------------------------------------------

    console.log('');
    console.log('========================================');
    console.log('CURRENT SELECTION');
    console.log('========================================');

    if (await vendorDropdown.count() > 0) {

        const vendorValue = await vendorDropdown.inputValue();

        const vendorText = await vendorDropdown
            .locator('option:checked')
            .textContent();

        console.log(
            'Vendor:',
            vendorText?.trim(),
            '| Value:',
            vendorValue
        );
    }


    if (await companyDropdown.count() > 0) {

        const companyValue = await companyDropdown.inputValue();

        const companyText = await companyDropdown
            .locator('option:checked')
            .textContent();

        console.log(
            'Billing Company:',
            companyText?.trim(),
            '| Value:',
            companyValue
        );
    }


    console.log('');
    console.log('========================================');
    console.log('TEST COMPLETE');
    console.log('========================================');
    console.log('');
    console.log('No invoice was uploaded.');
    console.log('No Confirm button was clicked.');
    console.log('');
    console.log('Browser will remain open for 10 minutes.');

    // Keep browser open
    await page.waitForTimeout(600000);

})();