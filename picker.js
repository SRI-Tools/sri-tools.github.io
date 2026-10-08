// Выбор оборудования на даты: свободные, занятые (с причиной) и пересекающиеся с черновиками.
// Используется в редакторе брони и на экране «Свободно».

import { el, formatSpan, STATUS, rankResults } from './format.js';

const BLOCKING = { confirmed: true, out: true };

function refText(r) {
  return `${r.booking_id} · ${r.client_name || 'без имени'} · ${formatSpan(r)}${r.overdue ? ' · не вернули в срок' : ''}${BLOCKING[r.status] ? '' : ' (' + STATUS[r.status] + ')'}`;
}

// selection: { items: Set<id>, stock: Map<id, qty> } — изменяется на месте, затем вызывается onChange.
export function renderPicker(container, { catalog, usage, selection, onChange }) {
  let query = '';
  const search = el('input', { type: 'search', placeholder: 'Поиск по коду, названию, метке', autocomplete: 'off' });
  const body = el('div');
  container.replaceChildren(el('div', { class: 'toolbar' }, search), body);
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    draw();
  });

  function draw() {
    body.replaceChildren();
    if (query) {
      // Поиск: один список, сначала совпадения в названии, потом в метке, коде, модели, серийнике.
      const found = rankResults(catalog.items.filter((i) => i.status !== 'retired'), query)
        .map(({ x, r }) => itemRow(x, r === 4))
        .concat(rankResults(catalog.stock, query).map(({ x }) => stockRow(x)));
      body.append(found.length
        ? el('section', { class: 'group' }, el('h2', {}, 'Найдено', el('span', { class: 'count' }, String(found.length))),
          el('ul', { class: 'list' }, found))
        : el('p', { class: 'muted' }, 'Ничего не найдено'));
      return;
    }
    Object.entries(catalog.categories).forEach(([cat, title]) => {
      const items = catalog.items
        .filter((i) => i.category === cat && i.status !== 'retired')
        .sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }));
      if (!items.length) return;
      const free = items.filter((i) => i.status === 'active' && !(usage.items[i.id] || []).some((r) => BLOCKING[r.status])).length;
      body.append(el('section', { class: 'group' },
        el('h2', {}, title, el('span', { class: 'count' }, `свободно ${free} из ${items.length}`)),
        el('ul', { class: 'list' }, items.map((i) => itemRow(i, false)))
      ));
    });

    const stock = catalog.stock;
    if (stock.length) {
      body.append(el('section', { class: 'group' },
        el('h2', {}, 'Коммутация и расходники'),
        el('ul', { class: 'list' }, stock.map((s) => stockRow(s)))
      ));
    }
  }

  function itemRow(item, bySerial) {
    const refs = usage.items[item.id] || [];
    const busy = refs.filter((r) => BLOCKING[r.status]);
    const drafts = refs.filter((r) => !BLOCKING[r.status]);
    const broken = item.status !== 'active';
    const checked = selection.items.has(item.id);
    const disabled = (busy.length || broken) && !checked;

    const box = el('input', { type: 'checkbox', checked, disabled });
    box.addEventListener('change', () => {
      if (box.checked) selection.items.add(item.id);
      else selection.items.delete(item.id);
      Promise.resolve(onChange(box.checked ? { added: item.id } : { removed: item.id })).then(draw);
    });

    return el('li', {},
      el('label', { class: `row pick${disabled ? ' off' : ''}` },
        box,
        el('span', { class: 'code' }, item.id),
        el('span', { class: 'name' },
          item.name,
          item.label ? el('span', { class: 'label' }, item.label) : null,
          bySerial ? el('span', { class: 'note' }, `серийный номер ${item.serial}`) : null,
          item.subtype && catalog.subtypes?.[item.subtype] ? el('span', { class: 'label' }, catalog.subtypes[item.subtype]) : null,
          item.band_name ? el('span', { class: 'label' }, `диапазон ${item.band_name}`) : null,
          broken ? el('span', { class: 'note bad' }, item.status === 'repair' ? 'в ремонте' : 'списано') : null,
          busy.map((r) => el('span', { class: 'note bad' }, 'занят: ' + refText(r))),
          drafts.map((r) => el('span', { class: 'note warn' }, 'черновик: ' + refText(r)))
        )
      )
    );
  }

  function stockRow(s) {
    const u = usage.stock[s.id] || { used: 0, draft: 0, refs: [] };
    const total = Number(s.qty_total) || 0;
    const free = Math.max(total - u.used, 0);
    const qty = selection.stock.get(s.id) || 0;

    const set = (n) => {
      const v = Math.max(0, Math.min(n, free));
      if (v) selection.stock.set(s.id, v);
      else selection.stock.delete(s.id);
      Promise.resolve(onChange({ stock: s.id })).then(draw);
    };

    return el('li', {},
      el('div', { class: 'row' },
        el('span', { class: 'code' }, s.id),
        el('span', { class: 'name' }, s.name,
          el('span', { class: `note${free ? '' : ' bad'}` }, `свободно ${free} из ${total}`),
          u.draft ? el('span', { class: 'note warn' }, `ещё ${u.draft} в черновиках`) : null),
        el('span', { class: 'stepper' },
          el('button', { type: 'button', class: 'button small', disabled: !qty, onclick: () => set(qty - 1), 'aria-label': 'Меньше' }, '−'),
          el('span', { class: 'qty' }, String(qty)),
          el('button', { type: 'button', class: 'button small', disabled: qty >= free, onclick: () => set(qty + 1), 'aria-label': 'Больше' }, '+'))
      )
    );
  }

  draw();
}
