// Synthetic invoice PDF for tests; independent of files being archived from pending.
function invoicePdf(vendorCode = 'R487') {
    const lines = ['Invoice No / Dt.: 1000000001 / 23.10.2026',
        `Customer / Vendor Code : 17804 /${vendorCode}`,
        'Supplier GSTIN: 06AAAAA0000A1Z5', 'Receiver GSTIN: 06BBBBB0000B1Z5'];
    const stream = `BT /F1 12 Tf 50 750 Td ${lines.map((line, index) => `${index ? '0 -20 Td ' : ''}(${line}) Tj`).join('\n')} ET`;
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
    let text = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(text));
        text += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(text);
    text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    text += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(text);
}

module.exports = { invoicePdf };
