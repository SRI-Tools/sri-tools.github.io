// Экран «Клиенты»: список с поиском, карточка клиента с историей броней, форма правки.
// Маршруты: #/clients — список, #/clients/C0001 — карточка, #/clients/new — новый клиент.
import { swapLayout, formatPhone, phoneInput, setChildren } from './format.js';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DEFAULT_TYPES = { person: 'Физлицо', ip: 'ИП', company: 'Организация' };

// Поля формы. types — для каких типов клиента поле показывается; label — подпись (или по типу).
const FIELDS = [
  { key: 'name', label: { person: 'ФИО', ip: 'Как называть в списке', company: 'Как называть в списке' }, types: ['person', 'ip', 'company'], required: true, placeholder: { person: 'Иванов Иван Иванович', ip: 'ИП Иванов', company: 'ООО «Ромашка»' } },
  { key: 'phone', label: 'Телефон', types: ['person', 'ip', 'company'], input: 'tel', placeholder: '+7 …' },
  { key: 'email', label: 'E-mail', types: ['person', 'ip', 'company'], input: 'email' },
  { key: 'company', label: { ip: 'Полное название (ИП ФИО полностью)', company: 'Полное название организации' }, types: ['ip', 'company'] },
  { key: 'inn', label: 'ИНН', types: ['ip', 'company'], digits: { ip: [12], company: [10] } },
  { key: 'kpp', label: 'КПП', types: ['company'], digits: { company: [9] } },
  { key: 'ogrn', label: { ip: 'ОГРНИП', company: 'ОГРН' }, types: ['ip', 'company'], digits: { ip: [15], company: [13] } },
  { key: 'address', label: 'Юридический адрес', types: ['ip', 'company'], textarea: true },
  { key: 'bank', label: 'Банк', types: ['ip', 'company'] },
  { key: 'bik', label: 'БИК', types: ['ip', 'company'], digits: { ip: [9], company: [9] } },
  { key: 'account', label: 'Расчётный счёт', types: ['ip', 'company'], digits: { ip: [20], company: [20] } },
  { key: 'corr_account', label: 'Корреспондентский счёт', types: ['ip', 'company'], digits: { ip: [20], company: [20] } },
  { key: 'representative', label: 'Представитель (ФИО, должность)', types: ['ip', 'company'], placeholder: 'Иванов И. И., директор' },
  { key: 'notes', label: 'Заметки', types: ['person', 'ip', 'company'], textarea: true }
];

// Реквизиты в карточке, по порядку.
const REQUISITES = ['company', 'inn', 'kpp', 'ogrn', 'address', 'bank', 'bik', 'account', 'corr_account', 'representative'];

// Строка поиска переживает переходы список ↔ карточка.
const state = { query: '' };
let renderSeq = 0;

export function renderClients(container, ctx, clientId) {
  const seq = ++renderSeq;
  const alive = () => seq === renderSeq;
  if (clientId === 'new' && ctx.can('clients')) return renderNew(container, ctx);
  if (clientId && clientId !== 'new') return renderCard(container, ctx, clientId, alive);
  return renderList(container, ctx, alive);
}

// ---------- общее ----------

function fieldLabel(field, type) {
  return typeof field.label === 'string' ? field.label : field.label[type] || field.label.company;
}

function shortDate(iso) {
  const [y, m, d] = String(iso).split('-');
  if (!d) return '';
  const year = +y !== new Date().getFullYear() ? ` ${y}` : '';
  return `${+d} ${MONTHS[+m - 1]}${year}`;
}

// 1 бронь, 2 брони, 5 броней.
function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function countText(n) {
  return `${n} ${plural(n, 'бронь', 'брони', 'броней')}`;
}

// Цифры телефона без кода страны: «+7 (900) 000-00-01» и «89000000001» → «9000000001».
function phoneDigits(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  return d;
}

function typeBadge(ctx, types, type) {
  if (!type || type === 'person') return null;
  return ctx.el('span', { class: 'badge cl-type' }, types[type] || type);
}

function loading(ctx) {
  return ctx.el('p', { class: 'muted' }, 'Загрузка…');
}

// ---------- список ----------

async function renderList(container, ctx, alive) {
  const { el } = ctx;
  const input = el('input', {
    type: 'search', placeholder: 'Имя, телефон, e-mail, ИНН', 'aria-label': 'Поиск клиента', value: state.query
  });
  const add = ctx.can('clients') ? el('a', { class: 'button primary', href: '#/clients/new' }, '+ Клиент') : null;
  const body = el('div', { class: 'cl-list' }, loading(ctx));
  container.replaceChildren(el('div', { class: 'toolbar search-row' }, input, add), body);

  // Сначала список с устройства (мгновенно), затем свежий с сервера, если он отличается.
  let types = DEFAULT_TYPES;
  let all = null;
  const draw = () => { if (all) body.replaceChildren(listBody(ctx, types, filterClients(all, state.query), all.length)); };
  const use = (data) => { types = data.types || DEFAULT_TYPES; all = sortClients(data.clients || []); draw(); };
  input.addEventListener('input', () => { state.query = input.value; draw(); });
  const cached = ctx.peek('clients');
  if (cached) use(cached);

  const data = await ctx.guarded(() => ctx.call('clients'));
  if (!alive()) return;
  if (!data) {
    if (!cached) body.replaceChildren(el('p', { class: 'muted' }, 'Не удалось загрузить список клиентов.'));
    return;
  }
  if (!cached || JSON.stringify(data) !== JSON.stringify(cached)) use(data);
}

// Сначала недавние клиенты, потом без броней — по имени.
function sortClients(list) {
  return list.slice().sort((a, b) => String(b.last || '').localeCompare(String(a.last || ''))
    || String(a.name).localeCompare(String(b.name), 'ru'));
}

function filterClients(list, query) {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return list;
  // и в другой раскладке, если её забыли переключить: «bdfyjd» → «иванов»
  const alt = swapLayout(q).replace(/ё/g, 'е');
  const digits = q.replace(/\D/g, '');
  // «8 900…» и «+7 900…» — без кода страны.
  const qPhone = /^[78]\d{3}/.test(digits) ? digits.slice(1) : digits;
  // Телефон ищем по цифрам, если в запросе нет букв: «900 000», «+7 900», «8900…».
  const phoneQuery = digits.length >= 3 && !/[a-zа-я]/i.test(q);
  return list.filter((c) => {
    const text = [c.name, c.email, c.company, c.inn].join('\n').toLowerCase().replace(/ё/g, 'е');
    if (text.includes(q) || (alt !== q && text.includes(alt))) return true;
    if (!phoneQuery) return false;
    const p = String(c.phone || '').replace(/\D/g, '');
    return p.includes(digits) || (p && phoneDigits(c.phone).includes(qPhone)) || String(c.inn || '').includes(digits);
  });
}

function listBody(ctx, types, list, total) {
  const { el } = ctx;
  if (!total) {
    return el('div', { class: 'panel cl-empty' },
      el('p', {}, 'Клиентов пока нет.'),
      el('p', { class: 'muted' }, ctx.can('clients')
        ? 'Добавьте клиента кнопкой «+ Клиент» — или он появится сам при первой брони.'
        : 'Клиенты появятся здесь после первой брони.'));
  }
  if (!list.length) return el('p', { class: 'muted cl-empty' }, 'Никого не нашлось. Попробуйте часть имени или последние цифры телефона.');
  return el('ul', { class: 'list' }, list.map((c) => el('li', {}, clientRow(ctx, types, c))));
}

function clientRow(ctx, types, c) {
  const { el } = ctx;
  const stats = c.bookings
    ? `${countText(+c.bookings)}${c.last ? ` · последняя ${shortDate(c.last)}` : ''}`
    : 'броней нет';
  return el('a', { class: 'row cl-row', href: `#/clients/${encodeURIComponent(c.id)}` },
    el('div', { class: 'name' },
      el('div', { class: 'cl-row-title' }, el('span', { class: 'cl-name' }, c.name), typeBadge(ctx, types, c.type)),
      c.phone ? el('span', { class: 'note cl-phone' }, formatPhone(c.phone)) : null,
      el('span', { class: 'note' }, stats)),
    el('span', { class: 'cl-chevron', 'aria-hidden': 'true' }, '›'));
}

// ---------- карточка ----------

async function renderCard(container, ctx, id, alive) {
  const { el } = ctx;
  const back = el('a', { class: 'cl-back', href: '#/clients' }, '← Клиенты');
  container.replaceChildren(back, loading(ctx));
  const data = await ctx.guarded(() => ctx.call('client', { id }));
  if (!alive()) return;
  if (!data) {
    container.replaceChildren(back, el('div', { class: 'notice bad' }, `Клиент ${id} не найден или не загрузился.`));
    return;
  }
  showCard(container, ctx, data);
}

function showCard(container, ctx, data) {
  const { el } = ctx;
  const { client, bookings = [] } = data;
  const types = data.types || DEFAULT_TYPES;
  const edit = () => container.replaceChildren(
    el('a', { class: 'cl-back', href: '#/clients' }, '← Клиенты'),
    el('h2', { class: 'view-title cl-title' }, 'Изменить клиента'),
    clientForm(ctx, types, client, {
      onSaved: (saved) => showCard(container, ctx, { ...data, client: saved, bookings: renamed(bookings, saved) }),
      onCancel: () => showCard(container, ctx, data)
    }));

  setChildren(container, [
    el('a', { class: 'cl-back', href: '#/clients' }, '← Клиенты'),
    cardHead(ctx, types, client, edit),
    contactsBlock(ctx, client),
    requisitesBlock(ctx, client),
    historyBlock(ctx, bookings),
    deleteBlock(ctx, client, bookings)
  ]);
}

// Удалить можно только клиента без действующих броней (сервер проверяет то же).
function deleteBlock(ctx, client, bookings) {
  const { el } = ctx;
  if (!ctx.can('clients') || bookings.some((b) => b.status !== 'cancelled')) return null;
  const status = el('div', {});
  const button = el('button', { type: 'button', class: 'button danger' }, 'Удалить клиента');
  button.addEventListener('click', async () => {
    if (!confirm(`Удалить клиента «${client.name}»? Это действие нельзя отменить.`)) return;
    button.disabled = true;
    try {
      await ctx.call('client_delete', { id: client.id });
      location.hash = '#/clients';
    } catch (err) {
      status.replaceChildren(el('div', { class: 'notice bad' }, err.message || 'Не удалось удалить'));
      button.disabled = false;
    }
  });
  return el('div', { class: 'cl-delete' }, button, status);
}

// После переименования брони клиента тоже переименованы на сервере.
function renamed(bookings, client) {
  return bookings.map((b) => ({ ...b, client_name: client.name }));
}

function cardHead(ctx, types, client, onEdit) {
  const { el } = ctx;
  const buttons = el('div', { class: 'cl-head-actions' },
    ctx.can('clients') ? el('button', { type: 'button', class: 'button', onclick: onEdit }, 'Изменить') : null,
    ctx.can('bookings')
      ? el('button', {
        type: 'button', class: 'button primary',
        onclick: () => ctx.newBookingFor({ id: client.id, name: client.name, phone: client.phone })
      }, 'Новая бронь')
      : null);
  return el('div', { class: 'cl-head' },
    el('div', { class: 'cl-head-title' },
      el('h2', { class: 'view-title' }, client.name),
      el('span', { class: 'muted cl-head-type' }, types[client.type] || types.person)),
    buttons.childElementCount ? buttons : null);
}

function contactsBlock(ctx, c) {
  const { el } = ctx;
  const rows = [];
  if (c.phone) rows.push(['Телефон', el('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, formatPhone(c.phone))]);
  if (c.email) rows.push(['E-mail', el('a', { href: `mailto:${c.email}` }, c.email)]);
  if (c.notes) rows.push(['Заметки', el('span', { class: 'cl-pre' }, c.notes)]);
  return el('div', { class: 'panel cl-block' },
    el('h3', { class: 'cl-block-title' }, 'Контакты'),
    rows.length ? defList(ctx, rows) : el('p', { class: 'muted cl-none' }, 'Контакты не указаны.'));
}

function requisitesBlock(ctx, c) {
  const { el } = ctx;
  if (c.type !== 'ip' && c.type !== 'company') return null;
  const rows = REQUISITES.filter((k) => c[k] && (k !== 'kpp' || c.type === 'company'))
    .map((k) => [fieldLabel(FIELDS.find((f) => f.key === k), c.type), el('span', { class: 'cl-pre' }, c[k])]);
  return el('div', { class: 'panel cl-block' },
    el('h3', { class: 'cl-block-title' }, 'Реквизиты'),
    rows.length ? defList(ctx, rows) : el('p', { class: 'muted cl-none' }, 'Реквизиты не заполнены.'));
}

function defList(ctx, rows) {
  const { el } = ctx;
  return el('dl', { class: 'cl-dl' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function historyBlock(ctx, bookings) {
  const { el } = ctx;
  const active = bookings.filter((b) => b.status !== 'cancelled').length;
  const summary = bookings.length
    ? `Всего: ${countText(active)}${active !== bookings.length ? `, отменено: ${bookings.length - active}` : ''}`
    : 'Броней пока нет.';
  return el('div', { class: 'group cl-history' },
    el('div', { class: 'section-head' }, el('h3', {}, 'История')),
    el('p', { class: 'muted' }, summary),
    bookings.length ? el('ul', { class: 'list' }, bookings.map((b) => el('li', {}, bookingRow(ctx, b)))) : null);
}

function bookingRow(ctx, b) {
  const { el } = ctx;
  return el('button', { type: 'button', class: 'row cl-booking', onclick: () => ctx.openBooking(b.id) },
    el('span', { class: 'dates-cell' }, ctx.formatSpan(b)),
    el('span', { class: 'name' },
      el('span', { class: 'cl-booking-id' }, b.id),
      el('span', { class: 'note' }, `${+b.count || 0} поз.`)),
    el('span', { class: `badge st-${b.status}` }, ctx.STATUS[b.status] || b.status));
}

// ---------- новый клиент ----------

function renderNew(container, ctx) {
  const { el } = ctx;
  container.replaceChildren(
    el('a', { class: 'cl-back', href: '#/clients' }, '← Клиенты'),
    el('h2', { class: 'view-title cl-title' }, 'Новый клиент'),
    clientForm(ctx, DEFAULT_TYPES, { type: 'person' }, {
      onSaved: (saved) => { location.hash = `#/clients/${encodeURIComponent(saved.id)}`; },
      onCancel: () => { location.hash = '#/clients'; }
    }));
  container.querySelector('input[name="name"]')?.focus();
}

// ---------- форма ----------

function clientForm(ctx, types, client, { onSaved, onCancel }) {
  const { el } = ctx;
  const typeSelect = el('select', { name: 'type' },
    Object.entries(types).map(([k, v]) => el('option', { value: k }, v)));
  typeSelect.value = types[client.type] ? client.type : 'person';

  const inputs = {};
  const wraps = FIELDS.map((f) => {
    const input = fieldInput(ctx, f, client[f.key]);
    const caption = el('span', {});
    const error = el('span', { class: 'note bad', hidden: true, 'aria-live': 'polite' });
    inputs[f.key] = { field: f, input, caption, error };
    input.addEventListener('blur', () => showError(inputs[f.key], typeSelect.value));
    input.addEventListener('input', () => { if (!inputs[f.key].error.hidden) showError(inputs[f.key], typeSelect.value); });
    return el('label', { class: f.textarea ? 'cl-wide' : '' }, caption, input, error);
  });

  const requisitesTitle = el('h3', { class: 'cl-form-section' }, 'Реквизиты');
  const status = el('div', {});
  const save = el('button', { type: 'submit', class: 'button primary' }, 'Сохранить');
  const form = el('form', { class: 'panel form cl-form', novalidate: true, autocomplete: 'off' },
    el('label', {}, 'Тип', typeSelect),
    wraps.slice(0, 3),
    requisitesTitle,
    wraps.slice(3),
    el('p', { class: 'notice cl-passport' }, 'Паспортные данные не храним — для договора клиент заполнит их сам.'),
    status,
    el('div', { class: 'actions cl-actions' },
      el('button', { type: 'button', class: 'button', onclick: onCancel }, 'Отмена'),
      save));

  const applyType = () => {
    const type = typeSelect.value;
    requisitesTitle.hidden = type === 'person';
    Object.values(inputs).forEach((x) => {
      const shown = x.field.types.includes(type);
      x.input.closest('label').hidden = !shown;
      x.caption.textContent = fieldLabel(x.field, type) + (x.field.required ? ' *' : '');
      const ph = x.field.placeholder;
      if (ph) x.input.placeholder = typeof ph === 'string' ? ph : ph[type];
      if (!x.error.hidden) showError(x, type);
    });
  };
  typeSelect.addEventListener('change', applyType);
  applyType();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = typeSelect.value;
    const bad = Object.values(inputs).filter((x) => x.field.types.includes(type) && showError(x, type));
    if (bad.length) {
      status.replaceChildren(el('div', { class: 'notice bad' }, 'Проверьте выделенные поля.'));
      bad[0].input.focus();
      return;
    }
    // Смена типа скрывает часть реквизитов — они не сохранятся; спрашиваем, если там что-то было.
    const dropped = Object.values(inputs).filter((x) => !x.field.types.includes(type) && fieldValue(x));
    if (dropped.length && !confirm(`Для этого типа не сохранятся: ${dropped.map((x) => fieldLabel(x.field, client.type || 'company')).join(', ')}. Продолжить?`)) return;
    save.disabled = true;
    status.replaceChildren(el('p', { class: 'muted' }, 'Сохраняю…'));
    try {
      const res = await ctx.call('client_save', { client: collect(client, inputs, type) });
      onSaved(res.client);
    } catch (err) {
      status.replaceChildren(el('div', { class: 'notice bad' }, err.message || 'Не удалось сохранить'));
      save.disabled = false;
    }
  });
  return form;
}

function fieldInput(ctx, f, value) {
  const { el } = ctx;
  const attrs = { name: f.key, maxlength: f.textarea ? 1000 : 200 };
  if (f.textarea) return Object.assign(el('textarea', { ...attrs, rows: 2 }), { value: value || '' });
  if (f.input) attrs.type = f.input;
  if (f.digits) Object.assign(attrs, { inputmode: 'numeric', maxlength: 40 });
  if (f.input === 'email') attrs.inputmode = 'email';
  const input = Object.assign(el('input', attrs), { value: f.input === 'tel' ? formatPhone(value) : value || '' });
  return f.input === 'tel' ? phoneInput(input) : input;
}

// Значение поля для сохранения: у цифровых полей убираем пробелы и дефисы.
function fieldValue(x) {
  const v = x.input.value.trim();
  return x.field.digits ? v.replace(/[\s-]/g, '') : v;
}

// Текст ошибки поля или '' — то же, что проверяет сервер, плюс длины реквизитов по типу клиента.
function fieldError(x, type) {
  const v = fieldValue(x);
  const f = x.field;
  if (f.required && !v) return type === 'person' ? 'Укажите имя' : 'Укажите название';
  if (!v) return '';
  if (f.input === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'Неверный e-mail';
  if (f.digits) {
    const lengths = f.digits[type] || [];
    if (!/^\d+$/.test(v)) return 'Только цифры';
    if (lengths.length && !lengths.includes(v.length)) {
      return `${fieldLabel(f, type)} — ${lengths.join(' или ')} ${plural(lengths[lengths.length - 1], 'цифра', 'цифры', 'цифр')}, сейчас ${v.length}`;
    }
  }
  return '';
}

// Показывает ошибку под полем; возвращает true, если поле с ошибкой.
function showError(x, type) {
  const msg = fieldError(x, type);
  x.error.textContent = msg;
  x.error.hidden = !msg;
  if (msg) x.input.setAttribute('aria-invalid', 'true');
  else x.input.removeAttribute('aria-invalid');
  return Boolean(msg);
}

// Поля, которые не относятся к типу, очищаем: у физлица реквизитов нет, у ИП нет КПП.
function collect(client, inputs, type) {
  const out = { type };
  if (client.id) out.id = client.id;
  Object.values(inputs).forEach((x) => {
    out[x.field.key] = x.field.types.includes(type) ? fieldValue(x) : '';
  });
  return out;
}
