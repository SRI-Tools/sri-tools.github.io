// Этикетки: список кодов для ввода на принтере этикеток (CODE128) и лист QR-кодов для печати.

import { el, rankResults } from './format.js';

let qrPromise = null;
function loadQr() {
  if (!qrPromise) {
    qrPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/qrcode.min.js'; // qrcode-generator 1.4.4
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR не загрузился')));
      s.onerror = () => reject(new Error('QR не загрузился'));
      document.head.append(s);
    });
  }
  return qrPromise;
}

function qrSvg(qrcode, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

export function renderLabels(container, catalog) {
  const selected = new Set();
  const state = { query: '', mode: 'codes', size: 25, withName: false };

  const search = el('input', { type: 'search', placeholder: 'Поиск по коду, названию, метке', autocomplete: 'off' });
  const listBox = el('div');
  const outBox = el('div', { class: 'labels-out' });
  const counter = el('span', { class: 'muted' });

  const visibleItems = () => {
    const items = catalog.items.filter((i) => i.status !== 'retired');
    return state.query
      ? rankResults(items, state.query).map((e) => e.x)
      : items.slice().sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }));
  };

  const modeSelect = el('select', { 'aria-label': 'Вид этикеток' },
    el('option', { value: 'codes' }, 'Коды для принтера (CODE128)'),
    el('option', { value: 'qr' }, 'QR-коды для печати'));
  const sizeSelect = el('select', { 'aria-label': 'Размер QR' },
    [20, 25, 30, 40].map((mm) => el('option', { value: String(mm), selected: mm === state.size }, `${mm} мм`)));
  const nameBox = el('input', { type: 'checkbox' });

  container.replaceChildren(
    el('div', { class: 'toolbar search-row' }, search),
    el('div', { class: 'row-between labels-tools' },
      counter,
      el('span', {},
        el('button', { type: 'button', class: 'button small', onclick: () => { visibleItems().forEach((i) => selected.add(i.id)); draw(); } }, 'Все'),
        ' ',
        el('button', { type: 'button', class: 'button small', onclick: () => { selected.clear(); draw(); } }, 'Снять'))),
    listBox,
    el('div', { class: 'panel form labels-form' },
      el('label', {}, 'Вид', modeSelect),
      el('label', { class: 'qr-only' }, 'Размер QR', sizeSelect),
      el('label', { class: 'check-row qr-only' }, nameBox, ' подписывать названием')),
    outBox
  );

  search.addEventListener('input', () => { state.query = search.value.trim().toLowerCase(); draw(); });
  modeSelect.addEventListener('change', () => { state.mode = modeSelect.value; drawOut(); });
  sizeSelect.addEventListener('change', () => { state.size = +sizeSelect.value; drawOut(); });
  nameBox.addEventListener('change', () => { state.withName = nameBox.checked; drawOut(); });

  function draw() {
    const items = visibleItems();
    listBox.replaceChildren(el('ul', { class: 'list labels-list' }, items.map((it) => {
      const box = el('input', { type: 'checkbox', checked: selected.has(it.id) });
      box.addEventListener('change', () => {
        if (box.checked) selected.add(it.id);
        else selected.delete(it.id);
        drawOut();
      });
      return el('li', {}, el('label', { class: 'row pick' }, box,
        el('span', { class: 'code' }, it.id),
        el('span', { class: 'name' }, it.name, it.label ? el('span', { class: 'label' }, it.label) : null)));
    })));
    drawOut();
  }

  async function drawOut() {
    const chosen = catalog.items.filter((i) => selected.has(i.id))
      .sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }));
    counter.textContent = `Выбрано: ${chosen.length}`;
    container.querySelectorAll('.qr-only').forEach((n) => { n.hidden = state.mode !== 'qr'; });
    if (!chosen.length) {
      outBox.replaceChildren(el('p', { class: 'muted' }, 'Отметьте позиции в списке.'));
      return;
    }

    if (state.mode === 'codes') {
      const text = chosen.map((i) => i.id).join('\n');
      const area = el('textarea', { readonly: true, rows: Math.min(chosen.length, 12) }, text);
      outBox.replaceChildren(
        el('p', { class: 'muted' }, 'На принтере: Barcode → CODE128, Width: Large, Bottom Text: ON. Коды введите по одному.'),
        area,
        el('button', {
          type: 'button', class: 'button',
          onclick: async (e) => {
            try {
              await navigator.clipboard.writeText(text);
              e.target.textContent = 'Скопировано';
            } catch {
              area.select();
            }
          }
        }, 'Копировать'));
      return;
    }

    let qrcode;
    try {
      qrcode = await loadQr();
    } catch (err) {
      outBox.replaceChildren(el('div', { class: 'notice bad' }, err.message));
      return;
    }
    const sheet = el('div', { id: 'label-sheet', class: 'label-sheet', style: `--qr:${state.size}mm` });
    chosen.forEach((i) => {
      const card = el('div', { class: 'label-card' });
      const pic = el('div', { class: 'label-qr' });
      pic.innerHTML = qrSvg(qrcode, i.id); // SVG от библиотеки, содержимое — только код позиции
      card.append(pic, el('div', { class: 'label-code' }, i.id),
        state.withName ? el('div', { class: 'label-name' }, i.label || i.name) : '');
      sheet.append(card);
    });
    outBox.replaceChildren(
      el('div', { class: 'row-between' },
        el('span', { class: 'muted' }, 'Предпросмотр. Печатается только лист с кодами.'),
        el('button', { type: 'button', class: 'button primary', onclick: () => window.print() }, 'Печать')),
      sheet);
  }

  draw();
}
