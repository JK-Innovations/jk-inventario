import { GARMENTS } from './parser.js';
import { normalizeSizeToken } from './sizes.js';

const SIZE_PHRASES = [
  [/youth\s*(x[\s-]*small|xs)\b|^yxs$/, 'YXS'],
  [/youth\s*small\b|^ys$/, 'YS'],
  [/youth\s*medium\b|^ym$/, 'YM'],
  [/youth\s*large\b|^yl$/, 'YL'],
  [/youth\s*(x[\s-]*large|xl)\b|^yxl$/, 'YXL'],
  [/adult\s*(x[\s-]*small|xs)\b|^axs$/, 'AXS'],
  [/adult\s*small\b|^as$/, 'AS'],
  [/adult\s*medium\b|^am$/, 'AM'],
  [/adult\s*large\b|^al$/, 'AL'],
  [/adult\s*(?:x[\s-]*large|xl)\b|^axl$/, 'AXL'],
  [/adult\s*2\s*x|^a?2xl$/, 'A2XL'],
  [/adult\s*3\s*x|^a?3xl$/, 'A3XL'],
  [/one[\s-]*size|^os$/, 'OS'],
  [/^(?:x[\s-]*small|xs)$/, 'XS'],
  [/^(?:small|s)$/, 'S'],
  [/^(?:medium|med|m)$/, 'M'],
  [/^(?:large|l)$/, 'L'],
  [/^(?:x[\s-]*large|xl)$/, 'XL'],
  [/^(?:2xl|xxl)$/, '2XL'],
  [/^(?:3xl|xxxl)$/, '3XL']
];

const LOOSE = {
  L: ['L', 'AL'],
  AL: ['AL', 'L'],
  M: ['M', 'AM', 'YM'],
  AM: ['AM', 'M'],
  YM: ['YM'],
  S: ['S', 'AS', 'YS'],
  AS: ['AS', 'S'],
  YS: ['YS'],
  XL: ['XL', 'AXL', 'YXL'],
  AXL: ['AXL', 'XL'],
  YXL: ['YXL'],
  XS: ['XS', 'AXS', 'YXS'],
  AXS: ['AXS', 'XS'],
  YXS: ['YXS'],
  '2XL': ['2XL', 'A2XL'],
  A2XL: ['A2XL', '2XL'],
  '3XL': ['3XL', 'A3XL'],
  A3XL: ['A3XL', '3XL']
};

const COLORS = [
  ['azul marino', 'navy'],
  ['navy', 'navy'],
  ['negro', 'black'],
  ['black', 'black'],
  ['maroon', 'maroon'],
  ['guinda', 'maroon'],
  ['vino', 'maroon'],
  ['blanco', 'white'],
  ['white', 'white'],
  ['gris', 'gray'],
  ['gray', 'gray'],
  ['grey', 'gray'],
  ['royal', 'royal'],
  ['rosa', 'pink'],
  ['pink', 'pink'],
  ['rojo', 'red'],
  ['red', 'red'],
  ['verde', 'green'],
  ['green', 'green'],
  ['khaki', 'khaki'],
  ['charcoal', 'charcoal']
];

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function canonicalSize(raw) {
  const text = fold(raw).replace(/\s+/g, ' ');
  if (!text) return '';
  for (const [pattern, code] of SIZE_PHRASES) {
    if (pattern.test(text)) return code;
  }
  const token = normalizeSizeToken(text);
  return token || text.toUpperCase();
}

export function sizesMatch(pdfSize, catalogSize) {
  const left = canonicalSize(pdfSize);
  const right = canonicalSize(catalogSize);
  if (!left || !right) return false;
  if (left === right) return true;
  return (LOOSE[left] || [left]).includes(right);
}

export function colorStem(value) {
  const text = fold(value);
  if (!text) return '';
  for (const [word, stem] of COLORS) {
    if (text.includes(word)) return stem;
  }
  return text;
}

export function colorsMatch(pdfColor, catalogColor) {
  const left = colorStem(pdfColor);
  const right = colorStem(catalogColor);
  if (!left || !right) return false;
  return left === right;
}

function normSku(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function wooExternalKey(line) {
  const sku = normSku(line?.sku);
  if (sku) return `sku:${sku.toLowerCase()}`;
  return `item:${fold(line?.name)}|${colorStem(line?.color)}|${canonicalSize(line?.size).toLowerCase()}`;
}

function garmentHit(lineName, product) {
  const hay = fold(lineName);
  const garment = fold(product?.garment);
  const name = fold(product?.name);
  if (!hay) return false;
  if (garment && (hay.includes(garment) || garment.includes(hay))) return true;
  if (name && (hay.includes(name) || name.includes(hay))) return true;
  for (const entry of GARMENTS) {
    const words = entry.words.map(fold);
    const inLine = words.some((word) => word && hay.includes(word));
    const inProduct = garment === entry.key || words.some((word) => word && (garment.includes(word) || name.includes(word)));
    if (inLine && inProduct) return true;
  }
  return false;
}

function skuCandidates(line, catalog) {
  const sku = normSku(line.sku);
  if (!sku) return [];
  const exact = (catalog.variants || []).filter((variant) => normSku(variant.sku) === sku);
  if (exact.length) return exact;
  const products = (catalog.products || []).filter((product) => {
    if (normSku(product.item_no) === sku) return true;
    return (product.alt_item_nos || []).some((alt) => normSku(alt) === sku);
  });
  const ids = new Set(products.map((product) => product.id));
  let variants = (catalog.variants || []).filter((variant) => ids.has(variant.product_id));
  if (line.color) {
    const colored = variants.filter((variant) => colorsMatch(line.color, variant.color));
    if (colored.length) variants = colored;
  }
  if (line.size) {
    const sized = variants.filter((variant) => sizesMatch(line.size, variant.size));
    if (sized.length) variants = sized;
  }
  return variants;
}

function fuzzyCandidates(line, catalog) {
  const products = new Map((catalog.products || []).map((product) => [product.id, product]));
  return (catalog.variants || []).filter((variant) => {
    const product = products.get(variant.product_id);
    if (!product || !garmentHit(line.name, product)) return false;
    if (line.color && !colorsMatch(line.color, variant.color)) return false;
    if (line.size && !sizesMatch(line.size, variant.size)) return false;
    return true;
  });
}

function decide(variants) {
  if (variants.length === 1) {
    return { status: 'matched', variantId: variants[0].id, candidates: [variants[0].id] };
  }
  if (variants.length > 1) {
    return { status: 'review', variantId: variants[0].id, candidates: variants.map((variant) => variant.id) };
  }
  return { status: 'not_found', variantId: '', candidates: [] };
}

export function matchWooLine(line, catalog, maps) {
  const key = wooExternalKey(line);
  const saved = (maps || []).find((row) => String(row.external_key || '').toLowerCase() === key && (!row.source || row.source === 'woocommerce'));
  if (saved) {
    const variant = (catalog.variants || []).find((row) => row.id === saved.variant_id);
    if (variant) {
      return { status: 'matched', variantId: variant.id, via: 'saved', candidates: [variant.id], key };
    }
  }
  const bySku = skuCandidates(line, catalog);
  if (bySku.length) {
    const decision = decide(bySku);
    return { ...decision, via: 'sku', key };
  }
  const fuzzy = fuzzyCandidates(line, catalog);
  if (fuzzy.length) {
    const decision = decide(fuzzy);
    return { ...decision, via: 'garment', key };
  }
  return { status: 'not_found', variantId: '', via: '', candidates: [], key };
}

export function physicalQty(stock, variantId) {
  const row = (stock || []).find((item) => item.variant_id === variantId);
  return row ? Number(row.physical) || 0 : 0;
}

export function withStock(rows, stock) {
  const used = new Map();
  return (rows || []).map((row) => {
    if (!row.variantId) return { ...row, stock: null, stockAfter: null };
    const current = physicalQty(stock, row.variantId);
    const already = used.get(row.variantId) || 0;
    const qty = Number(row.qty) || 0;
    used.set(row.variantId, already + qty);
    return { ...row, stock: current, stockAfter: current - already - qty };
  });
}

export function previewWoo(parsed, catalog, maps) {
  const rows = (parsed?.lines || []).map((line, index) => {
    const hit = matchWooLine(line, catalog, maps);
    return {
      key: String(index),
      name: line.name,
      sku: line.sku,
      color: line.color,
      size: line.size,
      qty: line.qty,
      price: line.price,
      unitPrice: line.unitPrice,
      raw: line.raw,
      status: hit.status,
      via: hit.via,
      variantId: hit.variantId || '',
      candidates: hit.candidates,
      remember: hit.status !== 'not_found',
      externalKey: hit.key
    };
  });
  return withStock(rows, catalog.stock || []);
}

export function findWooImport(orders, orderNumber) {
  const key = String(orderNumber || '').trim().toLowerCase();
  if (!key) return null;
  return (orders || []).find((order) => order.source === 'woocommerce' && String(order.external_ref || '').trim().toLowerCase() === key) || null;
}

export function findWooClient(clients, parsed) {
  const email = String(parsed?.email || '').trim().toLowerCase();
  const name = String(parsed?.customerName || '').trim().toLowerCase();
  if (email) {
    const byEmail = (clients || []).find((client) => String(client.email || '').trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  if (name) {
    return (clients || []).find((client) => String(client.name || '').trim().toLowerCase() === name) || null;
  }
  return null;
}

export function wooOrderHeader(parsed, clientId) {
  const number = String(parsed?.orderNumber || '').trim();
  const date = String(parsed?.orderDate || '').trim();
  return {
    channel: 'online',
    source: 'woocommerce',
    external_ref: number,
    client_id: clientId || null,
    school_id: null,
    reference: number,
    notes: [`WooCommerce ${number}`, date].filter(Boolean).join(' · ')
  };
}

export function wooCanConfirm(parsed, rows, duplicate) {
  if (duplicate) return false;
  if (!String(parsed?.orderNumber || '').trim()) return false;
  if (!rows?.length) return false;
  return rows.every((row) => row.variantId && Number(row.qty) > 0 && Number.isFinite(Number(row.unitPrice)));
}
