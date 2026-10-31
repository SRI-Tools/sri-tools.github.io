import { runInBackground, whenIdle, toast } from '../background.js';
import { queryVariants, setChildren } from '../format.js';
import { renderList } from '../inventory.js';
import { openItem, openStock } from './cards.js';
import { renderBands, renderOwners } from './directories.js';

// Инвентарь: общее состояние экрана, справочники из каталога, диалоги, фоновое сохранение,
// прейскурант и элементы форм — для всех модулей экрана.

export const ITEM_FIELDS = ['name', 'label', 'category', 'subtype', 'model', 'series', 'band', 'pair_no', 'serial',
  'manufacturer', 'origin_country', 'value_rub', 'notes', 'price_name', 'length_m'];

export const FIELD_NAMES = {
  name: 'Название', label: 'Метка', category: 'Категория', subtype: 'Тип', model: 'Модель', series: 'Серия',
  band: 'Диапазон', pair_no: 'Номер пары', serial: 'Серийный номер', manufacturer: 'Производитель',
  origin_country: 'Страна', value_rub: 'Стоимость, ₽', notes: 'Заметки', status: 'Статус', length_m: 'Длина, м',
  qty_total: 'Количество', length_m: 'Длина, м', id: 'Код', price_name: 'Прейскурант'
};

export const LOG_ACTIONS = {
  item_create: 'создана', item_update: 'изменена', item_status: 'смена статуса',
  stock_create: 'создан', stock_update: 'изменён', item_delete: 'удалена', stock_delete: 'удалён'
};

export const MATCH_NAMES = {
  same_series: 'та же серия (у одного производителя)', same_band: 'общие частоты', prefer_same_pair_no: 'по возможности тот же номер пары'
};

// Состояние экрана живёт между открытиями вкладки (поиск не сбрасывается).
export const state = { ctx: null, container: null, q: '', owner: '', status: '', price: '', view: 'list', body: null, dialog: null, shown: null, select: null, selBar: null };
// select — режим групповой правки: Set кодов отмеченных позиций (null — режим выключен).
// shown — что сейчас в окне: { kind: 'item' | 'stock', id } для карточки, null для формы и прочего.

export const cat = () => state.ctx.getCatalog() || {};

export const editable = () => state.ctx.can('inventory');

// Владельцы оборудования: код — окончание кода позиции (RF07-EMP).
export const owners = () => (cat().owners?.length ? cat().owners : [{ code: 'EMP', name: '' }]);

export const ownerLabel = (code) => {
  const o = owners().find((x) => x.code === code);
  return o?.name ? `${code} — ${o.name}` : code || '';
};

export const ownerOptions = () => owners().map((o) => [o.code, ownerLabel(o.code)]);

export const PRICE_FREE = '—';

export let priceList = null; // { prices: [{name, price, description, category}], at }

export async function loadPriceList() {
  if (priceList && Date.now() - priceList.at < 60_000) return priceList.prices;
  const res = await state.ctx.call('price_list');
  priceList = { prices: res.prices || [], at: Date.now() };
  return priceList.prices;
}

export function priceLabel(v) {
  if (!v) return state.ctx.el('span', { class: 'note warn' }, 'не привязано — цены нет');
  if (v === PRICE_FREE) return 'бесплатно / входит в комплект';
  const row = priceList?.prices.find((p) => p.name === v);
  return row ? `${v} — ${fmtNum(row.price)} ₽ в смену${row.free_with ? `; бесплатно вместе с: ${row.free_with}` : ''}` : v;
}

// Подсказка под выбором строки прейскуранта — по выбранному значению.
// stock — для расходника: не привязан — бесплатно (подбирается только строка с правилом «бесплатно вместе с»).
export function priceNote(select, stock = false) {
  const note = state.ctx.el('span', { class: 'note' });
  const update = () => {
    const row = priceList?.prices.find((p) => p.name === select.value);
    note.textContent = !select.value
      ? (stock ? 'Не привязан — бесплатно. Строка с правилом «бесплатно вместе с» подберётся по названию при сохранении'
        : 'Не привязано — строка подберётся по названию при сохранении')
      : select.value === PRICE_FREE ? 'Позиция не стоит денег — идёт в комплекте с основной'
        : row?.free_with ? `Цена за смену, если сдаётся отдельно; бесплатно вместе с: ${row.free_with} (по одной на каждую)`
          : 'Цена за смену — из этой строки прейскуранта';
  };
  select.addEventListener('change', update);
  update();
  return note;
}

// Выбор строки прейскуранта; keep — добавить «не менять» (групповая правка).
export function pricePicker(value, keep = false) {
  const { el } = state.ctx;
  const sel = el('select', { name: 'price_name' });
  const fill = (prices) => {
    const groups = new Map();
    prices.forEach((p) => {
      const g = p.category || 'Без раздела';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    });
    const known = !value || value === PRICE_FREE || prices.some((p) => p.name === value);
    sel.replaceChildren(
      ...(keep ? [el('option', { value: '__keep__' }, '— не менять —')] : []),
      el('option', { value: '' }, '— не привязано —'),
      el('option', { value: PRICE_FREE }, 'бесплатно / входит в комплект'),
      ...(known ? [] : [el('option', { value }, `${value} (нет в прейскуранте)`)]),
      ...[...groups].map(([g, rows]) => el('optgroup', { label: g },
        rows.map((p) => el('option', { value: p.name },
          `${p.name} — ${fmtNum(p.price)} ₽${p.free_with ? ` · бесплатно с: ${p.free_with}` : ''}`)))));
    sel.value = keep ? '__keep__' : value;
    sel.disabled = false;
  };
  sel.append(el('option', { value }, value ? `${value === PRICE_FREE ? 'бесплатно' : value} (загрузка списка…)` : 'Загрузка прейскуранта…'));
  sel.value = value;
  loadPriceList().then(fill).catch((e) => {
    sel.replaceChildren(el('option', { value }, value || '— не привязано —'));
    sel.title = `Прейскурант не загрузился: ${e.message}`;
  });
  return sel;
}

// ---------- групповая правка ----------

export function statusBadge(status) {
  if (status !== 'repair' && status !== 'retired') return null;
  return state.ctx.el('span', { class: `badge ${status}` }, cat().itemStatuses?.[status] || status);
}

// ---------- диалог ----------

export function showDialog(title, ...content) {
  const { el } = state.ctx;
  const dlg = state.dialog;
  state.shown = null;
  state.back = null;
  state.dirty = false;
  setChildren(dlg,
    el('div', { class: 'row-between inv-dialog-head' },
      el('h2', {}, title),
      el('button', { class: 'button small', type: 'button', 'aria-label': 'Закрыть', onclick: () => goBack() }, '✕')),
    content);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

// Форма, открытая из карточки: «назад» вернёт к этой карточке (со свежими данными).
export function showForm(title, ...content) {
  const parent = state.dialog.open ? state.shown : null;
  showDialog(title, ...content);
  if (parent) state.back = () => (parent.kind === 'item' ? openItem(parent.id) : openStock(parent.id));
}

// Шаг назад по окнам: к родительскому окну, если оно есть, иначе закрыть.
export function goBack() {
  if (state.dirty && !confirm('Закрыть без сохранения? Введённые изменения пропадут.')) return;
  const back = state.back;
  if (back) back();
  else state.dialog.close();
}

export function notices(list) {
  const { el } = state.ctx;
  return (list || []).map((n) => el('div', { class: `notice ${n.kind}` }, n.node || n.text));
}

// ---------- карточка позиции ----------

// Общий путь фонового сохранения позиции или расходника. При успехе: уведомление, обновлённый каталог
// и, если карточка ещё открыта, — она же со свежими данными. При ошибке: каталог перечитывается (локальная
// правка откатывается), уведомление с «Исправить» (fix — снова открыть форму) и «Повторить».
export function saveInBackground({ kind, id, label, task, done, fix, retry, created }) {
  runInBackground({
    label,
    task,
    onDone: (res) => {
      const r = done(res);
      (r.warnings || []).forEach((w) => toast({ kind: 'warn', text: w.message || String(w) }));
      toast({
        kind: 'ok', text: created ? `Создано: ${r.text || r.id}` : `Сохранено: ${r.text || r.id}`,
        actions: created ? [{ text: 'Открыть', onClick: () => (kind === 'stock' ? openStock(r.id) : openItem(r.id)) }] : []
      });
      whenIdle('inventory', refreshAfterSave);
      // код мог смениться (владелец) — карточку старого кода переключаем на новый
      if (id && r.id !== id && state.shown?.kind === kind && state.shown.id === id) state.shown.id = r.id;
    },
    onError: (err) => {
      if (err.code === 'unauthenticated') return;
      const actions = [];
      if (fix) actions.push({ text: 'Исправить', onClick: fix });
      if (retry) actions.push({ text: 'Повторить', onClick: retry });
      toast({ kind: 'bad', text: `Не сохранено — ${label}: ${err.message}`, actions });
      whenIdle('inventory', refreshAfterSave);
    }
  });
}

// После очереди сохранений: каталог с сервера, список и открытая карточка — заново.
export async function refreshAfterSave() {
  await state.ctx.reloadCatalog();
  if (state.view === 'list') renderList();
  else if (state.view === 'bands') renderBands();
  else if (state.view === 'owners') renderOwners();
  const shown = state.shown;
  if (state.dialog.open && shown) {
    if (shown.kind === 'item') openItem(shown.id);
    else openStock(shown.id);
  }
}

// ---------- карточка расходника ----------

// Каким станет код позиции после сохранения: другая категория — следующий свободный номер в ней
// (как на сервере), другой владелец — новое окончание.
export function nextItemCode(item, category, owner) {
  const m = /^([A-Z]+)(\d+)-([A-Z]+)$/.exec(item.id);
  if (!m) return item.id;
  const pad = (n) => String(n).padStart(2, '0');
  if (category && category !== m[1]) {
    const max = (cat().items || []).reduce((acc, i) => {
      const x = /^([A-Z]+)(\d+)-/.exec(i.id);
      return x && x[1] === category ? Math.max(acc, +x[2]) : acc;
    }, 0);
    return `${category}${pad(max + 1)}-${owner || m[3]}`;
  }
  return owner && owner !== m[3] ? `${m[1]}${m[2]}-${owner}` : item.id;
}

// Типы для категории: [[значение, подпись]]. Петличка — один тип без выбора, без типов — [['', '—']].
export function subtypeOptions(category) {
  const c = cat();
  const auto = c.subtypeAuto?.[category];
  if (auto) return [[auto, c.subtypes?.[auto] || auto]];
  const list = c.subtypesByCategory ? c.subtypesByCategory[category] || [] : Object.keys(c.subtypes || {});
  return [['', '—'], ...list.map((k) => [k, c.subtypes?.[k] || k])];
}

// Раздел новой записи: разделы оборудования и расходников в одном списке.
// Значения своего вида — как есть, другого — с префиксом; выбор другого вида вызывает switchTo(код).
export function categorySelect(kind, value, switchTo) {
  const { el } = state.ctx;
  const c = cat();
  const other = kind === 'item' ? 'stock' : 'item';
  const opts = (k, map) => Object.entries(map || {}).map(([code, title]) =>
    el('option', { value: k === kind ? code : `${k}:${code}` }, title));
  const groups = [
    el('optgroup', { label: 'Оборудование — у каждого экземпляра свой код' }, opts('item', c.categories)),
    el('optgroup', { label: 'Расходники — учёт количеством' }, opts('stock', c.stockCategories))
  ];
  const sel = el('select', { name: 'category' }, groups);
  sel.value = value || '';
  if (sel.selectedIndex < 0) sel.value = Object.keys((kind === 'item' ? c.categories : c.stockCategories) || {})[0] || '';
  sel.addEventListener('change', () => {
    if (sel.value.startsWith(`${other}:`)) switchTo(sel.value.slice(other.length + 1));
  });
  return sel;
}

export const MAX_COPIES = 50;

// Подсказка под выбором владельца: каким станет код (меняется только окончание).
export function ownerChangeNote(row, select) {
  const note = state.ctx.el('span', { class: 'note warn', hidden: true });
  if (!row) return note;
  const update = () => {
    const next = nextItemCode(row, '', select.value);
    note.hidden = next === row.id;
    note.textContent = `Код станет ${next} — во всех бронях тоже. Этикетку нужно перепечатать.`;
  };
  select.addEventListener('change', update);
  update();
  return note;
}

// ---------- производитель и модель из названия ----------

// Значения поля, уже встречающиеся у позиций: частые сверху, при равенстве — по алфавиту.
export function usedValues(key) {
  const counts = new Map();
  (cat().items || []).forEach((i) => {
    const v = String(i[key] ?? '').trim();
    if (!v) return;
    const k = v.toLowerCase();
    const e = counts.get(k) || { v, n: 0 };
    e.n++;
    counts.set(k, e);
  });
  return [...counts.values()].sort((a, b) => b.n - a.n || a.v.localeCompare(b.v, 'ru')).map((e) => e.v);
}

// Поле с подсказками: при нажатии — все значения из базы, при вводе — подходящие (и в другой раскладке).
// Выбор подставляет значение и отправляет input/change (на них завязаны другие поля формы).
export function suggestField(title, input, values) {
  const { el } = state.ctx;
  const list = el('ul', { class: 'ac-list', role: 'listbox', hidden: true });
  let active = -1;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  const hide = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  let picking = false;
  const pick = (v) => {
    input.value = v;
    hide();
    picking = true; // своё же событие input не должно снова открыть список
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    picking = false;
  };
  const show = (filter) => {
    const all = values();
    const vs = filter ? queryVariants(input.value) : [];
    const current = input.value.trim().toLowerCase();
    const shown = vs.length
      ? all.filter((v) => vs.some((q) => v.toLowerCase().includes(q)) && v.toLowerCase() !== current)
      : all;
    active = -1;
    list.replaceChildren(...shown.slice(0, 30).map((v) => el('li', {
      role: 'option', onmousedown: (e) => { e.preventDefault(); pick(v); }
    }, el('span', { class: 'ac-name' }, v))));
    list.hidden = !shown.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };

  input.addEventListener('focus', () => show(false));
  input.addEventListener('click', () => { if (list.hidden) show(false); });
  input.addEventListener('input', () => { if (!picking) show(true); });
  input.addEventListener('blur', hide);
  input.addEventListener('keydown', (e) => {
    const opts = [...list.children];
    if (e.key === 'Escape') return hide();
    if (e.key === 'ArrowDown' && list.hidden) { show(false); e.preventDefault(); return; }
    if (list.hidden || !opts.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('active', i === active));
      opts[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(opts[active].textContent);
    }
  });
  return el('div', { class: 'ac' }, field(title, input), list);
}

export function field(title, control, note) {
  return state.ctx.el('label', {}, title, control, note || null);
}

export function selectEl(name, options, value) {
  const { el } = state.ctx;
  const s = el('select', { name: name || null }, options.map(([v, t]) => el('option', { value: v }, t)));
  s.value = String(value ?? '');
  if (s.selectedIndex < 0 && options.length) s.selectedIndex = 0;
  return s;
}

export function formButtons(submitText, onCancel) {
  const { el } = state.ctx;
  return el('div', { class: 'inv-form-buttons' },
    el('button', { class: 'button primary', type: 'submit' }, submitText),
    el('button', { class: 'button', type: 'button', onclick: onCancel }, 'Отмена'));
}

export function setBusy(form, busy) {
  form.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
}

export function fmtNum(n) {
  const x = Number(String(n).replace(',', '.'));
  return Number.isFinite(x) ? x.toLocaleString('ru-RU') : String(n);
}

// Отметки выдачи/возврата: ISO или «yyyy-MM-dd HH:mm» → «03.10 14:20».
export function fmtStamp(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Прейскурант загрузить заново при следующем открытии формы.
export function resetPriceList() {
  priceList = null;
}
