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
