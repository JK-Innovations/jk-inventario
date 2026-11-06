import { SIZE_TOKEN_LIST, normalizeSizeToken } from './sizes.js';

/**
 * Quick entry, local, no AI.
 * Shape: <qty> <item# or garment words> [color] [size] [school]
 * Example: "5 polo navy M"
 */

export const GARMENTS = [
  { key: 't-shirt', words: ['playera', 'playeras', 't-shirt', 'tshirt', 'tee', 'tees', 'camiseta', 'camisetas'] },
  { key: 'long sleeve', words: ['manga larga', 'long sleeve', 'longsleeve', 'long-sleeve'] },
  { key: 'polo', words: ['polo', 'polos'] },
  { key: 'crewneck', words: ['crewneck', 'crew neck', 'crewneck'] },
  { key: 'hoodie', words: ['sudadera', 'sudaderas', 'hoodie', 'hoodies'] },
  { key: 'jacket', words: ['chamarra', 'chamarras', 'jacket', 'jackets', 'soft shell', 'softshell', 'fleece', 'zip up', 'zip-up', 'zipup', 'shell'] },
  { key: 'beanie', words: ['gorro', 'gorros', 'beanie', 'beanies'] },
  { key: 'cap', words: ['gorra', 'gorras', 'cap', 'caps'] },
  { key: 'pant', words: ['pantalon', 'pantalón', 'pant', 'pants'] },
  { key: 'short', words: ['short', 'shorts'] },
  { key: 'skirt', words: ['falda', 'faldas', 'skirt', 'skirts'] },
  { key: 'jumper', words: ['jumper', 'jumpers'] },
  { key: 'sock', words: ['calceta', 'calcetas', 'sock', 'socks'] },
  { key: 'vest', words: ['chaleco', 'chalecos', 'vest', 'vests'] },
  { key: 'cardigan', words: ['cardigan', 'cardigans'] }
];

const COLOR_PHRASES = [
  ['azul marino', 'navy'],
  ['azul rey', 'royal'],
  ['heather grey', 'gray'],
  ['heather gray', 'gray'],
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
  ['dorado', 'gold'],
  ['gold', 'gold'],
  ['morado', 'purple'],
  ['purple', 'purple'],
  ['cafe', 'brown'],
  ['café', 'brown'],
  ['brown', 'brown'],
  ['naranja', 'orange'],
  ['orange', 'orange'],
  ['amarillo', 'yellow'],
  ['yellow', 'yellow'],
  ['plata', 'silver'],
  ['silver', 'silver'],
  ['khaki', 'khaki'],
  ['charcoal', 'charcoal']
];

const GROUP_HINTS = {
  youth: 'youth',
  youths: 'youth',
  nino: 'youth',
  niño: 'youth',
  nina: 'youth',
  niña: 'youth',
  juvenil: 'youth',
  adult: 'adult',
  adulto: 'adult',
  adulta: 'adult'
};

function fold(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function takePhrase(text, phrases) {
  const folded = fold(text);
  const sorted = [...phrases].sort((a, b) => fold(b[0]).length - fold(a[0]).length);
  for (const [phrase, canonical] of sorted) {
    const needle = fold(phrase);
    const at = folded.indexOf(needle);
    if (at < 0) continue;
    const before = at === 0 || folded[at - 1] === ' ';
    const afterIdx = at + needle.length;
    const after = afterIdx === folded.length || folded[afterIdx] === ' ';
    if (!before || !after) continue;
    const next = (folded.slice(0, at) + ' ' + folded.slice(afterIdx)).replace(/\s+/g, ' ').trim();
    return { canonical, rest: next };
  }
  return null;
}

function applyGroupHint(size, group, hint) {
  if (!hint || !size || group) return { size, group, ambiguous: group == null && !!size };
  const bare = { XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL' };
  if (hint === 'youth' && bare[size]) {
    return { size: `Y${size === 'XS' ? 'XS' : size}`, group: 'youth', ambiguous: false };
  }
  if (hint === 'adult' && bare[size]) {
    return { size: `A${size === 'XS' ? 'XS' : size}`, group: 'adult', ambiguous: false };
  }
  if (hint === 'adult' && size === '2XL') return { size: 'A2XL', group: 'adult', ambiguous: false };
  if (hint === 'adult' && size === '3XL') return { size: 'A3XL', group: 'adult', ambiguous: false };
  return { size, group, ambiguous: group == null };
}

/**
 * @param {string} input
 * @param {{ itemNos?: string[], schools?: string[] }} [catalog]
 */
export function parseQuick(input, catalog = {}) {
  const original = String(input ?? '').trim();
  const result = {
    qty: null,
    itemNo: null,
    garment: null,
    color: null,
    size: null,
    sizeGroup: null,
    sizeAmbiguous: false,
    schoolText: null,
    leftover: []
  };
  if (!original) return result;

  let text = fold(original);
  const qtyMatch = text.match(/^(\d+)\b/);
  if (qtyMatch) {
    result.qty = Number(qtyMatch[1]);
    text = text.slice(qtyMatch[0].length).trim();
  }

  const garmentPhrases = GARMENTS.flatMap((garment) => garment.words.map((word) => [word, garment.key]));
  const garmentHit = takePhrase(text, garmentPhrases);
  if (garmentHit) {
    result.garment = garmentHit.canonical;
    text = garmentHit.rest;
  }

  const colorHit = takePhrase(text, COLOR_PHRASES);
  if (colorHit) {
    result.color = colorHit.canonical;
    text = colorHit.rest;
  }

  const tokens = text.split(' ').filter(Boolean);
  const itemNos = (catalog.itemNos || []).map((n) => fold(n));
  const consumed = new Set();
  let hint = null;

  tokens.forEach((token, index) => {
    if (!GROUP_HINTS[token]) return;
    hint = GROUP_HINTS[token];
    consumed.add(index);
  });

  const sizeTokens = [...SIZE_TOKEN_LIST].sort((a, b) => b[0].length - a[0].length);
  tokens.forEach((token, index) => {
    if (consumed.has(index) || result.size) return;
    const norm = normalizeSizeToken(token);
    const found = sizeTokens.find((entry) => entry[0] === norm);
    if (!found) return;
    result.size = found[1];
    result.sizeGroup = found[2];
    result.sizeAmbiguous = found[2] == null;
    consumed.add(index);
  });

  const looseItem = /^[a-z]{0,4}\d{2,}[a-z0-9]*$/i;
  tokens.forEach((token, index) => {
    if (consumed.has(index) || result.itemNo) return;
    const known = itemNos.includes(token);
    const loose = itemNos.length === 0 && looseItem.test(token);
    if (!known && !loose) return;
    result.itemNo = token.toUpperCase();
    consumed.add(index);
  });

  const hinted = applyGroupHint(result.size, result.sizeGroup, hint);
  result.size = hinted.size;
  result.sizeGroup = hinted.group;
  result.sizeAmbiguous = hinted.ambiguous;

  const rest = tokens.filter((_, index) => !consumed.has(index));
  const schools = catalog.schools || [];
  const hits = schools.filter((name) => schoolWordsMatch(rest, name));
  if (hits.length === 1) {
    result.schoolText = hits[0];
    result.leftover = [];
    return result;
  }
  result.leftover = rest;
  return result;
}

function schoolWords(value) {
  return fold(value).replace(/[^a-z0-9\s]/g, ' ').split(' ').filter(Boolean);
}

function schoolWordsMatch(rest, name) {
  if (!rest.length) return false;
  const nameWords = schoolWords(name);
  return rest.every((word, index) => nameWords[index] === word);
}

export function colorKey(value) {
  const folded = fold(value);
  const hit = takePhrase(folded, COLOR_PHRASES);
  if (hit && hit.rest === '') return hit.canonical;
  return folded;
}

export function matchesVariant(parsed, variant, product) {
  if (!parsed || !variant || !product) return false;
  if (parsed.itemNo) {
    const nos = [product.item_no, ...(product.alt_item_nos || [])].map((n) => String(n || '').toUpperCase());
    if (!nos.includes(parsed.itemNo.toUpperCase())) return false;
  }
  if (parsed.garment) {
    const blob = fold(`${product.garment} ${product.name}`);
    if (!blob.includes(fold(parsed.garment))) return false;
  }
  if (parsed.color && colorKey(variant.color) !== colorKey(parsed.color)) return false;
  if (parsed.size) {
    const size = String(variant.size || '').toUpperCase();
    if (parsed.sizeAmbiguous) {
      const bare = parsed.size.toUpperCase();
      const options = [bare, `Y${bare}`, `A${bare}`];
      if (!options.includes(size)) return false;
    } else if (size !== parsed.size.toUpperCase()) {
      return false;
    }
  }
  if (!parsed.itemNo && !parsed.garment) return false;
  return true;
}
