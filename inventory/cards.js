import { deleteRecords, renderList } from '../inventory.js';
import { FIELD_NAMES, LOG_ACTIONS, cat, editable, fmtNum, fmtStamp, notices, ownerLabel, priceLabel, saveInBackground, showDialog, state, statusBadge } from './shared.js';
import { openItemForm, showsBand } from './item-form.js';
import { openStockForm } from './stock-form.js';
import { bandText } from './directories.js';

// Инвентарь: карточки позиции и расходника, статусы (ремонт, списание), история.

// Карточки ещё нет в загруженном каталоге (только что создана — «Открыть» из уведомления раньше,
// чем обновились данные): подтянуть каталог и открыть; не нашлась и после этого — сообщить.
const reloading = new Set();
function openAfterReload(id, kind, extra) {
  const { el } = state.ctx;
  const missing = kind === 'item' ? 'Позиция не найдена' : 'Расходник не найден';
  if (reloading.has(id)) return showDialog(id, el('div', { class: 'notice bad' }, missing));
  showDialog(id, el('p', { class: 'muted' }, 'Загружаю…'));
  reloading.add(id);
  state.ctx.reloadCatalog().catch(() => null).then(() => {
    if (!state.dialog.open) return; // окно уже закрыли
    if (kind === 'item') openItem(id, extra);
    else openStock(id, extra);
  }).finally(() => reloading.delete(id));
}

export function openItem(id, extra = []) {
  const { el } = state.ctx;
  const c = cat();
  const i = (c.items || []).find((x) => x.id === id);
  if (!i) return openAfterReload(id, 'item', extra);
  const rf = showsBand(i.category, i.subtype) || i.band || i.series || i.pair_no;
  const rows = [
    ['Код', el('span', { class: 'code' }, i.id)],
    ['Владелец', ownerLabel(i.owner)],
    ['Название', i.name],
    ['Метка', i.label],
    ['Категория', c.categories?.[i.category] || i.category],
    ['Тип', c.subtypes?.[i.subtype] || i.subtype],
    ['Модель', i.model],
    rf && ['Серия', i.series],
    rf && ['Диапазон', bandText(i.band)],
    rf && ['Номер пары', i.pair_no],
    (i.category === 'BOOM' || i.length_m) && ['Длина', i.length_m ? `${fmtNum(i.length_m)} м` : ''],
    ['Серийный номер', i.serial],
    ['Производитель', i.manufacturer],
    ['Страна', i.origin_country],
    ['Стоимость', i.value_rub ? `${fmtNum(i.value_rub)} ₽` : ''],
    ['Прейскурант', priceLabel(i.price_name)],
    ['Статус', statusBadge(i.status) || (c.itemStatuses?.[i.status] || i.status || 'в строю')],
    ['Заметки', i.notes && el('span', { class: 'inv-pre' }, i.notes)]
  ].filter(Boolean);
  const statusBox = el('div', { class: 'inv-status-box' });
  showDialog(i.name, ...notices(extra), fieldList(rows), itemActions(i, statusBox), statusBox, historyBox(i.id));
  state.shown = { kind: 'item', id: i.id };
}

export function fieldList(rows) {
  const { el } = state.ctx;
  return el('dl', { class: 'inv-fields' }, rows.flatMap(([k, v]) => [
    el('dt', {}, k),
    el('dd', {}, v === '' || v === null || v === undefined ? el('span', { class: 'inv-empty' }, '—') : v)
  ]));
}

export function itemActions(i, statusBox) {
  const { el, can } = state.ctx;
  const btn = (text, onclick, cls = '') => el('button', { class: `button small ${cls}`, type: 'button', onclick }, text);
  const list = [];
  if (editable()) list.push(btn('Изменить', () => openItemForm(i)));
  if (can('retire')) {
    if (i.status === 'active' || !i.status) list.push(btn('В ремонт', () => statusForm(i, 'repair', statusBox)));
    if (i.status === 'repair' || i.status === 'retired') list.push(btn('Вернуть в строй', () => setStatus(i, 'active', '')));
    if (i.status !== 'retired') list.push(btn('Списать', () => statusForm(i, 'retired', statusBox), 'danger'));
  }
  // Удалить — только заведённое по ошибке, ни разу не бывшее в бронях (иначе сервер откажет).
  if (editable()) list.push(btn('Удалить', () => deleteRecords([i.id]), 'danger'));
  return list.length ? el('div', { class: 'inv-card-actions' }, list) : null;
}

// Причина ремонта (по желанию) или списания (обязательно): сервер добавит её с датой в заметки и в журнал.
export function statusForm(i, status, box) {
  const { el } = state.ctx;
  const retire = status === 'retired';
  const note = el('textarea', {
    name: 'reason', rows: 3, required: retire, maxlength: 1000,
    placeholder: retire ? 'Например: сломан разъём, ремонт дороже новой' : 'Что случилось'
  });
  const form = el('form', {
    class: 'form inv-inline-form',
    onsubmit: (e) => {
      e.preventDefault();
      const reason = note.value.trim();
      if (retire && !reason) {
        note.setCustomValidity('Укажите причину списания');
        note.reportValidity();
        return;
      }
      setStatus(i, status, reason);
    }
  },
  retire && el('div', { class: 'notice warn' }, `${i.id} пропадёт из подбора; код останется за позицией.`),
  el('label', {}, retire ? 'Причина списания *' : 'Заметка о ремонте (добавится в заметки)', note),
  el('div', { class: 'inv-form-buttons' },
    el('button', { class: `button ${retire ? 'danger' : 'primary'}`, type: 'submit' }, retire ? 'Списать' : 'Отправить в ремонт'),
    el('button', { class: 'button', type: 'button', onclick: () => box.replaceChildren() }, 'Отмена')));
  note.addEventListener('input', () => note.setCustomValidity(''));
  box.replaceChildren(form);
  note.focus();
}

// Смена статуса — в фоне: карточка сразу показывает новый статус, ответ сервера приходит уведомлением.
export function setStatus(i, status, reason) {
  const label = cat().itemStatuses?.[status] || status;
  const item = (cat().items || []).find((x) => x.id === i.id);
  if (item) item.status = status;
  renderList();
  openItem(i.id, [{ kind: 'info', text: `Статус «${label}» сохраняется…` }]);
  const send = () => saveInBackground({
    kind: 'item', id: i.id, label: `${i.id}: ${label}`,
    task: () => state.ctx.call('item_save', { item: { id: i.id }, status, reason }),
    done: (res) => ({ id: res.item.id, text: `${res.item.id}: статус «${label}»`, warnings: res.warnings }),
    retry: () => send()
  });
  send();
}

export function openStock(id, extra = []) {
  const { el } = state.ctx;
  const c = cat();
  const s = (c.stock || []).find((x) => x.id === id);
  if (!s) return openAfterReload(id, 'stock', extra);
  const rows = [
    ['Код', el('span', { class: 'code' }, s.id)],
    ['Владелец', ownerLabel(s.owner)],
    ['Название', s.name],
    ['Категория', c.stockCategories?.[s.category] || s.category],
    ['Количество', `${s.qty_total ?? 0} шт.`],
    (s.category === 'cable' || s.length_m) && ['Длина', s.length_m ? `${fmtNum(s.length_m)} м` : ''],
    (s.category === 'media' || s.capacity) && ['Объём', s.capacity || ''],
    ['Прейскурант', s.price_name ? priceLabel(s.price_name) : 'не привязан — бесплатно'],
    ['Заметки', s.notes && el('span', { class: 'inv-pre' }, s.notes)]
  ].filter(Boolean);
  const actions = editable() && el('div', { class: 'inv-card-actions' },
    el('button', { class: 'button small', type: 'button', onclick: () => openStockForm(s) }, 'Изменить'),
    el('button', { class: 'button small danger', type: 'button', onclick: () => deleteRecords([s.id]) }, 'Удалить'));
  showDialog(s.name, ...notices(extra), fieldList(rows), actions, historyBox(s.id));
  state.shown = { kind: 'stock', id: s.id };
}

// ---------- история ----------

export function historyBox(id) {
  const { el, call } = state.ctx;
  const box = el('section', { class: 'inv-history' }, el('h3', {}, 'История'), el('p', { class: 'muted' }, 'Загрузка…'));
  call('item_history', { id })
    .then((h) => box.replaceChildren(el('h3', {}, 'История'), ...historyContent(h)))
    .catch((err) => box.replaceChildren(el('h3', {}, 'История'), el('div', { class: 'notice bad' }, err.message)));
  return box;
}

export function historyContent({ bookings = [], log = [] }) {
  const { el } = state.ctx;
  const out = [];
  out.push(el('h4', {}, 'Брони'));
  out.push(bookings.length
    ? el('ul', { class: 'list' }, bookings.map(bookingRow))
    : el('p', { class: 'muted' }, 'Ещё не была в бронях.'));
  out.push(el('h4', {}, 'Изменения'));
  out.push(log.length
    ? el('ul', { class: 'list inv-log' }, log.map(logRow))
    : el('p', { class: 'muted' }, 'Изменений не записано.'));
  return out;
}

export function bookingRow(b) {
  const { el, formatSpan, STATUS, openBooking } = state.ctx;
  const marks = [
    b.qty > 1 && `${b.qty} шт.`,
    b.out_at && `выдано ${fmtStamp(b.out_at)}`,
    b.returned_at && `возвращено ${fmtStamp(b.returned_at)}`
  ].filter(Boolean).join(' · ');
  return el('li', {}, el('button', {
    class: 'row', type: 'button',
    onclick: () => { state.dialog.close(); openBooking(b.id); }
  },
  el('span', { class: 'dates-cell' }, formatSpan(b)),
  el('span', { class: 'name' }, b.client_name || '—', el('span', { class: 'note' }, [b.id, marks].filter(Boolean).join(' · '))),
  el('span', { class: `badge st-${b.status}` }, STATUS[b.status] || b.status)));
}

export function logRow(entry) {
  const { el } = state.ctx;
  const d = entry.details && typeof entry.details === 'object' ? entry.details : null;
  const changes = d?.changes ? Object.entries(d.changes) : [];
  let summary = '';
  if (!changes.length && d?.name) summary = `«${d.name}»${d.qty !== undefined ? `, ${d.qty} шт.` : ''}`;
  if (!d && entry.details) summary = String(entry.details);
  return el('li', { class: 'inv-log-row' },
    el('div', { class: 'inv-log-head' },
      el('strong', {}, LOG_ACTIONS[entry.action] || entry.action),
      el('span', { class: 'note' }, [entry.ts, entry.user].filter(Boolean).join(' · '))),
    summary && el('div', {}, summary),
    d?.reason && el('div', {}, el('span', { class: 'inv-muted' }, 'Причина: '), d.reason),
    changes.length > 0 && el('ul', { class: 'inv-changes' }, changes.map(([f, [from, to] = []]) =>
      el('li', {}, el('span', { class: 'inv-muted' }, `${FIELD_NAMES[f] || f}: `),
        `${showValue(f, from)} → ${showValue(f, to)}`))));
}

export function showValue(field, v) {
  if (v === '' || v === null || v === undefined) return '—';
  const c = cat();
  if (field === 'category') return c.categories?.[v] || c.stockCategories?.[v] || v;
  if (field === 'subtype') return c.subtypes?.[v] || v;
  if (field === 'status') return c.itemStatuses?.[v] || v;
  if (field === 'band') return bandText(v);
  if (field === 'price_name') return priceLabel(v);
  return String(v);
}

// ---------- форма позиции ----------
