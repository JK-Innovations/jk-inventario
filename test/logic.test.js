import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toCsv } from '../js/export.js';
import { lineTotalCents, orderTotals, taxCents, toCents } from '../js/money.js';
import { matchesVariant, parseQuick } from '../js/parser.js';
import { setLang } from '../js/i18n.js';
import { buildRows } from '../js/model.js';
import { html } from '../js/render.js';
import { alertFor, buildProductGrids, cardMatchesQuery, sizeOrderIndex } from '../js/stock-grid.js';
import { isSupabaseConfigured } from '../js/supabase-config.js';

test('quick entry understands 5 polo navy M', () => {
  const parsed = parseQuick('5 polo navy M');
  assert.equal(parsed.qty, 5);
  assert.equal(parsed.garment, 'polo');
  assert.equal(parsed.color, 'navy');
  assert.equal(parsed.size, 'M');
  assert.equal(parsed.sizeAmbiguous, true);
});

test('item number and youth size win when the catalog knows the number', () => {
  const parsed = parseQuick('5 5719 navy YM', { itemNos: ['5719'] });
  assert.equal(parsed.itemNo, '5719');
  assert.equal(parsed.color, 'navy');
  assert.equal(parsed.size, 'YM');
  assert.equal(parsed.sizeGroup, 'youth');
  assert.equal(parsed.sizeAmbiguous, false);
});

test('spanish garment words and a youth hint map a bare M', () => {
  const parsed = parseQuick('2 playeras');
  assert.equal(parsed.qty, 2);
  assert.equal(parsed.garment, 't-shirt');
  const hinted = parseQuick('5 polo navy youth M');
  assert.equal(hinted.size, 'YM');
  assert.equal(hinted.sizeGroup, 'youth');
  assert.equal(hinted.sizeAmbiguous, false);
});

test('ambiguous M matches youth and adult, not a different color', () => {
  const parsed = parseQuick('5 polo navy M');
  const product = { item_no: '5719', garment: 'polo', name: 'Harder polo', alt_item_nos: [] };
  assert.equal(matchesVariant(parsed, { color: 'Navy', size: 'YM' }, product), true);
  assert.equal(matchesVariant(parsed, { color: 'Navy', size: 'AM' }, product), true);
  assert.equal(matchesVariant(parsed, { color: 'Grey', size: 'AM' }, product), false);
  assert.equal(matchesVariant(parsed, { color: 'Maroon', size: 'YM' }, product), false);
  assert.equal(matchesVariant(parsed, { color: 'Navy', size: 'YXS' }, product), false);
});

test('CA tax on a client subtotal matches half-away rounding', () => {
  assert.equal(toCents('18.125'), 1813);
  assert.equal(lineTotalCents(2, '18.00'), 3600);
  assert.equal(taxCents(5800), 624);
  const totals = orderTotals([
    { qty: 2, unit_sell_price: '18.00' },
    { qty: 1, unit_sell_price: '22.00' }
  ]);
  assert.deepEqual(totals, { subtotal: 5800, tax: 624, total: 6424 });
});

test('csv keeps cost and client price in separate columns and neutralizes formulas', () => {
  const csv = toCsv([{ sku: 'A', cost_price: '1.00', client_sell_price: '2.00', name: '=HYPERLINK("x")' }]);
  assert.match(csv, /cost_price,client_sell_price/);
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv, /unit_cost/);
});

test('schema file stays in inventory and taxes client price only', () => {
  const sql = readFileSync(new URL('../supabase/001_inventory_schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /create schema if not exists inventory/i);
  assert.match(sql, /min_qty integer not null default 3/);
  assert.match(sql, /0\.10750/);
  assert.match(sql, /unit_sell_price numeric/);
  assert.doesNotMatch(sql, /create table if not exists public\./i);
  assert.doesNotMatch(sql, /alter table public\./i);
  const orderLines = sql.slice(
    sql.indexOf('create table if not exists inventory.order_lines'),
    sql.indexOf('comment on column inventory.order_lines.unit_sell_price')
  );
  assert.doesNotMatch(orderLines, /cost_price/);
});

test('configured publishable key is accepted and the unconfigured screen stays off the login form', () => {
  const configFile = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../supabase/001_inventory_schema.sql', import.meta.url), 'utf8');
  assert.match(configFile, /SUPABASE_URL:\s*"https:\/\/vqxsxltvmevuhmldeukt\.supabase\.co"/);
  assert.match(configFile, /SUPABASE_ANON_KEY:\s*"sb_publishable_ej94gddt9wq36lqyDOXaaQ_9gVXcWvd"/);
  assert.match(configFile, /SCHEMA:\s*"inventory"/);
  assert.match(configFile, /TAX_RATE:\s*0\.1075/);
  assert.doesNotMatch(configFile, /sb_secret_[A-Za-z0-9]/);
  assert.match(schema, /create schema if not exists inventory/i);
  assert.doesNotMatch(schema, /https:\/\/[a-z0-9]+\.supabase\.co/);
  assert.equal(isSupabaseConfigured({
    SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
    SUPABASE_ANON_KEY: 'YOUR_PUBLISHABLE_ANON_KEY'
  }), false);
  assert.equal(isSupabaseConfigured({
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_ANON_KEY: 'sb_secret_not_for_the_browser'
  }), false);
  assert.equal(isSupabaseConfigured({
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_exampleKey123'
  }), true);
  assert.equal(isSupabaseConfigured({
    SUPABASE_URL: 'https://vqxsxltvmevuhmldeukt.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_ej94gddt9wq36lqyDOXaaQ_9gVXcWvd',
    SCHEMA: 'inventory',
    TAX_RATE: 0.1075
  }), true);
  const page = html({ unconfigured: true, session: null, notice: '' });
  assert.match(page, /not configured/i);
  assert.match(page, /data-state="not-configured"/);
  assert.match(page, /publishable anon key/i);
  assert.doesNotMatch(page, /data-form="login"/);
});

test('login screen renders in English without a session', () => {
  const page = html({
    session: null,
    notice: '',
    noticeError: false,
    recovery: false
  });
  assert.match(page, /Workshop inventory/);
  assert.match(page, /Sign in/);
  assert.match(page, /data-form="login"/);
  assert.match(page, /assets\/brand\/logo-stacked-two-color\.png/);
});

test('dashboard explains available stock and the quick-add example', () => {
  const page = html({
    session: { user: { id: 'user-1', email: 'norma@example.com' } },
    profile: { role: 'admin', user_id: 'user-1', display_name: 'Norma' },
    recovery: false,
    booting: false,
    setupError: '',
    notice: '',
    screen: 'dashboard',
    routeId: null,
    filters: { school: 'all', category: 'all', alert: 'all', q: '', moveQ: '', showArchived: false },
    quick: { mode: 'receive', text: '', note: '', delta: '' },
    modal: null,
    productDraft: null,
    movementDraft: { variant_id: '', reason: 'receive', qty: '', direction: 'in', target: '', note: '' },
    orderDraft: null,
    db: {
      schools: [],
      clients: [],
      products: [],
      links: [],
      variants: [],
      stock: [],
      movements: [],
      orders: [],
      lines: [],
      profiles: []
    }
  });
  assert.match(page, /Available = physical/);
  assert.match(page, /5 polo navy M/);
  assert.match(page, /Add school/);
  assert.match(page, /Export CSV/);
});

test('order screen shows multi-line fields and CA tax, not cost', () => {
  const base = {
    session: { user: { id: 'user-1', email: 'norma@example.com' } },
    profile: { role: 'inventario', user_id: 'user-1' },
    recovery: false,
    booting: false,
    setupError: '',
    notice: '',
    screen: 'orders',
    routeId: 'new',
    filters: { school: 'all', category: 'all', alert: 'all', q: '', moveQ: '', showArchived: false },
    quick: { mode: 'receive', text: '', note: '', delta: '' },
    modal: null,
    productDraft: null,
    movementDraft: { variant_id: '', reason: 'receive', qty: '', direction: 'in', target: '', note: '' },
    db: {
      schools: [{ id: 's1', name: 'Harder', colors: ['#1E1E22', '#7A1F2B'], active: true, notes: '' }],
      clients: [{ id: 'c1', name: 'Sample Parent', phone: '', email: '', active: true }],
      products: [{ id: 'p1', name: 'Harder polo', garment: 'polo', category: 'uniform', item_no: '5719', supplier: 'SanMar', active: true }],
      links: [],
      variants: [{ id: 'v1', product_id: 'p1', sku: '5719-NAVY-YM', color: 'Navy', size: 'YM', size_group: 'youth', cost_price: '8.50', sell_price: '18.00', min_qty: 3, active: true }],
      stock: [{ variant_id: 'v1', physical: 12, reserved: 0, available: 12, alert: 'ok' }],
      movements: [],
      orders: [],
      lines: [],
      profiles: []
    }
  };
  const page = html({
    ...base,
    orderDraft: {
      key: 'new',
      id: null,
      order_no: '',
      channel: 'school',
      status: 'draft',
      client_id: 'c1',
      school_id: 's1',
      reference: '',
      notes: '',
      subtotal: null,
      tax_amount: null,
      total: null,
      lines: [{ key: 'l1', variant_id: 'v1', qty: 2, unit_sell_price: '18.00', custom_name: 'Alex', slide: true, sign: false }]
    }
  });
  assert.match(page, /Name on garment/);
  assert.match(page, /Slide/);
  assert.match(page, /Letrero|Sign/);
  assert.match(page, /CA tax 10\.75%/);
  assert.match(page, /\$36\.00/);
  assert.match(page, /\$3\.87/);
  assert.doesNotMatch(page, /Cost \(internal\)/);
});

function stockFixture() {
  return {
    schools: [{ id: 's1', name: 'Harder', active: true, colors: ['#1E1E22'] }],
    clients: [],
    products: [
      { id: 'p1', name: 'Harder polo', garment: 'polo', category: 'uniform', item_no: '5719', supplier: 'SanMar', active: true },
      { id: 'p2', name: 'Beanie', garment: 'beanie', category: 'general', item_no: '100', supplier: 'Capco', active: true }
    ],
    links: [],
    variants: [
      { id: 'v-navy-ym', product_id: 'p1', sku: 'A', color: 'Navy', size: 'YM', size_group: 'youth', sell_price: '18.00', min_qty: 3, active: true, school_id: null },
      { id: 'v-navy-am', product_id: 'p1', sku: 'B', color: 'Navy', size: 'AM', size_group: 'adult', sell_price: '18.00', min_qty: 3, active: true, school_id: null },
      { id: 'v-mar-yxs', product_id: 'p1', sku: 'C', color: 'Maroon', size: 'YXS', size_group: 'youth', sell_price: '22.00', min_qty: 3, active: true, school_id: null },
      { id: 'v-bean', product_id: 'p2', sku: 'D', color: 'Black', size: 'OS', size_group: 'os', sell_price: '12.00', min_qty: 3, active: true, school_id: 's1' }
    ],
    stock: [
      { variant_id: 'v-navy-ym', physical: 12, reserved: 2, available: 10 },
      { variant_id: 'v-navy-am', physical: 2, reserved: 0, available: 2 },
      { variant_id: 'v-mar-yxs', physical: 0, reserved: 0, available: 0 },
      { variant_id: 'v-bean', physical: 5, reserved: 0, available: 5 }
    ],
    movements: [],
    orders: [],
    lines: [],
    profiles: []
  };
}

test('stock grid puts youth sizes before adult and leaves a hole for a missing color', () => {
  assert.ok(sizeOrderIndex('YXS', 'youth') < sizeOrderIndex('YM', 'youth'));
  assert.ok(sizeOrderIndex('YM', 'youth') < sizeOrderIndex('AM', 'adult'));
  assert.ok(sizeOrderIndex('AM', 'adult') < sizeOrderIndex('A2XL', 'adult'));
  assert.equal(alertFor(10, 3), 'ok');
  assert.equal(alertFor(3, 3), 'low');
  assert.equal(alertFor(0, 3), 'out');
  const db = stockFixture();
  const all = buildProductGrids(buildRows(db, { school: 'all' }));
  assert.equal(all.length, 2);
  const polo = all.find((card) => card.product.item_no === '5719');
  assert.deepEqual(polo.sizes.map((size) => size.size), ['YXS', 'YM', 'AM']);
  const navy = polo.colors.find((line) => line.color === 'Navy');
  assert.equal(navy.cells[0], null);
  assert.equal(navy.cells[1].level.available, 10);
  assert.equal(navy.cells[2].level.available, 2);
  assert.equal(cardMatchesQuery(polo, 'navy'), true);
  assert.equal(cardMatchesQuery(polo, '5719'), true);
  assert.equal(cardMatchesQuery(polo, 'beanie'), false);
  const noSchool = buildProductGrids(buildRows(db, { school: 'none' }));
  assert.deepEqual(noSchool.map((card) => card.product.garment), ['polo']);
  const harder = buildProductGrids(buildRows(db, { school: 's1' }));
  assert.deepEqual(harder.map((card) => card.product.garment), ['beanie']);
});

test('stock is the home tab and a cell opens receive, deduct, and adjust', () => {
  const page = html({
    session: { user: { id: 'user-1', email: 'norma@example.com' } },
    profile: { role: 'admin', user_id: 'user-1' },
    recovery: false,
    booting: false,
    setupError: '',
    notice: '',
    screen: 'stock',
    routeId: null,
    filters: { school: 'all', category: 'all', alert: 'all', q: '', stockQ: '', moveQ: '', showArchived: false },
    quick: { mode: 'receive', text: '', note: '', delta: '' },
    modal: null,
    db: stockFixture()
  });
  assert.match(page, /assets\/brand\/logo-horizontal-deep-blue\.png/);
  assert.match(page, /alt="JK Innovations"/);
  assert.match(page, /data-screen="stock"[^>]*aria-current="page"/);
  assert.match(page, />Stock</);
  assert.match(page, /Dashboard/);
  assert.match(page, /\+ Quick entry/);
  assert.match(page, /\+ Add product/);
  assert.match(page, /Total units/);
  assert.match(page, /Search by garment, number or color/);
  assert.match(page, /No school/);
  assert.match(page, /data-view="table"/);
  assert.match(page, /<th>Supplier<\/th>/);
  assert.match(page, /status-pill ok/);
  assert.match(page, /status-pill low/);
  assert.match(page, /status-pill out/);
  assert.match(page, /aria-label="Receive"/);
  assert.match(page, /aria-label="Deduct"/);
  assert.match(page, /aria-label="Adjust"/);
  const yxs = page.indexOf('>YXS<');
  const ym = page.indexOf('>YM<');
  const am = page.indexOf('>AM<');
  assert.ok(yxs > -1 && yxs < ym && ym < am);
  const grid = html({
    session: { user: { id: 'user-1', email: 'norma@example.com' } },
    profile: { role: 'admin', user_id: 'user-1' },
    recovery: false,
    booting: false,
    setupError: '',
    notice: '',
    screen: 'stock',
    routeId: null,
    filters: { school: 'all', category: 'all', alert: 'all', q: '', stockQ: '', stockView: 'grid', moveQ: '', showArchived: false },
    quick: { mode: 'receive', text: '', note: '', delta: '' },
    modal: null,
    db: stockFixture()
  });
  assert.match(grid, /stock-cell empty/);
  assert.match(grid, /class="stock-cell ok"/);
  const open = html({
    session: { user: { id: 'user-1' } },
    profile: { role: 'inventario', user_id: 'user-1' },
    recovery: false,
    booting: false,
    setupError: '',
    notice: '',
    screen: 'stock',
    filters: { school: 'all', stockQ: '' },
    quick: { mode: 'receive', text: '', note: '', delta: '' },
    modal: { type: 'stock', variantId: 'v-navy-ym', mode: 'receive', qty: '1', note: '' },
    db: stockFixture()
  });
  assert.match(open, /data-form="stock-move"/);
  assert.match(open, /Receive/);
  assert.match(open, /Deduct/);
  assert.match(open, /Adjust/);
  setLang('es');
  const spanish = html({
    session: { user: { id: 'user-1' } },
    profile: { role: 'admin', user_id: 'user-1' },
    recovery: false,
    booting: false,
    setupError: '',
    notice: '',
    screen: 'stock',
    filters: { school: 'all', stockQ: '' },
    quick: { mode: 'receive', text: '', note: '', delta: '' },
    modal: null,
    db: stockFixture()
  });
  assert.match(spanish, />Existencias</);
  assert.match(spanish, /Sin escuela/);
  setLang('en');
});
