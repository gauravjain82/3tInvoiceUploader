const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function worksheetName(plantName, usedNames = new Set()) {
    // Excel sheet names are limited to 31 characters and disallow these symbols.
    let name = plantName.replace(/[\\/*?:\[\]\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
    if (name.length > 31) name = name.replace(/^MARUTI SUZUKI INDIA (?:LIMITED|LTD\.?)\s*-?\s*/i, '');
    if (name.length > 31) name = name.replace(/\bPLANT\s*/i, '').replace(/\s+/g, ' ').trim();
    name = name.slice(0, 31).replace(/'+$/g, '') || 'Plant';
    const base = name;
    let suffix = 2;
    while (usedNames.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
        const tail = ` (${suffix++})`;
        name = base.slice(0, 31 - tail.length).replace(/'+$/g, '') + tail;
    }
    usedNames.add(name.toLowerCase());
    return name;
}

function addResult(plants, plant, result) {
    const key = plant.code;
    let sheet = plants.get(key);
    if (!sheet) {
        sheet = { plantName: plant.displayName, columns: [], values: [] };
        plants.set(key, sheet);
    }
    if (result.status !== 'SUCCESS') return;
    if (!result.columns?.length || !Array.isArray(result.values)) throw new Error('Report columns or values are missing.');
    if (sheet.columns.length && JSON.stringify(sheet.columns) !== JSON.stringify(result.columns)) {
        throw new Error('Report columns changed for this plant. Stopped to preserve the exact portal layout.');
    }
    if (result.values.some(row => row.length !== result.columns.length)) throw new Error('Report row width differs from its header.');
    if (sheet.values.length + result.values.length > 1048575) throw new Error('This plant exceeds the Excel worksheet row limit.');
    sheet.columns = [...result.columns];
    sheet.values.push(...result.values.map(row => [...row]));
}

async function writeWorkbook(file, plants) {
    if (!plants.size) return;
    const workbook = new ExcelJS.Workbook();
    const usedNames = new Set();
    for (const plant of plants.values()) {
        const sheet = workbook.addWorksheet(worksheetName(plant.plantName, usedNames));
        if (!plant.columns.length) continue; // No fake rows/columns for empty reports.
        sheet.addRow(plant.columns);
        // Values stay as strings: preserves leading zeroes and long identifiers,
        // and prevents source text beginning with '=' becoming an Excel formula.
        sheet.addRows(plant.values);
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: plant.columns.length } };
        sheet.columns.forEach((column, index) => {
            column.width = Math.min(45, Math.max(14, plant.columns[index].length + 2));
            column.numFmt = '@';
        });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp';
    await workbook.xlsx.writeFile(temporary);
    fs.renameSync(temporary, file);
}

module.exports = { worksheetName, addResult, writeWorkbook };
