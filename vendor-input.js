const readline = require('readline/promises');

function validateVendorCode(value) {
    const code = String(value ?? '').trim().toUpperCase();
    if (code.length < 2 || code.length > 20 || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(code)) {
        throw new Error('Enter a valid MSIL vendor ID using letters, digits and optional hyphens, for example R487 or A-893.');
    }
    return code;
}

async function readStartupOptions(args, input = process.stdin, output = process.stdout) {
    const dryRun = args.includes('--dry-run');
    const scope = args.includes('--first') ? { limit: 1 } : {};
    const vendorIndex = args.indexOf('--vendor');
    if (vendorIndex !== -1) return { dryRun, ...scope, vendorCode: validateVendorCode(args[vendorIndex + 1]) };
    // Offline folder checks do not require a login vendor.
    if (dryRun) return { dryRun, ...scope };
    if (!input.isTTY) throw new Error('Vendor ID is required. Run interactively or use node bot.js --vendor YOUR_VENDOR_ID.');
    const terminal = readline.createInterface({ input, output });
    try {
        while (true) {
            const answer = await terminal.question('Enter the MSIL vendor ID for the user logging in (for example R487): ');
            try { return { dryRun, ...scope, vendorCode: validateVendorCode(answer) }; }
            catch (error) { output.write(error.message + '\n'); }
        }
    } finally { terminal.close(); }
}

module.exports = { validateVendorCode, readStartupOptions };
