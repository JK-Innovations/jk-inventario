import { getLang, t } from './i18n.js';
import { formatMoney, orderTotals, toCents } from './money.js';
import { attentionRows, buildRows, canMoveStock, canWriteCatalog, groupBySupplier, matchQuick, needed, NEXT_STATUS } from './model.js';
import { exactClient, filterClients } from './client-pick.js';
import { blankInventoryReport, blankOrdersReport, filterInventory, filterOrders } from './report-filters.js';
import { alertFor, buildProductGrids, rowMatchesQuery, sortStockRows, stockSummary } from './stock-grid.js';
import { SIZES_BY_GROUP, suggestSku } from './sizes.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function moneyInput(value) {
  if (value == null || value === '') return '';
  const cents = toCents(value);
  if (!Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

function moneyText(value) {
  const cents = toCents(value);
  return Number.isFinite(cents) ? formatMoney(cents) : '—';
}

function logoStacked() {
  return `<img class="logo-stacked" src="assets/brand/logo-stacked-two-color.png?v=brand2" alt="JK Innovations">`;
}

function langs() {
  const current = getLang();
  return `<div class="row" role="group" aria-label="Language">
    <button type="button" class="lang ${current === 'en' ? 'on' : ''}" data-action="lang" data-lang="en">EN</button>
    <button type="button" class="lang ${current === 'es' ? 'on' : ''}" data-action="lang" data-lang="es">ES</button>
  </div>`;
}

function notice(state) {
  if (!state.notice) return '';
  return `<div id="notice" class="banner ${state.noticeError ? 'bad' : 'good'}" role="status">${esc(state.notice)}</div>`;
}

function field(label, control) {
  return `<label class="field">${esc(label)}${control}</label>`;
}

function options(list, selected) {
  return list.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

export function html(state) {
  if (state.unconfigured) return unconfigured(state);
  if (!state.session) return login(state);
  if (state.recovery) return recovery(state);
  if (!state.profile) return locked(state);
  if (state.booting) {
    return `${shellStart(state)}<p class="muted">${esc(t('loading'))}</p></main>`;
  }
  if (state.setupError) {
    return `${shellStart(state)}<section class="panel"><h2>${esc(t('setupTitle'))}</h2><p>${esc(t('setupBody'))}</p><p class="muted">${esc(state.setupError)}</p></section></main>`;
  }
  const body = {
    stock: stock,
    dashboard: dashboard,
    products: products,
    movements: movements,
    orders: orders,
    directory: directory
  }[state.screen] || stock;
  return `${shellStart(state)}${notice(state)}${body(state)}${modal(state)}</main>`;
}

function unconfigured() {
  return `<div class="login-wrap"><section class="login-card" data-state="not-configured">
    <div class="between">${brandTitle()} ${langs()}</div>
    <h2>${esc(t('notConfiguredTitle'))}</h2>
    <p>${esc(t('notConfiguredBody'))}</p>
    <p class="muted">${esc(t('notConfiguredHint'))}</p>
  </section></div>`;
}

function login(state) {
  return `<div class="login-wrap"><form class="login-card" data-form="login">
    <div class="between">${brandTitle()} ${langs()}</div>
    <p class="muted">${esc(t('loginHelp'))}</p>
    ${state.notice ? `<div id="notice" class="banner ${state.noticeError ? 'bad' : 'good'}" role="status">${esc(state.notice)}</div>` : ''}
    ${field(t('email'), `<input name="email" type="email" autocomplete="username" required value="${esc(state.loginEmail || '')}">`)}
    ${field(t('password'), `<input name="password" type="password" autocomplete="current-password" required minlength="6">`)}
    <button class="btn" type="submit">${esc(t('signIn'))}</button>
    <button class="btn ghost" type="button" data-action="forgot">${esc(t('forgot'))}</button>
  </form></div>`;
}

function recovery(state) {
  return `<div class="login-wrap"><form class="login-card" data-form="recovery">
    <div class="between">${brandTitle()} ${langs()}</div>
    ${notice(state)}
    ${field(t('newPassword'), `<input name="password" type="password" autocomplete="new-password" required minlength="6">`)}
    <button class="btn" type="submit">${esc(t('savePassword'))}</button>
  </form></div>`;
}

function locked(state) {
  const id = state.session?.user?.id || '';
  return `<div class="login-wrap"><section class="login-card">
    <div class="between">${brandTitle()} ${langs()}</div>
    <h2>${esc(t('noAccess'))}</h2>
    <p class="muted">${esc(t('noAccessHelp'))}</p>
    <div><p class="eyebrow">${esc(t('yourUserId'))}</p><p class="id-box" id="user-id">${esc(id)}</p></div>
    <div class="row">
      <button class="btn" type="button" data-action="copy-id">${esc(t('copy'))}</button>
      <button class="btn sec" type="button" data-action="signout">${esc(t('signOut'))}</button>
    </div>
  </section></div>`;
}

function brandTitle() {
  return `<div class="login-lockup">${logoStacked()}<h1>${esc(t('appTitle'))}</h1></div>`;
}

function shellStart(state) {
  const tabs = ['stock', 'dashboard', 'products', 'movements', 'orders', 'directory'];
  const write = canWriteCatalog(state.profile.role);
  const current = getLang();
  const nextLang = current === 'es' ? 'en' : 'es';
  const langLabel = current === 'es' ? t('langSpanish') : t('langEnglish');
  return `<header class="app-header"><div class="brand-lockup"><img class="logo-symbol" src="assets/brand/logo-symbol-terracotta.png?v=brand2" alt=""><div class="brand-text"><img class="logo-horizontal" src="assets/brand/logo-horizontal-deep-blue.png?v=brand2" alt="JK Innovations"><p class="subtitle">${esc(t('appTitle'))}</p></div></div>
    <div class="header-actions">
      <button type="button" class="head-btn navy" data-action="lang" data-lang="${nextLang}">${esc(langLabel)}</button>
      <button type="button" class="head-btn ghost" data-action="signout">${esc(t('signOut'))}</button>
      <button type="button" class="head-btn brick" data-action="open-quick">+ ${esc(t('quickEntry'))}</button>
      ${write ? `<button type="button" class="head-btn navy" data-action="new-product">+ ${esc(t('addProduct'))}</button>` : ''}
    </div></header>
    <nav class="tab-pills">${tabs.map((tab) => `<button type="button" data-action="nav" data-screen="${tab}" class="${state.screen === tab ? 'on' : ''}" ${state.screen === tab ? 'aria-current="page"' : ''}>${esc(t(tab))}</button>`).join('')}</nav>
    <main class="app-main">`;
}

function priceLabel(cents) {
  if (!cents.length) return '—';
  if (cents.length === 1) return formatMoney(cents[0]);
  return `${formatMoney(cents[0])}–${formatMoney(cents[cents.length - 1])}`;
}

function stock(state) {
  const scoped = buildRows(state.db, { school: state.filters.school, category: 'all', alert: 'all', q: '', showArchived: false });
  const summary = stockSummary(scoped);
  const alert = state.filters.alert || 'all';
  const visible = sortStockRows(scoped.filter((row) => rowMatchesQuery(row, state.filters.stockQ) && (alert === 'all' || alertFor(row.level.available, row.variant.min_qty) === alert)));
  const schools = (state.db.schools || []).filter((school) => school.active !== false);
  const schoolOptions = [['all', t('all')], ['none', t('noSchool')], ...schools.map((school) => [school.id, school.name])];
  const canMove = canMoveStock(state.profile.role);
  const view = state.filters.stockView === 'grid' ? 'grid' : 'table';
  const alerts = [['all', t('all')], ['ok', t('statusOk')], ['low', t('low')], ['out', t('out')]];
  return `${summaryCards(summary)}
    ${inventoryReport(state)}
    <section class="panel toolbar">
      <label class="search-wrap">${esc(t('search'))}<input id="stock-q" class="search-lg" data-filter="stockQ" value="${esc(state.filters.stockQ || '')}" placeholder="${esc(t('stockSearchPlaceholder'))}" autocomplete="off"></label>
      <div class="toolbar-side">
        <div class="pill-row" role="group" aria-label="${esc(t('filterAlert'))}">
          ${alerts.map(([value, label]) => `<button type="button" class="filter-pill ${alert === value ? 'on' : ''}" data-action="stock-alert" data-alert="${esc(value)}">${esc(label)}</button>`).join('')}
        </div>
        <label class="school-pick">${esc(t('school'))}<select name="school" data-filter="school">${options(schoolOptions, state.filters.school)}</select></label>
        <div class="pill-row" role="group" aria-label="${esc(t('viewTable'))}">
          <button type="button" class="filter-pill ${view === 'table' ? 'on' : ''}" data-action="stock-view" data-view="table">${esc(t('viewTable'))}</button>
          <button type="button" class="filter-pill ${view === 'grid' ? 'on' : ''}" data-action="stock-view" data-view="grid">${esc(t('viewGrid'))}</button>
        </div>
      </div>
    </section>
    ${view === 'grid' ? stockGrid(visible, canMove) : stockTable(visible, canMove)}`;
}

function summaryCards(summary) {
  const cards = [
    ['blue', boxIcon(), t('totalUnits'), summary.units, t('totalUnitsCap')],
    ['navy', tagIcon(), t('productCount'), summary.products, t('productCountCap')],
    ['amber', alertIcon(), t('lowStock'), summary.low, t('lowStockCap')],
    ['red', outIcon(), t('outOfStock'), summary.out, t('outOfStockCap')]
  ];
  return `<section class="sum-row">${cards.map(([tone, icon, label, value, caption]) => `<article class="sum-card"><span class="sum-icon ${tone}">${icon}</span><div><p class="sum-label">${esc(label)}</p><p class="sum-num">${value}</p><p class="sum-cap">${esc(caption)}</p></div></article>`).join('')}</section>`;
}

function boxIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 7l8 5 8-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
}
function tagIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12V5h7l9 9-7 7-9-9z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/></svg>';
}
function alertIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10v4" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>';
}
function outIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.8"/></svg>';
}

function stockTable(rows, canMove) {
  if (!rows.length) return `<section class="panel"><p class="muted">${esc(t('stockEmpty'))}</p></section>`;
  const head = [t('supplier'), t('itemNo'), t('garment'), t('color'), t('size'), t('available'), t('status'), t('actions')];
  return `<section class="panel table-panel"><div class="table-scroll"><table class="nice"><thead><tr>${head.map((label) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((row) => {
      const alert = alertFor(row.level.available, row.variant.min_qty);
      const status = alert === 'ok' ? t('statusOk') : t(alert);
      return `<tr><td>${esc(row.product.supplier || '—')}</td><td>${esc(row.product.item_no || '—')}</td><td>${esc(row.product.garment || row.product.name || '')}</td><td>${esc(row.variant.color)}</td><td>${esc(row.variant.size)}</td><td class="num">${row.level.available}</td><td><span class="status-pill ${alert}">${esc(status)}</span></td><td>${stockActions(row, canMove)}</td></tr>`;
    }).join('')}
  </tbody></table></div></section>`;
}

function stockActions(row, canMove) {
  if (!canMove) return '';
  const id = esc(row.variant.id);
  return `<div class="row-actions">
    <button type="button" class="icon-btn plus" data-action="stock-cell" data-mode="receive" data-id="${id}" aria-label="${esc(t('receive'))}">+</button>
    <button type="button" class="icon-btn minus" data-action="stock-cell" data-mode="deduct" data-id="${id}" aria-label="${esc(t('deduct'))}">−</button>
    <button type="button" class="icon-btn edit" data-action="stock-cell" data-mode="adjust" data-id="${id}" aria-label="${esc(t('adjust'))}">✎</button>
  </div>`;
}

function stockGrid(rows, canMove) {
  const cards = buildProductGrids(rows);
  if (!cards.length) return `<section class="panel"><p class="muted">${esc(t('stockEmpty'))}</p></section>`;
  return `<div class="stock-cards">${cards.map((card) => stockCard(card, canMove)).join('')}</div>`;
}

function stockCard(card, canMove) {
  const title = card.product.garment || card.product.name || '';
  return `<article class="card stock-card">
    <header>
      <div>
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(card.product.supplier || '—')} · ${esc(card.product.item_no || '—')}</p>
      </div>
      <p class="sku">${esc(t('sell'))} ${esc(priceLabel(card.priceCents))}</p>
    </header>
    <div class="stock-scroll">
      <table class="stock-grid">
        <thead><tr><th></th>${card.sizes.map((size) => `<th scope="col">${esc(size.size)}</th>`).join('')}</tr></thead>
        <tbody>
          ${card.colors.map((line) => `<tr><th scope="row">${esc(line.color)}</th>${line.cells.map((row) => stockCell(row, canMove)).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  </article>`;
}

function stockCell(row, canMove) {
  if (!row) return '<td><span class="stock-cell empty"></span></td>';
  const available = row.level.available;
  const alert = alertFor(available, row.variant.min_qty);
  const label = `${row.variant.color} ${row.variant.size}, ${available} ${t('available')}`;
  if (!canMove) return `<td><span class="stock-cell ${alert}" aria-label="${esc(label)}">${available}</span></td>`;
  return `<td><button type="button" class="stock-cell ${alert}" data-action="stock-cell" data-id="${esc(row.variant.id)}" aria-label="${esc(label)}">${available}</button></td>`;
}

function filters(state) {
  const schools = state.db.schools.filter((school) => school.active !== false);
  const schoolOptions = [['all', t('allWorkshop')], ['none', t('noSchool')], ...schools.map((school) => [school.id, school.name])];
  const categories = [['all', t('all')], ['uniform', t('uniform')], ['sports', t('sports')], ['staff', t('staff')], ['general', t('general')]];
  const alerts = [['all', t('all')], ['ok', t('inStock')], ['low', t('low')], ['out', t('out')]];
  return `<div class="grid-2">
    ${field(t('school'), `<select name="school" data-filter="school">${options(schoolOptions, state.filters.school)}</select>`)}
    ${field(t('category'), `<select name="category" data-filter="category">${options(categories, state.filters.category)}</select>`)}
    ${field(t('filterAlert'), `<select name="alert" data-filter="alert">${options(alerts, state.filters.alert)}</select>`)}
    ${field(t('search'), `<input id="filter-q" name="q" data-filter="q" value="${esc(state.filters.q)}" placeholder="${esc(t('searchPlaceholder'))}">`)}
  </div>`;
}

function rows(state, extra = {}) {
  return buildRows(state.db, { ...state.filters, ...extra });
}

function reportActions(kind) {
  return `<div class="report-actions">
    <button type="button" class="btn" data-action="report-${kind}" data-kind="pdf">${esc(t('downloadPdf'))}</button>
    <button type="button" class="btn sec" data-action="report-${kind}" data-kind="print">${esc(t('printReport'))}</button>
    <button type="button" class="btn ghost" data-action="report-${kind}" data-kind="csv">${esc(t('csvReport'))}</button>
  </div>`;
}

function inventoryReport(state) {
  const filters = state.reportStock || blankInventoryReport();
  const all = buildRows(state.db, { school: 'all', category: 'all', alert: 'all', q: '', showArchived: false });
  const matched = filterInventory(all, filters);
  const suppliers = [...new Set(all.map((row) => (row.product.supplier || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const schools = (state.db.schools || []).filter((school) => school.active !== false);
  const schoolOptions = [['all', t('all')], ['none', t('noSchool')], ...schools.map((school) => [school.id, school.name])];
  const supplierOptions = [['all', t('all')], ...suppliers.map((name) => [name, name])];
  const sizeOptions = [['all', t('all')], ['youth', t('youth')], ['adult', t('adult')], ['toddler', t('toddler')], ['os', t('os')], ['numeric', t('numeric')]];
  const statusOptions = [['all', t('all')], ['ok', t('statusOk')], ['low', t('low')], ['out', t('out')]];
  const input = (fieldName, label, control) => field(label, control.replace('<input ', `<input data-report="inventory" data-field="${fieldName}" `).replace('<select ', `<select data-report="inventory" data-field="${fieldName}" `));
  return `<section class="panel report-panel">
    <h2>${esc(t('inventoryReport'))}</h2>
    <p class="muted">${matched.length} ${esc(t('reportRows'))}</p>
    <div class="report-grid">
      ${input('school', t('school'), `<select>${options(schoolOptions, filters.school)}</select>`)}
      ${input('supplier', t('supplier'), `<select>${options(supplierOptions, filters.supplier)}</select>`)}
      ${input('itemNo', t('itemNo'), `<input id="inv-item" value="${esc(filters.itemNo)}">`)}
      ${input('garment', t('garment'), `<input id="inv-garment" value="${esc(filters.garment)}" placeholder="${esc(t('garment'))}">`)}
      ${input('color', t('color'), `<input id="inv-color" value="${esc(filters.color)}">`)}
      ${input('sizeGroup', t('sizeGroupFilter'), `<select>${options(sizeOptions, filters.sizeGroup)}</select>`)}
      ${input('status', t('status'), `<select>${options(statusOptions, filters.status)}</select>`)}
      ${input('q', t('search'), `<input id="inv-q" value="${esc(filters.q)}" placeholder="${esc(t('stockSearchPlaceholder'))}">`)}
    </div>
    ${reportActions('inventory')}
  </section>`;
}

function ordersReport(state) {
  const filters = state.reportOrders || blankOrdersReport();
  const orders = state.db.orders || [];
  const lines = state.db.lines || [];
  const variants = new Map((state.db.variants || []).map((row) => [row.id, row]));
  const products = new Map((state.db.products || []).map((row) => [row.id, row]));
  const matched = filterOrders(orders, lines, variants, products, filters);
  const clients = (state.db.clients || []).filter((client) => client.active !== false);
  const schools = (state.db.schools || []).filter((school) => school.active !== false);
  const schoolOptions = [['all', t('all')], ['none', t('noSchool')], ...schools.map((school) => [school.id, school.name])];
  const clientOptions = [['all', t('all')], ...clients.map((client) => [client.id, client.name])];
  const statusOptions = [['all', t('all')], ...['draft', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled'].map((status) => [status, t(`status_${status}`)])];
  const input = (fieldName, label, control) => field(label, control.replace('<input ', `<input data-report="orders" data-field="${fieldName}" `).replace('<select ', `<select data-report="orders" data-field="${fieldName}" `));
  return `<section class="panel report-panel">
    <h2>${esc(t('ordersReport'))}</h2>
    <p class="muted">${matched.length} ${esc(t('reportRows'))}</p>
    <div class="report-grid">
      ${input('from', t('from'), `<input id="ord-from" type="date" value="${esc(filters.from)}">`)}
      ${input('to', t('to'), `<input id="ord-to" type="date" value="${esc(filters.to)}">`)}
      ${input('client', t('client'), `<select>${options(clientOptions, filters.client)}</select>`)}
      ${input('school', t('school'), `<select>${options(schoolOptions, filters.school)}</select>`)}
      ${input('status', t('status'), `<select>${options(statusOptions, filters.status)}</select>`)}
      ${input('garment', t('garment'), `<input id="ord-garment" value="${esc(filters.garment)}" placeholder="${esc(t('garment'))}">`)}
    </div>
    <label class="check"><input type="checkbox" data-report="orders" data-field="detailed" ${filters.detailed ? 'checked' : ''}> ${esc(t('detailedLines'))}</label>
    ${reportActions('orders')}
  </section>`;
}

function dashboard(state) {
  const list = rows(state, { showArchived: false });
  const quickList = buildRows(state.db, { school: 'all', category: 'all', alert: 'all', q: '', showArchived: false });
  const out = list.filter((row) => row.level.alert === 'out').length;
  const low = list.filter((row) => row.level.alert === 'low').length;
  const ok = list.filter((row) => row.level.alert === 'ok').length;
  const units = list.reduce((sum, row) => sum + row.level.available, 0);
  const oversold = list.filter((row) => row.level.available < 0).length;
  const hot = attentionRows(list);
  const write = canWriteCatalog(state.profile.role);
  return `<section class="panel quick" id="quick-panel">${quickForm(state, quickList)}</section>
    <section class="stats">
      <article class="stat ok"><span>${esc(t('inStock'))}</span><b>${ok}</b></article>
      <article class="stat low"><span>${esc(t('low'))}</span><b>${low}</b></article>
      <article class="stat out"><span>${esc(t('out'))}</span><b>${out}</b></article>
      <article class="stat in"><span>${esc(t('available'))}</span><b>${units}</b><span class="muted">${esc(t('units'))}</span></article>
    </section>
    <p class="muted">${esc(t('formula'))}</p>
    ${oversold ? `<p class="warn-line">${oversold} ${esc(t('oversold'))}</p>` : ''}
    <section class="panel">
      ${filters(state)}
      <div class="row">
        ${write ? `<button type="button" class="btn sec sm" data-action="open-school">${esc(t('addSchool'))}</button>
        <button type="button" class="btn sec sm" data-action="open-client">${esc(t('addClient'))}</button>
        <button type="button" class="btn sec sm" data-action="new-product">${esc(t('addProduct'))}</button>` : ''}
      </div>
    </section>
    <section class="panel">
      <h2>${esc(t('needsAttention'))}</h2>
      ${hot.length ? `<div class="cards">${hot.map((row) => attentionCard(row)).join('')}</div>` : `<p class="muted">${esc(t('nothingToReorder'))}</p>`}
    </section>
    <section class="panel">
      <h2>${esc(t('reorderBySupplier'))}</h2>
      ${reorder(hot)}
    </section>
    ${inventoryReport(state)}`;
}

function quickForm(state, list) {
  const mode = state.quick.mode;
  const note = mode !== 'receive';
  return `<form data-form="quick" class="stack">
    <div class="between"><h2>${esc(t('quickAdd'))}</h2><div class="modes">
      ${['receive', 'deduct', 'adjust'].map((item) => `<button type="button" class="chip ${mode === item ? 'on' : ''}" data-action="quick-mode" data-mode="${item}">${esc(t(item))}</button>`).join('')}
    </div></div>
    <input id="quick-text" name="text" value="${esc(state.quick.text)}" placeholder="${esc(t('quickPlaceholder'))}" autocomplete="off">
    ${note ? field(t('note'), `<input id="quick-note" name="note" value="${esc(state.quick.note)}" required>`) : ''}
    ${mode === 'adjust' ? field(t('delta'), `<input id="quick-delta" name="delta" inputmode="numeric" value="${esc(state.quick.delta)}" placeholder="+2 or -1">`) : ''}
    <div id="quick-results">${quickResults(state, list)}</div>
  </form>`;
}

function quickResults(state, list) {
  const text = state.quick.text.trim();
  if (!text) return '';
  const { parsed, matches } = matchQuick(text, list, state.db);
  if (!parsed.qty) return `<p class="muted">${esc(t('needQty'))}</p>`;
  if (!matches.length) return `<p class="muted">${esc(t('noMatch'))}</p>`;
  if (matches.length === 1) {
    const row = matches[0];
    return `<p class="muted">${esc(t('oneMatch'))}</p><button type="button" class="btn" data-action="quick-apply" data-id="${esc(row.variant.id)}">${esc(quickLabel(state, row, parsed.qty))}</button>`;
  }
  return `<p class="muted">${esc(t('severalMatches'))}</p><div class="chips">${matches.slice(0, 12).map((row) => `<button type="button" class="chip" data-action="quick-apply" data-id="${esc(row.variant.id)}">${esc(row.variant.sku)} · ${esc(row.variant.color)} ${esc(row.variant.size)}</button>`).join('')}</div>`;
}

function quickLabel(state, row, qty) {
  const verb = t(state.quick.mode);
  return `${verb} ${qty} · ${row.product.name} · ${row.variant.color} ${row.variant.size}`;
}

function attentionCard(row) {
  const alert = row.level.alert;
  return `<article class="card">
    <header><div><strong>${esc(row.product.name)}</strong><div class="muted">${esc(row.variant.color)} · ${esc(row.variant.size)} · ${esc(row.variant.sku)}</div></div><span class="pill ${alert}">${alert === 'out' ? '✖' : '▲'} ${esc(t(alert === 'out' ? 'out' : 'low'))}</span></header>
    <p>${esc(t('available'))} ${row.level.available} · ${esc(t('physical'))} ${row.level.physical} · ${esc(t('reserved'))} ${row.level.reserved} · ${esc(t('min'))} ${row.variant.min_qty} · ${esc(t('need'))} ${needed(row)}</p>
    <p class="muted">${esc(row.product.supplier || '—')}${row.product.lead_time_days != null ? ` · ${row.product.lead_time_days} ${t('days')}` : ''}${row.schools.length ? ` · ${esc(row.schools.map((school) => school.name).join(', '))}` : ''}</p>
    <button type="button" class="btn sm sec" data-action="count-variant" data-id="${esc(row.variant.id)}">${esc(t('count'))}</button>
  </article>`;
}

function reorder(hot) {
  const groups = groupBySupplier(hot);
  if (!groups.length) return `<p class="muted">${esc(t('nothingToReorder'))}</p>`;
  return groups.map(([supplier, items]) => `<div class="stack"><h3>${esc(supplier || '—')}</h3><div class="scroll"><table><thead><tr><th>${esc(t('itemNo'))}</th><th>${esc(t('garment'))}</th><th>${esc(t('color'))}</th><th>${esc(t('size'))}</th><th>${esc(t('need'))}</th></tr></thead><tbody>
    ${items.map((row) => `<tr><td>${esc(row.product.item_no)}</td><td>${esc(row.product.garment)}</td><td>${esc(row.variant.color)}</td><td>${esc(row.variant.size)}</td><td class="num">${needed(row)}</td></tr>`).join('')}
  </tbody></table></div></div>`).join('');
}

function products(state) {
  if (state.productDraft) return productEditor(state);
  const list = rows(state);
  const write = canWriteCatalog(state.profile.role);
  const grouped = new Map();
  for (const row of list) {
    if (!grouped.has(row.product.id)) grouped.set(row.product.id, []);
    grouped.get(row.product.id).push(row);
  }
  const cards = [...grouped.entries()].map(([, items]) => {
    const product = items[0].product;
    return `<article class="card"><header><div><strong>${esc(product.name)}</strong><div class="muted">${esc(t(product.category))} · ${esc(product.item_no || '—')} · ${esc(product.supplier || '—')}</div></div>
      <button type="button" class="btn sm" data-action="edit-product" data-id="${esc(product.id)}">${esc(write ? t('edit') : t('open'))}</button>
    </header>
    ${items.map((row) => `<div class="between"><span><span class="sku">${esc(row.variant.sku)}</span> ${esc(row.variant.color)} ${esc(row.variant.size)} ${row.variant.active === false ? `<span class="badge">${esc(t('archived'))}</span>` : ''}</span><span class="pill ${row.level.alert}">${row.level.available}</span></div>`).join('')}
    </article>`;
  }).join('');
  return `<section class="panel">${filters(state)}
    <label class="check"><input type="checkbox" data-filter="showArchived" ${state.filters.showArchived ? 'checked' : ''}> ${esc(t('showArchived'))}</label>
    ${write ? `<button type="button" class="btn" data-action="new-product">${esc(t('addProduct'))}</button>` : `<p class="muted">${esc(t('readOnly'))}</p>`}
    <div class="cards">${cards || `<p class="muted">${esc(t('emptyProducts'))}</p>`}</div>
  </section>`;
}

function productEditor(state) {
  const draft = state.productDraft;
  const write = canWriteCatalog(state.profile.role);
  const disabled = write ? '' : 'disabled';
  const categories = [['uniform', t('uniform')], ['sports', t('sports')], ['staff', t('staff')], ['general', t('general')]];
  const schools = state.db.schools.filter((school) => school.active !== false);
  const clients = state.db.clients.filter((client) => client.active !== false);
  return `<form class="panel" id="product-form" data-form="product">
    <div class="between"><h2>${esc(draft.id ? draft.name : t('addProduct'))}</h2><button type="button" class="btn ghost" data-action="back-products">${esc(t('back'))}</button></div>
    <p class="muted">${esc(t('priceSplit'))}</p>
    <div id="form-error" class="banner bad" hidden></div>
    <div class="grid-2">
      ${field(t('name'), `<input name="name" required value="${esc(draft.name)}" ${disabled}>`)}
      ${field(t('garment'), `<input name="garment" required list="garments" value="${esc(draft.garment)}" ${disabled}>`)}
      ${field(t('category'), `<select name="category" ${disabled}>${options(categories, draft.category)}</select>`)}
      ${field(t('itemNo'), `<input name="item_no" value="${esc(draft.item_no)}" ${disabled}>`)}
      ${field(t('supplier'), `<input name="supplier" list="suppliers" value="${esc(draft.supplier)}" ${disabled}>`)}
      ${field(t('leadTime'), `<input name="lead_time_days" inputmode="numeric" value="${esc(draft.lead_time_days ?? '')}" ${disabled}>`)}
    </div>
    ${field(t('notes'), `<textarea name="notes" ${disabled}>${esc(draft.notes)}</textarea>`)}
    <fieldset class="stack"><legend class="eyebrow">${esc(t('schools'))}</legend>
      ${schools.map((school) => `<label class="check"><input type="checkbox" name="school" value="${esc(school.id)}" ${draft.schoolIds.includes(school.id) ? 'checked' : ''} ${disabled}> ${esc(school.name)}</label>`).join('') || `<p class="muted">${esc(t('noSchool'))}</p>`}
    </fieldset>
    <h3>${esc(t('variants'))}</h3>
    ${draft.variants.map((variant, index) => variantRow(state, variant, index, clients, schools, disabled, draft)).join('')}
    ${write ? `<button type="button" class="btn sec" data-action="add-variant">${esc(t('addVariant'))}</button><button class="btn" type="submit">${esc(t('save'))}</button>` : ''}
    <datalist id="garments">${['polo', 't-shirt', 'crewneck', 'hoodie', 'jacket', 'beanie', 'cap', 'long sleeve', 'pant', 'short', 'skirt', 'jumper', 'sock', 'vest', 'cardigan'].map((item) => `<option value="${item}"></option>`).join('')}</datalist>
    <datalist id="suppliers">${[...new Set(['SanMar', 'S&S', 'ELDERWARE', ...state.db.products.map((product) => product.supplier).filter(Boolean)])].map((item) => `<option value="${esc(item)}"></option>`).join('')}</datalist>
  </form>`;
}

function variantRow(state, variant, index, clients, schools, disabled, draft) {
  const groups = [['youth', t('youth')], ['adult', t('adult')], ['toddler', t('toddler')], ['os', t('os')], ['numeric', t('numeric')]];
  const sizes = SIZES_BY_GROUP[variant.size_group] || [];
  const sizeControl = variant.size_group === 'numeric'
    ? `<input name="size" value="${esc(variant.size)}" ${disabled}>`
    : `<select name="size" ${disabled}>${options(sizes.map((size) => [size, size]), variant.size)}</select>`;
  const schoolOptions = [['', t('none')], ...schools.map((school) => [school.id, school.name])];
  const clientOptions = [['', t('none')], ...clients.map((client) => [client.id, client.name])];
  return `<div class="line" data-variant-row data-id="${esc(variant.id || '')}" data-key="${esc(variant.key)}">
    <div class="between"><strong>${esc(variant.sku || suggestSku(draft.item_no, variant.color, variant.size))}</strong>
      ${!disabled && !variant.id ? `<button type="button" class="btn ghost sm" data-action="remove-variant" data-key="${esc(variant.key)}">${esc(t('remove'))}</button>` : ''}
      ${!disabled && variant.id ? `<label class="check"><input type="checkbox" name="active" ${variant.active ? 'checked' : ''}> ${esc(t('active'))}</label>` : ''}
    </div>
    <div class="grid-2">
      ${field(t('color'), `<input name="color" required value="${esc(variant.color)}" ${disabled}>`)}
      ${field(t('sizeGroup'), `<select name="size_group" data-action="size-group" ${disabled}>${options(groups, variant.size_group)}</select>`)}
      ${field(t('size'), sizeControl)}
      ${field(t('sku'), `<input name="sku" value="${esc(variant.sku)}" placeholder="${esc(suggestSku(draft.item_no, variant.color, variant.size))}" ${disabled}>`)}
      ${field(t('cost'), `<input name="cost_price" inputmode="decimal" required value="${esc(moneyInput(variant.cost_price))}" ${disabled}>`)}
      ${field(t('sell'), `<input name="sell_price" inputmode="decimal" required value="${esc(moneyInput(variant.sell_price))}" ${disabled}>`)}
      ${field(t('minQty'), `<input name="min_qty" inputmode="numeric" required value="${esc(variant.min_qty ?? 3)}" ${disabled}>`)}
      ${field(t('design'), `<input name="design" value="${esc(variant.design)}" ${disabled}>`)}
      ${field(t('school'), `<select name="school_id" ${disabled}>${options(schoolOptions, variant.school_id || '')}</select>`)}
      ${field(t('client'), `<select name="client_id" ${disabled}>${options(clientOptions, variant.client_id || '')}</select>`)}
    </div>
  </div>`;
}

function movements(state) {
  const write = state.profile.role === 'admin' || state.profile.role === 'inventario' || state.profile.role === 'produccion';
  const list = rows({ ...state, filters: { ...state.filters, alert: 'all', q: '' } });
  const variantOptions = list.map((row) => [row.variant.id, `${row.variant.sku} · ${row.product.name} · ${row.variant.color} ${row.variant.size}`]);
  const reasons = ['receive', 'return', 'adjust', 'correction', 'count'].map((reason) => [reason, t(`reason_${reason}`)]);
  const draft = state.movementDraft;
  const selected = list.find((row) => row.variant.id === draft.variant_id);
  const showDirection = draft.reason === 'adjust' || draft.reason === 'correction';
  const profiles = new Map((state.db.profiles || []).map((profile) => [profile.user_id, profile]));
  const feed = state.db.movements || [];
  return `<section class="panel"><h2>${esc(t('recordMovement'))}</h2><p class="muted">${esc(t('movementHelp'))}</p>
    ${write ? `<form id="movement-form" data-form="movement" class="stack"><div id="form-error" class="banner bad" hidden></div>
      ${field(t('products'), `<select name="variant_id" required>${options([['', t('none')], ...variantOptions], draft.variant_id)}</select>`)}
      ${selected ? `<p class="muted">${esc(t('physical'))} ${selected.level.physical} · ${esc(t('reserved'))} ${selected.level.reserved} · ${esc(t('available'))} ${selected.level.available}</p>` : ''}
      ${field(t('reason'), `<select name="reason">${options(reasons, draft.reason)}</select>`)}
      ${draft.reason === 'count'
        ? field(t('targetPhysical'), `<input name="target" inputmode="numeric" required value="${esc(draft.target)}">`)
        : field(t('quantity'), `<input name="qty" inputmode="numeric" required value="${esc(draft.qty)}">`)}
      ${showDirection ? field(t('direction'), `<select name="direction">${options([['in', t('in')], ['out', t('outDir')]], draft.direction)}</select>`) : ''}
      ${field(t('note'), `<input name="note" value="${esc(draft.note)}" ${showDirection ? 'required' : ''}>`)}
      <button class="btn" type="submit">${esc(t('recordMovement'))}</button>
    </form>` : `<p class="muted">${esc(t('readOnly'))}</p>`}
  </section>
  <section class="panel"><h2>${esc(t('latestMovements'))}</h2>
    ${field(t('search'), `<input id="filter-move" data-filter="moveQ" value="${esc(state.filters.moveQ)}" placeholder="${esc(t('searchPlaceholder'))}">`)}
    ${movementTable(feed, state, profiles)}
  </section>`;
}

function movementTable(feed, state, profiles) {
  const q = state.filters.moveQ.trim().toLowerCase();
  const variants = new Map(state.db.variants.map((variant) => [variant.id, variant]));
  const products = new Map(state.db.products.map((product) => [product.id, product]));
  const orders = new Map(state.db.orders.map((order) => [order.id, order]));
  const rowsHtml = feed.filter((movement) => {
    if (!q) return true;
    const variant = variants.get(movement.variant_id);
    const product = variant ? products.get(variant.product_id) : null;
    return `${variant?.sku || ''} ${product?.name || ''} ${movement.reason} ${movement.note}`.toLowerCase().includes(q);
  }).map((movement) => {
    const variant = variants.get(movement.variant_id);
    const product = variant ? products.get(variant.product_id) : null;
    const actor = profiles.get(movement.created_by);
    const name = actor?.display_name || (movement.created_by && state.session.user.id === movement.created_by ? state.session.user.email : '') || (movement.created_by ? '' : t('system'));
    return `<tr><td>${esc(formatWhen(movement.created_at))}</td><td>${esc(variant?.sku || '—')}<div class="muted">${esc(product?.name || '')}</div></td><td class="num">${movement.delta > 0 ? '+' : ''}${movement.delta}</td><td>${esc(t(`reason_${movement.reason}`))}</td><td>${esc(movement.note || '')}</td><td>${esc(orders.get(movement.order_id)?.order_no || '')}</td><td>${esc(name || '—')}</td></tr>`;
  }).join('');
  if (!rowsHtml) return `<p class="muted">${esc(t('emptyMovements'))}</p>`;
  return `<div class="scroll"><table><thead><tr><th>${esc(t('when'))}</th><th>${esc(t('sku'))}</th><th>${esc(t('delta'))}</th><th>${esc(t('reason'))}</th><th>${esc(t('note'))}</th><th>${esc(t('orders'))}</th><th>${esc(t('who'))}</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}

function orders(state) {
  if (state.orderDraft) return orderEditor(state);
  const write = canWriteCatalog(state.profile.role);
  const clients = new Map(state.db.clients.map((client) => [client.id, client]));
  const list = [...state.db.orders].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return `${ordersReport(state)}
  <section class="panel"><div class="between"><h2>${esc(t('orders'))}</h2>
    <div class="row">
      ${write ? `<button type="button" class="btn" data-action="new-order">${esc(t('newOrder'))}</button>` : ''}
    </div></div>
    ${list.length ? `<div class="cards">${list.map((order) => `<article class="card"><header><div><strong>${esc(order.order_no)}</strong><div class="muted">${esc(clients.get(order.client_id)?.name || '—')} · ${esc(t(`channel_${order.channel}`))}</div></div><span class="pill ${order.status === 'cancelled' ? 'out' : order.status === 'fulfilled' ? 'ok' : 'low'}">${esc(t(`status_${order.status}`))}</span></header>
      <p>${moneyText(order.total)} <span class="muted">${esc(t('total'))}</span></p>
      <button type="button" class="btn sm sec" data-action="edit-order" data-id="${esc(order.id)}">${esc(t('open'))}</button></article>`).join('')}</div>` : `<p class="muted">${esc(t('emptyOrders'))}</p>`}
  </section>`;
}

function orderEditor(state) {
  const draft = state.orderDraft;
  const write = canWriteCatalog(state.profile.role) && !['fulfilled', 'cancelled'].includes(draft.status);
  const disabled = write ? '' : 'disabled';
  const clients = state.db.clients.filter((client) => client.active !== false);
  const schools = state.db.schools.filter((school) => school.active !== false);
  const catalog = rows({ ...state, filters: { school: 'all', category: 'all', alert: 'all', q: '', showArchived: false } });
  const variantOptions = catalog.map((row) => [row.variant.id, `${row.variant.sku} · ${row.product.name} · ${row.variant.color} ${row.variant.size} · ${moneyText(row.variant.sell_price)}`]);
  const preview = orderTotals(draft.lines.map((line) => ({ qty: Number(line.qty), unit_sell_price: line.unit_sell_price })));
  const transitions = (NEXT_STATUS[draft.status] || []).filter((status) => write || false);
  return `<form class="panel" id="order-form" data-form="order">
    <div class="between"><h2>${esc(draft.order_no || t('newOrder'))}</h2><button type="button" class="btn ghost" data-action="back-orders">${esc(t('back'))}</button></div>
    <p class="muted">${esc(t('taxHelp'))}</p>
    ${draft.status === 'fulfilled' || draft.status === 'cancelled' ? `<p class="banner info">${esc(t('closedOrder'))}</p>` : ''}
    <div id="form-error" class="banner bad" hidden></div>
    <div class="grid-2">
      ${clientPicker(state, draft, clients, schools, disabled, write)}
      ${field(t('school'), `<select name="school_id" ${disabled}>${options([['', t('none')], ...schools.map((school) => [school.id, school.name])], draft.school_id || '')}</select>`)}
      ${field(t('channel'), `<select name="channel" ${disabled}>${options(['workshop', 'school', 'online', 'other'].map((channel) => [channel, t(`channel_${channel}`)]), draft.channel)}</select>`)}
      ${field(t('reference'), `<input name="reference" value="${esc(draft.reference)}" ${disabled}>`)}
    </div>
    <p class="muted">${esc(t('referenceHelp'))}</p>
    ${field(t('notes'), `<textarea name="notes" ${disabled}>${esc(draft.notes)}</textarea>`)}
    <h3>${esc(t('lines'))}</h3>
    ${draft.lines.map((line) => orderLine(line, variantOptions, catalog, disabled)).join('')}
    ${write ? `<div class="row"><button type="button" class="btn sec" data-action="add-line">${esc(t('addLine'))}</button></div>` : ''}
    <div class="totals" id="order-totals">${totalsBlock(preview, draft)}</div>
    ${write ? `<button class="btn" type="submit">${esc(t('save'))}</button>` : ''}
    ${draft.id && canWriteCatalog(state.profile.role) ? `<div class="row">${transitions.map((status) => `<button type="button" class="btn ${status === 'fulfilled' ? '' : 'sec'} sm" data-action="set-status" data-status="${status}">${esc(t(`status_${status}`))}</button>`).join('')}</div>` : ''}
    ${transitions.includes('fulfilled') ? `<p class="warn-line">${esc(t('fulfillWarn'))}</p>` : ''}
    ${draft.id && ['draft', 'cancelled'].includes(draft.status) && canWriteCatalog(state.profile.role) ? `<button type="button" class="btn ghost" data-action="delete-order">${esc(t('deleteOrder'))}</button>` : ''}
  </form>`;
}

function clientPicker(state, draft, clients, schools, disabled, write) {
  const picker = state.orderClient || {};
  const selected = clients.find((client) => client.id === draft.client_id);
  const query = picker.active ? String(picker.query || '') : (selected?.name || '');
  const matches = filterClients(clients, query).slice(0, 8);
  const exact = exactClient(clients, query);
  const offerCreate = write && query.trim() && !exact;
  const createLabel = t('createNamed').replace('{name}', query.trim());
  return `<div class="client-picker"><input type="hidden" name="client_id" value="${esc(draft.client_id || '')}">
    <div class="client-picker-row">
      ${field(t('client'), `<input id="order-client-q" value="${esc(query)}" placeholder="${esc(t('clientSearchPlaceholder'))}" autocomplete="off" ${disabled}>`)}
      ${write ? `<button type="button" class="btn sec" data-action="toggle-new-client">${esc(t('newClient'))}</button>` : ''}
    </div>
    <p class="muted">${esc(t('clientOptional'))}</p>
    ${selected ? `<p class="muted">${esc(t('selectedClient'))}: <strong>${esc(selected.name)}</strong> ${write ? `<button type="button" class="btn ghost sm" data-action="clear-client">${esc(t('clearClient'))}</button>` : ''}</p>` : ''}
    ${query.trim() && matches.length ? `<div class="client-hits">${matches.map((client) => `<button type="button" class="client-hit ${client.id === draft.client_id ? 'on' : ''}" data-action="pick-client" data-id="${esc(client.id)}">${esc(client.name)}</button>`).join('')}</div>` : ''}
    ${offerCreate ? `<p class="muted">${esc(t('noClientMatches'))}</p><button type="button" class="btn" data-action="create-named-client">${esc(createLabel)}</button>` : ''}
    ${picker.open ? newClientFields(picker, schools) : ''}
    ${picker.error ? `<p class="banner bad" role="alert">${esc(picker.error)}</p>` : ''}
  </div>`;
}

function newClientFields(picker, schools) {
  return `<div class="new-client" id="order-new-client">
    ${field(t('name'), `<input id="new-client-name" value="${esc(picker.name || '')}" required>`)}
    ${field(t('phone'), `<input id="new-client-phone" value="${esc(picker.phone || '')}">`)}
    ${field(t('email'), `<input id="new-client-email" inputmode="email" value="${esc(picker.email || '')}">`)}
    ${field(t('school'), `<select id="new-client-school">${options([['', t('none')], ...schools.map((school) => [school.id, school.name])], picker.school_id || '')}</select>`)}
    <div class="row">
      <button type="button" class="btn" data-action="save-order-client">${esc(t('save'))}</button>
      <button type="button" class="btn ghost" data-action="cancel-new-client">${esc(t('cancel'))}</button>
    </div>
  </div>`;
}

function orderLine(line, variantOptions, catalog, disabled) {
  const row = catalog.find((item) => item.variant.id === line.variant_id);
  const over = row && Number(line.qty) > row.level.available;
  return `<div class="line" data-line data-key="${esc(line.key)}">
    ${field(t('products'), `<select name="variant_id" required ${disabled}>${options([['', t('none')], ...variantOptions], line.variant_id)}</select>`)}
    <div class="grid-2">
      ${field(t('qtyShort'), `<input name="qty" inputmode="numeric" required value="${esc(line.qty)}" ${disabled}>`)}
      ${field(t('sell'), `<input name="unit_sell_price" inputmode="decimal" required value="${esc(moneyInput(line.unit_sell_price))}" ${disabled}>`)}
      ${field(t('customName'), `<input name="custom_name" value="${esc(line.custom_name)}" ${disabled}>`)}
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" name="slide" ${line.slide ? 'checked' : ''} ${disabled}> ${esc(t('slide'))}</label>
      <label class="check"><input type="checkbox" name="sign" ${line.sign ? 'checked' : ''} ${disabled}> ${esc(t('sign'))}</label>
      ${!disabled ? `<button type="button" class="btn ghost sm" data-action="remove-line" data-key="${esc(line.key)}">${esc(t('remove'))}</button>` : ''}
    </div>
    ${row ? `<p class="${over ? 'warn-line' : 'muted'}">${esc(t('available'))} ${row.level.available}${over ? ` · ${esc(t('oversold'))}` : ''}</p>` : ''}
  </div>`;
}

function totalsBlock(preview, draft) {
  const saved = draft.id && draft.total != null && draft.total !== '';
  const block = (title, totals) => totals ? `<div><span>${esc(t('subtotal'))}</span><strong>${formatMoney(totals.subtotal)}</strong></div><div><span>${esc(t('tax'))}</span><strong>${formatMoney(totals.tax)}</strong></div><div><span>${esc(t('total'))}</span><strong>${formatMoney(totals.total)}</strong></div>` : '';
  return `<p class="eyebrow">${esc(t('preview'))}</p>${block(t('preview'), preview)}${saved ? `<p class="eyebrow">${esc(t('serverTotals'))}</p><div><span>${esc(t('subtotal'))}</span><strong>${moneyText(draft.subtotal)}</strong></div><div><span>${esc(t('tax'))}</span><strong>${moneyText(draft.tax_amount)}</strong></div><div><span>${esc(t('total'))}</span><strong>${moneyText(draft.total)}</strong></div>` : ''}`;
}

function directory(state) {
  const write = canWriteCatalog(state.profile.role);
  const schools = state.db.schools;
  const clients = state.db.clients;
  return `<section class="panel"><div class="between"><h2>${esc(t('schools'))}</h2>${write ? `<button type="button" class="btn sm" data-action="open-school">${esc(t('addSchool'))}</button>` : ''}</div>
    <div class="cards">${schools.map((school) => `<article class="card"><header><strong>${esc(school.name)}</strong>${write ? `<button type="button" class="btn sm sec" data-action="edit-school" data-id="${esc(school.id)}">${esc(t('edit'))}</button>` : ''}</header><p class="muted">${esc(school.notes || '')}</p></article>`).join('') || `<p class="muted">${esc(t('noSchool'))}</p>`}</div>
  </section>
  <section class="panel"><div class="between"><h2>${esc(t('clients'))}</h2>${write ? `<button type="button" class="btn sm" data-action="open-client">${esc(t('addClient'))}</button>` : ''}</div>
    <div class="cards">${clients.map((client) => `<article class="card"><header><strong>${esc(client.name)}</strong>${write ? `<button type="button" class="btn sm sec" data-action="edit-client" data-id="${esc(client.id)}">${esc(t('edit'))}</button>` : ''}</header><p class="muted">${esc(client.phone)} ${esc(client.email)}</p></article>`).join('') || `<p class="muted">—</p>`}</div>
  </section>
  ${state.profile.role === 'admin' ? people(state) : ''}`;
}

function people(state) {
  return `<section class="panel"><div class="between"><h2>${esc(t('people'))}</h2><button type="button" class="btn sm" data-action="open-access">${esc(t('grantAccess'))}</button></div>
    <p class="muted">${esc(t('peopleHelp'))}</p>
    <div class="cards">${(state.db.profiles || []).map((profile) => `<article class="card"><header><strong>${esc(profile.display_name || profile.user_id)}</strong><span class="badge">${esc(t(`role_${profile.role}`))}</span></header><p class="id-box">${esc(profile.user_id)}</p><button type="button" class="btn sm sec" data-action="edit-access" data-id="${esc(profile.user_id)}">${esc(t('edit'))}</button></article>`).join('')}</div>
  </section>`;
}

function modal(state) {
  if (!state.modal) return '';
  if (state.modal.type === 'quick') return quickModal(state);
  if (state.modal.type === 'stock') return stockModal(state);
  if (state.modal.type === 'school') return schoolModal(state.modal.school);
  if (state.modal.type === 'client') return clientModal(state);
  if (state.modal.type === 'access') return accessModal(state.modal.profile);
  return '';
}

function quickModal(state) {
  const list = buildRows(state.db, { school: 'all', category: 'all', alert: 'all', q: '', showArchived: false });
  return `<div class="modal-back" data-action="close-modal"><div class="modal quick-pop" data-stop>
    ${quickForm(state, list)}
    <button class="btn ghost" type="button" data-action="close-modal">${esc(t('cancel'))}</button>
  </div></div>`;
}

function stockModal(state) {
  const draft = state.modal;
  const variant = (state.db.variants || []).find((row) => row.id === draft.variantId);
  const product = (state.db.products || []).find((row) => row.id === variant?.product_id);
  const level = (state.db.stock || []).find((row) => row.variant_id === draft.variantId);
  const available = Number(level?.available ?? 0);
  const mode = draft.mode || 'receive';
  const qty = draft.qty ?? '1';
  const title = product?.garment || product?.name || t('stock');
  return `<div class="modal-back" data-action="close-modal"><form class="modal stock-pop" data-form="stock-move" data-stop>
    <div class="between"><h2>${esc(title)}</h2><button class="btn ghost sm" type="button" data-action="close-modal">${esc(t('cancel'))}</button></div>
    <p>${esc(variant?.color || '')} · ${esc(variant?.size || '')}</p>
    <p class="muted">${esc(t('available'))} ${available} · ${esc(t('min'))} ${variant?.min_qty ?? ''}</p>
    <div class="modes">
      ${['receive', 'deduct', 'adjust'].map((item) => `<button type="button" class="chip ${mode === item ? 'on' : ''}" data-action="stock-mode" data-mode="${item}">${esc(t(item))}</button>`).join('')}
    </div>
    <div class="stepper">
      <button type="button" class="btn sec" data-action="stock-step" data-dir="-1" aria-label="−">−</button>
      <input id="stock-qty" name="qty" inputmode="numeric" value="${esc(qty)}" aria-label="${esc(t('qtyShort'))}">
      <button type="button" class="btn sec" data-action="stock-step" data-dir="1" aria-label="+">+</button>
    </div>
    ${mode !== 'receive' ? field(t('note'), `<input id="stock-note" name="note" value="${esc(draft.note || '')}" required>`) : ''}
    <button class="btn" type="submit">${esc(t(mode))}</button>
  </form></div>`;
}

function schoolModal(school) {
  const colors = school.colors || ['#1E1E22', '#9A4A3C'];
  return `<div class="modal-back" data-action="close-modal"><form class="modal" data-form="school" data-stop>
    <h2>${esc(school.id ? school.name : t('addSchool'))}</h2>
    <div id="form-error" class="banner bad" hidden></div>
    ${field(t('name'), `<input name="name" required value="${esc(school.name || '')}">`)}
    <div class="row">${field(t('colors'), `<input name="color_a" type="color" value="${esc(colors[0] || '#1E1E22')}">`)}${field(t('colors'), `<input name="color_b" type="color" value="${esc(colors[1] || '#9A4A3C')}">`)}</div>
    ${field(t('notes'), `<textarea name="notes">${esc(school.notes || '')}</textarea>`)}
    <label class="check"><input type="checkbox" name="active" ${school.active !== false ? 'checked' : ''}> ${esc(t('active'))}</label>
    <div class="row"><button class="btn" type="submit">${esc(t('save'))}</button><button class="btn ghost" type="button" data-action="close-modal">${esc(t('cancel'))}</button></div>
  </form></div>`;
}

function clientModal(state) {
  const client = state.modal.client;
  const schools = state.db.schools.filter((school) => school.active !== false);
  return `<div class="modal-back" data-action="close-modal"><form class="modal" data-form="client" data-stop>
    <h2>${esc(client.id ? client.name : t('addClient'))}</h2>
    <div id="form-error" class="banner bad" hidden></div>
    ${field(t('name'), `<input name="name" required value="${esc(client.name || '')}">`)}
    ${field(t('phone'), `<input name="phone" value="${esc(client.phone || '')}">`)}
    ${field(t('email'), `<input name="email" type="email" value="${esc(client.email || '')}">`)}
    ${field(t('school'), `<select name="school_id">${options([['', t('none')], ...schools.map((school) => [school.id, school.name])], client.school_id || '')}</select>`)}
    ${field(t('notes'), `<textarea name="notes">${esc(client.notes || '')}</textarea>`)}
    <label class="check"><input type="checkbox" name="active" ${client.active !== false ? 'checked' : ''}> ${esc(t('active'))}</label>
    <div class="row"><button class="btn" type="submit">${esc(t('save'))}</button><button class="btn ghost" type="button" data-action="close-modal">${esc(t('cancel'))}</button></div>
  </form></div>`;
}

function accessModal(profile) {
  const roles = [['admin', t('role_admin')], ['inventario', t('role_inventario')], ['produccion', t('role_produccion')]];
  return `<div class="modal-back" data-action="close-modal"><form class="modal" data-form="access" data-stop>
    <h2>${esc(t('grantAccess'))}</h2>
    <div id="form-error" class="banner bad" hidden></div>
    ${field(t('userId'), `<input name="user_id" required value="${esc(profile.user_id || '')}" ${profile.existing ? 'readonly' : ''}>`)}
    ${field(t('name'), `<input name="display_name" value="${esc(profile.display_name || '')}">`)}
    ${field(t('role'), `<select name="role">${options(roles, profile.role || 'inventario')}</select>`)}
    <label class="check"><input type="checkbox" name="active" ${profile.active !== false ? 'checked' : ''}> ${esc(t('active'))}</label>
    <div class="row"><button class="btn" type="submit">${esc(t('save'))}</button><button class="btn ghost" type="button" data-action="close-modal">${esc(t('cancel'))}</button></div>
  </form></div>`;
}

function formatWhen(iso) {
  if (!iso) return '—';
  const locale = getLang() === 'es' ? 'es-US' : 'en-US';
  return new Date(iso).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function stockExportRows(state) {
  return rows(state).map((row) => ({
    sku: row.variant.sku,
    item_no: row.product.item_no,
    name: row.product.name,
    garment: row.product.garment,
    category: row.product.category,
    supplier: row.product.supplier,
    lead_time_days: row.product.lead_time_days ?? '',
    color: row.variant.color,
    size: row.variant.size,
    size_group: row.variant.size_group,
    schools: row.schools.map((school) => school.name).join('; '),
    client: row.client?.name || '',
    design: row.variant.design,
    cost_price: row.variant.cost_price,
    client_sell_price: row.variant.sell_price,
    min_qty: row.variant.min_qty,
    physical: row.level.physical,
    reserved: row.level.reserved,
    available: row.level.available,
    alert: row.level.alert
  }));
}

export function orderExportRows(state) {
  const clients = new Map(state.db.clients.map((client) => [client.id, client]));
  const schools = new Map(state.db.schools.map((school) => [school.id, school]));
  const variants = new Map(state.db.variants.map((variant) => [variant.id, variant]));
  const products = new Map(state.db.products.map((product) => [product.id, product]));
  const lines = [];
  for (const order of state.db.orders) {
    const orderLines = state.db.lines.filter((line) => line.order_id === order.id);
    for (const line of orderLines) {
      const variant = variants.get(line.variant_id);
      const product = variant ? products.get(variant.product_id) : null;
      lines.push({
        order_no: order.order_no,
        status: order.status,
        channel: order.channel,
        client: clients.get(order.client_id)?.name || '',
        school: schools.get(order.school_id)?.name || '',
        reference: order.reference,
        sku: variant?.sku || '',
        garment: product?.garment || '',
        color: variant?.color || '',
        size: variant?.size || '',
        qty: line.qty,
        custom_name: line.custom_name,
        slide: line.slide,
        sign: line.sign,
        unit_sell_price: line.unit_sell_price,
        line_total: line.line_total,
        subtotal: order.subtotal,
        tax_amount: order.tax_amount,
        total: order.total
      });
    }
  }
  return lines;
}
