import { lineTotalCents, toCents } from './money.js';

function text(value) {
  return String(value || '').trim().toLowerCase();
}

function dayStart(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function dayEnd(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

export function blankInventoryReport() {
  return { school: 'all', supplier: 'all', itemNo: '', garment: '', color: '', sizeGroup: 'all', status: 'all', q: '' };
}

export function blankOrdersReport() {
  return { from: '', to: '', client: 'all', school: 'all', status: 'all', garment: '', detailed: false };
}

export function filterInventory(rows, filters = {}) {
  const itemNo = text(filters.itemNo);
  const garment = text(filters.garment);
  const color = text(filters.color);
  const q = text(filters.q);
  return (rows || []).filter((row) => {
    const schoolIds = row.schoolIds || [];
    if (filters.school === 'none') {
      if (schoolIds.length) return false;
    } else if (filters.school && filters.school !== 'all') {
      if (!schoolIds.includes(filters.school)) return false;
    }
    if (filters.supplier && filters.supplier !== 'all' && (row.product.supplier || '') !== filters.supplier) return false;
    if (itemNo && !text(row.product.item_no).includes(itemNo)) return false;
    if (garment && !`${row.product.garment || ''} ${row.product.name || ''}`.toLowerCase().includes(garment)) return false;
    if (color && !text(row.variant.color).includes(color)) return false;
    if (filters.sizeGroup && filters.sizeGroup !== 'all' && row.variant.size_group !== filters.sizeGroup) return false;
    const status = row.level?.alert || 'out';
    if (filters.status && filters.status !== 'all' && status !== filters.status) return false;
    if (q) {
      const blob = [
        row.product.garment,
        row.product.name,
        row.product.item_no,
        row.product.supplier,
        row.variant.color,
        row.variant.size,
        row.variant.sku,
        ...(row.schools || []).map((school) => school.name)
      ].join(' ').toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

export function inventoryFilterSummary(filters, labels) {
  const parts = [];
  parts.push(`${labels.school}: ${labels.schoolValue}`);
  parts.push(`${labels.supplier}: ${labels.supplierValue}`);
  if (text(filters.itemNo)) parts.push(`${labels.itemNo}: ${String(filters.itemNo).trim()}`);
  if (text(filters.garment)) parts.push(`${labels.garment}: ${String(filters.garment).trim()}`);
  if (text(filters.color)) parts.push(`${labels.color}: ${String(filters.color).trim()}`);
  parts.push(`${labels.size}: ${labels.sizeValue}`);
  parts.push(`${labels.status}: ${labels.statusValue}`);
  if (text(filters.q)) parts.push(`${labels.search}: ${String(filters.q).trim()}`);
  return parts.join(' · ');
}

export function filterOrders(orders, lines, variants, products, filters = {}) {
  const from = filters.from ? dayStart(filters.from) : null;
  const to = filters.to ? dayEnd(filters.to) : null;
  const garment = text(filters.garment);
  return (orders || []).filter((order) => {
    if (from || to) {
      const created = order.created_at ? new Date(order.created_at) : null;
      if (!created || Number.isNaN(created.getTime())) return false;
      if (from && created < from) return false;
      if (to && created > to) return false;
    }
    if (filters.client && filters.client !== 'all' && order.client_id !== filters.client) return false;
    if (filters.school === 'none') {
      if (order.school_id) return false;
    } else if (filters.school && filters.school !== 'all' && order.school_id !== filters.school) return false;
    if (filters.status && filters.status !== 'all' && order.status !== filters.status) return false;
    if (garment) {
      const orderLines = (lines || []).filter((line) => line.order_id === order.id);
      const hit = orderLines.some((line) => {
        const variant = variants.get(line.variant_id);
        const product = variant ? products.get(variant.product_id) : null;
        const blob = [product?.garment, product?.name, product?.item_no, variant?.color, variant?.sku].join(' ').toLowerCase();
        return blob.includes(garment);
      });
      if (!hit) return false;
    }
    return true;
  });
}

export function groupOrdersByClient(orders, lines, variants, products, clients, schools) {
  const buckets = new Map();
  const sorted = (orders || []).slice().sort((a, b) => {
    const aName = clients.get(a.client_id)?.name || '';
    const bName = clients.get(b.client_id)?.name || '';
    if (!aName && bName) return 1;
    if (aName && !bName) return -1;
    const byName = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    if (byName) return byName;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  for (const order of sorted) {
    const key = order.client_id || '';
    if (!buckets.has(key)) {
      const client = clients.get(order.client_id);
      buckets.set(key, {
        clientId: key,
        name: client?.name || '',
        phone: client?.phone || '',
        schools: [],
        orders: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        qty: 0
      });
    }
    const group = buckets.get(key);
    const schoolName = schools.get(order.school_id)?.name || '';
    if (schoolName && !group.schools.includes(schoolName)) group.schools.push(schoolName);
    const orderLines = (lines || []).filter((line) => line.order_id === order.id).map((line) => {
      const variant = variants.get(line.variant_id);
      const product = variant ? products.get(variant.product_id) : null;
      return {
        item: product?.garment || product?.name || variant?.sku || '',
        color: variant?.color || '',
        size: variant?.size || '',
        qty: Number(line.qty) || 0,
        unitPrice: line.unit_sell_price,
        lineCents: lineTotalCents(line.qty, line.unit_sell_price)
      };
    });
    group.qty += orderLines.reduce((sum, line) => sum + line.qty, 0);
    group.subtotal += toCents(order.subtotal) || 0;
    group.tax += toCents(order.tax_amount) || 0;
    group.total += toCents(order.total) || 0;
    group.orders.push({
      orderNo: order.order_no,
      createdAt: order.created_at,
      status: order.status,
      school: schoolName,
      subtotal: toCents(order.subtotal) || 0,
      tax: toCents(order.tax_amount) || 0,
      total: toCents(order.total) || 0,
      lines: orderLines
    });
  }
  return [...buckets.values()];
}

export function ordersFilterSummary(filters, labels) {
  const parts = [];
  parts.push(`${labels.from}: ${filters.from || labels.any}`);
  parts.push(`${labels.to}: ${filters.to || labels.any}`);
  parts.push(`${labels.client}: ${labels.clientValue}`);
  parts.push(`${labels.school}: ${labels.schoolValue}`);
  parts.push(`${labels.status}: ${labels.statusValue}`);
  if (text(filters.garment)) parts.push(`${labels.garment}: ${String(filters.garment).trim()}`);
  parts.push(filters.detailed ? labels.detailed : labels.summary);
  return parts.join(' · ');
}

export function reportFileName(kind, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const title = kind === 'orders' ? 'Orders' : 'Inventory';
  return `JK_${title}_${day}.pdf`;
}
