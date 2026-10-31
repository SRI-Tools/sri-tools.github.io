import { group, render } from '../inventory.js';
import { cat, editable, field, fmtNum, formButtons, notices, owners, setBusy, showDialog, state } from './shared.js';

// Инвентарь: справочники владельцев и диапазонов.

export const NEW_BAND = '__new_band__';

export const bandsAll = () => cat().bands || [];

export const rangesText = (ranges) => (ranges || []).map(([a, b]) => `${fmtNum(a)}–${fmtNum(b)}`).join(' / ');

// «A · линейка, производитель · 516–558 МГц»; неизвестный номер — как есть.
// Диапазон в строке списка: «A 516–558 МГц».
export function bandShort(id) {
  if (!id) return '';
  const b = bandsAll().find((x) => x.id === id);
  if (!b) return id;
  const freq = rangesText(b.ranges);
  return `${b.code}${freq ? ` ${freq} МГц` : ''}`;
}

export function bandText(id) {
  if (!id) return '';
  const b = bandsAll().find((x) => x.id === id);
  if (!b) return `${id} (нет в справочнике)`;
  const where = [b.line, b.manufacturer].filter(Boolean);
  const freq = rangesText(b.ranges);
  return `${b.code}${where.length ? ` · ${where.join(', ')}` : ''}${freq ? ` · ${freq} МГц` : ''}`;
}

// Выбор диапазона: сначала производителя позиции, затем остальные; «+ новый диапазон…» — форма прямо здесь.
export function bandPicker(value, makerInput) {
  const { el, call } = state.ctx;
  const select = el('select', { name: 'band' });
  const note = el('span', { class: 'note' });
  const newBox = el('div', { class: 'inv-inline-form', hidden: true });
  let current = value;

  const fill = () => {
    const maker = makerInput.value.trim().toLowerCase();
    const groups = new Map();
    bandsAll().forEach((b) => {
      const key = b.manufacturer || 'Без производителя';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    });
    const order = [...groups.keys()].sort((a, b) =>
      (b.toLowerCase() === maker) - (a.toLowerCase() === maker) || a.localeCompare(b, 'ru'));
    const option = (b) => el('option', { value: b.id },
      `${b.code}${b.line ? ` · ${b.line}` : ''}${b.ranges?.length ? ` — ${rangesText(b.ranges)} МГц` : ''}`);
    select.replaceChildren(
      el('option', { value: '' }, '—'),
      ...(current && !bandsAll().some((b) => b.id === current) ? [el('option', { value: current }, `${current} (нет в справочнике)`)] : []),
      ...order.map((g) => el('optgroup', { label: g }, groups.get(g).map(option))),
      el('option', { value: NEW_BAND }, '+ новый диапазон…'));
    select.value = current;
    note.textContent = current ? bandText(current) : '';
  };

  const openNew = () => {
    const err = el('div');
    const inp = (ph, val = '') => el('input', { placeholder: ph, value: val, autocomplete: 'off' });
    const maker = inp('Производитель', makerInput.value.trim());
    const line = inp('Линейка, например ew G4 (можно пусто)');
    const code = inp('Обозначение, например B12');
    const ranges = inp('Частоты, МГц: 470-800, 823-832, 940-960');
    const add = el('button', { class: 'button primary', type: 'button' }, 'Добавить диапазон');
    add.addEventListener('click', async () => {
      err.replaceChildren();
      add.disabled = true;
      try {
        const res = await call('band_save', { band: { manufacturer: maker.value, line: line.value, code: code.value, ranges: ranges.value } });
        await state.ctx.reloadCatalog();
        current = res.band;
        newBox.hidden = true;
        fill();
      } catch (e) {
        add.disabled = false;
        err.replaceChildren(el('div', { class: 'notice bad' }, e.message));
      }
    });
    newBox.replaceChildren(
      el('strong', {}, 'Новый диапазон'),
      el('div', { class: 'inv-grid' }, maker, line),
      el('div', { class: 'inv-grid' }, code, ranges),
      err,
      el('div', { class: 'inv-form-buttons' }, add,
        el('button', { class: 'button', type: 'button', onclick: () => { newBox.hidden = true; fill(); } }, 'Отмена')));
    newBox.hidden = false;
    code.focus();
  };

  select.addEventListener('change', () => {
    if (select.value === NEW_BAND) return openNew();
    current = select.value;
    note.textContent = current ? bandText(current) : '';
  });
  makerInput.addEventListener('change', fill);
  fill();
  return { select, note, newBox };
}

export function bandsHead() {
  const { el } = state.ctx;
  return el('div', { class: 'row-between inv-kits-head' },
    el('div', { class: 'inv-kits-title' },
      el('button', { class: 'button small', type: 'button', onclick: () => { state.view = 'list'; render(); } }, '← Назад'),
      el('h2', { class: 'view-title' }, 'Диапазоны')),
    editable() && el('button', { class: 'button small primary', type: 'button', onclick: () => openBandForm(null) }, '+ Диапазон'));
}

export function renderBands(extra = []) {
  const { el } = state.ctx;
  const items = cat().items || [];
  const count = (id) => items.filter((i) => i.band === id).length;
  const groups = new Map();
  bandsAll().forEach((b) => {
    const key = b.manufacturer || 'Без производителя';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });
  const sections = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'ru')).map((g) => group(g, groups.get(g).map((b) =>
    el('li', {}, el('button', { class: 'row', type: 'button', onclick: () => editable() && openBandForm(b) },
      el('span', { class: 'code' }, b.code),
      el('span', { class: 'name' }, b.ranges?.length ? `${rangesText(b.ranges)} МГц` : el('span', { class: 'inv-muted' }, 'частоты не указаны'),
        el('span', { class: 'label' }, [b.line, b.notes].filter(Boolean).join(' · '))),
      el('span', { class: 'qty' }, count(b.id) ? `${count(b.id)} поз.` : ''))))));
  state.body.replaceChildren(
    ...notices(extra),
    el('p', { class: 'muted' }, 'Пара подходит, если у диапазонов есть общие частоты — даже у разных производителей.'),
    ...(sections.length ? sections : [el('p', { class: 'muted' }, 'Справочник пуст.')]));
}

export function openBandForm(band) {
  const { el } = state.ctx;
  const isNew = !band;
  const err = el('div');
  const inp = (name, val, attrs = {}) => el('input', { name, value: val || '', autocomplete: 'off', ...attrs });
  const maker = inp('manufacturer', band?.manufacturer, { required: true });
  const line = inp('line', band?.line);
  const code = inp('code', band?.code, { required: true });
  const ranges = inp('ranges', band ? (band.ranges || []).map(([a, b]) => `${a}-${b}`).join(', ') : '', { required: true, placeholder: '470-800, 823-832' });
  const notes = el('textarea', { name: 'notes', rows: 2 }, band?.notes || '');
  const used = band ? (cat().items || []).filter((i) => i.band === band.id).length : 0;
  const form = el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      saveBand(form, { band: { id: band?.id, manufacturer: maker.value, line: line.value, code: code.value, ranges: ranges.value, notes: notes.value } }, err);
    }
  },
  el('div', { class: 'inv-grid' }, field('Производитель *', maker), field('Линейка', line)),
  el('div', { class: 'inv-grid' }, field('Обозначение *', code), field('Частоты, МГц *', ranges, el('span', { class: 'note' }, 'Отрезки через запятую'))),
  field('Заметки', notes),
  used > 0 && el('p', { class: 'note' }, `Указан у позиций: ${used}. Изменение частот сразу влияет на подбор пар.`),
  err,
  formButtons(isNew ? 'Добавить' : 'Сохранить', () => state.dialog.close()),
  !isNew && !used && el('button', {
    class: 'button danger inv-owner-delete', type: 'button',
    onclick: () => { if (confirm(`Удалить диапазон ${band.code}?`)) saveBand(form, { band: { id: band.id }, delete: true }, err); }
  }, 'Удалить диапазон'));
  showDialog(isNew ? 'Новый диапазон' : `Диапазон ${band.code}`, form);
  (isNew ? maker : ranges).focus();
}

export async function saveBand(form, params, err) {
  const { el, call } = state.ctx;
  err.replaceChildren();
  setBusy(form, true);
  try {
    await call('band_save', params);
    await state.ctx.reloadCatalog();
    state.dialog.close();
    renderBands([{ kind: 'ok', text: params.delete ? 'Удалено' : 'Сохранено' }]);
  } catch (e) {
    setBusy(form, false);
    err.replaceChildren(el('div', { class: 'notice bad' }, e.message));
  }
}

// ---------- владельцы ----------

export function ownersHead() {
  const { el } = state.ctx;
  return el('div', { class: 'row-between inv-kits-head' },
    el('div', { class: 'inv-kits-title' },
      el('button', { class: 'button small', type: 'button', onclick: () => { state.view = 'list'; render(); } }, '← Назад'),
      el('h2', { class: 'view-title' }, 'Владельцы')),
    editable() && el('button', { class: 'button small primary', type: 'button', onclick: () => openOwnerForm(null) }, '+ Владелец'));
}

export function renderOwners(extra = []) {
  const { el } = state.ctx;
  const c = cat();
  const count = (code) => (c.items || []).filter((i) => i.owner === code && i.status !== 'retired').length +
    (c.stock || []).filter((s) => s.owner === code).length;
  state.body.replaceChildren(
    ...notices(extra),
    el('p', { class: 'muted' }, 'Код владельца — окончание кода позиции: RF07-EMP. Владельца позиции меняют в её карточке.'),
    el('ul', { class: 'list' }, owners().map((o) => el('li', {},
      el('button', { class: 'row', type: 'button', onclick: () => editable() && openOwnerForm(o) },
        el('span', { class: 'code' }, o.code),
        el('span', { class: 'name' }, o.name || el('span', { class: 'inv-muted' }, 'без названия'),
          o.notes && el('span', { class: 'label' }, o.notes)),
        el('span', { class: 'qty' }, `${count(o.code)} поз.`))))));
}

export function openOwnerForm(owner) {
  const { el } = state.ctx;
  const isNew = !owner;
  const err = el('div');
  const code = el('input', {
    name: 'code', value: owner?.code || '', required: true, autocomplete: 'off', maxlength: 6,
    pattern: '[A-Za-z]{1,6}', disabled: !isNew, style: 'text-transform: uppercase'
  });
  const name = el('input', { name: 'name', value: owner?.name || '', autocomplete: 'off', maxlength: 100 });
  const notes = el('textarea', { name: 'notes', rows: 2 }, owner?.notes || '');
  const form = el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      saveOwner(form, { owner: { code: isNew ? code.value : owner.code, name: name.value, notes: notes.value }, isNew }, err);
    }
  },
  field('Код *', code, el('span', { class: 'note' }, isNew
    ? 'Латинские буквы, до 6: окончание кодов позиций (RF07-AM). Потом не меняется.'
    : 'Код не меняется: он — часть кодов позиций.')),
  field('Название', name),
  field('Заметки', notes),
  err,
  formButtons(isNew ? 'Добавить' : 'Сохранить', () => state.dialog.close()),
  !isNew && owner.code !== 'EMP' && el('button', {
    class: 'button danger inv-owner-delete', type: 'button',
    onclick: () => {
      if (confirm(`Удалить владельца ${owner.code}? Это можно, только если у него нет позиций.`)) {
        saveOwner(form, { owner: { code: owner.code }, delete: true }, err);
      }
    }
  }, 'Удалить владельца'));
  showDialog(isNew ? 'Новый владелец' : `Владелец ${owner.code}`, form);
  (isNew ? code : name).focus();
}

export async function saveOwner(form, params, err) {
  const { el, call } = state.ctx;
  err.replaceChildren();
  setBusy(form, true);
  try {
    await call('owner_save', params);
    await state.ctx.reloadCatalog();
    state.dialog.close();
    renderOwners([{ kind: 'ok', text: params.delete ? 'Удалено' : 'Сохранено' }]);
  } catch (e) {
    setBusy(form, false);
    err.replaceChildren(el('div', { class: 'notice bad' }, e.message));
  }
}

// ---------- правила комплектов ----------
