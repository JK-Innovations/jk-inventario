/**
 * Money math that matches Postgres numeric round-half-away-from-zero
 * to 2 places, and CA tax of 10.75% on the client subtotal.
 * Cost is never an input.
 */

export const TAX_RATE = 0.1075;
export const TAX_LABEL = '10.75%';

export function toCents(value) {
  if (value == null || value === '') return 0;
  const s = String(value).trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const pad = (frac + '000').slice(0, 3);
  let cents = Number(whole) * 100 + Number(pad.slice(0, 2));
  if (pad[2] >= '5') cents += 1;
  return neg ? -cents : cents;
}

export function formatMoney(cents) {
  if (!Number.isFinite(cents)) return '—';
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}$${dollars}.${rem}`;
}

/** Tax on a client subtotal already expressed in cents. */
export function taxCents(subtotalCents) {
  if (!Number.isFinite(subtotalCents)) return NaN;
  const neg = subtotalCents < 0;
  const num = Math.abs(subtotalCents) * 1075;
  let quote = Math.floor(num / 10000);
  const rem = num % 10000;
  if (rem * 2 >= 10000) quote += 1;
  return neg ? -quote : quote;
}

export function lineTotalCents(qty, unitPrice) {
  const q = Number(qty);
  const unit = toCents(unitPrice);
  if (!Number.isInteger(q) || q <= 0 || !Number.isFinite(unit)) return NaN;
  return q * unit;
}

export function orderTotals(lines) {
  let subtotal = 0;
  for (const line of lines) {
    const cents = lineTotalCents(line.qty, line.unit_sell_price);
    if (!Number.isFinite(cents)) return null;
    subtotal += cents;
  }
  const tax = taxCents(subtotal);
  return { subtotal, tax, total: subtotal + tax };
}
