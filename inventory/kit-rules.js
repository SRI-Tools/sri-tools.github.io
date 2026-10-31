import { render } from '../inventory.js';
import { MATCH_NAMES, cat, editable, field, notices, selectEl, setBusy, showDialog, state } from './shared.js';

// Инвентарь: правила комплектов — список и редактор.

export function kitsHead() {
  const { el } = state.ctx;
  return el('div', { class: 'row-between inv-kits-head' },
    el('div', { class: 'inv-kits-title' },
      el('button', { class: 'button small', type: 'button', onclick: () => { state.view = 'list'; render(); } }, '← Назад'),
      el('h2', { class: 'view-title' }, 'Комплекты')),
    editable() && el('button', { class: 'button small primary', type: 'button', onclick: () => openRuleForm(null) }, '+ Правило'));
}

export function renderKits(extra = []) {
  const { el } = state.ctx;
  const rules = cat().kitRules || [];
  state.body.replaceChildren(
    ...notices(extra),
    el('p', { class: 'muted' }, 'Что предлагать добавить в бронь вместе с позицией. Обязательное без пары не даст подтвердить бронь.'),
    rules.length
      ? el('ul', { class: 'list' }, rules.map(ruleRow))
      : el('p', { class: 'muted' }, 'Правил пока нет.'));
}

export function ruleRow(r) {
  const { el } = state.ctx;
  const content = [
    el('span', { class: 'code' }, r.id),
    el('span', { class: 'name' }, el('strong', {}, r.slot || '—'), el('span', { class: 'note' }, describeRule(r)),
      r.notes && el('span', { class: 'note' }, r.notes))
  ];
  if (!editable()) return el('li', {}, el('div', { class: 'row static' }, content));
  return el('li', {}, el('button', { class: 'row', type: 'button', onclick: () => openRuleForm(r) }, content));
}

export function describeRule(r) {
  const parts = [`К: ${describeSel(r.applies_to)} → добавлять: ${describeSel(r.pick_from)} ×${r.qty || 1}`];
  parts.push(isYes(r.required) ? 'обязательно' : /^warn$/i.test(String(r.required)) ? 'предупреждать' : 'по желанию');
  const prefs = [];
  const def = parseDefault(r.default);
  if (def.kind === 'pair') prefs.push('сначала тот же номер пары');
  else if (def.kind === 'longest') prefs.push('сначала самый длинный');
  else if (def.kind === 'name') prefs.push(`сначала «${def.value}»`);
  else if (def.kind === 'series') prefs.push(`сначала серия ${def.value}`);
  else if (def.kind === 'raw') prefs.push(`сначала: ${def.value}`);
  const match = matchList(r.match);
  const same = [];
  if (match.includes('same_series')) same.push('та же серия');
  if (match.includes('same_band')) same.push('общие частоты');
  if (same.length) prefs.push(same.join(' и '));
  if (match.includes('prefer_same_pair_no') && def.kind !== 'pair') prefs.unshift('по возможности тот же номер пары');
  if (prefs.length) parts.push(prefs.join(', '));
  return parts.join(' · ');
}

export function describeSel(sel) {
  const list = splitSel(sel);
  if (!list.length) return '—';
  return list.map(({ kind, value }) => {
    const c = cat();
    const vals = value.split('|').map((x) => x.trim()).filter(Boolean);
    const q = (arr) => arr.map((x) => `«${x}»`).join(' или ');
    switch (kind) {
      case 'model': return `модель ${q(vals)}`;
      case 'subtype': return `тип ${q(vals.map((x) => lookup(c.subtypes, x)))}`;
      case 'category': return `категория ${q(vals.map((x) => lookup(c.categories, x)))}`;
      case 'series': return `серия ${q(vals)}`;
      case 'name': return `название содержит ${q(vals)}`;
      case 'stock': return `расходник ${q(vals.map((x) => lookup(c.stockCategories, x)))}`;
      default: return value ? `${kind}:${value}` : kind;
    }
  }).join(' и ');
}

// Значение справочника без учёта регистра кода (правила сравнивают коды так же).
export function lookup(dict, code) {
  const key = Object.keys(dict || {}).find((k) => k.toLowerCase() === String(code).toLowerCase());
  return key ? dict[key] : code;
}

export function dictKey(dict, code) {
  return Object.keys(dict || {}).find((k) => k.toLowerCase() === String(code).toLowerCase()) || null;
}

export function splitSel(sel) {
  return String(sel || '').split('&').map((x) => x.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(':');
    return i < 0 ? { kind: p.toLowerCase(), value: '' } : { kind: p.slice(0, i).trim().toLowerCase(), value: p.slice(i + 1).trim() };
  });
}

export function parseDefault(d) {
  const s = String(d || '').trim();
  if (!s || s === 'auto') return { kind: 'auto', value: '' };
  if (s === 'pair' || s === 'longest') return { kind: s, value: '' };
  const m = /^(name|series):(.*)$/.exec(s);
  return m ? { kind: m[1], value: m[2].trim() } : { kind: 'raw', value: s };
}

export const matchList = (m) => String(m || '').split(',').map((x) => x.trim()).filter(Boolean);

export const isYes = (v) => /^(yes|да|true|1)$/i.test(String(v ?? ''));

// Разбор условия правила в поля формы. Что не укладывается в простые поля — остаётся текстом как есть.
export function selToForm(sel, kinds) {
  const c = cat();
  const parts = splitSel(sel);
  const dicts = { subtype: c.subtypes, category: c.categories, stock: c.stockCategories };
  const single = (p) => {
    if (!kinds.includes(p.kind)) return null;
    if (dicts[p.kind]) {
      const key = dictKey(dicts[p.kind], p.value);
      return key ? { kind: p.kind, value: key, extra: '' } : null;
    }
    return { kind: p.kind, value: p.value, extra: '' };
  };
  if (!parts.length) return { kind: kinds[0], value: '', extra: '' };
  if (parts.length === 1) return single(parts[0]) || { kind: 'raw', value: String(sel), extra: '' };
  if (parts.length === 2 && parts[0].kind === 'stock' && parts[1].kind === 'name' && kinds.includes('stock')) {
    const first = single(parts[0]);
    if (first) return { ...first, extra: parts[1].value };
  }
  return { kind: 'raw', value: String(sel), extra: '' };
}

export const APPLY_KINDS = [['model', 'модель'], ['subtype', 'тип'], ['category', 'категория'], ['name', 'название содержит'], ['raw', 'своё условие (как есть)']];

export const PICK_KINDS = [['subtype', 'тип'], ['category', 'категория'], ['name', 'название содержит'], ['stock', 'расходник категории'], ['raw', 'своё условие (как есть)']];

export const DEFAULT_KINDS = [['auto', 'автоматически'], ['pair', 'тот же номер пары'], ['longest', 'самый длинный'], ['name', 'название содержит…'], ['series', 'серия…'], ['raw', 'своё (как есть)']];

// Поле «условие»: вид + значение (список из справочника или текст).
export function selectorEditor(title, kinds, sel) {
  const { el } = state.ctx;
  const c = cat();
  const init = selToForm(sel, kinds.map(([k]) => k));
  const kind = selectEl('', kinds, init.kind);
  const box = el('div', { class: 'inv-sel-value' });
  let read = () => '';
  const draw = (k, value, extra) => {
    if (k === 'subtype' || k === 'category' || k === 'stock') {
      const dict = { subtype: c.subtypes, category: c.categories, stock: c.stockCategories }[k] || {};
      const s = selectEl('', Object.entries(dict), value || Object.keys(dict)[0]);
      s.setAttribute('aria-label', title);
      if (k !== 'stock') {
        box.replaceChildren(s);
        read = () => `${k}:${s.value}`;
        return;
      }
      const nm = el('input', { value: extra || '', placeholder: 'и название содержит (необязательно)', autocomplete: 'off' });
      box.replaceChildren(s, nm);
      read = () => `stock:${s.value}${nm.value.trim() ? `&name:${nm.value.trim()}` : ''}`;
      return;
    }
    const hint = k === 'name' ? 'несколько вариантов — через |' : k === 'raw' ? 'например: category:ACC&name:…' : '';
    const t = el('input', { value: value || '', placeholder: hint, autocomplete: 'off', 'aria-label': title });
    box.replaceChildren(t);
    read = () => (k === 'raw' ? t.value.trim() : t.value.trim() ? `${k}:${t.value.trim()}` : '');
  };
  draw(init.kind, init.value, init.extra);
  kind.addEventListener('change', () => draw(kind.value, '', ''));
  return { node: el('label', {}, title, el('div', { class: 'inv-sel' }, kind, box)), value: () => read() };
}

export function defaultEditor(value) {
  const { el } = state.ctx;
  const init = parseDefault(value);
  const kind = selectEl('', DEFAULT_KINDS, init.kind);
  const text = el('input', { value: init.value, autocomplete: 'off', 'aria-label': 'Значение' });
  const update = () => { text.hidden = !['name', 'series', 'raw'].includes(kind.value); };
  kind.addEventListener('change', () => { text.value = ''; update(); });
  update();
  return {
    node: el('label', {}, 'Что предлагать первым', el('div', { class: 'inv-sel' }, kind, text)),
    value: () => {
      const k = kind.value;
      const t = text.value.trim();
      if (k === 'name' || k === 'series') return t ? `${k}:${t}` : 'auto';
      if (k === 'raw') return t || 'auto';
      return k;
    }
  };
}

export function openRuleForm(rule) {
  const { el } = state.ctx;
  const isNew = !rule;
  const r = rule || { qty: 1, default: 'auto', required: 'yes', match: '' };
  const err = el('div');
  const applies = selectorEditor('К чему', APPLY_KINDS, r.applies_to);
  const pick = selectorEditor('Что добавлять', PICK_KINDS, r.pick_from);
  const slot = el('input', { name: 'slot', value: r.slot || '', required: true, autocomplete: 'off', placeholder: 'Как называть в брони' });
  const qty = el('input', { name: 'qty', type: 'number', min: 1, step: 1, inputmode: 'numeric', value: r.qty || 1 });
  const def = defaultEditor(r.default);
  const required = selectEl('required', [
    ['yes', 'Обязательно — без него бронь не подтвердить'],
    ['warn', 'Предупреждать, если не хватает'],
    ['no', 'По желанию — молча']
  ], isYes(r.required) ? 'yes' : /^warn$/i.test(String(r.required)) ? 'warn' : 'no');
  const current = matchList(r.match);
  const matchBoxes = Object.entries(MATCH_NAMES).map(([k, t]) => {
    const box = el('input', { type: 'checkbox', value: k, checked: current.includes(k) });
    return { k, box, node: el('label', { class: 'check-row' }, box, t) };
  });
  const unknownMatch = current.filter((k) => !MATCH_NAMES[k]);
  const notes = el('textarea', { name: 'notes', rows: 2 }, r.notes || '');

  const form = el('form', {
    class: 'form',
    onsubmit: (e) => {
      e.preventDefault();
      const data = {
        applies_to: applies.value(), slot: slot.value.trim(), pick_from: pick.value(), qty: qty.value,
        default: def.value(), required: required.value,
        match: matchBoxes.filter((m) => m.box.checked).map((m) => m.k).concat(unknownMatch).join(','),
        notes: notes.value.trim()
      };
      if (rule) data.id = rule.id;
      saveRule(form, { rule: data }, err, rule ? 'Сохранено' : null);
    }
  },
  applies.node,
  field('Слот', slot),
  pick.node,
  el('div', { class: 'inv-grid' }, field('Сколько', qty), def.node),
  field('Если не хватает', required),
  el('fieldset', { class: 'inv-fieldset' }, el('legend', {}, 'Совпадение с основной позицией'), matchBoxes.map((m) => m.node)),
  field('Заметки', notes),
  err,
  el('div', { class: 'inv-form-buttons' },
    el('button', { class: 'button primary', type: 'submit' }, isNew ? 'Создать' : 'Сохранить'),
    el('button', { class: 'button', type: 'button', onclick: () => state.dialog.close() }, 'Отмена'),
    !isNew && el('button', {
      class: 'button danger', type: 'button',
      onclick: () => {
        if (confirm(`Удалить правило ${rule.id} «${rule.slot}»?`)) saveRule(form, { rule: { id: rule.id }, delete: true }, err, `Правило ${rule.id} удалено`);
      }
    }, 'Удалить')));
  showDialog(isNew ? 'Новое правило' : `Правило ${rule.id}`, form);
}

export async function saveRule(form, params, err, doneText) {
  const { el, call } = state.ctx;
  err.replaceChildren();
  setBusy(form, true);
  try {
    const before = new Set((cat().kitRules || []).map((r) => r.id));
    const res = await call('kit_rule_save', params);
    await state.ctx.reloadCatalog();
    const created = (res.rules || []).find((r) => !before.has(r.id));
    state.dialog.close();
    renderKits([{ kind: 'ok', text: doneText || `Создано правило ${created ? created.id : ''}`.trim() }]);
  } catch (e) {
    setBusy(form, false);
    err.replaceChildren(el('div', { class: 'notice bad' }, e.message));
  }
}

// ---------- мелочи ----------
