import { renderList } from '../inventory.js';
import { MAX_COPIES, cat, categorySelect, field, fmtNum, formButtons, ownerChangeNote, ownerOptions, priceNote, pricePicker, saveInBackground, selectEl, showForm, state } from './shared.js';
import { openStock } from './cards.js';
import { openItemForm } from './item-form.js';

// Инвентарь: форма расходника — кабели (разъёмы, длина), носители (объём), штуки с разной длиной или объёмом.

export const OTHER = '__other__';

export function openStockForm(stock, draft = null) {
  const { el } = state.ctx;
  const c = cat();
  const isNew = !stock;
  const v = { ...(stock || { category: Object.keys(c.stockCategories || {})[0] || '', qty_total: 1 }), ...(draft || {}) };
  const err = el('div');
  const conns = c.connectors || [];
  const parsed = parseCableName(v.name || '');

  // У носителя объём — в конце названия («SanDisk Extreme PRO, 64 ГБ»); в поле — название без объёма.
  const name = el('input', { name: 'name', value: stripCapacity(v.name || '', v.capacity), required: true, autocomplete: 'off' });
  const capacity = el('input', { name: 'capacity', value: v.capacity || '', placeholder: '64 ГБ', autocomplete: 'off' });
  // Новая запись: выбор раздела оборудования переключает на форму позиции.
  const category = isNew
    ? categorySelect('stock', v.category, (code) => openItemForm(null, {
      category: code, name: name.value, owner: owner.value, notes: notes.value, qty: qty.value
    }))
    : selectEl('category', Object.entries(c.stockCategories || {}), v.category);
  const qty = el('input', { name: 'qty_total', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: v.qty_total ?? 0 });
  const length = el('input', { name: 'length_m', inputmode: 'decimal', value: v.length_m ? fmtNum(v.length_m) : '' });
  const notes = el('textarea', { name: 'notes', rows: 3 }, v.notes || '');
  const owner = selectEl('owner', ownerOptions(), v.owner || 'EMP');
  const price = pricePicker(v.price_name || '');
  const a = connectorPicker('Разъём A', conns, parsed?.a || '');
  const b = connectorPicker('Разъём B', conns, parsed?.b || '');

  // Название собирается из разъёмов и длины, пока его не переписали руками.
  let lastAuto = buildCableName(a.value(), b.value(), length.value);
  const rebuild = () => {
    if (category.value !== 'cable') return;
    const next = buildCableName(a.value(), b.value(), length.value);
    if (!name.value.trim() || name.value === lastAuto) name.value = next;
    lastAuto = next;
  };
  [a, b].forEach((p) => p.onChange(rebuild));
  length.addEventListener('input', rebuild);

  const lengthField = field('Длина, м', length);
  const cableBox = el('div', {}, el('div', { class: 'inv-grid' }, a.node, b.node), lengthField);
  const nameNote = state.ctx.el('span', { class: 'note' }, 'Собирается из разъёмов и длины — можно поправить.');
  const capacityField = field('Объём', capacity, el('span', { class: 'note' }, 'Допишется к названию: «…, 64 ГБ». Число без единиц — в гигабайтах.'));
  // Новый расходник в нескольких штуках: у кабелей — длина, у носителей — объём каждой.
  const variants = isNew ? stockVariants(qty, category, { cable: length, media: capacity }) : null;
  const update = () => {
    cableBox.hidden = nameNote.hidden = category.value !== 'cable';
    capacityField.hidden = category.value !== 'media' || Boolean(variants?.many());
    if (category.value === 'cable') lengthField.hidden = Boolean(variants?.many());
    variants?.render();
  };
  category.addEventListener('change', () => { update(); rebuild(); });
  qty.addEventListener('input', update);

  const form = el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      const cat_ = category.value;
      const media = cat_ === 'media';
      const data = {
        name: media ? withCapacity(name.value.trim(), capacity.value) : name.value.trim(), category: cat_, qty_total: qty.value.trim(),
        length_m: cat_ === 'cable' ? length.value.trim().replace(',', '.') : '', notes: notes.value.trim(),
        owner: owner.value, price_name: price.value, capacity: media ? normCapacity(capacity.value) : ''
      };
      if (stock) data.id = stock.id;
      const groups = variants?.groups();
      if (!groups || groups.length < 2) {
        if (groups?.length === 1) Object.assign(data, groupData(groups[0]));
        return saveStock(form, stock, data, err);
      }
      // Разные длины / объёмы — отдельными записями, одинаковые — одной с количеством.
      if (cat_ === 'cable' && groups.some((g) => g.value !== '' && !(Number(g.value.replace(',', '.')) >= 0))) {
        return err.replaceChildren(el('div', { class: 'notice bad' }, 'Длина — числом, в метрах'));
      }
      groups.forEach((g) => saveStock(form, null, { ...data, qty_total: String(g.qty), ...groupData(g) }, err));
    }
  },
  field('Категория', category),
  cableBox,
  field('Название *', name, nameNote),
  capacityField,
  field('Владелец', owner, ownerChangeNote(stock, owner)),
  field('Количество, шт.', qty, !isNew && el('span', { class: 'note' }, 'Купили ещё или что-то сломалось — просто поменяйте число.')),
  variants?.box,
  field('Прейскурант', price, priceNote(price, true)),
  field('Заметки', notes),
  err,
  formButtons(isNew ? 'Создать' : 'Сохранить', () => (isNew ? state.dialog.close() : openStock(stock.id))));
  // Поля одной группы (длина или объём) — в данные записи; название кабеля пересобирается с длиной.
  function groupData(g) {
    if (category.value === 'media') return { capacity: normCapacity(g.value), name: withCapacity(name.value.trim(), g.value) };
    const auto = name.value === lastAuto;
    return { length_m: g.value.replace(',', '.'), name: auto ? buildCableName(a.value(), b.value(), g.value) : name.value.trim() };
  }
  update();
  showForm(isNew ? 'Новый расходник' : `Правка ${stock.id}`, form);
  // несохранённое после ошибки (или перенесённое из формы другого вида) — не терять молча
  if (draft && (draft.name || draft.id)) state.dirty = true;
}

// Объём носителя: «64» → «64 ГБ», «1 тб» → «1 ТБ».
export function normCapacity(v) {
  const t = String(v || '').trim().replace(/\s+/g, ' ');
  if (/^\d+([.,]\d+)?$/.test(t)) return `${t} ГБ`;
  return t.replace(/\s*(гб|gb)$/i, ' ГБ').replace(/\s*(тб|tb)$/i, ' ТБ').replace(/\s*(мб|mb)$/i, ' МБ');
}

export function withCapacity(name, cap) {
  const c = normCapacity(cap);
  if (!c) return name;
  // объём уже в названии («Карта SD 64 ГБ») — второй раз не дописываем
  const base = stripCapacity(name, c);
  return base.toLowerCase().replace(/\s+/g, '').includes(c.toLowerCase().replace(/\s+/g, '')) ? base : `${base}, ${c}`;
}

export function stripCapacity(name, cap) {
  const c = normCapacity(cap);
  return c && name.endsWith(`, ${c}`) ? name.slice(0, -(c.length + 2)) : name;
}

// Штуки нового расходника: при количестве больше одного — у каждой своя длина (кабель) или объём (носитель).
// inputs — общие поля по разделам (их значение подставляется в новые строки).
// groups() — [{ value, qty }]: одинаковые значения вместе; null — одна штука или раздел без параметра.
export function stockVariants(qty, category, inputs) {
  const { el } = state.ctx;
  const box = el('fieldset', { class: 'inv-fieldset inv-copies', hidden: true });
  const rows = { cable: [], media: [] };
  const titles = { cable: 'Длина, м', media: 'Объём' };
  const count = () => Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(qty.value)) || 1));
  const kind = () => (rows[category.value] ? category.value : null);
  const many = () => Boolean(kind()) && count() > 1;
  const render = () => {
    const k = kind();
    const n = count();
    box.hidden = !many();
    if (!k || box.hidden) return;
    const list = rows[k];
    while (list.length < n) {
      list.push(el('input', {
        value: inputs[k].value, placeholder: titles[k], 'aria-label': `${titles[k]} ${list.length + 1}`,
        autocomplete: 'off', inputmode: k === 'cable' ? 'decimal' : null
      }));
    }
    box.replaceChildren(
      el('legend', {}, `Штуки: ${n}`),
      ...list.slice(0, n).map((input, i) => el('div', { class: 'inv-copy inv-copy-one' }, el('span', { class: 'inv-copy-n' }, `${i + 1}.`), input)),
      el('span', { class: 'note' }, `${titles[k]} у каждой. Одинаковые сохранятся одной записью с количеством, разные — отдельными записями.`));
  };
  // общее поле меняют, пока строки ещё не тронуты, — подставить и в них
  Object.entries(inputs).forEach(([k, input]) => input.addEventListener('input', () => {
    rows[k].forEach((r) => { if (!r.dataset.touched) r.value = input.value; });
  }));
  box.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
  return {
    box,
    many,
    render,
    groups: () => {
      if (!many()) return null;
      const map = new Map();
      rows[kind()].slice(0, count()).forEach((r) => {
        const v = r.value.trim();
        map.set(v, (map.get(v) || 0) + 1);
      });
      return [...map].map(([value, n]) => ({ value, qty: n }));
    }
  };
}

// Выбор разъёма: список из каталога + «другое…» со свободным вводом.
export function connectorPicker(title, conns, initial) {
  const { el } = state.ctx;
  const known = !initial || conns.includes(initial);
  const sel = selectEl('', [['', '—'], ...conns.map((x) => [x, x]), [OTHER, 'другое…']], known ? initial : OTHER);
  const custom = el('input', { value: known ? '' : initial, placeholder: 'Свой разъём', autocomplete: 'off', hidden: known });
  sel.addEventListener('change', () => {
    custom.hidden = sel.value !== OTHER;
    if (!custom.hidden) custom.focus();
  });
  return {
    node: el('label', {}, title, sel, custom),
    value: () => (sel.value === OTHER ? custom.value.trim() : sel.value),
    onChange: (fn) => { sel.addEventListener('change', fn); custom.addEventListener('input', fn); }
  };
}

export function buildCableName(a, b, len) {
  if (!a && !b) return '';
  const l = String(len || '').trim().replace('.', ',');
  return `${[a, b].filter(Boolean).join(' – ')}${l ? `, ${l} м` : ''}`;
}

export function parseCableName(name) {
  const m = /^(.+?) – (.+?)(?:, [\d.,]+ м)?$/.exec(name);
  return m ? { a: m[1].trim(), b: m[2].trim() } : null;
}

// Проверки до отправки (форма ещё открыта): остальное проверит сервер, ошибка придёт уведомлением.
export function saveStock(form, stock, data, err) {
  const { el } = state.ctx;
  const qty = Number(data.qty_total);
  const problem = data.qty_total === '' ? 'Укажите количество'
    : !(qty >= 0) || Math.floor(qty) !== qty ? 'Количество — целым числом'
      : data.length_m !== '' && !(Number(data.length_m) >= 0) ? 'Длина — числом, в метрах' : '';
  if (problem) {
    err.replaceChildren(el('div', { class: 'notice bad' }, problem));
    return;
  }
  const send = () => saveInBackground({
    kind: 'stock', id: stock?.id, created: !stock, label: stock ? stock.id : `«${data.name}»`,
    task: () => state.ctx.call('stock_save', { stock: data }),
    done: (res) => ({ id: res.stock.id, warnings: res.warnings }),
    fix: () => openStockForm(stock ? (cat().stock || []).find((x) => x.id === stock.id) || stock : null, data),
    retry: () => send()
  });
  send();
  if (stock) {
    const local = (cat().stock || []).find((x) => x.id === stock.id);
    if (local) Object.assign(local, data, { id: local.id, qty_total: qty });
    renderList();
    openStock(stock.id, [{ kind: 'info', text: 'Сохраняется…' }]);
  } else {
    state.dialog.close();
  }
}
