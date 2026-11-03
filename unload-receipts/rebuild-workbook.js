// Re-export saved, successful queries without opening the portal or submitting again.
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('../csv-log');
const { parseReport } = require('./export');
const { addResult, writeWorkbook } = require('./workbook');

async function rebuild(directory) {
    const [header, ...rows] = parseCsv(fs.readFileSync(path.join(directory, 'query-status.csv'), 'utf8'));
    const plants = new Map();
    for (const values of rows.filter(row => row.some(Boolean))) {
        const row = Object.fromEntries(header.map((key, index) => [key, values[index]]));
        if (!['SUCCESS', 'NO_DATA'].includes(row.Result)) continue;
        const parsed = row.Result === 'NO_DATA' ? { status: 'NO_DATA' }
            : parseReport(JSON.parse(fs.readFileSync(path.join(row.DetailsFolder, 'page.json'), 'utf8')));
        addResult(plants, { code: row.CompCode, displayName: row.PlantName }, parsed);
    }
    const file = path.join(directory, 'receipts.xlsx');
    await writeWorkbook(file, plants);
    console.log('Excel workbook:', file);
    return file;
}
module.exports = { rebuild };
if (require.main === module) {
    if (!process.argv[2]) { console.error('Supply the saved run directory.'); process.exitCode = 1; }
    else rebuild(path.resolve(process.argv[2])).catch(error => { console.error(error.message); process.exitCode = 1; });
}
