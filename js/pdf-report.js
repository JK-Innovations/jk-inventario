import { getLang, t } from './i18n.js';
import { formatMoney, lineTotalCents, toCents } from './money.js';
import { filterInventory, filterOrders, inventoryFilterSummary, ordersFilterSummary, reportFileName } from './report-filters.js';
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

export function ordersTable(orders, lines, variants, products, clients, schools, detailed) {
  const sorted = orders.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const body = [];
  let qty = 0;
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  for (const order of sorted) {
    const orderLines = lines.filter((line) => line.order_id === order.id);
    const pieces = orderLines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    qty += pieces;
    subtotal += toCents(order.subtotal) || 0;
    tax += toCents(order.tax_amount) || 0;
    total += toCents(order.total) || 0;
    const client = clients.get(order.client_id)?.name || '—';
    const school = schools.get(order.school_id)?.name || '—';
    const when = order.created_at ? new Date(order.created_at).toLocaleDateString(getLang() === 'es' ? 'es-US' : 'en-US') : '—';
    const status = t(`status_${order.status}`) || order.status;
    if (!detailed) {
      const items = orderLines.map((line) => {
        const variant = variants.get(line.variant_id);
        const product = variant ? products.get(variant.product_id) : null;
        return `${line.qty} ${product?.garment || variant?.sku || ''}`.trim();
      }).join(', ') || '—';
      body.push([order.order_no, when, client, school, status, items, money(order.subtotal), money(order.tax_amount), money(order.total), order.status]);
    } else if (!orderLines.length) {
      body.push([order.order_no, when, client, school, status, '—', '0', money(order.total), order.status]);
    } else {
      orderLines.forEach((line) => {
        const variant = variants.get(line.variant_id);
        const product = variant ? products.get(variant.product_id) : null;
        const item = [product?.garment || product?.name || variant?.sku || '—', variant?.color, variant?.size].filter(Boolean).join(' ');
        const lineCents = lineTotalCents(line.qty, line.unit_sell_price);
        body.push([
          order.order_no,
          when,
          client,
          school,
          status,
          item,
          String(line.qty),
          Number.isFinite(lineCents) ? formatMoney(lineCents) : '—',
          order.status
        ]);
      });
    }
  }
  return { body, count: sorted.length, qty, subtotal, tax, total };
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

export async function buildOrdersPdf(pack, summary, detailed) {
  const assets = await loadAssets();
  const doc = createDoc(assets);
  const title = t('ordersReport');
  const head = detailed
    ? [[t('orderNo'), t('date'), t('client'), t('school'), t('status'), t('item'), t('qtyShort'), t('lineTotal')]]
    : [[t('orderNo'), t('date'), t('client'), t('school'), t('status'), t('itemsQty'), t('subtotal'), t('tax'), t('total')]];
  const body = pack.body.length
    ? pack.body.map((row) => row.slice(0, head[0].length))
    : [[t('noReportRows'), ...Array(head[0].length - 1).fill('')]];
  const statusColumn = 4;
  const top = headerHeight(doc, summary);
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
      if (data.section !== 'body' || data.column.index !== statusColumn) return;
      const code = pack.body[data.row.index]?.at(-1);
      if (code && STATUS_COLOR[code]) {
        data.cell.styles.textColor = STATUS_COLOR[code];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });
  const y = Math.min((doc.lastAutoTable?.finalY || top) + 18, doc.internal.pageSize.getHeight() - 36);
  doc.setFont('Raleway', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TERRACOTTA);
  doc.text(`${t('totals')}: ${pack.count} ${t('orders').toLowerCase()} · ${t('qtyShort')} ${pack.qty} · ${t('subtotal')} ${formatMoney(pack.subtotal)} · ${t('tax')} ${formatMoney(pack.tax)} · ${t('total')} ${formatMoney(pack.total)}`, 32, y);
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
