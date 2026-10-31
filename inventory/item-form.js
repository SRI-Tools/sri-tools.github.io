import { renderList } from '../inventory.js';
import { ITEM_FIELDS, MAX_COPIES, cat, categorySelect, field, formButtons, nextItemCode, ownerOptions, priceNote, pricePicker, saveInBackground, selectEl, showForm, state, subtypeOptions, suggestField, usedValues } from './shared.js';
import { openItem } from './cards.js';
import { openStockForm } from './stock-form.js';
import { NEW_BAND, bandPicker } from './directories.js';

// Инвентарь: форма позиции — экземпляры, «в комплекте с», подсказки категории, производителя и модели.

// «В комплекте с»: модели основного оборудования, к которым эта позиция предлагается в брони
// (по одной; не хватает — предупреждение). Сохраняется правилами комплектов «к модели X — эта позиция».
// Отмечено то, что уже есть в правилах; changed() — трогали ли (иначе правила не пересылаются).
export function kitWithPicker(item, v) {
  const { el } = state.ctx;
  const c = cat();
  const sel = (it) => (it?.model ? `model:${it.model}` : it?.name ? `name:${it.name}` : '');
  const mineSel = sel(item).toLowerCase();
  const current = new Set((c.kitRules || [])
    .filter((r) => mineSel && String(r.pick_from || '').toLowerCase() === mineSel && /^model:[^&|]+$/i.test(String(r.applies_to || '')))
    .map((r) => String(r.applies_to).slice(6).trim().toLowerCase()));
  (v.kit_with || []).forEach((m) => current.add(String(m).toLowerCase()));
  // модели — из инвентаря (в строю), без своей; подпись — название первой такой позиции
  const models = new Map();
  (c.items || []).forEach((i) => {
    const m = String(i.model || '').trim();
    if (!m || i.status === 'retired' || (item && m.toLowerCase() === String(item.model || '').toLowerCase())) return;
    if (!models.has(m.toLowerCase())) models.set(m.toLowerCase(), { model: m, name: i.name, cat: c.categories?.[i.category] || '' });
  });
  const list = [...models.values()].sort((a, b) => a.cat.localeCompare(b.cat, 'ru') || a.name.localeCompare(b.name, 'ru'));
  let touched = false;
  const boxes = list.map((m) => {
    const box = el('input', { type: 'checkbox', value: m.model, checked: current.has(m.model.toLowerCase()) });
    box.addEventListener('change', () => { touched = true; render(); });
    return { m, box, node: el('label', { class: 'check-row inv-kitwith-row' }, box, m.name, el('span', { class: 'note' }, m.cat)) };
  });
  const filter = el('input', { type: 'search', placeholder: 'Найти модель', autocomplete: 'off', 'aria-label': 'Найти модель' });
  const listBox = el('div', { class: 'inv-kitwith-list' });
  const summary = el('span', { class: 'note' });
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    listBox.replaceChildren(...boxes.filter((b) => b.box.checked || !q || `${b.m.name} ${b.m.model}`.toLowerCase().includes(q)).map((b) => b.node));
    const on = boxes.filter((b) => b.box.checked).map((b) => b.m.name);
    summary.textContent = on.length
      ? `Будет предлагаться в брони к: ${on.join(', ')} — по одной; если свободной нет — предупреждение.`
      : 'Не привязано: в брони само не предлагается.';
  };
  filter.addEventListener('input', render);
  render();
  const node = el('details', { class: 'inv-kitwith', open: current.size > 0 },
    el('summary', {}, 'В комплекте с…'), filter, listBox, summary);
  return {
    node,
    changed: () => touched,
    value: () => boxes.filter((b) => b.box.checked).map((b) => b.m.model)
  };
}

// Показывать ли поля «диапазон / серия / пара»: для категории, где они есть хоть у одной позиции,
// либо для типа, у которого они где-то заполнены.
export function showsBand(category, subtype) {
  const items = cat().items || [];
  if (category === 'RF') return true;
  return items.some((i) => i.band && ((subtype && i.subtype === subtype) || i.category === category));
}

// draft — введённые ранее значения (после ошибки фонового сохранения «Исправить»).
export function openItemForm(item, draft = null) {
  const { el } = state.ctx;
  const c = cat();
  const isNew = !item;
  const v = { ...(item || { category: Object.keys(c.categories || {})[0] || '' }), ...(draft || {}) };
  const err = el('div');
  const f = {};
  const input = (name, attrs = {}) => (f[name] = el('input', { name, value: v[name] ?? '', ...attrs }));
  const select = (name, options) => (f[name] = selectEl(name, options, v[name] ?? ''));

  const codeNote = el('span', { class: 'note warn', hidden: true });
  f.owner = selectEl('owner', ownerOptions(), v.owner || 'EMP');
  input('manufacturer', { autocomplete: 'off' });
  const band = bandPicker(v.band || '', f.manufacturer);
  f.band = band.select;
  const bandBox = el('div', {},
    field('Диапазон', band.select, band.note),
    band.newBox,
    el('div', { class: 'inv-grid' },
      field('Серия', input('series')),
      field('Номер пары', input('pair_no', { inputmode: 'numeric' }))));
  // Длина — у удочек (и у позиции, где она уже указана).
  const lengthField = field('Длина, м', input('length_m', { inputmode: 'decimal', autocomplete: 'off', placeholder: '3,5' }));
  if (v.length_m) f.length_m.value = String(v.length_m).replace('.', ','); // «3,5», как пишут
  const update = () => {
    lengthField.hidden = f.category.value !== 'BOOM' && !v.length_m;
    fillSubtypes();
    bandBox.hidden = !showsBand(f.category.value, f.subtype.value) && !v.band;
    const next = isNew ? '' : nextItemCode(item, f.category.value, f.owner.value);
    const moved = Boolean(next) && next !== item.id; // другая категория или владелец
    codeNote.hidden = !moved;
    codeNote.textContent = moved ? `Код станет ${next} — во всех бронях тоже. Этикетку нужно перепечатать.` : '';
  };

  // Новая запись: в списке разделов и расходники — выбор такого раздела переключает на форму расходника.
  f.category = isNew
    ? categorySelect('item', v.category, (code) => openStockForm(null, {
      category: code, name: f.name.value, owner: f.owner.value, notes: f.notes.value, qty_total: f.qty.value
    }))
    : select('category', Object.entries(c.categories || {}));
  // Тип — только в категориях, где он что-то значит (пары радиосистем, комплекты); список — по категории.
  f.subtype = el('select', { name: 'subtype' });
  const subtypeField = field('Тип', f.subtype);
  const fillSubtypes = () => {
    const opts = subtypeOptions(f.category.value);
    const keep = f.subtype.value || v.subtype || '';
    f.subtype.replaceChildren(...opts.map(([val, text]) => el('option', { value: val }, text)));
    f.subtype.value = opts.some(([val]) => val === keep) ? keep : opts[0]?.[0] ?? '';
    subtypeField.hidden = opts.length < 2;
  };
  fillSubtypes();
  const labelField = field('Метка', input('label', { autocomplete: 'off' }));
  const serialField = field('Серийный номер', input('serial', { autocomplete: 'off' }));
  const copies = isNew ? copiesPicker(v, f, [labelField, serialField]) : null;

  const form = el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      // Код меняется (другая категория или владелец) — этикетка устареет: спросить заранее.
      const next = isNew ? '' : nextItemCode(item, f.category.value, f.owner.value);
      if (next && next !== item.id
        && !confirm(`Код позиции сменится: ${item.id} → ${next}.\nСтарую этикетку нужно будет перепечатать. Сохранить?`)) return;
      saveItem(item, f, copies?.values());
    }
  },
    el('div', { class: 'inv-grid' },
      field('Категория', f.category, codeNote),
      subtypeField),
    field('Название *', input('name', { required: true, autocomplete: 'off' })),
    copies && copies.qtyField,
    field('Владелец', f.owner),
    el('div', { class: 'inv-grid' },
      suggestField('Производитель', f.manufacturer, () => usedValues('manufacturer')),
      field('Модель', input('model', { autocomplete: 'off' }))),
    bandBox,
    el('div', { class: 'inv-grid' },
      labelField,
      suggestField('Страна', input('origin_country', { autocomplete: 'off' }), () => usedValues('origin_country'))),
    serialField,
    copies && copies.box,
    lengthField,
    field('Стоимость, ₽', input('value_rub', { inputmode: 'decimal' })),
    field('Прейскурант', f.price_name = pricePicker(v.price_name || ''), priceNote(f.price_name)),
    (f.kitWith = kitWithPicker(item, v)).node,
    field('Заметки', f.notes = el('textarea', { name: 'notes', rows: 3 }, v.notes || '')),
    err,
    formButtons(isNew ? 'Создать' : 'Сохранить', () => (isNew ? state.dialog.close() : openItem(item.id))));
  f.category.addEventListener('change', update);
  f.owner.addEventListener('change', update);
  f.subtype.addEventListener('change', update);
  autoMakerModel(f.name, f.manufacturer, f.model);
  if (isNew) autoCategory(f, update);
  update();
  showForm(isNew ? 'Новая позиция' : `Правка ${item.id}`, form);
  // несохранённое после ошибки (или перенесённое из формы другого вида) — не терять молча
  if (draft && (draft.name || draft.id)) state.dirty = true;
  if (isNew) f.name.focus();
}

// Количество экземпляров новой позиции: больше одного — у каждого свои серийник и метка,
// каждый сохранится отдельной позицией со своим кодом. single — общие поля метки и серийника (прячутся).
export function copiesPicker(v, f, single) {
  const { el } = state.ctx;
  const rows = [];
  f.qty = el('input', { name: 'qty', type: 'number', min: 1, max: MAX_COPIES, step: 1, inputmode: 'numeric', value: v.qty || v.copies?.length || 1 });
  const box = el('fieldset', { class: 'inv-fieldset inv-copies', hidden: true });
  const count = () => Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(f.qty.value)) || 1));
  const render = () => {
    const n = count();
    const many = n > 1;
    while (rows.length < n) {
      const k = rows.length;
      const prev = v.copies?.[k] || {};
      rows.push({
        serial: el('input', { value: prev.serial || '', placeholder: 'Серийный номер', 'aria-label': `Серийный номер ${k + 1}`, autocomplete: 'off' }),
        label: el('input', { value: prev.label || '', placeholder: 'Метка', 'aria-label': `Метка ${k + 1}`, autocomplete: 'off' })
      });
    }
    // Переход один ⇄ несколько: введённое в общие поля — у первого экземпляра, и обратно.
    const wasMany = !box.hidden;
    if (many && !wasMany && !restoring) {
      rows[0].serial.value = f.serial.value;
      rows[0].label.value = f.label.value;
    } else if (!many && wasMany) {
      f.serial.value = rows[0].serial.value;
      f.label.value = rows[0].label.value;
    }
    single.forEach((x) => { x.hidden = many; });
    box.hidden = !many;
    box.replaceChildren(
      el('legend', {}, `Экземпляры: ${n}`),
      ...rows.slice(0, n).map((r, k) => el('div', { class: 'inv-copy' }, el('span', { class: 'inv-copy-n' }, `${k + 1}.`), r.serial, r.label)),
      el('span', { class: 'note' }, 'Каждый сохранится отдельной позицией со своим кодом, остальные поля — общие. Потом любую можно поправить.'));
  };
  f.qty.addEventListener('input', render);
  let restoring = Boolean(v.copies); // форма после ошибки: экземпляры уже заполнены
  render();
  restoring = false;
  return {
    qtyField: field('Количество, шт.', f.qty),
    box,
    values: () => (count() > 1 ? rows.slice(0, count()).map((r) => ({ serial: r.serial.value.trim(), label: r.label.value.trim() })) : null)
  };
}

// Новая позиция: категория и тип по названию («Сплиттер …» → «Антенны», тип «сплиттер»), пока их не выбрали
// вручную. Правила приходят с сервера в каталоге (categoryHints).
export function autoCategory(f, update) {
  const hints = (cat().categoryHints || []).map((h) => {
    try {
      return { ...h, re: new RegExp(h.re, 'i') };
    } catch {
      return null; // правило, которое браузер не понимает, — пропустить
    }
  }).filter(Boolean);
  if (!hints.length) return;
  const touched = { category: false, subtype: false };
  // выбор вручную — больше не подставлять (программная подстановка событий не вызывает)
  f.category.addEventListener('change', () => { touched.category = true; });
  f.subtype.addEventListener('change', () => { touched.subtype = true; });
  const note = state.ctx.el('span', { class: 'note', hidden: true }, 'Подобрано по названию — можно поменять.');
  f.category.closest('label')?.append(note);
  f.name.addEventListener('input', () => {
    const text = `${f.name.value} ${f.model.value}`;
    const cat_ = hints.find((h) => h.category && h.re.test(text));
    const sub = cat_?.subtype ? cat_ : hints.find((h) => h.subtype && h.re.test(text) && (!h.category || h.category === cat_?.category));
    let changed = false;
    if (!touched.category && cat_ && [...f.category.options].some((o) => o.value === cat_.category) && f.category.value !== cat_.category) {
      f.category.value = cat_.category;
      changed = true;
    }
    if (changed) update(); // список типов — под новую категорию, до подстановки типа
    if (!touched.subtype && sub?.subtype && [...f.subtype.options].some((o) => o.value === sub.subtype) && f.subtype.value !== sub.subtype) {
      f.subtype.value = sub.subtype;
      if (!changed) update();
      changed = true;
    }
    if (changed) note.hidden = false;
  });
}

// Сохранение в фоне: правка сразу видна в карточке, новая позиция — уведомлением с кодом, когда сервер его присвоит.
// copies — экземпляры новой позиции ([{serial, label}], больше одного) или null.
export function saveItem(item, f, copies = null) {
  const data = {};
  ITEM_FIELDS.forEach((k) => { data[k] = f[k].value.trim(); });
  if (data.band === NEW_BAND) data.band = item?.band || '';
  data.owner = f.owner.value;
  if (item) data.id = item.id;
  if (copies) data.serial = data.label = '';
  const label = item ? item.id : copies ? `«${data.name}» × ${copies.length}` : `«${data.name}»`;
  const kitWith = f.kitWith?.changed() ? f.kitWith.value() : null;
  const send = () => saveInBackground({
    kind: 'item', id: item?.id, created: !item, label,
    task: () => state.ctx.call('item_save', {
      item: data, ...(copies ? { copies } : {}), ...(kitWith ? { kit_with: kitWith } : {})
    }),
    done: (res) => ({
      id: res.item.id, warnings: res.warnings,
      text: res.items?.length > 1 ? `${res.items.length} шт.: ${res.items.map((x) => x.id).join(', ')}` : ''
    }),
    fix: () => openItemForm(item ? (cat().items || []).find((x) => x.id === item.id) || item : null,
      copies ? { ...data, qty: copies.length, copies } : data),
    retry: () => send()
  });
  send();
  if (item) {
    const local = (cat().items || []).find((x) => x.id === item.id);
    if (local) Object.assign(local, data, { id: local.id });
    renderList();
    openItem(item.id, [{ kind: 'info', text: 'Сохраняется…' }]);
  } else {
    state.dialog.close();
  }
}

// ---------- форма расходника ----------

// Производители, уже известные в базе (из позиций и справочника диапазонов), — длинные первыми,
// чтобы «Acme Pro» не приняли за «Acme».
export function knownMakers() {
  const c = cat();
  const all = [...(c.items || []).map((i) => i.manufacturer), ...(Array.isArray(c.bands) ? c.bands : []).map((b) => b.manufacturer)]
    .map((m) => String(m || '').trim()).filter(Boolean);
  const unique = [...new Map(all.map((m) => [m.toLowerCase(), m])).values()];
  return unique.sort((a, b) => b.length - a.length);
}

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// «Рация Acme X-100 (№1)» → { maker: 'Acme', model: 'X-100' }. Сначала ищется известный производитель,
// иначе — первое латинское слово без цифр. Модель — остаток до скобки или запятой, без русских слов в конце;
// модель без латинских букв не подставляется. Без производителя модель — латинская часть названия.
export function parseMakerModel(name, makers) {
  const s = String(name || '').trim();
  let maker = '';
  let rest = '';
  for (const m of makers) {
    const hit = new RegExp(`(^|[\\s(«"])${escapeRe(m)}(?=$|[\\s,(»"])`, 'i').exec(s);
    if (hit) {
      maker = m;
      rest = s.slice(hit.index + hit[0].length);
      break;
    }
  }
  if (!maker) {
    const hit = /(^|\s)([A-Za-z][A-Za-z&'.-]+)(?=$|[\s,(])/.exec(s);
    if (hit) {
      maker = hit[2];
      rest = s.slice(hit.index + hit[0].length);
    } else {
      const i = s.search(/[A-Za-z]/);
      rest = i < 0 ? '' : s.slice(i);
    }
  }
  let model = rest.split(/[(,]/)[0].trim().replace(/(\s+[а-яё][^\s]*)+$/i, '').trim();
  if (!/[A-Za-z]/.test(model)) model = '';
  return { maker, model };
}

// Пока производитель и модель не правили руками (пусты или совпадают с предыдущей подстановкой),
// они заполняются из названия при вводе.
export function autoMakerModel(nameInput, makerInput, modelInput) {
  const makers = knownMakers();
  let last = parseMakerModel(nameInput.value, makers);
  nameInput.addEventListener('input', () => {
    const next = parseMakerModel(nameInput.value, makers);
    if (!makerInput.value.trim() || makerInput.value === last.maker) {
      if (makerInput.value !== next.maker) {
        makerInput.value = next.maker;
        makerInput.dispatchEvent(new Event('change')); // список диапазонов — по производителю
      }
    }
    if (!modelInput.value.trim() || modelInput.value === last.model) modelInput.value = next.model;
    last = next;
  });
}

// ---------- диапазоны ----------
