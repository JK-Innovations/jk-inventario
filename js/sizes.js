/** Youth and adult sizes stay distinct. Sports is a product category, not a size group. */

export const SIZE_GROUPS = ['youth', 'adult', 'toddler', 'os', 'numeric'];

export const SIZES_BY_GROUP = {
  youth: ['YXS', 'YS', 'YM', 'YL', 'YXL'],
  adult: ['AXS', 'AS', 'AM', 'AL', 'AXL', 'A2XL', 'A3XL'],
  toddler: ['2T', '3T', '4T', '5T', '5/6', '7'],
  os: ['OS'],
  numeric: []
};

const ALIASES = {
  SMALL: 'S',
  MEDIUM: 'M',
  LARGE: 'L',
  'X-LARGE': 'XL',
  XLARGE: 'XL',
  '2X': '2XL',
  '3X': '3XL',
  ONESIZE: 'OS',
  'ONE-SIZE': 'OS',
  'ONE SIZE': 'OS'
};

/** Longest tokens first so YXS wins over XS and A2XL wins over XL. */
export const SIZE_TOKEN_LIST = [
  ['YOUTHXS', 'YXS', 'youth'],
  ['YXS', 'YXS', 'youth'],
  ['YXL', 'YXL', 'youth'],
  ['AXS', 'AXS', 'adult'],
  ['A2XL', 'A2XL', 'adult'],
  ['A3XL', 'A3XL', 'adult'],
  ['AXL', 'AXL', 'adult'],
  ['2XL', '2XL', 'adult'],
  ['3XL', '3XL', 'adult'],
  ['5/6', '5/6', 'toddler'],
  ['2T', '2T', 'toddler'],
  ['3T', '3T', 'toddler'],
  ['4T', '4T', 'toddler'],
  ['5T', '5T', 'toddler'],
  ['YS', 'YS', 'youth'],
  ['YM', 'YM', 'youth'],
  ['YL', 'YL', 'youth'],
  ['AS', 'AS', 'adult'],
  ['AM', 'AM', 'adult'],
  ['AL', 'AL', 'adult'],
  ['XS', 'XS', null],
  ['XL', 'XL', null],
  ['OS', 'OS', 'os'],
  ['S', 'S', null],
  ['M', 'M', null],
  ['L', 'L', null]
];

export function normalizeSizeToken(raw) {
  let s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(',', '.');
  if (ALIASES[s]) s = ALIASES[s];
  return s;
}

export function suggestSku(itemNo, color, size) {
  const part = (value) => String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return [part(itemNo) || 'SKU', part(color), part(size)].filter(Boolean).join('-');
}
