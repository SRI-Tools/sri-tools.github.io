import { runInBackground, whenIdle, toast } from './background.js';

import { PRICE_FREE, cat, editable, field, fmtNum, formButtons, goBack, ownerLabel, ownerOptions, owners, pricePicker, refreshAfterSave, resetPriceList, selectEl, showDialog, state, statusBadge, subtypeOptions, suggestField, usedValues } from './inventory/shared.js';
import { openItem, openStock } from './inventory/cards.js';
import { openItemForm } from './inventory/item-form.js';
import { NEW_BAND, bandPicker, bandShort, bandsHead, ownersHead, renderBands, renderOwners } from './inventory/directories.js';
import { kitsHead, renderKits } from './inventory/kit-rules.js';

// Экран «Инвентарь»: список позиций и расходников, сворачиваемые разделы, режим выбора и групповые действия.
// Карточки, формы, правила комплектов и справочники — в web/inventory/*.js.
// Названия категорий, типов и т. п. приходят из каталога — здесь нет ничего о конкретном оборудовании.

export function renderInventory(container, ctx) {
  state.ctx = ctx;
  state.container = container;
  state.view = 'list';
  render();
}

export function render() {
  const { el } = state.ctx;
  state.dialog = el('dialog', { class: 'inv-dialog' });
  // Esc, ✕ и нажатие вне окна — шаг назад: из формы правки к карточке, из карточки — закрыть.
  state.dialog.addEventListener('cancel', (e) => { e.preventDefault(); goBack(); });
  // Несохранённые правки в форме — спросить, прежде чем уйти.
  state.dialog.addEventListener('input', () => { state.dirty = true; });
  state.body = el('div', { class: 'inv-body' });
  state.selBar = el('div', { class: 'inv-select-fab', hidden: true });
  const heads = { kits: kitsHead, owners: ownersHead, bands: bandsHead };
  state.container.replaceChildren((heads[state.view] || listHead)(), state.body, state.selBar, state.dialog);
  if (state.view === 'kits') renderKits();
  else if (state.view === 'owners') renderOwners();
  else if (state.view === 'bands') renderBands();
  else renderList();
}

// Фильтры списка (пусто — все): владелец — у позиций и расходников; статус — у позиций,
// у расходников статуса нет, они считаются «в строю».
export const byOwner = (list) => (state.owner ? list.filter((x) => x.owner === state.owner) : list);

export const itemStatus = (i) => i.status || 'active';

export const filterItems = (list) => byOwner(list).filter((i) => (!state.status || itemStatus(i) === state.status)
  && (state.price !== 'none' || !i.price_name));

export const filterStock = (list) => (!state.price && (!state.status || state.status === 'active') ? byOwner(list) : []);

// ---------- список ----------

export function listHead() {
  const { el, scanWhere } = state.ctx;
  const search = el('input', {
    type: 'search', placeholder: 'Поиск: название, код, метка, серийный номер', value: state.q, 'aria-label': 'Поиск',
    oninput: (e) => { state.q = e.target.value; renderList(); }
  });
  const toolbar = el('div', { class: 'toolbar search-row' }, search,
    el('button', { class: 'button', type: 'button', onclick: () => scanWhere() }, 'Скан'));
  const actions = editable() && el('div', { class: 'inv-actions' },
    el('button', { class: 'button small primary', type: 'button', onclick: () => openItemForm(null) }, '+ Добавить'),
    el('button', { class: 'button small', type: 'button', onclick: () => { state.view = 'kits'; render(); } }, 'Комплекты'),
    el('button', { class: 'button small', type: 'button', onclick: () => { state.view = 'owners'; render(); } }, 'Владельцы'),
    el('button', { class: 'button small', type: 'button', onclick: () => { state.view = 'bands'; render(); } }, 'Диапазоны'));
  if (state.owner && !owners().some((o) => o.code === state.owner)) state.owner = '';
  const filter = (title, options, key) => {
    const sel = selectEl('', [['', 'все'], ...options], state[key]);
    sel.addEventListener('change', () => { state[key] = sel.value; renderList(); });
    return el('label', { class: 'inv-filter' }, title, sel);
  };
  const statuses = Object.entries(cat().itemStatuses || { active: 'в строю', repair: 'в ремонте', retired: 'списано' });
  state.foldBtn = el('button', { class: 'button small inv-fold-all', type: 'button', hidden: true, onclick: toggleFoldAll }, 'Свернуть всё');
  const filters = el('div', { class: 'inv-filters' },
    filter('Статус', statuses, 'status'),
    owners().length > 1 && filter('Владелец', ownerOptions(), 'owner'),
    filter('Прейскурант', [['none', 'не привязано']], 'price'),
    sortPicker(),
    state.foldBtn);
  // display: contents — строка поиска закрепляется (sticky) относительно всего экрана, а не этого блока
  return el('div', { class: 'inv-head' }, toolbar, actions, filters);
}

export function renderList() {
  const q = state.q.trim().toLowerCase();
  state.body.replaceChildren(...(q ? searchList(q) : groupedList()));
  if (state.select) refreshChecks(); // галочки заголовков: всё / часть / ничего
  else renderSelectBar();
  renderFoldAll();
  measureHead();
}

// ---------- прейскурант ----------
// Таблица цен владельца; список для выбора загружается при открытии формы (кэш — минута).

export function toggleSelectMode() {
  state.select = state.select ? null : new Set();
  state.lastPicked = null;
  render();
}

// Позиции, видимые сейчас в списке (после поиска и фильтров, не в свёрнутых разделах), — по галочкам на экране.
export function visibleIds() {
  return [...state.body.querySelectorAll('input.inv-check')].filter((c) => !c.closest('details:not([open])')).map((c) => c.value);
}

// Плавающая панель выбора слева внизу: вне режима — «Выбрать», в режиме — счётчик и кнопки действий в ряд.
export function renderSelectBar() {
  const { el } = state.ctx;
  const bar = state.selBar;
  if (!bar) return;
  bar.hidden = !editable() || state.view !== 'list';
  if (bar.hidden) return bar.replaceChildren();
  if (!state.select) {
    return bar.replaceChildren(el('button', { class: 'button inv-fab-main', type: 'button', onclick: toggleSelectMode }, '☑ Выбрать'));
  }
  // отмеченные, которых больше нет в каталоге (удалены, сменили код), — убираем
  const known = new Set([...(cat().items || []), ...(cat().stock || [])].map((i) => i.id));
  [...state.select].forEach((id) => { if (!known.has(id)) state.select.delete(id); });
  const n = state.select.size;
  const visible = visibleIds();
  const allVisible = visible.length > 0 && visible.every((id) => state.select.has(id));
  const btn = (text, onclick, disabled = false, cls = '') =>
    el('button', { class: `button ${cls}`, type: 'button', onclick, disabled }, text);
  bar.replaceChildren(el('div', { class: 'inv-fab-row' },
    el('button', { class: 'button inv-fab-close', type: 'button', 'aria-label': 'Завершить выбор', title: 'Завершить выбор', onclick: toggleSelectMode }, '✕'),
    el('span', { class: 'inv-fab-count' }, `Выбрано: ${n}`),
    // Одна кнопка: выделить показанное; если оно уже всё выделено — снять с него выделение.
    allVisible
      ? btn(`Снять выделение (${visible.length})`, () => { visible.forEach((id) => state.select.delete(id)); renderList(); })
      : btn(`Выделить найденные (${visible.length})`, () => { visible.forEach((id) => state.select.add(id)); renderList(); }, !visible.length),
    btn('Изменить…', () => openBatchForm([...state.select]), !n, 'primary'),
    btn('Подобрать прейскурант', () => suggestPrices([...state.select]), !n),
    btn('Удалить…', () => deleteRecords([...state.select]), !n, 'danger')));
}

// Shift — все строки от последней нажатой до этой (в порядке на экране) получают то же состояние.
export function toggleSelected(id, on, range) {
  const visible = visibleIds();
  const from = range && state.lastPicked ? visible.indexOf(state.lastPicked) : -1;
  const to = visible.indexOf(id);
  const ids = from >= 0 && to >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  ids.forEach((x) => (on ? state.select.add(x) : state.select.delete(x)));
  state.lastPicked = id;
  state.shift = false;
  refreshChecks();
}

// Галочки строк и заголовков разделов — по state.select; меню выбора — заново.
export function refreshChecks() {
  state.body.querySelectorAll('input.inv-check').forEach((c) => {
    c.checked = state.select.has(c.value);
    c.closest('label')?.classList.toggle('checked', c.checked);
  });
  state.body.querySelectorAll('.inv-group-box').forEach((wrap) => {
    const box = wrap.querySelector('input.inv-group-check');
    const ids = wrap.groupIds();
    const n = ids.filter((x) => state.select.has(x)).length;
    box.checked = ids.length > 0 && n === ids.length;
    box.indeterminate = n > 0 && n < ids.length;
    box.parentElement.setAttribute('aria-checked', box.indeterminate ? 'mixed' : String(box.checked));
  });
  renderSelectBar();
}

// Строки списка (ul) — коды по галочкам.
export function listIds(list) {
  return list ? [...list.querySelectorAll('input.inv-check')].map((c) => c.value) : [];
}

// Галочка «всё сразу» (у заголовка раздела, у «Найдено: N»): getIds — какие строки она отмечает.
// Нажатие не сворачивает раздел. Состояние (всё / часть / ничего) выставляет refreshChecks.
export function groupCheck(label, getIds) {
  const { el } = state.ctx;
  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleGroup(getIds());
  };
  const wrap = el('span', {
    class: 'inv-group-box', role: 'checkbox', tabindex: 0, 'aria-label': label, 'aria-checked': 'false',
    onclick: toggle,
    onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') toggle(e); }
  }, el('input', { type: 'checkbox', class: 'inv-group-check', tabindex: -1, 'aria-hidden': 'true' }));
  wrap.groupIds = getIds;
  return wrap;
}

// Всё из ids отмечено — снять, иначе отметить всё.
export function toggleGroup(ids) {
  const all = ids.length > 0 && ids.every((x) => state.select.has(x));
  ids.forEach((x) => (all ? state.select.delete(x) : state.select.add(x)));
  state.lastPicked = null;
  refreshChecks();
}

// Общее значение поля у позиций или undefined, если значения разные.
export function commonValue(items, key) {
  const vals = new Set(items.map((i) => String(i[key] ?? '')));
  return vals.size === 1 ? [...vals][0] : undefined;
}

// Форма групповой правки: только поля, общие по смыслу. Одинаковое у всех — уже заполнено, разное — пусто
// с пометкой «разные». Отправляются только изменённые поля.
export function openBatchForm(ids) {
  const { el } = state.ctx;
  const c = cat();
  const items = ids.map((id) => (c.items || []).find((i) => i.id === id) || (c.stock || []).find((s) => s.id === id)).filter(Boolean);
  if (!items.length) return;
  // Есть расходники — только общие поля: владелец и прейскурант.
  const stockCount = items.filter((i) => !(c.items || []).some((x) => x.id === i.id)).length;
  const onlyCommon = stockCount > 0;
  const changed = new Set();
  const KEEP = '__keep__';
  const mark = (name) => () => changed.add(name);
  const differ = (key) => commonValue(items, key) === undefined;
  const note = (key) => (differ(key) ? el('span', { class: 'note' }, 'Сейчас разные — оставьте пустым, чтобы не менять') : null);
  const text = (key, attrs = {}) => {
    const input = el('input', { name: key, value: commonValue(items, key) ?? '', placeholder: differ(key) ? 'разные' : '', autocomplete: 'off', ...attrs });
    input.addEventListener('input', mark(key));
    input.addEventListener('change', mark(key));
    return input;
  };
  // Списки — по умолчанию «не менять»; что сейчас — подсказкой под полем.
  const choice = (key, options) => {
    const sel = selectEl(key, [[KEEP, '— не менять —'], ...options], KEEP);
    sel.addEventListener('change', mark(key));
    return sel;
  };
  const nowNote = (key, names) => {
    const common = commonValue(items, key);
    const label = common === undefined ? 'разные' : `у всех: ${common === '' ? '—' : names(common)}`;
    return el('span', { class: 'note' }, `Сейчас ${label}`);
  };

  const owner = choice('owner', ownerOptions());
  const category = choice('category', Object.entries(c.categories || {}));
  // типы — те, что бывают в категориях выбранных позиций или в новой категории (сервер проверит каждую)
  // (у категорий с единственным типом выбора нет: тип ставится сам — subtypeAuto)
  const typesFor = (cats) => [...new Set(cats.filter((k) => !c.subtypeAuto?.[k])
    .flatMap((k) => subtypeOptions(k).map(([t]) => t)).filter(Boolean))];
  const typeKeys = typesFor(items.map((i) => i.category));
  const subtype = choice('subtype', [['', '— (без типа)'], ...typeKeys.map((k) => [k, c.subtypes?.[k] || k])]);
  const subtypeField = field('Тип', subtype, nowNote('subtype', (v) => c.subtypes?.[v] || v));
  subtypeField.hidden = !typeKeys.length;
  const codeNote = el('span', { class: 'note warn', hidden: true });
  category.addEventListener('change', () => {
    const moving = category.value !== KEEP ? items.filter((i) => i.category !== category.value) : [];
    codeNote.hidden = !moving.length;
    codeNote.textContent = `Коды сменятся у ${moving.length} поз. — во всех бронях тоже. Этикетки нужно перепечатать.`;
    const keys = category.value === KEEP ? typeKeys : typesFor([category.value]);
    subtype.replaceChildren(...[[KEEP, '— не менять —'], ['', '— (без типа)'], ...keys.map((k) => [k, c.subtypes?.[k] || k])]
      .map(([v, t]) => el('option', { value: v }, t)));
    subtypeField.hidden = !keys.length;
  });
  const maker = text('manufacturer');
  const model = text('model');
  const country = text('origin_country');
  const value = text('value_rub', { inputmode: 'decimal' });
  const price = pricePicker('', true);
  price.addEventListener('change', mark('price_name'));
  const allRf = items.every((i) => i.category === 'RF');
  // поля категории — когда выбраны позиции одной категории: у удочек — длина
  const allBoom = items.every((i) => i.category === 'BOOM');
  const length = allBoom ? text('length_m', { inputmode: 'decimal', placeholder: differ('length_m') ? 'разные' : '3,5' }) : null;
  if (length && length.value) length.value = length.value.replace('.', ',');
  const series = allRf ? text('series') : null;
  const band = allRf ? bandPicker(commonValue(items, 'band') ?? '', maker) : null;
  band?.select.addEventListener('change', () => { if (band.select.value !== NEW_BAND) changed.add('band'); });

  const err = el('div');
  const form = el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      const set = {};
      const read = { owner, category, subtype, manufacturer: maker, model, origin_country: country, value_rub: value, series, band: band?.select, price_name: price, length_m: length };
      changed.forEach((k) => {
        const v = read[k]?.value;
        if (v === undefined || v === KEEP || v === NEW_BAND) return;
        set[k] = v.trim();
      });
      if (!Object.keys(set).length) {
        err.replaceChildren(el('div', { class: 'notice warn' }, 'Ничего не изменено'));
        return;
      }
      const moving = set.category ? items.filter((i) => i.category !== set.category).length : 0;
      if (moving && !confirm(`Сменятся коды у ${moving} поз. (новая категория — новые номера).\nСтарые этикетки нужно будет перепечатать. Сохранить?`)) return;
      saveBatch(items.map((i) => i.id), set);
    }
  },
  el('p', { class: 'muted' }, `Выбрано: ${items.length}. ${items.slice(0, 6).map((i) => i.id).join(', ')}${items.length > 6 ? '…' : ''}`),
  onlyCommon && el('p', { class: 'note' }, `Среди выбранных есть расходники (${stockCount}) — меняются только владелец и прейскурант.`),
  onlyCommon ? field('Владелец', owner, nowNote('owner', ownerLabel)) : el('div', { class: 'inv-grid' },
    field('Категория', category, el('div', {}, nowNote('category', (v) => c.categories?.[v] || v), codeNote)),
    field('Владелец', owner, nowNote('owner', ownerLabel))),
  !onlyCommon && subtypeField,
  !onlyCommon && el('div', { class: 'inv-grid' },
    suggestField('Производитель', maker, () => usedValues('manufacturer')),
    field('Модель', model, note('model'))),
  !onlyCommon && el('div', { class: 'inv-grid' },
    suggestField('Страна', country, () => usedValues('origin_country')),
    field('Стоимость, ₽', value, note('value_rub'))),
  field('Прейскурант', price),
  !onlyCommon && allBoom && field('Длина, м', length, note('length_m')),
  !onlyCommon && allRf && el('div', {}, field('Диапазон', band.select, band.note), band.newBox),
  !onlyCommon && allRf && field('Серия', series, note('series')),
  !onlyCommon && !allRf && !allBoom && el('p', { class: 'note' }, 'Поля категории (длина удочек, диапазон и серия радиосистем) — когда выбраны позиции одной категории.'),
  err,
  formButtons(`Применить к ${items.length}`, () => goBack()));
  showDialog(`Изменить выбранные (${items.length})`, form);
}

// Заново привязать выбранные позиции к прейскуранту по названию (после правки прейскуранта).
export function suggestPrices(ids) {
  resetPriceList(); // список для форм — тоже свежий
  const send = () => runInBackground({
    label: `прейскурант для ${ids.length} поз.`,
    task: () => state.ctx.call('items_price_suggest', { ids }),
    onDone: (res) => {
      const shown = res.changes.slice(0, 5).map((c) => `${c.id}: ${c.to === PRICE_FREE ? 'бесплатно' : c.to}`).join('; ');
      toast({
        kind: res.changed ? 'ok' : 'warn',
        text: res.changed ? `Привязано заново: ${res.changed}. ${shown}${res.changed > 5 ? '…' : ''}` : 'Ничего не изменилось — подходящих новых строк в прейскуранте нет',
        timeout: res.changed ? 8000 : 0
      });
      whenIdle('inventory', refreshAfterSave);
    },
    onError: (err) => {
      if (err.code === 'unauthenticated') return;
      toast({ kind: 'bad', text: `Прейскурант не подобран: ${err.message}`, actions: [{ text: 'Повторить', onClick: send }] });
    }
  });
  send();
}

// Одним запросом в фоне; правка сразу видна в списке.
export function saveBatch(ids, set) {
  const items = [...(cat().items || []), ...(cat().stock || [])];
  ids.forEach((id) => {
    const local = items.find((i) => i.id === id);
    if (local) Object.assign(local, Object.fromEntries(Object.entries(set).filter(([k]) => k !== 'owner' && k !== 'category')));
  });
  state.dialog.close();
  renderList();
  const send = () => runInBackground({
    label: `${ids.length} поз.`,
    task: () => state.ctx.call('items_batch', { ids, set }),
    onDone: (res) => {
      Object.entries(res.renamed || {}).forEach(([from, to]) => {
        if (state.select?.delete(from)) state.select.add(to);
      });
      toast({ kind: 'ok', text: res.changed ? `Изменено позиций: ${res.changed}` : 'Всё уже было так — ничего не изменено' });
      whenIdle('inventory', refreshAfterSave);
    },
    onError: (err) => {
      if (err.code === 'unauthenticated') return;
      toast({
        kind: 'bad', text: `Не сохранено — групповая правка (${ids.length} поз.): ${err.message}`,
        actions: [{ text: 'Повторить', onClick: send }]
      });
      whenIdle('inventory', refreshAfterSave);
    }
  });
  send();
}

// Сортировка строк внутри разделов: по коду (номер по числу: RF2 раньше RF10) или по названию (по алфавиту).
const SORT_KEY = 'inv-sort';
function sortMode() {
  if (state.sort) return state.sort;
  try {
    state.sort = localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'code';
  } catch {
    state.sort = 'code';
  }
  return state.sort;
}

// «Сортировать: по коду / по названию» — текстом, выбранный вариант выделен.
function sortPicker() {
  const { el } = state.ctx;
  const box = el('span', { class: 'inv-filter inv-sort', role: 'radiogroup', 'aria-label': 'Сортировка' });
  const draw = () => {
    const opt = (mode, text) => el('button', {
      type: 'button', class: `inv-sort-opt${sortMode() === mode ? ' on' : ''}`,
      role: 'radio', 'aria-checked': String(sortMode() === mode),
      onclick: () => {
        if (sortMode() === mode) return;
        state.sort = mode;
        try {
          localStorage.setItem(SORT_KEY, mode);
        } catch {
          // хранилище недоступно — порядок до перезагрузки
        }
        draw();
        renderList();
      }
    }, text);
    box.replaceChildren('Сортировать:', opt('code', 'по коду'), el('span', { 'aria-hidden': 'true' }, '/'), opt('name', 'по названию'));
  };
  draw();
  return box;
}

const byCode = (a, b) => String(a.id).localeCompare(String(b.id), 'ru', { numeric: true });
function sorted(list) {
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru', { numeric: true, sensitivity: 'base' }) || byCode(a, b);
  return list.slice().sort(sortMode() === 'name' ? byName : byCode);
}

export function groupedList() {
  const { el } = state.ctx;
  const c = cat();
  const items = sorted(filterItems(c.items || []));
  const stock = sorted(filterStock(c.stock || []));
  const out = [];
  // Без фильтра статуса списанное — отдельной свёрнутой группой в конце; с фильтром — по категориям.
  const inGroups = (i) => state.status || i.status !== 'retired';
  Object.entries(c.categories || {}).forEach(([code, title]) => {
    const list = items.filter((i) => i.category === code && inGroups(i));
    if (list.length) out.push(foldGroup(`item:${code}`, title, list.map((i) => itemRow(i))));
  });
  const known = new Set(Object.keys(c.categories || {}));
  const orphans = items.filter((i) => !known.has(i.category) && inGroups(i));
  if (orphans.length) out.push(foldGroup('item:', 'Без категории', orphans.map((i) => itemRow(i))));
  Object.entries(c.stockCategories || {}).forEach(([code, title]) => {
    const list = stock.filter((s) => s.category === code);
    if (list.length) out.push(foldGroup(`stock:${code}`, title, list.map((s) => stockRow(s))));
  });
  const retired = state.status ? [] : items.filter((i) => i.status === 'retired');
  if (retired.length) out.push(foldGroup('retired', 'Списано', retired.map((i) => itemRow(i)), false));
  if (!out.length) out.push(el('p', { class: 'muted' }, state.status || state.owner ? 'Ничего не найдено.' : 'Инвентарь пуст.'));
  return out;
}

// ---------- сворачиваемые разделы списка ----------
// Что свёрнуто, а что развёрнуто, помнит браузер (только для удобства этого устройства).

export const FOLD_KEY = 'inv-folds';

export let folds = null; // { ключ раздела: true — развёрнут, false — свёрнут }

export function foldState() {
  if (folds) return folds;
  try {
    folds = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {};
  } catch {
    folds = {};
  }
  return folds;
}

export function saveFolds() {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
  } catch {
    // хранилище недоступно — состояние живёт до перезагрузки
  }
}

// Раздел со сворачиваемым заголовком; byDefault — развёрнут ли, пока его не трогали.
export function foldGroup(key, title, rows, byDefault = true) {
  const { el } = state.ctx;
  const f = foldState();
  // В режиме выбора — галочка у заголовка: отметить весь раздел (и свёрнутый).
  const list = el('ul', { class: 'list' }, rows);
  const groupBox = state.select ? groupCheck(`Выбрать всё: ${title}`, () => listIds(list)) : null;
  const node = el('details', { class: 'group inv-fold', open: f[key] ?? byDefault, 'data-fold': key },
    // галочка (в режиме выбора) — слева, стрелка свернуть/развернуть — после неё
    el('summary', {}, el('h2', {}, groupBox, el('span', { class: 'inv-fold-arrow', 'aria-hidden': 'true' }, '▾'), title,
      el('span', { class: 'count' }, String(rows.length)))),
    list);
  node.addEventListener('toggle', () => {
    f[key] = node.open;
    scheduleFoldSync();
  });
  return node;
}

// Высота закреплённой шапки (заголовок + вкладки) — для плавающей «Свернуть всё»: шрифты и масштаб
// у всех разные, фиксированный отступ залезал на вкладки.
export const headObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measureHead()) : null;

export const observed = new WeakSet();

export function measureHead() {
  // закреплённое сверху: заголовок, вкладки, жёлтая плашка «офлайн» (когда видна)
  const fixed = [...document.querySelectorAll('.topbar, .tabs, .offline-bar')];
  // шапка рисуется после входа — следить за её размером с первого замера (плашка появляется и скрывается)
  fixed.forEach((n) => {
    if (headObserver && !observed.has(n)) {
      observed.add(n);
      headObserver.observe(n);
    }
  });
  // при прокрутке низ закреплённого — top + высота; до прокрутки — где оно стоит сейчас
  const bottom = fixed.filter((n) => n.offsetHeight).reduce((max, n) => Math.max(max,
    (parseFloat(getComputedStyle(n).top) || 0) + n.offsetHeight, n.getBoundingClientRect().bottom), 0);
  if (bottom) document.documentElement.style.setProperty('--head-h', `${Math.round(bottom)}px`);
}

// Кнопка «Свернуть всё / Развернуть всё»: если хоть один раздел открыт — свернуть все, иначе развернуть.
export function renderFoldAll() {
  const btn = state.foldBtn;
  if (!btn) return;
  const all = [...state.body.querySelectorAll('details.inv-fold')];
  btn.hidden = !all.length;
  btn.textContent = all.some((d) => d.open) ? 'Свернуть всё' : 'Развернуть всё';
}

export function toggleFoldAll() {
  const all = [...state.body.querySelectorAll('details.inv-fold')];
  const open = !all.some((d) => d.open);
  const f = foldState();
  all.forEach((d) => {
    f[d.dataset.fold] = open;
    d.open = open;
  });
  scheduleFoldSync();
}

// После сворачивания (одного раздела или всех сразу — события toggle приходят пачкой) — один раз:
// запомнить, обновить кнопку и меню выбора («Выделить найденные» — только по развёрнутым).
export let foldSync = null;

export function scheduleFoldSync() {
  if (foldSync) return;
  foldSync = setTimeout(() => {
    foldSync = null;
    saveFolds();
    renderFoldAll();
    if (state.select) renderSelectBar();
  }, 0);
}

export function group(title, rows) {
  const { el } = state.ctx;
  return el('section', { class: 'group' },
    el('h2', {}, title, el('span', { class: 'count' }, String(rows.length))),
    el('ul', { class: 'list' }, rows));
}

export function searchList(q) {
  const { el, rankResults } = state.ctx;
  const c = cat();
  const stock = filterStock(c.stock || []).map((s) => ({ ...s, category_name: c.stockCategories?.[s.category] || '' }));
  const items = rankResults(filterItems(c.items || []), q);
  // Без фильтра статуса списанное — отдельно, свёрнутым списком под основными результатами.
  const apart = (e) => !state.status && e.x.status === 'retired';
  const found = items.filter((e) => !apart(e)).map((e) => itemRow(e.x, e.r))
    .concat(rankResults(stock, q).map((e) => stockRow(e.x)));
  const retired = items.filter(apart).map((e) => itemRow(e.x, e.r));
  if (!found.length && !retired.length) return [el('p', { class: 'muted' }, 'Ничего не найдено.')];
  const list = found.length ? el('ul', { class: 'list' }, found) : null;
  return [
    // в режиме выбора — галочка «все найденные» (без свёрнутых списанных)
    el('p', { class: 'muted inv-found' },
      state.select && list ? groupCheck('Выбрать все найденные', () => listIds(list)) : null,
      `Найдено: ${found.length}${retired.length ? ` (и списанных: ${retired.length})` : ''}`),
    list,
    retired.length ? el('details', { class: 'group inv-retired' },
      el('summary', {}, `Списано (${retired.length})`),
      el('ul', { class: 'list' }, retired)) : null
  ].filter(Boolean);
}

// Строка в режиме выбора: вся строка — галочка (карточка не открывается).
export function selectRow(id, ...content) {
  const { el } = state.ctx;
  const box = el('input', { type: 'checkbox', class: 'inv-check', value: id });
  box.checked = state.select.has(id);
  box.addEventListener('change', () => toggleSelected(id, box.checked, state.shift));
  // Shift запоминается по нажатию на строку (и на саму галочку — событие всплывает сюда же).
  const row = el('label', { class: `row inv-select-row${box.checked ? ' checked' : ''}` },
    box, el('span', { class: 'code' }, id), ...content);
  row.addEventListener('click', (e) => {
    if (e.target === box) {
      state.shift = e.shiftKey; // нажали саму галочку — дальше сработает change
      return;
    }
    // Нажатие в любом месте строки обрабатываем сами: с Shift браузеры не всегда передают его галочке.
    e.preventDefault();
    box.checked = !box.checked;
    toggleSelected(id, box.checked, e.shiftKey);
  });
  return el('li', {}, row);
}

export function itemRow(i, rank) {
  const { el } = state.ctx;
  const extra = [i.length_m ? `${fmtNum(i.length_m)} м` : '', i.label, i.type_name, bandShort(i.band)].filter(Boolean).join(' · ');
  if (state.select) {
    return selectRow(i.id, el('span', { class: 'name' }, i.name, extra && el('span', { class: 'label' }, extra)), statusBadge(i.status));
  }
  return el('li', {}, el('button', { class: 'row', type: 'button', onclick: () => openItem(i.id) },
    el('span', { class: 'code' }, i.id),
    el('span', { class: 'name' }, i.name, extra && el('span', { class: 'label' }, extra),
      rank === 4 && el('span', { class: 'note' }, `серийный номер ${i.serial}`)),
    statusBadge(i.status)));
}

export function stockRow(s) {
  const { el } = state.ctx;
  const name = el('span', { class: 'name' }, s.name, s.length_m && el('span', { class: 'label' }, `${fmtNum(s.length_m)} м`));
  const qty = el('span', { class: 'qty' }, `${s.qty_total ?? 0} шт.`);
  if (state.select) return selectRow(s.id, name, qty);
  return el('li', {}, el('button', { class: 'row', type: 'button', onclick: () => openStock(s.id) },
    el('span', { class: 'code' }, s.id), name, qty));
}

// Удаление заведённого по ошибке: сервер удалит только то, что ни разу не было в бронях.
export function deleteRecords(ids) {
  const c = cat();
  const rows = ids.map((id) => (c.items || []).find((i) => i.id === id) || (c.stock || []).find((s) => s.id === id)).filter(Boolean);
  if (!rows.length) return;
  const names = rows.slice(0, 5).map((r) => `${r.id} ${r.name}`).join('\n');
  const text = rows.length === 1
    ? `Удалить «${rows[0].name}» (${rows[0].id})?`
    : `Удалить ${rows.length} шт.?\n${names}${rows.length > 5 ? '\n…' : ''}`;
  if (!confirm(`${text}\n\nУдаляется только то, что ни разу не было в бронях. Это нельзя отменить.`)) return;
  if (state.dialog.open) state.dialog.close();
  const send = () => runInBackground({
    label: `удаление (${rows.length})`,
    task: () => state.ctx.call('inventory_delete', { ids: rows.map((r) => r.id) }),
    onDone: (res) => {
      res.deleted.forEach((id) => state.select?.delete(id));
      if (res.deleted.length) toast({ kind: 'ok', text: `Удалено: ${res.deleted.join(', ')}` });
      res.kept.forEach((k) => toast({ kind: 'warn', text: `${k.name} (${k.id}) не удалён: ${k.reason}` }));
      whenIdle('inventory', refreshAfterSave);
    },
    onError: (err) => {
      if (err.code === 'unauthenticated') return;
      toast({ kind: 'bad', text: `Не удалено: ${err.message}`, actions: [{ text: 'Повторить', onClick: send }] });
    }
  });
  send();
}
