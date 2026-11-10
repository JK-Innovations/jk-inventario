import { getLang, t } from './i18n.js';
import { formatMoney, toCents } from './money.js';
import { filterInventory, filterOrders, groupOrdersByClient, inventoryFilterSummary, ordersFilterSummary, reportFileName } from './report-filters.js';
import { sortStockRows } from './stock-grid.js';

const BLUE = [39, 73, 105];
const TERRACOTTA = [154, 74, 60];
const BLUSH = [245, 237, 235];
const STATUS_COLOR = {
  ok: [31, 122, 76],
  low: [138, 90, 0],
  out: [140, 58, 50]
};

let assetsPromise = null;

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const [regular, bold, logo] = await Promise.all([
        fetch('assets/brand/fonts/Raleway-Regular.ttf').then((res) => res.arrayBuffer()),
        fetch('assets/brand/fonts/Raleway-Bold.ttf').then((res) => res.arrayBuffer()),
        fetch('assets/brand/logo-horizontal-deep-blue.png').then((res) => res.blob())
      ]);
      const logoUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(logo);
      });
      return {
        regular: bytesToBase64(new Uint8Array(regular)),
        bold: bytesToBase64(new Uint8Array(bold)),
        logoUrl
      };
    })().catch((error) => {
      assetsPromise = null;
      throw error;
    });
  }
  return assetsPromise;
}

function createDoc(assets) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  doc.addFileToVFS('Raleway-Regular.ttf', assets.regular);
  doc.addFont('Raleway-Regular.ttf', 'Raleway', 'normal');
  doc.addFileToVFS('Raleway-Bold.ttf', assets.bold);
  doc.addFont('Raleway-Bold.ttf', 'Raleway', 'bold');
  doc.setFont('Raleway', 'normal');
  return doc;
}

function stampNow() {
  const locale = getLang() === 'es' ? 'es-US' : 'en-US';
  return new Date().toLocaleString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function filterLines(doc, filterText) {
  const width = doc.internal.pageSize.getWidth();
  return doc.splitTextToSize(filterText || '', width - 184);
}

function headerHeight(doc, filterText) {
  return Math.max(86, 50 + filterLines(doc, filterText).length * 11);
}

function drawHeader(doc, assets, title, filterText) {
  const width = doc.internal.pageSize.getWidth();
  if (assets.logoUrl) doc.addImage(assets.logoUrl, 'PNG', 32, 18, 108, 28);
  doc.setFont('Raleway', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...TERRACOTTA);
  doc.text(title, 152, 32);
  doc.setFont('Raleway', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...BLUE);
  doc.text(stampNow(), width - 32, 26, { align: 'right' });
  doc.text(filterLines(doc, filterText), 152, 46);
}

function paintPages(doc, assets, title, filterText, top) {
  const pages = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    drawHeader(doc, assets, title, filterText);
    doc.setFont('Raleway', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BLUE);
    doc.text(`${t('page')} ${i} / ${pages}`, width - 32, height - 18, { align: 'right' });
  }
  return top;
}

function saveDoc(doc, filename) {
  doc.save(filename);
}

function statusLabel(code) {
  if (code === 'ok') return t('statusOk');
  if (code === 'low') return t('low');
  if (code === 'out') return t('out');
  return code || '';
}

function money(value) {
  const cents = toCents(value);
  return Number.isFinite(cents) ? formatMoney(cents) : '—';
}

export function inventoryTable(rows) {
  const sorted = sortStockRows(rows);
  const body = sorted.map((row) => {
    const status = row.level?.alert || 'out';
    return [
      row.product.supplier || '—',
      row.product.item_no || '—',
      row.product.garment || row.product.name || '',
      row.variant.color || '',
      row.variant.size || '',
      String(row.level.physical ?? 0),
      String(row.level.reserved ?? 0),
      String(row.level.available ?? 0),
      statusLabel(status),
      status
    ];
  });
  const totals = sorted.reduce((sum, row) => {
    sum.physical += Number(row.level.physical) || 0;
    sum.reserved += Number(row.level.reserved) || 0;
    sum.available += Number(row.level.available) || 0;
    return sum;
  }, { physical: 0, reserved: 0, available: 0 });
  return { body, totals, count: sorted.length };
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(getLang() === 'es' ? 'es-US' : 'en-US');
}

export function ordersTable(orders, lines, variants, products, clients, schools) {
  const groups = groupOrdersByClient(orders, lines, variants, products, clients, schools);
  const body = [];
  let qty = 0;
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  let count = 0;
  for (const group of groups) {
    qty += group.qty;
    subtotal += group.subtotal;
    tax += group.tax;
    total += group.total;
    count += group.orders.length;
    for (const order of group.orders) {
      const items = order.lines.map((line) => `${line.qty} ${line.item}`.trim()).join(', ') || '—';
      body.push([
        order.orderNo,
        formatDate(order.createdAt),
        group.name || '—',
        order.school || '—',
        t(`status_${order.status}`) || order.status,
        items,
        formatMoney(order.subtotal),
        formatMoney(order.tax),
        formatMoney(order.total),
        order.status
      ]);
    }
  }
  return { body, groups, count, qty, subtotal, tax, total };
}

export function detailedOrderRows(groups) {
  const rows = [];
  for (const group of groups || []) {
    let shown = false;
    for (const order of group.orders) {
      const lines = order.lines.length ? order.lines : [{ item: '—', color: '', size: '', qty: 0, unitPrice: '', lineCents: NaN }];
      lines.forEach((line, index) => {
        rows.push([
          shown ? '' : (group.name || t('noClient')),
          shown ? '' : group.schools.join(', '),
          shown ? '' : group.phone,
          index ? '' : order.orderNo,
          index ? '' : formatDate(order.createdAt),
          index ? '' : (t(`status_${order.status}`) || order.status),
          line.item || '—',
          line.color || '',
          line.size || '',
          String(line.qty),
          line.unitPrice ? money(line.unitPrice) : '—',
          Number.isFinite(line.lineCents) ? formatMoney(line.lineCents) : '—',
          index ? '' : formatMoney(order.subtotal),
          index ? '' : formatMoney(order.tax),
          index ? '' : formatMoney(order.total)
        ]);
        shown = true;
      });
    }
    rows.push(['', '', '', '', '', '', '', '', '', '', '', t('clientTotal'), formatMoney(group.subtotal), formatMoney(group.tax), formatMoney(group.total)]);
  }
  return rows;
}

function tableTheme(statusColumn) {
  return {
    styles: { font: 'Raleway', fontSize: 9, textColor: BLUE, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: BLUE, textColor: 255, font: 'Raleway', fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: BLUSH, textColor: BLUE, font: 'Raleway', fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [233, 236, 241] },
    didParseCell(data) {
      if (data.section !== 'body' || data.column.index !== statusColumn) return;
      const code = data.row.raw[data.row.raw.length - 1];
      const color = STATUS_COLOR[code];
      if (color) {
        data.cell.styles.textColor = color;
        data.cell.styles.fontStyle = 'bold';
      }
    }
  };
}

export async function buildInventoryPdf(rows, summary) {
  const assets = await loadAssets();
  const doc = createDoc(assets);
  const title = t('inventoryReport');
  const table = inventoryTable(rows);
  const head = [[t('supplier'), t('itemNo'), t('garment'), t('color'), t('size'), t('onHand'), t('reserved'), t('available'), t('status')]];
  const body = table.body.length
    ? table.body.map((row) => row.slice(0, 9))
    : [[t('noReportRows'), '', '', '', '', '', '', '', '']];
  const raw = table.body.length ? table.body : [['', '', '', '', '', '', '', '', '', '']];
  const foot = [[`${t('totals')} (${table.count})`, '', '', '', '', String(table.totals.physical), String(table.totals.reserved), String(table.totals.available), '']];
  const top = headerHeight(doc, summary);
  doc.autoTable({
    head,
    body,
    foot,
    startY: top,
    margin: { top, bottom: 36, left: 28, right: 28 },
    showHead: 'everyPage',
    ...tableTheme(8),
    didParseCell(data) {
      const code = raw[data.row.index]?.[9];
      if (data.section === 'body' && data.column.index === 8 && code && STATUS_COLOR[code]) {
        data.cell.styles.textColor = STATUS_COLOR[code];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });
  paintPages(doc, assets, title, summary);
  return doc;
}

function clientBanner(group) {
  const name = group.name || t('noClient');
  const bits = [name];
  if (group.schools.length) bits.push(group.schools.join(', '));
  if (group.phone) bits.push(group.phone);
  const countWord = group.orders.length === 1 ? t('orderSingular') : t('orders').toLowerCase();
  bits.push(`${group.orders.length} ${countWord}`);
  bits.push(formatMoney(group.total));
  return bits.join(' · ');
}

function moneyLine(label, subtotal, tax, total) {
  return `${label}: ${t('subtotal')} ${formatMoney(subtotal)} · ${t('tax')} ${formatMoney(tax)} · ${t('total')} ${formatMoney(total)}`;
}

function detailedBody(group) {
  const rows = [[{
    content: clientBanner(group),
    colSpan: 9,
    styles: { fillColor: BLUSH, textColor: TERRACOTTA, fontStyle: 'bold', fontSize: 11 }
  }]];
  for (const order of group.orders) {
    rows.push([
      order.orderNo,
      formatDate(order.createdAt),
      t(`status_${order.status}`) || order.status,
      '', '', '', '', '', ''
    ]);
    const lines = order.lines.length ? order.lines : [{ item: '—', color: '', size: '', qty: 0, unitPrice: '', lineCents: NaN }];
    for (const line of lines) {
      rows.push([
        '', '', '',
        { content: line.item || '—', styles: { cellPadding: { top: 4, right: 4, bottom: 4, left: 16 } } },
        line.color,
        line.size,
        String(line.qty),
        line.unitPrice ? money(line.unitPrice) : '—',
        Number.isFinite(line.lineCents) ? formatMoney(line.lineCents) : '—'
      ]);
    }
    rows.push([{
      content: moneyLine(t('orderTotal'), order.subtotal, order.tax, order.total),
      colSpan: 9,
      styles: { fontStyle: 'bold', textColor: BLUE }
    }]);
  }
  rows.push([{
    content: moneyLine(t('clientTotal'), group.subtotal, group.tax, group.total),
    colSpan: 9,
    styles: { fillColor: BLUSH, textColor: TERRACOTTA, fontStyle: 'bold' }
  }]);
  return rows;
}

function estimateGroup(group) {
  let rows = 2;
  for (const order of group.orders) rows += 2 + Math.max(order.lines.length, 1);
  return rows * 18 + 12;
}

function drawDetailedOrders(doc, groups, summary) {
  const head = [[t('orderNo'), t('date'), t('status'), t('item'), t('color'), t('size'), t('qtyShort'), t('unitPrice'), t('lineTotal')]];
  const top = headerHeight(doc, summary);
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentHeight = pageHeight - top - 48;
  let cursor = top;
  if (!groups.length) {
    doc.autoTable({
      head,
      body: [[{ content: t('noReportRows'), colSpan: 9 }]],
      startY: cursor,
      margin: { top, bottom: 48, left: 28, right: 28 },
      styles: { font: 'Raleway', fontSize: 9, textColor: BLUE },
      headStyles: { fillColor: BLUE, textColor: 255, font: 'Raleway', fontStyle: 'bold', fontSize: 8 }
    });
    return;
  }
  for (const group of groups) {
    const needed = estimateGroup(group);
    const room = pageHeight - 48 - cursor;
    if (cursor > top && needed < contentHeight && room < needed) {
      doc.addPage();
      cursor = top;
    } else if (cursor > top && room < 72) {
      doc.addPage();
      cursor = top;
    }
    const name = group.name || t('noClient');
    let continued = false;
    doc.autoTable({
      head,
      body: detailedBody(group),
      startY: cursor,
      margin: { top: top + 20, bottom: 48, left: 28, right: 28 },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: { font: 'Raleway', fontSize: 9, textColor: BLUE, cellPadding: 4 },
      headStyles: { fillColor: BLUE, textColor: 255, font: 'Raleway', fontStyle: 'bold', fontSize: 8 },
      didDrawPage() {
        if (!continued) {
          continued = true;
          return;
        }
        doc.setFont('Raleway', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...TERRACOTTA);
        doc.text(t('clientContinued').replace('{name}', name), 32, top + 8);
      }
    });
    cursor = (doc.lastAutoTable?.finalY || cursor) + 10;
  }
}

export async function buildOrdersPdf(pack, summary, detailed) {
  const assets = await loadAssets();
  const doc = createDoc(assets);
  const title = t('ordersReport');
  const top = headerHeight(doc, summary);
  if (detailed) {
    drawDetailedOrders(doc, pack.groups || [], summary);
  } else {
    const head = [[t('orderNo'), t('date'), t('client'), t('school'), t('status'), t('itemsQty'), t('subtotal'), t('tax'), t('total')]];
    const body = pack.body.length
      ? pack.body.map((row) => row.slice(0, 9))
      : [[t('noReportRows'), ...Array(8).fill('')]];
    doc.autoTable({
      head,
      body,
      startY: top,
      margin: { top, bottom: 48, left: 28, right: 28 },
      showHead: 'everyPage',
      styles: { font: 'Raleway', fontSize: 9, textColor: BLUE, cellPadding: 4 },
      headStyles: { fillColor: BLUE, textColor: 255, font: 'Raleway', fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [233, 236, 241] },
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index !== 4) return;
        const code = pack.body[data.row.index]?.at(-1);
        if (code && STATUS_COLOR[code]) {
          data.cell.styles.textColor = STATUS_COLOR[code];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
  }
  let y = (doc.lastAutoTable?.finalY || top) + 18;
  if (y > doc.internal.pageSize.getHeight() - 48) {
    doc.addPage();
    y = top + 18;
  }
  doc.setFont('Raleway', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TERRACOTTA);
  const countWord = pack.count === 1 ? t('orderSingular') : t('orders').toLowerCase();
  const grand = doc.splitTextToSize(`${t('totals')}: ${pack.count} ${countWord} · ${t('qtyShort')} ${pack.qty} · ${t('subtotal')} ${formatMoney(pack.subtotal)} · ${t('tax')} ${formatMoney(pack.tax)} · ${t('total')} ${formatMoney(pack.total)}`, doc.internal.pageSize.getWidth() - 64);
  doc.text(grand, 32, y);
  paintPages(doc, assets, title, summary);
  return doc;
}

export async function downloadInventoryPdf(rows, summary) {
  const doc = await buildInventoryPdf(rows, summary);
  saveDoc(doc, reportFileName('inventory'));
}

export async function downloadOrdersPdf(pack, summary, detailed) {
  const doc = await buildOrdersPdf(pack, summary, detailed);
  saveDoc(doc, reportFileName('orders'));
}

export function printReport(title, filterText, headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">${escapeHtml(t('noReportRows'))}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: Raleway, sans-serif; color: #274969; margin: 24px; }
      h1 { color: #9A4A3C; font-size: 22px; margin: 0 0 6px; }
      p { font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { background: #274969; color: white; text-align: left; padding: 6px; }
      td { padding: 6px; border-bottom: 1px solid #E9ECF1; }
      tr:nth-child(even) td { background: #F5EDEB; }
      img { height: 36px; }
    </style></head><body>
    <img src="assets/brand/logo-horizontal-deep-blue.png" alt="JK Innovations">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(stampNow())}</p>
    <p>${escapeHtml(filterText)}</p>
    <table><thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0');
  document.body.appendChild(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(html);
  frame.contentDocument.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1500);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export { filterInventory, filterOrders, inventoryFilterSummary, ordersFilterSummary, reportFileName };
