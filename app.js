import { initAuth, signOut, getUser, setUser, clearSession } from './auth.js';
import { call, peek, isDemo } from './api.js';
import { CONFIG } from './config.js';
import { el, formatSpan, today, STATUS, ITEM_STATUS, rankResults, queryVariants, formatPhone, phoneInput } from './format.js';
import { renderPicker } from './picker.js';
import { loadCore } from './core-loader.js';
import { startCamera, feedback, unlockAudio, normalizeCode, codeKey } from './scanner.js';
import { readProfile, saveProfile, clearCache, connection, savePersonalManifest, saveTitle } from './offline.js';
import { renderLabels } from './labels.js';
import { renderUsers } from './users.js';
import { renderInventory } from './inventory.js';
import { renderClients } from './clients.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['bookings', 'booking', 'free', 'catalog', 'clients', 'labels', 'users'];

let catalog = null;
let me = null; // текущий сотрудник: { email, name, perms, owner }

// Есть ли у сотрудника право (в демо — все права).
function can(perm) {
  return isDemo() || !!me?.perms?.includes(perm);
}

// Сессия завершена или истекла — к экрану входа.
function sessionExpired() {
  clearCache(); // сохранённые на устройстве данные — тоже: сессию могли завершить из-за потери телефона
  clearSession();
  location.reload();
}

// Для модулей: истёкшая сессия — сразу на вход, остальные ошибки — модулю.
async function moduleCall(action, params) {
  try {
    return await call(action, params);
  } catch (err) {
    if (err.code === 'unauthenticated') sessionExpired();
    throw err;
  }
}

// ---------- общее ----------

function showMessage(text) {
  $('message').textContent = text || '';
  $('message').hidden = !text;
}

// Ошибка показывается в строке сообщений (при истёкшем входе — повторный вход); результат тогда undefined.
async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 'unauthenticated') sessionExpired();
    else showMessage(err.message);
    return undefined;
  }
}

// Код из каталога для отсканированного или введённого (RF07 → RF07-AM): по номеру, владелец в записи не важен.
function resolveCode(code) {
  const key = codeKey(code);
  if (!key || !catalog) return code;
  const hit = catalog.items.find((i) => codeKey(i.id) === key) || (catalog.stock || []).find((s) => codeKey(s.id) === key);
  return hit ? hit.id : code;
}

function itemById(id) {
  return catalog.items.find((i) => i.id === id);
}

function stockById(id) {
  return catalog.stock.find((s) => s.id === id);
}

function statusBadge(status) {
  return el('span', { class: `badge st-${status}` }, STATUS[status] || status);
}

function show(view) {
  VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== view; });
  // Кнопки брони живут в полосе вкладок; на других экранах их нет.
  if (view !== 'booking') $('booking-actions').hidden = true;
  document.querySelectorAll('#tabs a').forEach((a) => {
    const tab = view === 'booking' ? 'bookings' : view;
    a.classList.toggle('active', a.dataset.tab === tab);
    // На узком экране вкладки прокручиваются — держим активную в поле зрения.
    if (a.dataset.tab === tab) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  window.scrollTo(0, 0);
}

// ---------- маршруты ----------

async function route() {
  if (!catalog) return;
  showMessage('');
  const [, view, arg] = location.hash.split('/');
  if (view === 'booking') return openBooking(arg === 'new' ? null : decodeURIComponent(arg || ''));
  if (view === 'free') return openFree();
  if (view === 'catalog') return openCatalog();
  if (view === 'clients') return openClients(arg ? decodeURIComponent(arg) : null);
  if (view === 'users') {
    if (!can('users')) return openBookings();
    show('users');
    renderUsers($('users'), { call, guarded, el, me });
    return undefined;
  }
  if (view === 'labels') {
    show('labels');
    if (!$('labels').childElementCount) renderLabels($('labels'), catalog);
    return undefined;
  }
  return openBookings();
}

// ---------- список броней ----------

let bookingsSeq = 0;

// Сначала — список, сохранённый на устройстве (мгновенно), затем — свежий с сервера, если он отличается.
async function openBookings() {
  show('bookings');
  const list = $('bookings-list');
  const seq = ++bookingsSeq;
  const cached = peek('bookings');
  if (cached) renderBookings(list, cached);
  else list.replaceChildren(el('p', { class: 'muted' }, 'Загрузка…'));
  const fresh = await guarded(() => call('bookings'));
  if (!fresh || seq !== bookingsSeq) return;
  if (!cached || JSON.stringify(fresh) !== JSON.stringify(cached)) renderBookings(list, fresh);
}

function renderBookings(list, bookings) {
  const t = today();
  const isOpen = (b) => b.status !== 'cancelled' && b.status !== 'returned';
  // текущие — идут сегодня или выданы и не возвращены (в том числе просроченные); будущие — ещё не начались
  const current = bookings.filter((b) => isOpen(b) && (b.status === 'out' || (b.start <= t && b.end >= t)));
  const future = bookings.filter((b) => isOpen(b) && !current.includes(b) && b.start > t);
  const past = bookings.filter((b) => !current.includes(b) && !future.includes(b) && b.status !== 'cancelled');
  const cancelled = bookings.filter((b) => b.status === 'cancelled');
  const byStart = (a, b) => (a.start + a.id).localeCompare(b.start + b.id);

  list.replaceChildren();
  const group = (title, rows, open = true) => {
    if (!rows.length) return;
    const ul = el('ul', { class: 'list' }, rows.map(bookingRow));
    list.append(open
      ? el('section', { class: 'group' }, el('h2', {}, title, el('span', { class: 'count' }, String(rows.length))), ul)
      : el('details', { class: 'group' }, el('summary', {}, `${title} (${rows.length})`), ul));
  };
  group('Текущие', current.sort(byStart));
  group('Будущие', future.sort(byStart));
  group('Прошедшие', past.sort(byStart).reverse(), false);
  group('Отменённые', cancelled.sort(byStart).reverse(), false);
  if (!bookings.length) list.append(el('p', { class: 'muted' }, 'Броней пока нет.'));
}

function bookingRow(b) {
  return el('li', {},
    el('a', { class: 'row', href: `#/booking/${encodeURIComponent(b.id)}` },
      el('span', { class: 'dates-cell' }, formatSpan(b)),
      el('span', { class: 'name' }, b.client_name || 'без имени',
        el('span', { class: 'note' }, `${b.id} · ${b.count} поз.`)),
      statusBadge(b.status)
    )
  );
}

// ---------- бронь ----------

// Типы позиций, которые можно сдавать «отдельно» — без обязательной пары по правилам комплектов.
const SEPARATE_ALLOWED = new Set(['tx', 'rx', 'plugon']);

const editor = {
  booking: null, // текущая бронь с сервера (или null для новой)
  selection: { items: new Set(), stock: new Map() },
  meta: new Map(), // код позиции или 'stock:код' → { parent, slot } для добавленных комплектом
  separate: new Set(),
  usage: null, // занятость на даты формы (без этой брони)
  usageKey: '',
  clientId: '', // клиент из справочника (пусто — сервер найдёт или создаст по имени)
  kitNotes: [],
  lines: [] // строки брони с сервера: out_at / returned_at
};

function resetEditor() {
  editor.selection = { items: new Set(), stock: new Map() };
  editor.meta = new Map();
  editor.separate = new Set();
  editor.usage = null;
  editor.usageKey = '';
  editor.kitNotes = [];
  editor.lines = [];
  editor.clientId = '';
}

function formValues() {
  const f = $('booking-form');
  return {
    ...Object.fromEntries(['client_name', 'client_phone', 'start', 'start_half', 'end', 'end_half', 'notes', 'shifts']
      .map((k) => [k, f.elements[k].value])),
    contract: f.elements.contract.checked ? 'yes' : ''
  };
}

function fillForm(b) {
  const f = $('booking-form');
  Object.entries(b).forEach(([k, v]) => {
    if (k === 'contract') f.elements.contract.checked = v === true || v === 'yes';
    else if (f.elements[k]) f.elements[k].value = v ?? '';
  });
}

// ---------- цены в брони ----------
// Цены строк фиксируются сервером при сохранении (снимок прейскуранта); здесь — только показ и итоги.

let PricesLib = null;
loadCore('prices', 'Prices').then((P) => { PricesLib = P; renderPriceSummary(); }).catch(() => {});

// Сохранённая строка брони для позиции (с ценой), если есть.
function savedLine(id, stock) {
  return editor.lines.find((x) => (stock ? x.stock_id === id : x.item_id === id));
}

function contractOn() {
  return $('booking-form').elements.contract.checked;
}

// Строки брони для расчёта: что выбрано сейчас, с ценой из сохранённой строки (снимок прейскуранта).
// Новые (ещё не сохранённые) позиции — без цены, их считает fresh.
function pricedLines() {
  const lines = [];
  let fresh = 0;
  const snap = (l) => ({ price: l.price, price_name: l.price_name, price_cat: l.price_cat, free_with: l.free_with });
  editor.selection.items.forEach((id) => {
    const l = savedLine(id, false);
    if (l) lines.push({ item_id: id, ...snap(l) });
    else fresh++;
  });
  editor.selection.stock.forEach((qty, id) => {
    const l = savedLine(id, true);
    lines.push({ stock_id: id, qty, ...(l ? snap(l) : { price: 0 }) });
  });
  return { lines, fresh };
}

// Сколько единиц строки бесплатны в комплекте сейчас (убрали основную позицию — комплектующая стала платной).
// Считается один раз на отрисовку состава (renderLines сбрасывает), а не заново для каждой строки.
let kitFreeMap = null;
function kitFreeQty(id, stock) {
  if (!PricesLib?.kitFree) return 0;
  if (!kitFreeMap) {
    const { lines } = pricedLines();
    const free = PricesLib.kitFree(lines);
    kitFreeMap = new Map(lines.map((l, i) => [l.item_id ? `i:${l.item_id}` : `s:${l.stock_id}`, free[i]]));
  }
  return kitFreeMap.get(stock ? `s:${id}` : `i:${id}`) || 0;
}

// Подпись цены у строки: «600 ₽» (с договором — пересчитанная), «бесплатно», «в комплекте», «без цены»; новая — пусто.
function priceTag(id, stock) {
  const l = savedLine(id, stock);
  if (!l || !PricesLib) return null;
  if (!PricesLib.hasPrice(l)) return stock ? null : el('span', { class: 'price miss' }, 'без цены');
  if (Number(l.price) === 0) return stock ? null : el('span', { class: 'price' }, 'бесплатно');
  const unit = `${PricesLib.money(PricesLib.unit(l.price, contractOn()))} ₽`;
  const free = kitFreeQty(id, stock);
  const qty = stock ? editor.selection.stock.get(id) || 0 : 1;
  if (free && free >= qty) return el('span', { class: 'price', title: `${unit} отдельно` }, 'в комплекте');
  if (free) return el('span', { class: 'price' }, `${unit}, ${free} шт. в комплекте`);
  return el('span', { class: 'price', title: l.free_with ? `бесплатно вместе с: ${l.free_with}` : null }, unit);
}

function renderPriceSummary() {
  const box = $('price-summary');
  if (!box) return;
  if (!PricesLib || $('view-booking').hidden) return box.replaceChildren();
  const f = $('booking-form');
  const b = formValues();
  // смены по датам — подсказкой в поле
  try { f.elements.shifts.placeholder = `по датам: ${PricesLib.shiftsAuto(b)}`; } catch { /* даты не заполнены */ }
  const { lines, fresh } = pricedLines();
  if (!lines.length && !fresh) return box.replaceChildren();
  let t;
  try { t = PricesLib.totals(b, lines); } catch { return box.replaceChildren(); }
  const word = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'смена' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'смены' : 'смен');
  box.replaceChildren(el('div', { class: 'panel price-panel' },
    el('div', { class: 'price-totals' },
      el('span', {}, 'В смену: ', el('strong', {}, `${PricesLib.money(t.perShift)} ₽`)),
      el('span', {}, `За период (${t.shifts} ${word(t.shifts)}): `, el('strong', {}, `${PricesLib.money(t.period)} ₽`))),
    t.discountPct ? el('p', { class: 'note' }, `Скидка ${t.discountPct} % от ${PricesLib.DISCOUNT_FROM_SHIFTS} смен; без скидки — ${PricesLib.money(t.gross)} ₽`) : null,
    t.contract ? el('p', { class: 'note' }, 'С договором: цены ÷ 0,91 с округлением до рубля') : null,
    t.free?.length ? el('p', { class: 'note' }, `В комплекте бесплатно: ${t.free.map((f) => (f.line.item_id
      ? itemById(f.line.item_id)?.name || f.line.item_id
      : `${stockById(f.line.stock_id)?.name || f.line.stock_id} × ${f.qty}`)).join(', ')}`) : null,
    t.missing.length ? el('p', { class: 'note warn' }, `Без цены: ${t.missing.map((l) => itemById(l.item_id)?.name || l.item_id).join(', ')} — привяжите к прейскуранту в «Инвентаре»`) : null,
    fresh ? el('p', { class: 'note' }, `Новых позиций: ${fresh} — их цены подтянутся из прейскуранта при сохранении`) : null,
    repriceButton(),
    contractButton(),
    customsButton()));
}

// Цены брони фиксируются при сохранении; эта кнопка пересчитывает все строки по прейскуранту сейчас.
function repriceButton() {
  if (!editor.booking || !editable() || !['draft', 'confirmed', 'out'].includes(editor.booking.status)) return null;
  const btn = el('button', {
    type: 'button', class: 'button small',
    onclick: () => {
      if (!confirm('Взять все цены этой брони из прейскуранта заново? Цены, зафиксированные раньше, заменятся текущими.')) return;
      save(editor.booking.status === 'confirmed' ? 'confirmed' : 'draft', { reprice: true, trigger: btn });
    }
  }, 'Обновить цены по прейскуранту');
  const at = editor.booking.prices_at;
  return el('div', { class: 'contract-row' }, btn, el('span', { class: 'note' }, at
    ? `цены из прейскуранта на ${fmtDateTime(at)}`
    : 'цены фиксируются при сохранении брони'));
}

// «2026-10-04 14:32» → «04.10.2026 14:32»
function fmtDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s));
  return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : String(s);
}

// Файл с сервера ({ filename, base64 }) — скачать.
function downloadBase64(res, type) {
  const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a', { href: url, download: res.filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Таможенный список (.xlsx) по сохранённой брони: одинаковые позиции — строкой с количеством и серийниками.
function customsButton() {
  if (!editor.booking || editor.booking.status === 'cancelled') return null;
  const btn = el('button', { type: 'button', class: 'button small' }, 'Таможенный список (.xlsx)');
  const note = el('span', { class: 'note' }, 'по сохранённой брони');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    note.textContent = 'Собираю список…';
    note.classList.remove('warn');
    try {
      const res = await call('customs_xlsx', { id: editor.booking.id });
      downloadBase64(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      // чего не хватает в инвентаре (стоимость, страна) — подсказкой
      note.textContent = res.warnings?.length ? `Готово. ${res.warnings.join('; ')} — заполните в «Инвентаре»` : `Готово: ${res.filename}`;
      note.classList.toggle('warn', Boolean(res.warnings?.length));
    } catch (err) {
      if (err.code === 'unauthenticated') return sessionExpired();
      note.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  return el('div', { class: 'contract-row' }, btn, note);
}

// Договор (.docx) по сохранённой брони — собирается на сервере из шаблона владельца.
function contractButton() {
  if (!editor.booking || !contractOn() || editor.booking.status === 'cancelled') return null;
  const saved = editor.booking.contract === true || editor.booking.contract === 'yes';
  const btn = el('button', { type: 'button', class: 'button small' }, 'Скачать договор (.docx)');
  const note = el('span', { class: 'note' }, saved ? 'по сохранённой брони' : 'сначала сохраните бронь с отметкой «С договором»');
  btn.disabled = !saved;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    note.textContent = 'Собираю договор…';
    try {
      const res = await call('contract_docx', { id: editor.booking.id });
      downloadBase64(res, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      note.textContent = `Готово: ${res.filename}`;
    } catch (err) {
      if (err.code === 'unauthenticated') return sessionExpired();
      note.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  return el('div', { class: 'contract-row' }, btn, note);
}

function editable() {
  return can('bookings') && (!editor.booking || ['draft', 'confirmed', 'out'].includes(editor.booking.status));
}

// Выдана и не возвращена (в выданной брони такую строку убирают только через возврат).
function isIssued(id, stock) {
  return editor.lines.some((l) => (stock ? l.stock_id === id : l.item_id === id) && l.out_at && !l.returned_at);
}

// Выдано по строкам брони (расходники — суммарно).
function issuedQty(stockId) {
  return editor.lines.filter((l) => l.stock_id === stockId && l.out_at).reduce((n, l) => n + (Number(l.qty) || 0), 0);
}

// Занятость на текущие даты формы; кэшируется, пока даты не меняются.
async function editorUsage() {
  const v = formValues();
  if (!v.start || !v.end) return null;
  const key = [v.start, v.start_half, v.end, v.end_half].join('|');
  if (editor.usage && editor.usageKey === key) return editor.usage;
  const usage = await guarded(() => call('availability', {
    start: v.start, start_half: v.start_half, end: v.end, end_half: v.end_half, exclude: editor.booking?.id || ''
  }));
  if (usage) {
    editor.usage = usage;
    editor.usageKey = key;
  }
  return usage || null;
}

const BLOCKING = { confirmed: true, out: true };

// Добавляет к позициям их комплекты по правилам KitRules — и комплекты добавленного
// (например, к одной позиции — вторая, к ней — третья). Чего нет в наличии — в kitNotes.
async function applyKits(mainIds) {
  if (!catalog.kitRules?.length) return;
  const [Kits, usage] = await Promise.all([loadCore('kits', 'Kits'), editorUsage()]);
  if (!usage) return;
  const isFree = (id) => !(usage.items[id] || []).some((r) => BLOCKING[r.status]);
  const stockFree = (id) => {
    const s = stockById(id);
    const used = usage.stock[id]?.used || 0;
    return (Number(s?.qty_total) || 0) - used - (editor.selection.stock.get(id) || 0);
  };

  const queue = mainIds.map((id) => ({ id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift();
    const main = itemById(id);
    if (!main || editor.separate.has(id)) continue;
    const taken = Object.fromEntries([...editor.selection.items].map((x) => [x, true]));
    // строки брони — чтобы многоканальная позиция со свободным каналом закрыла слот без новой
    const lines = [...editor.selection.items].map((x) => ({ item_id: x, separate: editor.separate.has(x) }))
      .concat([...editor.selection.stock].map(([stock_id, qty]) => ({ stock_id, qty })));
    const adds = Kits.resolve(main, catalog.kitRules, catalog.items, catalog.stock, { isFree, stockFree, taken, lines });
    adds.forEach((a) => {
      if (a.existing) return;
      if (a.missing) {
        if (a.required) editor.kitNotes.push(`${id}: ${a.message}`);
      } else if (a.item_id) {
        editor.selection.items.add(a.item_id);
        editor.meta.set(a.item_id, { parent: id, slot: a.slot });
        if (depth < 2) queue.push({ id: a.item_id, depth: depth + 1 });
      } else if (a.stock_id) {
        editor.selection.stock.set(a.stock_id, (editor.selection.stock.get(a.stock_id) || 0) + a.qty);
        if (!editor.meta.has(`stock:${a.stock_id}`)) editor.meta.set(`stock:${a.stock_id}`, { parent: id, slot: a.slot });
      }
    });
  }
}

// Убирает позицию и всё, что было добавлено к ней комплектом.
function removeWithKit(id) {
  if (isIssued(id, false)) return;
  editor.selection.items.delete(id);
  editor.meta.delete(id);
  editor.separate.delete(id);
  [...editor.meta].forEach(([key, m]) => {
    if (m.parent !== id) return;
    if (key.startsWith('stock:')) {
      editor.selection.stock.delete(key.slice(6));
      editor.meta.delete(key);
    } else {
      removeWithKit(key);
    }
  });
}

// Только комплект позиции (сама позиция остаётся).
function removeKitOf(id) {
  [...editor.meta].forEach(([key, m]) => {
    if (m.parent !== id) return;
    if (key.startsWith('stock:')) {
      editor.selection.stock.delete(key.slice(6));
      editor.meta.delete(key);
    } else {
      removeWithKit(key);
    }
  });
}

async function onPickerChange(change) {
  editor.kitNotes = [];
  if (change.added) await applyKits([change.added]);
  if (change.removed) {
    if (isIssued(change.removed, false)) {
      editor.selection.items.add(change.removed); // выданное остаётся — убрать можно только возвратом
      editor.kitNotes.push(`${change.removed}: выдан — чтобы убрать, оформите возврат`);
    } else {
      removeWithKit(change.removed);
    }
  }
  if (change.stock && editor.selection.stock.get(change.stock) < issuedQty(change.stock)) {
    editor.selection.stock.set(change.stock, issuedQty(change.stock));
    editor.kitNotes.push(`${change.stock}: выдано ${issuedQty(change.stock)} шт. — меньше указать нельзя, оформите возврат`);
  }
  renderLines();
}

let bookingSeq = 0; // номер последнего открытия брони: ответы от предыдущих отбрасываются

async function openBooking(id, prefill) {
  const seq = ++bookingSeq;
  show('booking');
  setPickerOpen(false);
  $('booking-messages').replaceChildren();
  resetEditor();
  editor.booking = null;

  if (id) {
    $('booking-title').textContent = id;
    $('booking-status').replaceChildren();
    const data = await guarded(() => call('booking', { id }));
    if (!data || seq !== bookingSeq) return;
    editor.booking = data.booking;
    editor.lines = data.lines;
    editor.clientId = data.booking.client_id || '';
    fillForm(data.booking);
    data.lines.forEach((l) => {
      if (l.item_id) {
        editor.selection.items.add(l.item_id);
        if (l.parent_line) editor.meta.set(l.item_id, { parent: l.parent_line, slot: l.slot });
        if (l.separate) editor.separate.add(l.item_id);
      } else if (l.stock_id) {
        editor.selection.stock.set(l.stock_id, (editor.selection.stock.get(l.stock_id) || 0) + l.qty);
        if (l.parent_line) editor.meta.set(`stock:${l.stock_id}`, { parent: l.parent_line, slot: l.slot });
      }
    });
    $('booking-status').replaceChildren(statusBadge(data.booking.status));
  } else {
    $('booking-title').textContent = 'Новая бронь';
    $('booking-status').replaceChildren();
    $('booking-form').reset();
    const t = today();
    fillForm({ start: t, start_half: 'am', end: t, end_half: 'pm', ...(prefill?.dates || {}) });
    if (prefill?.client) {
      fillForm({ client_name: prefill.client.name || '', client_phone: prefill.client.phone || '' });
      editor.clientId = prefill.client.id || '';
    }
    (prefill?.items || []).forEach((i) => editor.selection.items.add(i));
    (prefill?.stock || []).forEach(([sid, q]) => editor.selection.stock.set(sid, q));
  }

  const canEdit = editable();
  const status = editor.booking?.status;
  [...$('booking-form').elements].forEach((e) => {
    // У выданной брони дата выдачи в прошлом — её не меняют, только продлевают возврат.
    e.disabled = !canEdit || (status === 'out' && (e.name === 'start' || e.name === 'start_half'));
  });
  $('add-gear').hidden = !canEdit;
  $('save-draft').hidden = !canEdit || status === 'out';
  $('save-confirm').hidden = !canEdit;
  $('save-confirm').textContent = status === 'confirmed' || status === 'out' ? 'Сохранить' : 'Подтвердить';
  $('cancel-booking').hidden = !editor.booking || !['draft', 'confirmed'].includes(editor.booking.status) || !can('bookings');
  const pendingIssue = editor.lines.some((l) => !l.out_at);
  $('issue-booking').hidden = !can('issue') || !(status === 'confirmed' || (status === 'out' && pendingIssue));
  $('issue-booking').textContent = status === 'out' ? 'Довыдать' : 'Выдача';
  $('return-booking').hidden = editor.booking?.status !== 'out' || !can('issue');
  $('booking-actions').hidden = [...$('booking-actions').children].every((b) => b.hidden);
  renderLines();

  // Выбранное на экране «Свободно» сразу дополняется комплектами.
  if (prefill?.items?.length) {
    await applyKits(prefill.items);
    if (seq !== bookingSeq) return;
    renderLines();
  }

  if (canEdit) loadClientOptions();

  // Выбор оборудования открыт сразу, если бронь можно менять.
  if (canEdit) {
    setPickerOpen(true);
    $('picker').replaceChildren(el('p', { class: 'muted' }, 'Загрузка…'));
    refreshPicker();
  }
}

function lineRow(id, { child, slot, qty, stock }) {
  const canEdit = editable();
  const it = stock ? null : itemById(id);
  const s = stock ? stockById(id) : null;
  const name = stock ? (s ? s.name : 'нет в каталоге') : (it ? it.name : 'нет в каталоге');
  const canSeparate = canEdit && it && SEPARATE_ALLOWED.has(it.subtype) && !child;
  const separateBox = canSeparate ? el('label', { class: 'note check' },
    el('input', {
      type: 'checkbox',
      checked: editor.separate.has(id),
      onchange: (e) => {
        editor.kitNotes = [];
        if (e.target.checked) {
          editor.separate.add(id);
          removeKitOf(id);
          renderLines();
        } else {
          editor.separate.delete(id);
          applyKits([id]).then(renderLines);
        }
      }
    }), ' отдельно, без пары') : null;

  return el('li', { class: child ? 'child' : '' },
    el('div', { class: 'row' },
      el('span', { class: 'code' }, id),
      el('span', { class: 'name' }, name,
        it?.label ? el('span', { class: 'label' }, it.label) : null,
        slot ? el('span', { class: 'note' }, `↳ ${slot}`) : null,
        separateBox,
        !canSeparate && editor.separate.has(id) ? el('span', { class: 'note' }, 'отдельно, без пары') : null),
      stock ? el('span', { class: 'qty' }, `${qty} шт.`) : null,
      priceTag(id, stock),
      lineMark(id, stock),
      canEdit && !(stock ? issuedQty(id) > 0 : isIssued(id, false)) ? el('button', {
        type: 'button', class: 'button small', 'aria-label': `Убрать ${id}`,
        onclick: () => {
          if (stock) {
            editor.selection.stock.delete(id);
            editor.meta.delete(`stock:${id}`);
          } else {
            removeWithKit(id);
          }
          renderLines();
          refreshPicker();
        }
      }, '×') : null));
}

function lineMark(id, stock) {
  const st = editor.booking?.status;
  if (st !== 'out' && st !== 'returned') return null;
  const l = editor.lines.find((x) => (stock ? x.stock_id === id : x.item_id === id));
  if (!l) return null;
  if (l.returned_at) return el('span', { class: 'mark' }, 'вернули ✓');
  if (l.out_at) return el('span', { class: 'mark' }, 'выдано ✓');
  return el('span', { class: 'mark miss' }, 'не выдано');
}

// Состав брони деревом: основная позиция, под ней её комплект.
function renderLines() {
  kitFreeMap = null; // состав мог измениться
  const ul = $('booking-lines');
  const rows = [];
  const placed = new Set();
  const byCode = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
  const children = (parent) => [...editor.meta].filter(([, m]) => m.parent === parent).map(([k]) => k);

  const place = (key, depth) => {
    if (placed.has(key)) return;
    const stock = key.startsWith('stock:');
    const id = stock ? key.slice(6) : key;
    if (stock ? !editor.selection.stock.has(id) : !editor.selection.items.has(id)) return;
    placed.add(key);
    const m = editor.meta.get(key);
    rows.push(lineRow(id, { child: depth > 0, slot: m?.slot, qty: editor.selection.stock.get(id), stock }));
    if (!stock) children(id).sort(byCode).forEach((k) => place(k, depth + 1));
  };

  const isRoot = (id) => !editor.meta.has(id) || !editor.selection.items.has(editor.meta.get(id).parent);
  [...editor.selection.items].filter(isRoot).sort(byCode).forEach((id) => place(id, 0));
  [...editor.selection.items].sort(byCode).forEach((id) => place(id, 0));
  [...editor.selection.stock.keys()].sort(byCode).forEach((id) => place(`stock:${id}`, 0));

  ul.replaceChildren(...rows);
  ul.hidden = !rows.length;
  $('lines-empty').hidden = !!rows.length;
  const n = editor.selection.items.size + [...editor.selection.stock.values()].reduce((a, b) => a + b, 0);
  $('lines-count').textContent = n ? String(n) : '';

  $('kit-notes').replaceChildren(...(editor.kitNotes.length
    ? [el('div', { class: 'notice warn' }, el('strong', {}, 'Комплект неполный:'),
      el('ul', {}, editor.kitNotes.map((t) => el('li', {}, t))))]
    : []));
  renderPriceSummary();
}

// ---------- клиент в брони ----------

const clientList = { at: 0, items: [], active: -1 };

// Справочник для поля «Клиент»: сразу — с устройства, с сервера — не чаще раза в минуту.
async function loadClientOptions() {
  if (!clientList.items.length) clientList.items = peek('clients')?.clients || [];
  if (Date.now() - clientList.at > 60_000) {
    const data = await call('clients').catch(() => null);
    if (data) {
      clientList.items = data.clients;
      clientList.at = Date.now();
      if (!$('client-options').hidden) showClientOptions();
    }
  }
}

// Список клиентов под полем: при щелчке — все (недавние сверху), при вводе — подходящие.
function showClientOptions() {
  const input = $('booking-form').elements.client_name;
  const box = $('client-options');
  const q = input.value.trim().toLowerCase();
  const variants = queryVariants(q);
  const recent = clientList.items.slice().sort((x, y) => String(y.last || '').localeCompare(String(x.last || ''))
    || String(x.name).localeCompare(String(y.name), 'ru'));
  // сначала — имя начинается с введённого, затем — имя содержит, затем — телефон или организация
  // (и в другой раскладке, если её забыли переключить)
  const rankOne = (c, v) => {
    const name = String(c.name || '').toLowerCase();
    if (name.startsWith(v)) return 1;
    if (name.includes(v)) return 2;
    return [c.phone, c.company].some((f) => String(f || '').toLowerCase().includes(v)) ? 3 : 0;
  };
  const rank = (c) => {
    const r = variants.map((v) => rankOne(c, v)).filter(Boolean);
    return r.length ? Math.min(...r) : 0;
  };
  const found = q
    ? recent.map((c) => ({ c, r: rank(c) })).filter((x) => x.r).sort((a, b) => a.r - b.r).map((x) => x.c)
    : recent;
  const rows = found.slice(0, 50);
  clientList.active = -1;
  box.replaceChildren(...rows.map((c, i) => el('li', {
    role: 'option', id: `client-opt-${i}`,
    onmousedown: (e) => { e.preventDefault(); pickClient(c); }
  }, el('span', { class: 'ac-name' }, c.name),
  el('span', { class: 'note' }, [formatPhone(c.phone), c.company].filter(Boolean).join(' · ')))));
  box.hidden = !rows.length;
  input.setAttribute('aria-expanded', String(!box.hidden));
}

function hideClientOptions() {
  $('client-options').hidden = true;
  $('booking-form').elements.client_name.setAttribute('aria-expanded', 'false');
}

function pickClient(c) {
  const f = $('booking-form');
  f.elements.client_name.value = c.name;
  editor.clientId = c.id;
  if (c.phone) f.elements.client_phone.value = formatPhone(c.phone);
  hideClientOptions();
}

function onClientKey(e) {
  const box = $('client-options');
  const opts = [...box.children];
  if (e.key === 'Escape') { hideClientOptions(); return; }
  if (e.key === 'ArrowDown' && box.hidden) { showClientOptions(); e.preventDefault(); return; }
  if (box.hidden || !opts.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = opts.length;
    clientList.active = (clientList.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    opts.forEach((o, i) => o.classList.toggle('active', i === clientList.active));
    opts[clientList.active].scrollIntoView({ block: 'nearest' });
    e.target.setAttribute('aria-activedescendant', opts[clientList.active].id);
  } else if (e.key === 'Enter' && clientList.active >= 0) {
    e.preventDefault();
    opts[clientList.active].dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
  }
}

// Ввели имя вручную: если оно точно совпадает с клиентом из справочника — привязываем бронь к нему.
function onClientInput() {
  const f = $('booking-form');
  const name = f.elements.client_name.value.trim().toLowerCase();
  const match = clientList.items.filter((c) => c.name.trim().toLowerCase() === name);
  if (match.length === 1) {
    editor.clientId = match[0].id;
    if (!f.elements.client_phone.value && match[0].phone) f.elements.client_phone.value = match[0].phone;
  } else {
    editor.clientId = '';
  }
  showClientOptions();
}

async function refreshPicker() {
  if ($('picker-wrap').hidden) return;
  const usage = await editorUsage();
  if (!usage) return;
  renderPicker($('picker'), { catalog, usage, selection: editor.selection, onChange: onPickerChange });
}

function showResult(res) {
  const box = $('booking-messages');
  box.replaceChildren();
  const list = (cls, title, items) => {
    if (!items?.length) return;
    box.append(el('div', { class: `notice ${cls}` }, el('strong', {}, title),
      el('ul', {}, items.map((m) => el('li', {}, m.message)))));
  };
  list('bad', editor.booking?.status === 'out' ? 'Сохранить нельзя:' : 'Подтвердить нельзя:', res.errors);
  list('warn', 'Обратите внимание:', res.warnings);
}

// reprice — заново взять все цены из прейскуранта (кнопка «Обновить цены»).
async function save(status, { reprice = false, trigger = null } = {}) {
  const f = $('booking-form');
  if (!f.reportValidity()) return;
  const lines = [
    ...[...editor.selection.items].map((item_id) => ({
      item_id,
      separate: editor.separate.has(item_id),
      parent_line: editor.meta.get(item_id)?.parent || '',
      slot: editor.meta.get(item_id)?.slot || ''
    })),
    ...[...editor.selection.stock].map(([stock_id, qty]) => ({
      stock_id,
      qty,
      parent_line: editor.meta.get(`stock:${stock_id}`)?.parent || '',
      slot: editor.meta.get(`stock:${stock_id}`)?.slot || ''
    }))
  ];
  const buttons = [$('save-draft'), $('save-confirm')];
  buttons.forEach((b) => { b.disabled = true; });
  // Индикация до ответа сервера: нажатая кнопка — «Сохраняю…» с крутилкой, под составом — строка состояния.
  const clicked = trigger || (status === 'confirmed' ? $('save-confirm') : $('save-draft'));
  const label = clicked.textContent;
  clicked.classList.add('busy');
  clicked.disabled = true;
  clicked.textContent = reprice ? 'Обновляю цены…' : status === 'confirmed' ? 'Подтверждаю…' : 'Сохраняю…';
  $('booking-messages').replaceChildren(el('div', { class: 'notice info busy-line', role: 'status' },
    reprice ? 'Беру цены из прейскуранта и сохраняю бронь…' : 'Сохраняю бронь…'));
  try {
    const res = await call('booking_save', {
      booking: { ...formValues(), id: editor.booking?.id || '', client_id: editor.clientId || '' },
      lines,
      status,
      reprice
    });
    if (!editor.booking) history.replaceState(null, '', `#/booking/${encodeURIComponent(res.booking.id)}`);
    await openBooking(res.booking.id);
    showResult(res);
    if (!res.errors.length && !res.warnings.length) {
      $('booking-messages').append(el('div', { class: 'notice ok' },
        reprice ? 'Цены обновлены по прейскуранту.'
          : status === 'confirmed' ? 'Бронь подтверждена.' : status === 'out' ? 'Изменения сохранены.' : 'Черновик сохранён.'));
    }
  } catch (err) {
    if (err.code === 'conflict') showResult({ errors: err.details || [], warnings: [] });
    else if (err.code === 'unauthenticated') sessionExpired();
    else $('booking-messages').replaceChildren(el('div', { class: 'notice bad' }, err.message));
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    clicked.classList.remove('busy');
    clicked.disabled = false;
    clicked.textContent = label;
    $('booking-messages').querySelector('.busy-line')?.remove();
  }
}

async function cancelBooking() {
  if (!editor.booking) return;
  if (!confirm(`Отменить бронь ${editor.booking.id}? Оборудование освободится.`)) return;
  const res = await guarded(() => call('booking_cancel', { id: editor.booking.id }));
  if (res) await openBooking(res.booking.id);
}

// ---------- сканер: окно ----------

const scan = { stop: null, onCode: null };

// Открывает окно сканера. onCode(код) вызывается для каждого кода с камеры, ручного ввода или Bluetooth-сканера.
async function openScan({ title, onCode, onClose }) {
  unlockAudio(); // до первого await: сигналы разрешены только в обработчике нажатия
  const dlg = $('scan-dialog');
  $('scan-title').textContent = title;
  $('scan-last').replaceChildren();
  $('scan-extra').replaceChildren();
  $('scan-actions').replaceChildren();
  $('scan-hint').textContent = 'Включаю камеру…';
  scan.onCode = onCode;
  scan.onClose = onClose;
  if (!dlg.open) dlg.showModal();
  $('scan-manual').elements.code.value = '';
  try {
    scan.stop = await startCamera($('scan-video'), (code) => scan.onCode?.(resolveCode(code)));
    $('scan-hint').textContent = 'Наведите камеру на штрихкод, держите телефон вдоль штрихов';
  } catch (err) {
    $('scan-hint').textContent = err?.name === 'NotAllowedError'
      ? 'Нет доступа к камере — разрешите его в настройках браузера или вводите код вручную'
      : `Камера недоступна: ${err.message || err}. Можно вводить код вручную`;
  }
}

function closeScan() {
  scan.stop?.();
  scan.stop = null;
  scan.onCode = null;
  const onClose = scan.onClose;
  scan.onClose = null;
  if ($('scan-dialog').open) $('scan-dialog').close();
  onClose?.();
}

function scanMessage(kind, text) {
  $('scan-last').replaceChildren(el('div', { class: `notice ${kind}` }, text));
}

// ---------- выдача и возврат ----------

// mode: 'out' — выдача (все строки брони), 'return' — возврат (выданное и не возвращённое).
function startIssue(mode) {
  const b = editor.booking;
  if (!b) return;
  const pending = editor.lines.filter((l) => (mode === 'out' ? !l.out_at : l.out_at && !l.returned_at));
  const checked = new Set();
  const key = (l) => l.item_id || `stock:${l.stock_id}`;

  const renderList = () => {
    const done = pending.filter((l) => checked.has(key(l))).length;
    $('scan-extra').replaceChildren(
      el('p', { class: 'muted' }, `Отмечено ${done} из ${pending.length}. Расходники без этикеток отмечайте вручную.`),
      el('ul', { class: 'list' }, pending.map((l) => {
        const k = key(l);
        const it = l.item_id ? itemById(l.item_id) : stockById(l.stock_id);
        const box = el('input', {
          type: 'checkbox', checked: checked.has(k),
          onchange: (e) => { if (e.target.checked) checked.add(k); else checked.delete(k); renderList(); }
        });
        return el('li', {}, el('label', { class: `row pick${checked.has(k) ? ' done' : ''}` },
          box,
          el('span', { class: 'code' }, l.item_id || l.stock_id),
          el('span', { class: 'name' }, it ? it.name : '', l.slot ? el('span', { class: 'note' }, `↳ ${l.slot}`) : null),
          l.stock_id ? el('span', { class: 'qty' }, `${l.qty} шт.`) : null));
      })));
  };

  let finishing = false;
  const finish = async (e) => {
    if (finishing) return;
    const missing = pending.filter((l) => !checked.has(key(l)));
    if (!checked.size) {
      scanMessage('bad', 'Ничего не отмечено');
      return;
    }
    if (missing.length && !confirm(
      `${mode === 'out' ? 'Не выдано' : 'Не возвращено'}: ${missing.map((l) => l.item_id || l.stock_id).join(', ')}.\n` +
      `${mode === 'out' ? 'Оформить выдачу' : 'Сохранить возврат'} без них?`)) return;
    const ids = [...checked];
    finishing = true;
    if (e?.target) e.target.disabled = true;
    // Ошибку показываем в окне сканера: общая строка сообщений скрыта за ним.
    const res = await call(mode === 'out' ? 'booking_out' : 'booking_return', {
      id: b.id,
      item_ids: ids.filter((k) => !k.startsWith('stock:')),
      stock_ids: ids.filter((k) => k.startsWith('stock:')).map((k) => k.slice(6))
    }).catch((err) => {
      if (err.code === 'unauthenticated') sessionExpired();
      else scanMessage('bad', err.message);
      return null;
    });
    finishing = false;
    if (e?.target) e.target.disabled = false;
    if (!res) return;
    closeScan();
    await openBooking(b.id);
    const box = $('booking-messages');
    if (res.missing.length) {
      box.append(el('div', { class: 'notice warn' },
        `${mode === 'out' ? 'Выдано без' : 'Ещё не вернули'}: ${res.missing.join(', ')}`));
    } else {
      box.append(el('div', { class: 'notice ok' },
        mode === 'out' ? 'Всё выдано.' : 'Всё возвращено, бронь закрыта.'));
    }
  };

  openScan({
    title: `${mode === 'out' ? 'Выдача' : 'Возврат'} ${b.id}`,
    onCode: (code) => {
      const line = pending.find((l) => l.item_id === code);
      if (line) {
        if (checked.has(code)) {
          feedback('repeat');
          scanMessage('ok', `${code} уже отмечен`);
          return;
        }
        checked.add(code);
        feedback('ok');
        scanMessage('ok', `✓ ${code} ${itemById(code)?.name || ''}`);
        renderList();
        return;
      }
      const it = itemById(code);
      const already = editor.lines.find((l) => l.item_id === code);
      feedback(!it ? 'unknown' : already ? 'repeat' : 'wrong');
      scanMessage('bad', it
        ? (already ? `${code} уже ${mode === 'out' ? 'выдан' : 'возвращён'}` : `${code} ${it.name} — не из этой брони`)
        : `Код ${code} не найден`);
    }
  });
  $('scan-actions').append(el('button', {
    type: 'button', class: 'button primary wide', onclick: finish
  }, mode === 'out' ? 'Оформить выдачу' : 'Сохранить возврат'));
  renderList();
}

// ---------- каталог: где вещь ----------

function scanWhere() {
  openScan({
    title: 'Найти по штрихкоду',
    onCode: async (code) => {
      const it = itemById(code);
      if (!it) {
        feedback('unknown');
        scanMessage('bad', `Код ${code} не найден`);
        return;
      }
      feedback('ok');
      scanMessage('ok', `${code} · ${it.name}`);
      const where = await guarded(() => call('item_where', { id: code }));
      if (!where) return;
      const rows = [];
      if (where.out) rows.push(['Сейчас', `выдан: ${where.out.id} · ${where.out.client_name} · ${formatSpan(where.out)}`]);
      else rows.push(['Сейчас', 'на складе']);
      where.upcoming.forEach((b) => rows.push(['Бронь', `${b.id} · ${b.client_name} · ${formatSpan(b)}`]));
      if (it.label) rows.push(['Метка', it.label]);
      if (it.serial) rows.push(['Серийный номер', it.serial]);
      if (it.status !== 'active') rows.push(['Статус', ITEM_STATUS[it.status] || it.status]);
      $('scan-extra').replaceChildren(el('dl', { class: 'where' },
        rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
    }
  });
}

// ---------- свободно ----------

const free = { selection: { items: new Set(), stock: new Map() } };

function openFree() {
  show('free');
  const f = $('free-form');
  if (!f.elements.start.value) {
    f.elements.start.value = today();
    f.elements.end.value = today();
  }
  loadFree();
}

async function loadFree() {
  const f = $('free-form');
  const v = Object.fromEntries(['start', 'start_half', 'end', 'end_half'].map((k) => [k, f.elements[k].value]));
  if (!v.start || !v.end) return;
  if (v.end < v.start) {
    f.elements.end.value = v.start;
    v.end = v.start;
  }
  $('free-picker').replaceChildren(el('p', { class: 'muted' }, 'Загрузка…'));
  const usage = await guarded(() => call('availability', v));
  if (!usage) return;
  renderPicker($('free-picker'), { catalog, usage, selection: free.selection, onChange: updateFreeBar });
  updateFreeBar();
}

function updateFreeBar() {
  const n = free.selection.items.size + [...free.selection.stock.values()].reduce((a, b) => a + b, 0);
  $('free-bar').hidden = !n;
  $('free-selected').textContent = `Выбрано: ${n}`;
}

function createFromFree() {
  const f = $('free-form');
  const prefill = {
    dates: Object.fromEntries(['start', 'start_half', 'end', 'end_half'].map((k) => [k, f.elements[k].value])),
    items: [...free.selection.items],
    stock: [...free.selection.stock]
  };
  free.selection = { items: new Set(), stock: new Map() };
  updateFreeBar();
  history.pushState(null, '', '#/booking/new');
  openBooking(null, prefill);
}

// ---------- каталог ----------

// ---------- инвентарь и клиенты (модули) ----------

// Общий контекст для модулей экранов.
function moduleCtx() {
  return {
    el, call: moduleCall, peek, guarded, can, formatSpan, rankResults, STATUS,
    getCatalog: () => catalog,
    reloadCatalog,
    scanWhere,
    openBooking: (id) => { location.hash = `#/booking/${encodeURIComponent(id)}`; },
    newBookingFor: (client) => {
      history.pushState(null, '', '#/booking/new');
      openBooking(null, { client });
    },
    showMessage
  };
}

function openCatalog() {
  show('catalog');
  renderInventory($('inventory'), moduleCtx());
}

function openClients(id) {
  show('clients');
  renderClients($('clients'), moduleCtx(), id || null);
}

// Каталог заново с сервера (после правки инвентаря); справочные поля для поиска.
async function reloadCatalog() {
  const fresh = await guarded(() => call('catalog'));
  if (!fresh) return catalog;
  catalog = prepareCatalog(fresh);
  return catalog;
}

function prepareCatalog(c) {
  const bandCode = Object.fromEntries((Array.isArray(c.bands) ? c.bands : []).map((b) => [b.id, b.code]));
  c.items.forEach((i) => {
    i.type_name = c.subtypes?.[i.subtype] || '';
    i.category_name = c.categories?.[i.category] || '';
    i.band_name = bandCode[i.band] || '';
  });
  return c;
}

// ---------- права в интерфейсе ----------

function applyPerms() {
  document.querySelector('#tabs a[data-tab="users"]').hidden = !can('users');
  document.querySelector('#view-bookings a[href="#/booking/new"]').hidden = !can('bookings');
  $('free-create').hidden = !can('bookings');
}

// ---------- запуск ----------

// После входа: название в шапке, во вкладке и у ярлыка на домашнем экране.
// До входа везде нейтральное «Inventory» из index.html и manifest.webmanifest.
function setAppName(title) {
  $('app-title').textContent = title;
  document.title = title;
  let meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (!meta) {
    meta = el('meta', { name: 'apple-mobile-web-app-title' });
    document.head.append(meta);
  }
  meta.content = title;
  // Ярлык на домашнем экране: браузеры берут название из манифеста по его адресу, подмену через
  // blob: не все видят (Firefox). Поэтому манифест с настоящим названием кладётся в кэш на этом
  // устройстве, и service worker отдаёт его вместо публичного (там нейтральное «Inventory»).
  saveTitle(title);
  savePersonalManifest(title).then((ok) => {
    const link = document.querySelector('link[rel="manifest"]');
    if (ok && link) link.href = `manifest.webmanifest?named=${Date.now()}`;
  });
}

async function onUser(profile) {
  $('signin').hidden = !!profile;
  $('user').hidden = !profile;
  $('tabs').hidden = !profile;
  if (!profile) {
    VIEWS.forEach((v) => { $(`view-${v}`).hidden = true; });
    return;
  }
  me = profile;
  $('user-name').textContent = profile.name || profile.email;
  if (!isDemo()) saveProfile(profile);
  if (!catalog) {
    // Каталог с устройства — экран открывается сразу; свежий подтягивается следом.
    const cached = peek('catalog');
    if (cached) {
      useCatalog(cached);
      route();
      const fresh = await guarded(() => call('catalog'));
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(cached)) useCatalog(fresh);
      return;
    }
    showMessage('Загрузка…');
    const fresh = await guarded(() => call('catalog'));
    if (!fresh) return;
    showMessage('');
    useCatalog(fresh);
  }
  route();
}

// Новый каталог: права и название — из него. Открытые экраны берут каталог при следующей отрисовке.
function useCatalog(data) {
  catalog = prepareCatalog(data);
  if (catalog.me) {
    me = catalog.me;
    if (!isDemo()) setUser(me);
  }
  applyPerms();
  if (catalog.title) setAppName(catalog.title);
}

phoneInput($('booking-form').elements.client_phone); // телефон в брони — «+7 915 067-77-21»

$('sign-out').addEventListener('click', () => {
  renderIcsBox();
  $('account-dialog').showModal();
});

// Календарь по ссылке (ICS): личная секретная ссылка сотрудника; перевыпуск отключает старую.
function renderIcsBox() {
  const box = $('ics-box');
  if (!box) return;
  if (!can('bookings')) return box.replaceChildren();
  const out = el('div', { class: 'ics-out' });
  const load = async (renew) => {
    out.replaceChildren(el('p', { class: 'note' }, renew ? 'Выпускаю новую ссылку…' : 'Получаю ссылку…'));
    try {
      const res = await call('ics_link', renew ? { renew: true } : {});
      // адрес — тот же, по которому сайт обращается к серверу (развёртывание с актуальной версией)
      const url = res.key && CONFIG.API_URL ? `${CONFIG.API_URL}?ics=${res.key}` : res.url;
      const input = el('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Ссылка на календарь', onfocus: (e) => e.target.select() });
      const copy = el('button', {
        type: 'button', class: 'button small',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            copy.textContent = 'Скопировано';
          } catch {
            input.select();
            copy.textContent = 'Скопируйте вручную';
          }
        }
      }, 'Копировать');
      out.replaceChildren(
        input,
        el('div', { class: 'actions' },
          copy,
          el('a', { class: 'button small', href: url.replace(/^https:/, 'webcal:') }, 'Подписаться'),
          el('button', {
            type: 'button', class: 'button small danger',
            onclick: () => { if (confirm('Выпустить новую ссылку? Старая перестанет работать во всех календарях, где она добавлена.')) load(true); }
          }, 'Новая ссылка')),
        el('p', { class: 'note' }, 'Outlook: «Добавить календарь» → «Из Интернета». iPhone и Mac: «Подписаться» или «Календарь» → «Новая подписка». Google Календарь: «Другие календари» → «+» → «По URL». Календари обновляют подписку сами, обычно раз в несколько часов.'),
        el('p', { class: 'note warn' }, 'Ссылка личная: по ней видны брони и клиенты. Не передавайте её. Если она попала не туда — выпустите новую.'));
    } catch (err) {
      if (err.code === 'unauthenticated') return sessionExpired();
      out.replaceChildren(el('p', { class: 'note warn' }, err.message));
    }
  };
  box.replaceChildren(
    el('h3', {}, 'Календарь по ссылке'),
    el('p', { class: 'muted' }, 'Брони в Outlook, iPhone, Google Календаре — подпиской по ссылке, обновляется само.'),
    out);
  out.replaceChildren(el('button', { type: 'button', class: 'button small', onclick: () => load(false) }, 'Показать ссылку'));
}
$('account-close').addEventListener('click', () => $('account-dialog').close());
async function leave(allDevices) {
  if (allDevices && !confirm('Выйти на всех устройствах? На каждом из них нужно будет войти заново.')) return;
  clearCache();
  await signOut(allDevices);
  location.reload();
}
$('sign-out-here').addEventListener('click', () => leave(false));
$('sign-out-all').addEventListener('click', () => leave(true));
// Выбор оборудования: на широком экране — колонкой справа, на телефоне — под составом брони.
const WIDE = window.matchMedia('(min-width: 1000px)');

function setPickerOpen(open) {
  $('picker-wrap').hidden = !open;
  $('booking-layout').classList.toggle('with-picker', open);
  document.body.classList.toggle('wide-main', open);
}

// На телефоне «+ Добавить» — переход к выбору (и открытие, если его закрыли «Готово»).
$('add-gear').addEventListener('click', () => {
  if ($('picker-wrap').hidden) {
    setPickerOpen(true);
    $('picker').replaceChildren(el('p', { class: 'muted' }, 'Загрузка…'));
    refreshPicker();
  }
  $('picker-wrap').scrollIntoView({ behavior: 'smooth' });
  $('picker-wrap').querySelector('input[type="search"]')?.focus({ preventScroll: true });
});
$('picker-done').addEventListener('click', () => {
  setPickerOpen(false);
  if (!WIDE.matches) $('booking-lines').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('booking-form').addEventListener('change', (e) => {
  if (e.target.name === 'start' && $('booking-form').elements.end.value < e.target.value) {
    $('booking-form').elements.end.value = e.target.value;
  }
  if (['start', 'start_half', 'end', 'end_half'].includes(e.target.name)) refreshPicker();
  if (['start', 'start_half', 'end', 'end_half', 'contract'].includes(e.target.name)) renderLines(); // цены и итоги
});
$('booking-form').elements.shifts.addEventListener('input', renderPriceSummary);
$('save-draft').addEventListener('click', () => save('draft'));
{
  const input = $('booking-form').elements.client_name;
  input.addEventListener('input', onClientInput);
  input.addEventListener('focus', showClientOptions);
  input.addEventListener('click', showClientOptions);
  input.addEventListener('keydown', onClientKey);
  input.addEventListener('blur', hideClientOptions);
}
$('save-confirm').addEventListener('click', () => save(editor.booking?.status === 'out' ? 'out' : 'confirmed'));
$('cancel-booking').addEventListener('click', cancelBooking);
$('issue-booking').addEventListener('click', () => startIssue('out'));
$('return-booking').addEventListener('click', () => startIssue('return'));
$('scan-close').addEventListener('click', closeScan);
$('scan-dialog').addEventListener('cancel', (e) => { e.preventDefault(); closeScan(); });

// Крестик очистки у всех полей поиска (в Firefox своего нет). Поля создаются модулями по ходу работы —
// новые находятся наблюдателем за страницей; обработчики модулей на поле сохраняются (поле то же самое).
{
  const enhance = (input) => {
    if (input.dataset.clear) return;
    input.dataset.clear = '1';
    const wrap = el('span', { class: 'search-clear-wrap' });
    const btn = el('button', { type: 'button', class: 'search-clear', 'aria-label': 'Очистить поиск', tabindex: '-1' }, '✕');
    const sync = () => { btn.hidden = !input.value; };
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // фокус остаётся в поле
    btn.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      sync();
      input.focus();
    });
    input.addEventListener('input', sync);
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input, btn);
    sync();
  };
  const scan = (root) => root.querySelectorAll?.('input[type="search"]').forEach(enhance);
  scan(document);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    if (n.matches('input[type="search"]')) enhance(n);
    else scan(n);
  }))).observe(document.body, { childList: true, subtree: true });
}

// Нажатие вне окна (на затемнённый фон) — как Esc: событие cancel, его обрабатывает само окно
// (сканер останавливает камеру, инвентарь возвращается к предыдущему окну). Нажатие должно и начаться,
// и закончиться снаружи — иначе выделение текста мышью из окна наружу закрыло бы его.
{
  let downOutside = null;
  const outside = (dlg, e) => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  document.addEventListener('pointerdown', (e) => {
    const dlg = e.target;
    downOutside = dlg instanceof HTMLDialogElement && dlg.open && outside(dlg, e) ? dlg : null;
  }, true);
  document.addEventListener('click', (e) => {
    const dlg = e.target;
    if (!(dlg instanceof HTMLDialogElement) || dlg !== downOutside || !dlg.open || !outside(dlg, e)) return;
    downOutside = null;
    if (dlg.dispatchEvent(new Event('cancel', { cancelable: true }))) dlg.close();
  }, true);
}
$('scan-manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = e.target.elements.code;
  const code = normalizeCode(input.value);
  input.value = '';
  if (code) scan.onCode?.(resolveCode(code));
});
$('free-form').addEventListener('change', loadFree);
$('free-create').addEventListener('click', createFromFree);
window.addEventListener('hashchange', route);

// ---------- без сети ----------

function renderConnection() {
  const { offline, at } = connection.state;
  const bar = $('offline-bar');
  bar.hidden = !offline;
  if (!offline) return;
  const when = at ? new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  bar.textContent = `Нет связи${when ? ` · данные на ${when}` : ''} · изменения недоступны`;
}

connection.addEventListener('change', renderConnection);
window.addEventListener('online', () => { if (catalog) route(); });
window.addEventListener('offline', () => { if (catalog) route(); });

if ('serviceWorker' in navigator && location.protocol === 'https:' && !isDemo()) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Устройство, где уже входили: название ярлыка обновляется сразу, не дожидаясь сервера.
{
  const saved = !isDemo() && readProfile()?.title;
  if (saved) savePersonalManifest(saved);
}

if (isDemo()) {
  onUser({ name: 'Демо-режим' });
} else if (!CONFIG.GOOGLE_CLIENT_ID || !CONFIG.API_URL) {
  showMessage('Приложение ещё не настроено.');
} else {
  // Есть сессия — приложение открывается сразу (и без сети); нет — кнопка входа Google.
  if (!getUser()) $('signin').hidden = false;
  initAuth($('gsi-button'), onUser, showMessage).catch((err) => showMessage(err.message));
}
