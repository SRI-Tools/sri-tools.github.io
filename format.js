// Форматирование для интерфейса.

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export const STATUS = {
  draft: 'черновик',
  confirmed: 'подтверждена',
  out: 'выдана',
  returned: 'возвращена',
  cancelled: 'отменена'
};

export const ITEM_STATUS = { active: 'в строю', repair: 'в ремонте', retired: 'списано' };


// Сегодня в часовом поясе устройства, 'YYYY-MM-DD'.
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDate(iso) {
  const [, m, d] = String(iso).split('-');
  return `${+d} ${MONTHS[+m - 1]}`;
}

// «12–14 окт», «12 окт вечер – 14 окт утро».
export function formatSpan(b) {
  const sh = b.start_half || 'am';
  const eh = b.end_half || 'pm';
  const full = sh === 'am' && eh === 'pm';
  if (full && b.start === b.end) return shortDate(b.start);
  if (full && String(b.start).slice(0, 7) === String(b.end).slice(0, 7)) {
    return `${+String(b.start).slice(8)}–${shortDate(b.end)}`;
  }
  if (full) return `${shortDate(b.start)} – ${shortDate(b.end)}`;
  const half = (h) => (h === 'am' ? 'утро' : 'вечер');
  return `${shortDate(b.start)} ${half(sh)} – ${shortDate(b.end)} ${half(eh)}`;
}

// Дети узла: массивы разворачиваются, пустое (null, undefined, '', false) пропускается.
const kids = (children) => children.flat().filter((c) => c !== null && c !== undefined && c !== '' && c !== false);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === false || v === null || v === undefined) return;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  });
  node.append(...kids(children));
  return node;
}

// Заменить содержимое узла — с той же нормализацией, что в el() (replaceChildren выводит false/null текстом).
export function setChildren(node, ...children) {
  node.replaceChildren(...kids(children));
  return node;
}

// Телефон: «+7 915 067-77-21» для +7 и +1 (как на сервере, Clients.js formatPhone_). Остальное — как введено.
export function formatPhone(s) {
  const raw = String(s ?? '').trim();
  if (!raw || /[a-zа-я,;]/i.test(raw)) return raw;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
  else if (d.length === 10 && d[0] === '9') d = `7${d}`;
  if (d.length !== 11 || (d[0] !== '7' && d[0] !== '1')) return raw;
  const n = d.slice(1);
  return `+${d[0]} ${n.slice(0, 3)} ${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8)}`;
}

// Поле телефона: при выходе из поля номер приводится к виду «+7 915 067-77-21».
export function phoneInput(input) {
  input.addEventListener('blur', () => { input.value = formatPhone(input.value); });
  return input;
}

// Раскладка не переключена: «ящщь» → «zoom», и наоборот «rkbtyn» → «клиент».
const EN = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
const EN_TO_RU = Object.fromEntries([...EN].map((c, i) => [c, RU[i]]));
const RU_TO_EN = Object.fromEntries([...RU].map((c, i) => [c, EN[i]]));

export function swapLayout(q) {
  const s = String(q || '').toLowerCase();
  const map = /[а-яё]/.test(s) ? RU_TO_EN : EN_TO_RU;
  return [...s].map((c) => map[c] ?? c).join('');
}

// Запрос и он же в другой раскладке (если отличается). Для поиска «по любому из».
export function queryVariants(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  const alt = swapLayout(s);
  return alt !== s ? [s, alt] : [s];
}

// Насколько позиция подходит под поиск: 1 — в названии, 2 — в метке или коде,
// 3 — в типе, категории, модели или диапазоне, 4 — в серийнике; 0 — пустой запрос; -1 — не подходит.
// Запрос проверяется и в другой раскладке, берётся лучший ранг.
// type_name, category_name и band_name проставляются после загрузки каталога (см. app.js).
export function searchRank(x, q) {
  if (!q) return 0;
  const ranks = queryVariants(q).map((v) => rankOne(x, v)).filter((r) => r > 0);
  return ranks.length ? Math.min(...ranks) : -1;
}

function rankOne(x, q) {
  const has = (v) => String(v ?? '').toLowerCase().includes(q);
  if (has(x.name)) return 1;
  if (has(x.label) || has(x.id)) return 2;
  if (has(x.type_name) || has(x.category_name) || has(x.model) || has(x.band_name)) return 3;
  if (has(x.serial)) return 4;
  return -1;
}

// Найденное одним списком: сначала по названию, потом остальное; внутри — по коду.
export function rankResults(list, q) {
  return list
    .map((x) => ({ x, r: searchRank(x, q) }))
    .filter((e) => e.r > 0)
    .sort((a, b) => a.r - b.r || String(a.x.id).localeCompare(String(b.x.id), 'ru', { numeric: true }));
}
