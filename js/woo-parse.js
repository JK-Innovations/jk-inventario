/**
 * Text parser for WooCommerce order PDFs.
 * Tuned for the common "WooCommerce PDF Invoices & Packing Slips" layout
 * (Order Number, Order Date, Product, Quantity, Price, "SKU:", "Size:", "Color:")
 * and a few Spanish labels. Real sample PDFs will tighten these patterns.
 * The Price figure on that layout is the line total, so the unit price is price / qty.
 */

const ORDER_NUMBER = [
  /order\s*(?:number|no\.?|#)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]*)/i,
  /(?:n[úu]mero|no\.?)\s*de\s*pedido\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]*)/i,
  /pedido\s*(?:n[úu]mero|no\.?|#)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]*)/i
];

const ORDER_DATE = [
  /order\s*date\s*[:#]?\s*([^\n]+)/i,
  /fecha\s*(?:del\s*)?pedido\s*[:#]?\s*([^\n]+)/i
];

const STOP = /^(subtotal|total|shipping|env[ií]o|tax|impuesto|payment|pago|customer notes|order notes|notas|thank you|gracias)\b/i;
const HEADER = /(product|producto)/i;
const HEADER_QTY = /(qty|quantity|cantidad)/i;
const JUNK = /^(billing address|shipping address|bill to|ship to|customer|cliente|direcci[oó]n(?:\s+de\s+\w+)?|order number|order date|n[úu]mero de pedido|fecha(?:\s+del)?\s+pedido|packing slip|invoice|factura|nota de entrega|nota de empaque)$/i;

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

export function parseMoney(raw) {
  let value = String(raw ?? '').trim().replace(/[$€£]/g, '').replace(/\s/g, '');
  if (!value) return null;
  if (value.includes(',') && value.includes('.')) value = value.replace(/,/g, '');
  else if (value.includes(',') && !value.includes('.')) value = value.replace(',', '.');
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function looksLikeText(text) {
  return (String(text || '').match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length >= 20;
}

function isEmail(line) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(line);
}

function isPhone(line) {
  return /^\+?\d[\d\s().-]{6,}$/.test(line);
}

function pullAttrs(line, item) {
  const sku = line.match(/sku\s*:\s*([A-Z0-9][A-Z0-9-]*)/i);
  const color = line.match(/colou?r\s*:\s*([^,\n]+?)(?=\s+(?:size|talla|sku)\s*:|$)/i);
  const size = line.match(/(?:size|talla)\s*:\s*([^,\n]+?)(?=\s+(?:colou?r|sku)\s*:|$)/i);
  let hit = false;
  if (sku) {
    item.sku = sku[1].trim();
    hit = true;
  }
  if (color) {
    item.color = color[1].trim();
    hit = true;
  }
  if (size) {
    item.size = size[1].trim();
    hit = true;
  }
  if (!hit) return false;
  const stripped = line
    .replace(/sku\s*:\s*[A-Z0-9][A-Z0-9-]*/ig, '')
    .replace(/colou?r\s*:\s*[^,\n]+/ig, '')
    .replace(/(?:size|talla)\s*:\s*[^,\n]+/ig, '')
    .trim();
  return stripped.length === 0;
}

function blank(name = '') {
  return { name: name.trim(), sku: '', color: '', size: '', qty: 0, price: null, raw: [] };
}

function finish(item) {
  const qty = Number(item.qty) || 0;
  const price = item.price;
  const unit = qty > 0 && Number.isFinite(price) ? Math.round((price / qty) * 100) / 100 : null;
  return {
    name: item.name.trim(),
    sku: item.sku.trim(),
    color: item.color.trim(),
    size: item.size.trim(),
    qty,
    price,
    unitPrice: unit,
    raw: item.raw.join(' | ')
  };
}

function findCustomerName(lines, email) {
  const heads = /^(billing address|shipping address|bill to|ship to|customer|cliente|direcci[oó]n de facturaci[oó]n|direcci[oó]n de env[ií]o)$/i;
  for (let i = 0; i < lines.length; i += 1) {
    if (!heads.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
      const line = lines[j];
      if (!line || isEmail(line) || isPhone(line) || JUNK.test(line) || /^\d/.test(line)) continue;
      if (HEADER.test(line) && HEADER_QTY.test(line)) break;
      return line;
    }
  }
  const at = lines.findIndex((line) => line.toLowerCase() === email.toLowerCase());
  if (at > 0) {
    const previous = lines[at - 1];
    if (previous && !JUNK.test(previous) && !/^\d/.test(previous) && !isPhone(previous)) return previous;
  }
  return '';
}

function findItems(lines) {
  const headerAt = lines.findIndex((line) => HEADER.test(line) && HEADER_QTY.test(line));
  const start = headerAt >= 0 ? headerAt + 1 : 0;
  const items = [];
  let current = null;
  let active = headerAt >= 0;

  function push() {
    if (current && (current.name || current.sku)) items.push(finish(current));
    current = null;
  }

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (STOP.test(line)) {
      push();
      break;
    }
    if (!active) {
      if (/sku\s*:/i.test(line)) {
        active = true;
        current = blank('');
        const previous = lines[i - 1] || '';
        if (previous && !JUNK.test(previous) && !isEmail(previous) && !isPhone(previous) && !/^\d/.test(previous)) {
          current.name = previous;
          current.raw.push(previous);
        }
      } else {
        continue;
      }
    }
    if (!current) current = blank();
    current.raw.push(line);
    if (pullAttrs(line, current)) continue;
    const labeledQty = line.match(/^(?:qty|quantity|cantidad)\s*:\s*(\d+)$/i);
    if (labeledQty) {
      current.qty = Number(labeledQty[1]);
      continue;
    }
    const labeledPrice = line.match(/^(?:price|precio|line total|total)\s*:\s*([$€£]?\s*[0-9][0-9.,]*)$/i);
    if (labeledPrice) {
      current.price = parseMoney(labeledPrice[1]);
      continue;
    }
    const qtyPrice = line.match(/^(\d+)\s+[$€£]?\s*([0-9][0-9.,]*)$/);
    if (qtyPrice) {
      current.qty = Number(qtyPrice[1]);
      current.price = parseMoney(qtyPrice[2]);
      continue;
    }
    const row = line.match(/^(.+?)\s{2,}(\d+)\s+[$€£]?\s*([0-9][0-9.,]*)$/)
      || line.match(/^(.+?)\s+(\d+)\s+[$€£]([0-9][0-9.,]*)$/);
    if (row && !/sku\s*:|colou?r\s*:|(?:size|talla)\s*:/i.test(row[1])) {
      if (current.name || current.sku) {
        current.raw.pop();
        push();
        current = blank();
        current.raw.push(line);
      }
      current.name = row[1].trim();
      current.qty = Number(row[2]);
      current.price = parseMoney(row[3]);
      continue;
    }
    if (/^\d+$/.test(line) && !current.qty) {
      current.qty = Number(line);
      continue;
    }
    if (/^[$€£]\s*[0-9]/.test(line) && current.price == null) {
      current.price = parseMoney(line);
      continue;
    }
    if (current.qty || current.sku) {
      current.raw.pop();
      push();
      current = blank(line);
      current.raw.push(line);
      continue;
    }
    current.name = current.name ? `${current.name} ${line}` : line;
  }
  push();
  return items.filter((item) => item.name || item.sku);
}

export function parseWooText(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const joined = lines.join('\n');
  const email = (joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
  return {
    orderNumber: firstMatch(joined, ORDER_NUMBER),
    orderDate: firstMatch(joined, ORDER_DATE).replace(/\s{2,}/g, ' ').trim(),
    customerName: findCustomerName(lines, email),
    email,
    lines: findItems(lines)
  };
}

export function describeWooLine(line) {
  const bits = [line.name];
  if (line.color) bits.push(line.color);
  if (line.size) bits.push(line.size);
  if (line.sku) bits.push(`SKU ${line.sku}`);
  if (line.qty) bits.push(`×${line.qty}`);
  return bits.filter(Boolean).join(' · ');
}
