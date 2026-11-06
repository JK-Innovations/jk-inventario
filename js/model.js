import { matchesVariant, parseQuick } from './parser.js';

export function stockIndex(stockRows) {
  return new Map((stockRows || []).map((row) => [row.variant_id, row]));
}

export function linkIndex(links) {
  const map = new Map();
  for (const link of links || []) {
    if (!map.has(link.product_id)) map.set(link.product_id, []);
    map.get(link.product_id).push(link.school_id);
  }
  return map;
}

export function buildRows(db, filters = {}) {
  const stock = stockIndex(db.stock);
  const products = new Map((db.products || []).map((row) => [row.id, row]));
  const schools = new Map((db.schools || []).map((row) => [row.id, row]));
  const clients = new Map((db.clients || []).map((row) => [row.id, row]));
  const links = linkIndex(db.links);
  const showArchived = !!filters.showArchived;
  const q = String(filters.q || '').trim().toLowerCase();

  return (db.variants || []).filter((variant) => {
    if (!showArchived && variant.active === false) return false;
    const product = products.get(variant.product_id);
    if (!product) return false;
    if (!showArchived && product.active === false) return false;
    return true;
  }).map((variant) => {
    const product = products.get(variant.product_id);
    const level = stock.get(variant.id) || {
      physical: 0,
      reserved: 0,
      available: 0,
      min_qty: variant.min_qty,
      alert: (variant.min_qty >= 0 ? 'out' : 'out')
    };
    const schoolIds = new Set(links.get(variant.product_id) || []);
    if (variant.school_id) schoolIds.add(variant.school_id);
    const schoolList = [...schoolIds].map((id) => schools.get(id)).filter(Boolean);
    return {
      variant,
      product,
      level: {
        physical: Number(level.physical) || 0,
        reserved: Number(level.reserved) || 0,
        available: Number(level.available) || 0,
        min_qty: variant.min_qty,
        alert: level.alert || (Number(level.available) <= 0 ? 'out' : Number(level.available) <= variant.min_qty ? 'low' : 'ok')
      },
      schoolIds: [...schoolIds],
      schools: schoolList,
      client: clients.get(variant.client_id) || null
    };
  }).filter((row) => {
    if (filters.category && filters.category !== 'all' && row.product.category !== filters.category) return false;
    if (filters.school === 'none') {
      if (row.schoolIds.length) return false;
    } else if (filters.school && filters.school !== 'all') {
      if (!row.schoolIds.includes(filters.school)) return false;
    }
    if (filters.alert && filters.alert !== 'all' && row.level.alert !== filters.alert) return false;
    if (q) {
      const blob = [
        row.product.name,
        row.product.garment,
        row.product.item_no,
        row.product.supplier,
        row.variant.sku,
        row.variant.color,
        row.variant.size,
        row.variant.design,
        row.client?.name,
        ...row.schools.map((school) => school.name)
      ].join(' ').toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

export function needed(row) {
  return Math.max(Number(row.variant.min_qty) - Number(row.level.available), 0);
}

export function attentionRows(rows) {
  return rows
    .filter((row) => row.level.alert === 'out' || row.level.alert === 'low')
    .slice()
    .sort((a, b) => {
      if (a.level.alert !== b.level.alert) return a.level.alert === 'out' ? -1 : 1;
      return needed(b) - needed(a);
    });
}

export function groupBySupplier(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.product.supplier?.trim() || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function catalogFor(db) {
  const itemNos = [];
  for (const product of db.products || []) {
    if (product.item_no) itemNos.push(product.item_no);
    for (const alt of product.alt_item_nos || []) itemNos.push(alt);
  }
  return {
    itemNos,
    schools: (db.schools || []).filter((school) => school.active !== false).map((school) => school.name)
  };
}

export function matchQuick(text, rows, db) {
  const parsed = parseQuick(text, catalogFor(db));
  const matches = rows.filter((row) => {
    if (row.variant.active === false || row.product.active === false) return false;
    if (!matchesVariant(parsed, row.variant, row.product)) return false;
    if (parsed.schoolText && !row.schools.some((school) => school.name === parsed.schoolText)) return false;
    return true;
  });
  return { parsed, matches };
}

export const NEXT_STATUS = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_production', 'ready', 'fulfilled', 'draft', 'cancelled'],
  in_production: ['ready', 'fulfilled', 'confirmed', 'cancelled'],
  ready: ['fulfilled', 'in_production', 'cancelled'],
  fulfilled: [],
  cancelled: []
};

export function canWriteCatalog(role) {
  return role === 'admin' || role === 'inventario';
}

export function canMoveStock(role) {
  return role === 'admin' || role === 'inventario' || role === 'produccion';
}
