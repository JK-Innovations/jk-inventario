/** Read selectable text from a PDF in the browser. Scanned pages come back empty. */

function linesFromItems(items) {
  const rows = [];
  for (const item of items || []) {
    const str = String(item.str || '').trim();
    if (!str) continue;
    const x = item.transform?.[4] || 0;
    const y = item.transform?.[5] || 0;
    let row = rows.find((entry) => Math.abs(entry.y - y) < 3);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => row.parts.sort((a, b) => a.x - b.x).map((part) => part.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function textFromPdf(data) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs?.getDocument) throw new Error('pdf.js is not loaded');
  const doc = await pdfjs.getDocument({ data, disableWorker: false }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(linesFromItems(content.items));
  }
  return pages.filter(Boolean).join('\n');
}
