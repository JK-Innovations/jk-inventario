import { download, stamp, toCsv, toJson } from './export.js';
import { initLang, setLang, t } from './i18n.js';
import { canMoveStock, canWriteCatalog } from './model.js';
import { orderExportRows, stockExportRows, html } from './render.js';
import { SIZES_BY_GROUP, suggestSku } from './sizes.js';
import { toCents } from './money.js';
import { isSupabaseConfigured } from './supabase-config.js';

const cfg = window.JKIN_INVENTARIO_CONFIG || {};

function makeClient() {
  if (!isSupabaseConfigured(cfg) || !window.supabase?.createClient) return null;
  try {
    return window.supabase.createClient(cfg.SUPABASE_URL.trim(), cfg.SUPABASE_ANON_KEY.trim(), {
      db: { schema: cfg.SCHEMA || 'inventory' },
      auth: {
        storageKey: 'jkin-inventario-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  } catch {
    return null;
  }
}

const sb = makeClient();

const state = {
  session: null,
  profile: null,
  recovery: false,
  unconfigured: !sb,
  booting: true,
  setupError: '',
  notice: '',
  noticeError: false,
  loginEmail: '',
  screen: 'stock',
  routeId: null,
  db: emptyDb(),
  filters: { school: 'all', category: 'all', alert: 'all', q: '', stockQ: '', moveQ: '', showArchived: false },
  quick: { mode: 'receive', text: '', note: '', delta: '' },
  modal: null,
  productDraft: null,
  movementDraft: blankMovement(),
  orderDraft: null,
  orderClient: blankOrderClient(),
  saving: false
};

initLang();

function emptyDb() {
  return { schools: [], clients: [], products: [], links: [], variants: [], stock: [], movements: [], orders: [], lines: [], profiles: [] };
}

function blankMovement() {
  return { variant_id: '', reason: 'receive', qty: '', direction: 'in', target: '', note: '' };
}

function blankVariant() {
  return {
    key: crypto.randomUUID(),
    id: null,
    color: '',
    size_group: 'youth',
    size: 'YM',
    sku: '',
    cost_price: '',
    sell_price: '',
    min_qty: 3,
    school_id: '',
    client_id: '',
    design: '',
    active: true
  };
}

function blankProduct() {
  return {
    key: 'new',
    id: null,
    name: '',
    garment: '',
    category: 'uniform',
    item_no: '',
    supplier: '',
    lead_time_days: '',
    notes: '',
    schoolIds: [],
    variants: [blankVariant()]
  };
}

function blankOrderClient() {
  return { active: false, query: '', open: false, error: '', name: '', phone: '', email: '', school_id: '' };
}

function blankOrder() {
  return {
    key: 'new',
    id: null,
    order_no: '',
    channel: 'workshop',
    status: 'draft',
    client_id: '',
    school_id: '',
    reference: '',
    notes: '',
    subtotal: null,
    tax_amount: null,
    total: null,
    lines: [blankLine()]
  };
}

function blankLine(variant) {
  return {
    key: crypto.randomUUID(),
    variant_id: variant?.id || '',
    qty: 1,
    unit_sell_price: variant?.sell_price ?? '',
    custom_name: '',
    slide: false,
    sign: false
  };
}

function render() {
  syncEditors();
  document.getElementById('app').innerHTML = html(state);
}

function syncEditors() {
  if (state.screen === 'products') {
    if (!state.routeId) state.productDraft = null;
    else if (state.productDraft?.key !== state.routeId) {
      state.productDraft = state.routeId === 'new' ? blankProduct() : productFromId(state.routeId);
    }
  }
  if (state.screen === 'orders') {
    if (!state.routeId) state.orderDraft = null;
    else if (state.orderDraft?.key !== state.routeId) {
      state.orderDraft = state.routeId === 'new' ? blankOrder() : orderFromId(state.routeId);
      state.orderClient = blankOrderClient();
      const chosen = state.db.clients.find((client) => client.id === state.orderDraft.client_id);
      if (chosen) state.orderClient.query = chosen.name;
    }
  }
}

function productFromId(id) {
  const product = state.db.products.find((row) => row.id === id);
  if (!product) return blankProduct();
  const schoolIds = state.db.links.filter((link) => link.product_id === id).map((link) => link.school_id);
  const variants = state.db.variants.filter((row) => row.product_id === id).map((row) => ({
    key: row.id,
    id: row.id,
    color: row.color,
    size_group: row.size_group,
    size: row.size,
    sku: row.sku,
    cost_price: row.cost_price,
    sell_price: row.sell_price,
    min_qty: row.min_qty,
    school_id: row.school_id || '',
    client_id: row.client_id || '',
    design: row.design || '',
    active: row.active !== false
  }));
  return {
    key: id,
    id,
    name: product.name,
    garment: product.garment,
    category: product.category,
    item_no: product.item_no || '',
    supplier: product.supplier || '',
    lead_time_days: product.lead_time_days ?? '',
    notes: product.notes || '',
    schoolIds,
    variants: variants.length ? variants : [blankVariant()]
  };
}

function orderFromId(id) {
  const order = state.db.orders.find((row) => row.id === id);
  if (!order) return blankOrder();
  const lines = state.db.lines.filter((line) => line.order_id === id).map((line) => ({
    key: line.id,
    variant_id: line.variant_id,
    qty: line.qty,
    unit_sell_price: line.unit_sell_price,
    custom_name: line.custom_name || '',
    slide: !!line.slide,
    sign: !!line.sign
  }));
  return {
    key: id,
    id,
    order_no: order.order_no,
    channel: order.channel,
    status: order.status,
    client_id: order.client_id || '',
    school_id: order.school_id || '',
    reference: order.reference || '',
    notes: order.notes || '',
    subtotal: order.subtotal,
    tax_amount: order.tax_amount,
    total: order.total,
    lines: lines.length ? lines : [blankLine()]
  };
}

function go(screen, id) {
  const next = `#/${screen}${id ? `/${id}` : ''}`;
  if (location.hash !== next) location.hash = next;
  else {
    state.screen = screen;
    state.routeId = id || null;
    render();
  }
}

function applyHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  if (raw.includes('access_token') || raw.includes('error_description')) return;
  const [screen, id] = raw.split('/');
  const known = ['stock', 'dashboard', 'products', 'movements', 'orders', 'directory'];
  state.screen = known.includes(screen) ? screen : 'stock';
  state.routeId = id || null;
}

function flash(message, isError = false) {
  state.notice = message;
  state.noticeError = isError;
  const el = document.getElementById('notice');
  if (!el) {
    render();
    return;
  }
  el.hidden = !message;
  el.textContent = message;
  el.className = `banner ${isError ? 'bad' : 'good'}`;
}

function formError(message) {
  const el = document.getElementById('form-error');
  if (!el) {
    flash(message, true);
    return;
  }
  el.hidden = !message;
  el.textContent = message || '';
}

function errText(error) {
  if (!error) return '';
  return [error.message, error.details, error.hint].filter(Boolean).join(' ');
}

async function loadAll() {
  state.booting = true;
  state.setupError = '';
  render();
  const jobs = [
    ['schools', 'name', true],
    ['clients', 'name', true],
    ['products', 'name', true],
    ['product_schools', 'product_id', true],
    ['variants', 'sku', true],
    ['stock_levels', 'sku', true],
    ['movements', 'created_at', false],
    ['orders', 'created_at', false],
    ['order_lines', 'created_at', true],
    ['profiles', 'display_name', true]
  ];
  try {
    const loaded = {};
    for (const [table, column, ascending] of jobs) {
      let query = sb.from(table).select('*').order(column, { ascending });
      if (table === 'movements' || table === 'orders') query = query.limit(500);
      const { data, error } = await query;
      if (error) throw error;
      loaded[table] = data || [];
    }
    state.db = {
      schools: loaded.schools,
      clients: loaded.clients,
      products: loaded.products,
      links: loaded.product_schools,
      variants: loaded.variants,
      stock: loaded.stock_levels,
      movements: loaded.movements,
      orders: loaded.orders,
      lines: loaded.order_lines,
      profiles: loaded.profiles
    };
    state.profile = loaded.profiles.find((profile) => profile.user_id === state.session.user.id) || null;
    state.booting = false;
    render();
  } catch (error) {
    state.booting = false;
    state.setupError = errText(error);
    render();
  }
}

async function refreshProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();
  if (error) {
    state.setupError = errText(error);
    state.profile = null;
    state.booting = false;
    render();
    return;
  }
  state.profile = data;
  if (!data) {
    state.booting = false;
    render();
    return;
  }
  await loadAll();
}

function readQuick() {
  const text = document.getElementById('quick-text');
  const note = document.getElementById('quick-note');
  const delta = document.getElementById('quick-delta');
  if (text) state.quick.text = text.value;
  if (note) state.quick.note = note.value;
  if (delta) state.quick.delta = delta.value;
}

function snapshotProduct() {
  const form = document.getElementById('product-form');
  if (!form || !state.productDraft) return;
  const data = new FormData(form);
  state.productDraft = {
    ...state.productDraft,
    name: data.get('name') || '',
    garment: data.get('garment') || '',
    category: data.get('category') || 'uniform',
    item_no: data.get('item_no') || '',
    supplier: data.get('supplier') || '',
    lead_time_days: data.get('lead_time_days') || '',
    notes: data.get('notes') || '',
    schoolIds: data.getAll('school'),
    variants: [...form.querySelectorAll('[data-variant-row]')].map((row) => ({
      key: row.dataset.key,
      id: row.dataset.id || null,
      color: row.querySelector('[name=color]').value,
      size_group: row.querySelector('[name=size_group]').value,
      size: row.querySelector('[name=size]').value,
      sku: row.querySelector('[name=sku]').value,
      cost_price: row.querySelector('[name=cost_price]').value,
      sell_price: row.querySelector('[name=sell_price]').value,
      min_qty: row.querySelector('[name=min_qty]').value,
      school_id: row.querySelector('[name=school_id]').value,
      client_id: row.querySelector('[name=client_id]').value,
      design: row.querySelector('[name=design]').value,
      active: row.querySelector('[name=active]') ? row.querySelector('[name=active]').checked : true
    }))
  };
}

function snapshotOrder() {
  const form = document.getElementById('order-form');
  if (!form || !state.orderDraft) return;
  const data = new FormData(form);
  state.orderDraft = {
    ...state.orderDraft,
    client_id: data.get('client_id') || '',
    school_id: data.get('school_id') || '',
    channel: data.get('channel') || 'workshop',
    reference: data.get('reference') || '',
    notes: data.get('notes') || '',
    lines: [...form.querySelectorAll('[data-line]')].map((row) => ({
      key: row.dataset.key,
      variant_id: row.querySelector('[name=variant_id]').value,
      qty: row.querySelector('[name=qty]').value,
      unit_sell_price: row.querySelector('[name=unit_sell_price]').value,
      custom_name: row.querySelector('[name=custom_name]').value,
      slide: row.querySelector('[name=slide]').checked,
      sign: row.querySelector('[name=sign]').checked
    }))
  };
}

function snapshotMovement() {
  const form = document.getElementById('movement-form');
  if (!form) return;
  const data = new FormData(form);
  state.movementDraft = {
    variant_id: data.get('variant_id') || '',
    reason: data.get('reason') || 'receive',
    qty: data.get('qty') || '',
    direction: data.get('direction') || 'in',
    target: data.get('target') || '',
    note: data.get('note') || ''
  };
}

function nullIfBlank(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

async function saveProduct(form) {
  if (!canWriteCatalog(state.profile.role)) return;
  snapshotProduct();
  const draft = state.productDraft;
  if (!draft.name.trim() || !draft.garment.trim()) {
    formError(t('required'));
    return;
  }
  const lead = String(draft.lead_time_days).trim();
  if (lead && (!/^\d+$/.test(lead) || Number(lead) < 0)) {
    formError(t('badNumber'));
    return;
  }
  const variants = [];
  for (const row of draft.variants) {
    const cost = toCents(row.cost_price);
    const sell = toCents(row.sell_price);
    const min = Number(row.min_qty);
    if (!row.color.trim() || !row.size.trim() || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(sell) || sell < 0 || !Number.isInteger(min) || min < 0) {
      formError(t('badNumber'));
      return;
    }
    variants.push({
      id: row.id,
      color: row.color.trim(),
      size_group: row.size_group,
      size: row.size.trim(),
      sku: (row.sku.trim() || suggestSku(draft.item_no, row.color, row.size)).toUpperCase(),
      cost_price: (cost / 100).toFixed(2),
      sell_price: (sell / 100).toFixed(2),
      min_qty: min,
      school_id: nullIfBlank(row.school_id),
      client_id: nullIfBlank(row.client_id),
      design: row.design.trim(),
      active: row.active !== false
    });
  }
  const payload = {
    name: draft.name.trim(),
    garment: draft.garment.trim(),
    category: draft.category,
    item_no: draft.item_no.trim(),
    supplier: draft.supplier.trim(),
    lead_time_days: lead === '' ? null : Number(lead),
    notes: draft.notes.trim()
  };
  let productId = draft.id;
  if (!productId) {
    const { data, error } = await sb.from('products').insert(payload).select('*').single();
    if (error) throw error;
    productId = data.id;
  } else {
    const { error } = await sb.from('products').update(payload).eq('id', productId);
    if (error) throw error;
  }
  const { error: clearError } = await sb.from('product_schools').delete().eq('product_id', productId);
  if (clearError) throw clearError;
  if (draft.schoolIds.length) {
    const { error } = await sb.from('product_schools').insert(draft.schoolIds.map((school_id) => ({ product_id: productId, school_id })));
    if (error) throw error;
  }
  for (const row of variants) {
    const body = { ...row, product_id: productId };
    delete body.id;
    if (row.id) {
      const { error } = await sb.from('variants').update(body).eq('id', row.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('variants').insert(body);
      if (error) throw error;
    }
  }
  state.productDraft = null;
  await loadAll();
  go('products', productId);
  flash(t('saved'));
}

async function saveMovement() {
  snapshotMovement();
  const draft = state.movementDraft;
  if (!draft.variant_id) {
    formError(t('required'));
    return;
  }
  let delta = 0;
  let note = draft.note.trim();
  if (draft.reason === 'count') {
    if (!/^\d+$/.test(String(draft.target).trim())) {
      formError(t('badNumber'));
      return;
    }
    const level = state.db.stock.find((row) => row.variant_id === draft.variant_id);
    const physical = Number(level?.physical || 0);
    delta = Number(draft.target) - physical;
    if (delta === 0) {
      flash(t('alreadyMatches'));
      return;
    }
    if (!note) note = `Physical count ${draft.target}`;
  } else {
    if (!/^\d+$/.test(String(draft.qty).trim()) || Number(draft.qty) <= 0) {
      formError(t('badNumber'));
      return;
    }
    const magnitude = Number(draft.qty);
    const incoming = draft.reason === 'receive' || draft.reason === 'return' || draft.direction !== 'out';
    delta = incoming ? magnitude : -magnitude;
    if ((draft.reason === 'adjust' || draft.reason === 'correction') && !note) {
      formError(t('noteRequired'));
      return;
    }
  }
  const { error } = await sb.from('movements').insert({
    variant_id: draft.variant_id,
    delta,
    reason: draft.reason,
    note
  });
  if (error) throw error;
  state.movementDraft = { ...blankMovement(), variant_id: draft.variant_id, reason: draft.reason };
  await loadAll();
  flash(t('movementRecorded'));
}

function readStockModal() {
  const form = document.querySelector('form[data-form="stock-move"]');
  if (!form || state.modal?.type !== 'stock') return;
  const data = new FormData(form);
  state.modal.qty = String(data.get('qty') ?? state.modal.qty ?? '1');
  state.modal.note = String(data.get('note') ?? state.modal.note ?? '');
}

async function saveStockCell(form) {
  if (!canMoveStock(state.profile?.role) || state.modal?.type !== 'stock') return;
  const data = new FormData(form);
  const mode = state.modal.mode || 'receive';
  const raw = String(data.get('qty') || '').trim();
  let note = String(data.get('note') || '').trim();
  let delta;
  let reason;
  if (mode === 'adjust') {
    if (!/^[+-]?\d+$/.test(raw) || Number(raw) === 0) {
      formError(t('badNumber'));
      return;
    }
    delta = Number(raw);
    reason = 'correction';
    if (!note) {
      formError(t('noteRequired'));
      return;
    }
  } else if (mode === 'deduct') {
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
      formError(t('badNumber'));
      return;
    }
    delta = -Number(raw);
    reason = 'adjust';
    if (!note) {
      formError(t('noteRequired'));
      return;
    }
  } else {
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
      formError(t('badNumber'));
      return;
    }
    delta = Number(raw);
    reason = 'receive';
    if (!note) note = 'Stock receive';
  }
  await insertMovement({ variantId: state.modal.variantId, delta, reason, note });
  state.modal = null;
  await loadAll();
  flash(t('movementRecorded'));
}

async function insertMovement({ variantId, delta, reason, note }) {
  const { error } = await sb.from('movements').insert({
    variant_id: variantId,
    delta,
    reason,
    note
  });
  if (error) throw error;
}

async function applyQuick(variantId) {
  readQuick();
  const qty = Number(String(state.quick.text).trim().match(/^(\d+)/)?.[1] || 0);
  if (!qty) {
    flash(t('needQty'), true);
    return;
  }
  let delta = qty;
  let reason = 'receive';
  let note = state.quick.note.trim();
  if (state.quick.mode === 'deduct') {
    delta = -qty;
    reason = 'adjust';
    if (!note) {
      flash(t('noteRequired'), true);
      return;
    }
  } else if (state.quick.mode === 'adjust') {
    if (!/^[+-]?\d+$/.test(String(state.quick.delta).trim()) || Number(state.quick.delta) === 0) {
      flash(t('badNumber'), true);
      return;
    }
    delta = Number(state.quick.delta);
    reason = 'correction';
    if (!note) {
      flash(t('noteRequired'), true);
      return;
    }
  } else if (!note) {
    note = 'Quick receive';
  }
  await insertMovement({ variantId, delta, reason, note });
  state.quick.text = '';
  state.quick.note = '';
  state.quick.delta = '';
  await loadAll();
  flash(t('movementRecorded'));
}

async function saveOrder() {
  if (!canWriteCatalog(state.profile.role)) return;
  snapshotOrder();
  const draft = state.orderDraft;
  if (['fulfilled', 'cancelled'].includes(draft.status)) {
    formError(t('closedOrder'));
    return;
  }
  const lines = [];
  for (const line of draft.lines) {
    const qty = Number(line.qty);
    const price = toCents(line.unit_sell_price);
    if (!line.variant_id || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      formError(t('badNumber'));
      return;
    }
    lines.push({
      variant_id: line.variant_id,
      qty,
      unit_sell_price: (price / 100).toFixed(2),
      custom_name: line.custom_name.trim(),
      slide: !!line.slide,
      sign: !!line.sign
    });
  }
  if (!lines.length) {
    formError(t('noLines'));
    return;
  }
  const header = {
    channel: draft.channel,
    client_id: nullIfBlank(draft.client_id),
    school_id: nullIfBlank(draft.school_id),
    reference: draft.reference.trim(),
    notes: draft.notes.trim()
  };
  let orderId = draft.id;
  if (!orderId) {
    const { data, error } = await sb.from('orders').insert(header).select('*').single();
    if (error) throw error;
    orderId = data.id;
    state.orderDraft.id = orderId;
    state.orderDraft.key = orderId;
    state.orderDraft.order_no = data.order_no;
    state.routeId = orderId;
    history.replaceState(null, '', `#/orders/${orderId}`);
  } else {
    const { error } = await sb.from('orders').update(header).eq('id', orderId);
    if (error) throw error;
    const { error: deleteError } = await sb.from('order_lines').delete().eq('order_id', orderId);
    if (deleteError) throw deleteError;
  }
  const { error: lineError } = await sb.from('order_lines').insert(lines.map((line) => ({ ...line, order_id: orderId })));
  if (lineError) throw lineError;
  await loadAll();
  state.orderDraft = orderFromId(orderId);
  state.orderDraft.key = orderId;
  render();
  flash(t('orderSaved'));
}

async function setStatus(status) {
  if (!state.orderDraft?.id) return;
  const { error } = await sb.from('orders').update({ status }).eq('id', state.orderDraft.id);
  if (error) throw error;
  const id = state.orderDraft.id;
  await loadAll();
  state.orderDraft = orderFromId(id);
  state.orderDraft.key = id;
  render();
  flash(t('saved'));
}

async function deleteOrder() {
  const id = state.orderDraft?.id;
  if (!id) return;
  if (!window.confirm(t('confirmDelete'))) return;
  const { error: lineError } = await sb.from('order_lines').delete().eq('order_id', id);
  if (lineError) throw lineError;
  const { error } = await sb.from('orders').delete().eq('id', id);
  if (error) throw error;
  state.orderDraft = null;
  await loadAll();
  go('orders');
  flash(t('saved'));
}

async function saveSchool(form) {
  const data = new FormData(form);
  const payload = {
    name: String(data.get('name') || '').trim(),
    colors: [data.get('color_a'), data.get('color_b')].filter(Boolean),
    notes: String(data.get('notes') || '').trim(),
    active: data.get('active') === 'on'
  };
  if (!payload.name) {
    formError(t('required'));
    return;
  }
  const id = state.modal?.school?.id;
  const { error } = id
    ? await sb.from('schools').update(payload).eq('id', id)
    : await sb.from('schools').insert(payload);
  if (error) throw error;
  state.modal = null;
  await loadAll();
  flash(t('saved'));
}

async function saveOrderClient(fields) {
  if (!canWriteCatalog(state.profile?.role) || !state.orderDraft) return;
  if (!sb) {
    state.orderClient.error = t('notConfiguredTitle');
    render();
    return;
  }
  const name = String(fields.name || '').trim();
  const email = String(fields.email || '').trim();
  if (!name) {
    state.orderClient.open = true;
    state.orderClient.error = t('required');
    render();
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    state.orderClient.open = true;
    state.orderClient.error = t('badEmail');
    render();
    return;
  }
  const payload = {
    name,
    phone: String(fields.phone || '').trim(),
    email,
    school_id: nullIfBlank(fields.school_id),
    notes: '',
    active: true
  };
  const { data, error } = await sb.from('clients').insert(payload).select('id,name,phone,email,school_id,notes,active').single();
  if (error) throw error;
  state.orderDraft.client_id = data.id;
  state.orderClient = { ...blankOrderClient(), query: data.name };
  await loadAll();
  render();
  flash(t('clientCreated'));
}

async function saveClient(form) {
  const data = new FormData(form);
  const payload = {
    name: String(data.get('name') || '').trim(),
    phone: String(data.get('phone') || '').trim(),
    email: String(data.get('email') || '').trim(),
    school_id: nullIfBlank(data.get('school_id')),
    notes: String(data.get('notes') || '').trim(),
    active: data.get('active') === 'on'
  };
  if (!payload.name) {
    formError(t('required'));
    return;
  }
  const id = state.modal?.client?.id;
  const { error } = id
    ? await sb.from('clients').update(payload).eq('id', id)
    : await sb.from('clients').insert(payload);
  if (error) throw error;
  state.modal = null;
  await loadAll();
  flash(t('saved'));
}

async function saveAccess(form) {
  const data = new FormData(form);
  const userId = String(data.get('user_id') || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    formError(t('badUser'));
    return;
  }
  const payload = {
    user_id: userId,
    display_name: String(data.get('display_name') || '').trim(),
    role: data.get('role'),
    active: data.get('active') === 'on'
  };
  const exists = state.db.profiles.some((profile) => profile.user_id === userId);
  const { error } = exists
    ? await sb.from('profiles').update(payload).eq('user_id', userId)
    : await sb.from('profiles').insert(payload);
  if (error) throw error;
  state.modal = null;
  await loadAll();
  flash(t('saved'));
}

async function onSubmit(event) {
  const form = event.target;
  const kind = form?.dataset?.form;
  if (!kind) return;
  event.preventDefault();
  if (!sb) {
    state.unconfigured = true;
    render();
    return;
  }
  if (state.saving) return;
  state.saving = true;
  formError('');
  try {
    if (kind === 'login') {
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      state.loginEmail = email;
      const { error } = await sb.auth.signInWithPassword({
        email,
        password: String(data.get('password') || '')
      });
      if (error) flash(errText(error), true);
    } else if (kind === 'recovery') {
      const password = new FormData(form).get('password');
      const { error } = await sb.auth.updateUser({ password: String(password || '') });
      if (error) flash(errText(error), true);
      else {
        state.recovery = false;
        flash(t('passwordSaved'));
        render();
      }
    } else if (kind === 'stock-move') await saveStockCell(form);
    else if (kind === 'quick') {
      const only = form.querySelector('[data-action="quick-apply"]');
      if (only && form.querySelectorAll('[data-action="quick-apply"]').length === 1) await applyQuick(only.dataset.id);
    } else if (kind === 'product') await saveProduct(form);
    else if (kind === 'movement') await saveMovement();
    else if (kind === 'order') await saveOrder();
    else if (kind === 'school') await saveSchool(form);
    else if (kind === 'client') await saveClient(form);
    else if (kind === 'access') await saveAccess(form);
  } catch (error) {
    formError(errText(error));
  } finally {
    state.saving = false;
  }
}

function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'close-modal' && event.target.closest('.modal')) return;
  const action = button.dataset.action;
  if (action === 'stop') return;
  if (action === 'lang') {
    setLang(button.dataset.lang);
    render();
    return;
  }
  if (action === 'signout') {
    if (!sb) return;
    sb.auth.signOut();
    return;
  }
  if (action === 'forgot') {
    if (!sb) return;
    const email = document.querySelector('form[data-form="login"] [name=email]')?.value?.trim();
    if (!email) {
      flash(t('required'), true);
      return;
    }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(({ error }) => {
      flash(error ? errText(error) : t('forgotSent'), !!error);
    });
    return;
  }
  if (action === 'copy-id') {
    const id = state.session?.user?.id || '';
    navigator.clipboard?.writeText(id).then(() => flash(t('copied'))).catch(() => flash(id));
    return;
  }
  if (action === 'open-quick') {
    readQuick();
    state.modal = { type: 'quick' };
    render();
    return;
  }
  if (action === 'stock-alert') {
    state.filters.alert = button.dataset.alert || 'all';
    render();
    return;
  }
  if (action === 'stock-view') {
    state.filters.stockView = button.dataset.view === 'grid' ? 'grid' : 'table';
    render();
    return;
  }
  if (action === 'nav') {
    go(button.dataset.screen);
    return;
  }
  if (action === 'stock-cell') {
    if (!canMoveStock(state.profile?.role)) return;
    state.modal = { type: 'stock', variantId: button.dataset.id, mode: button.dataset.mode || 'receive', qty: '1', note: '' };
    render();
    return;
  }
  if (action === 'stock-mode') {
    readStockModal();
    if (state.modal?.type !== 'stock') return;
    state.modal.mode = button.dataset.mode;
    if (state.modal.mode !== 'adjust' && Number(state.modal.qty) < 1) state.modal.qty = '1';
    render();
    return;
  }
  if (action === 'stock-step') {
    readStockModal();
    if (state.modal?.type !== 'stock') return;
    const dir = Number(button.dataset.dir) || 0;
    let next = Number(String(state.modal.qty).trim());
    if (!Number.isFinite(next)) next = 0;
    next += dir;
    if (state.modal.mode === 'adjust') {
      if (next === 0) next = dir < 0 ? -1 : 1;
    } else {
      next = Math.max(1, next);
    }
    state.modal.qty = String(next);
    render();
    return;
  }
  if (action === 'quick-mode') {
    readQuick();
    state.quick.mode = button.dataset.mode;
    render();
    return;
  }
  if (action === 'quick-apply') {
    applyQuick(button.dataset.id).catch((error) => flash(errText(error), true));
    return;
  }
  if (action === 'export-stock') {
    const data = stockExportRows(state);
    const name = `jk-inventory-${stamp()}`;
    if (button.dataset.kind === 'json') download(`${name}.json`, toJson(data), 'application/json');
    else download(`${name}.csv`, toCsv(data), 'text/csv');
    return;
  }
  if (action === 'export-orders') {
    const data = orderExportRows(state);
    const name = `jk-orders-${stamp()}`;
    if (button.dataset.kind === 'json') download(`${name}.json`, toJson(data), 'application/json');
    else download(`${name}.csv`, toCsv(data), 'text/csv');
    return;
  }
  if (action === 'open-school') {
    state.modal = { type: 'school', school: { name: '', colors: ['#1E1E22', '#9A4A3C'], notes: '', active: true } };
    render();
    return;
  }
  if (action === 'edit-school') {
    const school = state.db.schools.find((row) => row.id === button.dataset.id);
    state.modal = { type: 'school', school: { ...school } };
    render();
    return;
  }
  if (action === 'open-client') {
    snapshotOrder();
    state.modal = { type: 'client', client: { name: '', phone: '', email: '', school_id: '', notes: '', active: true } };
    render();
    return;
  }
  if (action === 'edit-client') {
    const client = state.db.clients.find((row) => row.id === button.dataset.id);
    state.modal = { type: 'client', client: { ...client } };
    render();
    return;
  }
  if (action === 'open-access') {
    state.modal = { type: 'access', profile: { user_id: '', display_name: '', role: 'inventario', active: true } };
    render();
    return;
  }
  if (action === 'edit-access') {
    const profile = state.db.profiles.find((row) => row.user_id === button.dataset.id);
    state.modal = { type: 'access', profile: { ...profile, existing: true } };
    render();
    return;
  }
  if (action === 'close-modal') {
    state.modal = null;
    render();
    return;
  }
  if (action === 'new-product') {
    state.productDraft = null;
    go('products', 'new');
    return;
  }
  if (action === 'edit-product') {
    state.productDraft = null;
    go('products', button.dataset.id);
    return;
  }
  if (action === 'back-products') go('products');
  if (action === 'add-variant') {
    snapshotProduct();
    state.productDraft.variants.push(blankVariant());
    render();
    return;
  }
  if (action === 'remove-variant') {
    snapshotProduct();
    state.productDraft.variants = state.productDraft.variants.filter((row) => row.key !== button.dataset.key);
    if (!state.productDraft.variants.length) state.productDraft.variants.push(blankVariant());
    render();
    return;
  }
  if (action === 'count-variant') {
    state.movementDraft = { ...blankMovement(), variant_id: button.dataset.id, reason: 'count' };
    go('movements');
    return;
  }
  if (action === 'new-order') {
    state.orderDraft = null;
    state.orderClient = blankOrderClient();
    go('orders', 'new');
    return;
  }
  if (action === 'toggle-new-client') {
    snapshotOrder();
    state.orderClient.open = !state.orderClient.open;
    state.orderClient.error = '';
    if (state.orderClient.open && !state.orderClient.name) state.orderClient.name = state.orderClient.query.trim();
    render();
    return;
  }
  if (action === 'cancel-new-client') {
    state.orderClient.open = false;
    state.orderClient.error = '';
    render();
    return;
  }
  if (action === 'pick-client') {
    snapshotOrder();
    const client = state.db.clients.find((row) => row.id === button.dataset.id);
    if (client && state.orderDraft) {
      state.orderDraft.client_id = client.id;
      state.orderClient.active = false;
      state.orderClient.query = client.name;
      state.orderClient.open = false;
      state.orderClient.error = '';
    }
    render();
    return;
  }
  if (action === 'clear-client') {
    snapshotOrder();
    if (state.orderDraft) state.orderDraft.client_id = '';
    state.orderClient = blankOrderClient();
    state.orderClient.active = true;
    render();
    return;
  }
  if (action === 'create-named-client') {
    snapshotOrder();
    saveOrderClient({ name: state.orderClient.query.trim() }).catch((error) => {
      state.orderClient.error = errText(error);
      render();
    });
    return;
  }
  if (action === 'save-order-client') {
    snapshotOrder();
    saveOrderClient({
      name: state.orderClient.name.trim(),
      phone: state.orderClient.phone.trim(),
      email: state.orderClient.email.trim(),
      school_id: state.orderClient.school_id
    }).catch((error) => {
      state.orderClient.error = errText(error);
      render();
    });
    return;
  }
  if (action === 'edit-order') {
    state.orderDraft = null;
    go('orders', button.dataset.id);
    return;
  }
  if (action === 'back-orders') go('orders');
  if (action === 'add-line') {
    snapshotOrder();
    state.orderDraft.lines.push(blankLine());
    render();
    return;
  }
  if (action === 'remove-line') {
    snapshotOrder();
    state.orderDraft.lines = state.orderDraft.lines.filter((line) => line.key !== button.dataset.key);
    if (!state.orderDraft.lines.length) state.orderDraft.lines.push(blankLine());
    render();
    return;
  }
  if (action === 'set-status') {
    setStatus(button.dataset.status).catch((error) => formError(errText(error)));
    return;
  }
  if (action === 'delete-order') {
    deleteOrder().catch((error) => formError(errText(error)));
  }
}

function onChange(event) {
  if (event.target.id === 'new-client-school') {
    state.orderClient.school_id = event.target.value;
    return;
  }
  const filter = event.target.dataset?.filter;
  if (filter) {
    if (filter === 'showArchived') state.filters.showArchived = event.target.checked;
    else state.filters[filter] = event.target.value;
    render();
    return;
  }
  if (event.target.closest('#movement-form')) {
    snapshotMovement();
    render();
    return;
  }
  if (event.target.name === 'size_group' && event.target.closest('[data-variant-row]')) {
    snapshotProduct();
    const key = event.target.closest('[data-variant-row]').dataset.key;
    const row = state.productDraft.variants.find((variant) => variant.key === key);
    const sizes = SIZES_BY_GROUP[row?.size_group] || [];
    if (row && sizes.length && !sizes.includes(String(row.size).toUpperCase())) row.size = sizes[0];
    render();
    return;
  }
  if (event.target.name === 'variant_id' && event.target.closest('[data-line]')) {
    snapshotOrder();
    const line = state.orderDraft.lines.find((row) => row.key === event.target.closest('[data-line]').dataset.key);
    const variant = state.db.variants.find((row) => row.id === event.target.value);
    if (line && variant) line.unit_sell_price = variant.sell_price;
    render();
  }
}

function keepField(id, start) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  if (start != null && el.setSelectionRange) el.setSelectionRange(start, start);
}

function onInput(event) {
  if (event.target.id === 'order-client-q') {
    snapshotOrder();
    const value = event.target.value;
    state.orderClient.active = true;
    state.orderClient.query = value;
    state.orderClient.error = '';
    const selected = state.db.clients.find((client) => client.id === state.orderDraft?.client_id);
    if (selected && selected.name !== value && state.orderDraft) state.orderDraft.client_id = '';
    const start = event.target.selectionStart;
    render();
    keepField('order-client-q', start);
    return;
  }
  if (event.target.id === 'new-client-name' || event.target.id === 'new-client-phone' || event.target.id === 'new-client-email') {
    state.orderClient[event.target.id.replace('new-client-', '')] = event.target.value;
    return;
  }
  if (event.target.dataset?.filter === 'q' || event.target.dataset?.filter === 'moveQ' || event.target.dataset?.filter === 'stockQ') {
    state.filters[event.target.dataset.filter] = event.target.value;
    const start = event.target.selectionStart;
    const id = event.target.id;
    render();
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      if (start != null) el.setSelectionRange(start, start);
    }
    return;
  }
  if (event.target.id === 'quick-text' || event.target.id === 'quick-note' || event.target.id === 'quick-delta') {
    readQuick();
    const box = document.getElementById('quick-results');
    if (!box) return;
    const fresh = html(state);
    const holder = document.createElement('div');
    holder.innerHTML = fresh;
    const next = holder.querySelector('#quick-results');
    if (next) box.innerHTML = next.innerHTML;
    return;
  }
  if (event.target.closest('#order-form') && event.target.name !== 'notes') {
    snapshotOrder();
    const box = document.getElementById('order-totals');
    if (!box) return;
    const fresh = document.createElement('div');
    fresh.innerHTML = html(state);
    const next = fresh.querySelector('#order-totals');
    if (next) box.innerHTML = next.innerHTML;
  }
}

document.body.addEventListener('click', onClick);
document.body.addEventListener('submit', onSubmit);
document.body.addEventListener('change', onChange);
document.body.addEventListener('input', onInput);
window.addEventListener('hashchange', () => {
  applyHash();
  render();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modal) {
    state.modal = null;
    render();
  }
});

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (location.hash.includes('access_token')) {
      history.replaceState(null, '', `${location.pathname}${location.search}#/stock`);
    }
    if (event === 'PASSWORD_RECOVERY') {
      state.recovery = true;
      state.booting = false;
      render();
      return;
    }
    if (event === 'TOKEN_REFRESHED') return;
    if (!session) {
      state.profile = null;
      state.db = emptyDb();
      state.booting = false;
      state.recovery = false;
      render();
      return;
    }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') refreshProfile();
  });
} else {
  state.booting = false;
}

applyHash();
render();
