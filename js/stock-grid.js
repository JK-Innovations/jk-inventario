import { SIZES_BY_GROUP } from './sizes.js';
import { toCents } from './money.js';

const GROUP_ORDER = ['youth', 'toddler', 'adult', 'os', 'numeric'];

export function sizeOrderIndex(size, sizeGroup) {
  const token = String(size ?? '').trim().toUpperCase();
  let cursor = 0;
  for (const group of GROUP_ORDER) {
    const list = SIZES_BY_GROUP[group] || [];
    const at = list.indexOf(token);
    if (at >= 0) return cursor + at;
    cursor += Math.max(list.length, 1);
  }
  const groupAt = GROUP_ORDER.indexOf(sizeGroup);
  return 1000 + (groupAt < 0 ? 9 : groupAt) * 50;
}

export function alertFor(available, minQty) {
  const avail = Number(available) || 0;
  const min = Number(minQty);
  const floor = Number.isFinite(min) ? min : 0;
  if (avail <= 0) return 'out';
  if (avail <= floor) return 'low';
  return 'ok';
}

function sizeKey(size, sizeGroup) {
  return `${sizeGroup || ''}:${String(size ?? '').trim().toUpperCase()}`;
}

export function buildProductGrids(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!groups.has(row.product.id)) groups.set(row.product.id, []);
    groups.get(row.product.id).push(row);
  }
  return [...groups.values()].map((items) => {
    const product = items[0].product;
    const sizes = [];
    const seen = new Set();
    const ordered = items.slice().sort((a, b) => {
      const diff = sizeOrderIndex(a.variant.size, a.variant.size_group) - sizeOrderIndex(b.variant.size, b.variant.size_group);
      if (diff) return diff;
      return String(a.variant.size).localeCompare(String(b.variant.size));
    });
    for (const row of ordered) {
      const key = sizeKey(row.variant.size, row.variant.size_group);
      if (seen.has(key)) continue;
      seen.add(key);
      sizes.push({ key, size: row.variant.size, sizeGroup: row.variant.size_group });
    }
    const byColor = new Map();
    for (const row of items) {
      const color = row.variant.color || '';
      if (!byColor.has(color)) byColor.set(color, new Map());
      byColor.get(color).set(sizeKey(row.variant.size, row.variant.size_group), row);
    }
    const colors = [...byColor.keys()]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((color) => ({
        color,
        cells: sizes.map((size) => byColor.get(color).get(size.key) || null)
      }));
    const priceCents = [...new Set(items.map((row) => toCents(row.variant.sell_price)).filter((cents) => Number.isFinite(cents)))].sort((a, b) => a - b);
    return { product, sizes, colors, priceCents };
  }).sort((a, b) => {
    const left = a.product.garment || a.product.name || '';
    const right = b.product.garment || b.product.name || '';
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  });
}

export function sortStockRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    const garment = String(a.product.garment || a.product.name || '').localeCompare(String(b.product.garment || b.product.name || ''), undefined, { sensitivity: 'base' });
    if (garment) return garment;
    const supplier = String(a.product.supplier || '').localeCompare(String(b.product.supplier || ''), undefined, { sensitivity: 'base' });
    if (supplier) return supplier;
    const color = String(a.variant.color || '').localeCompare(String(b.variant.color || ''), undefined, { sensitivity: 'base' });
    if (color) return color;
    const size = sizeOrderIndex(a.variant.size, a.variant.size_group) - sizeOrderIndex(b.variant.size, b.variant.size_group);
    if (size) return size;
    return String(a.variant.sku || '').localeCompare(String(b.variant.sku || ''));
  });
}

export function stockSummary(rows) {
  const list = rows || [];
  return {
    units: list.reduce((sum, row) => sum + (Number(row.level.available) || 0), 0),
    products: new Set(list.map((row) => row.product.id)).size,
    low: list.filter((row) => alertFor(row.level.available, row.variant.min_qty) === 'low').length,
    out: list.filter((row) => alertFor(row.level.available, row.variant.min_qty) === 'out').length
  };
}

export function rowMatchesQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const blob = [row.product.garment, row.product.name, row.product.item_no, row.variant.color].join(' ').toLowerCase();
  return blob.includes(q);
}

export function cardMatchesQuery(card, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const blob = [
    card.product.garment,
    card.product.name,
    card.product.item_no,
    ...card.colors.map((row) => row.color)
  ].join(' ').toLowerCase();
  return blob.includes(q);
}
