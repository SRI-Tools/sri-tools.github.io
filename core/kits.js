// Комплекты: что добавлять к позиции по умолчанию и чего не хватает в брони.
// Правила — строки листа KitRules:
//   applies_to  к чему правило: model:X | subtype:Y | category:Z | name:подстрока
//   slot        название слота
//   pick_from   откуда брать: subtype:Y | category:Z | name:A|B (подстрока) | stock:K (категория расходников)
//   qty         сколько (для расходников)
//   default     что предлагать: auto | pair (тот же номер пары) | name:X | series:N
//   required    yes — без этого бронь не подтвердить; warn — предупредить, но сохранить; no — молча
//   match       совместимость с основной позицией: same_series, same_band, prefer_same_pair_no
//
// same_band — общие частоты: у позиций есть band_ranges ([[от, до], …] МГц, из справочника диапазонов),
// и отрезки пересекаются; если частот нет хотя бы у одной — сравниваются обозначения диапазона.
// same_series — только у позиций одного производителя: с другим производителем пару решают частоты.
// Многоканальная позиция (Quad — 4, Triple — 3, Dual — 2 в названии или модели) обслуживает столько основных.
//
// Одинаковые по смыслу правила одной основной позиции — одна потребность: если у пушки правила на
// два цеппелина разных моделей, ей нужен один любой цеппелин, а не оба (см. needsFor).
//
// Правило неактивно, если в инвентаре вообще нет подходящих позиций (их ещё не внесли):
// иначе основную позицию нельзя было бы подтвердить никогда.
// Файл публикуется вместе с сайтом, поэтому в нём нет ничего о конкретном оборудовании.

var Kits = (function () {
  function parseSel(sel) {
    var s = String(sel || '').trim();
    var i = s.indexOf(':');
    if (i < 0) return { field: s.toLowerCase(), values: [] };
    return {
      field: s.slice(0, i).trim().toLowerCase(),
      values: s.slice(i + 1).split('|').map(function (v) { return v.trim().toLowerCase(); }).filter(Boolean)
    };
  }

  // Несколько условий через «&» должны выполняться все: stock:cable&name:A – B.
  function parts(sel) {
    return String(sel || '').split('&').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function matchesSel(sel, item) {
    var list = parts(sel);
    if (list.length > 1) return list.every(function (x) { return matchesOne(x, item); });
    return matchesOne(list[0] || '', item);
  }

  function matchesOne(sel, item) {
    var p = parseSel(sel);
    var any = function (fn) { return p.values.some(fn); };
    switch (p.field) {
      case 'model': return any(function (v) { return String(item.model || '').toLowerCase() === v; });
      case 'subtype': return any(function (v) { return String(item.subtype || '').toLowerCase() === v; });
      case 'category': return any(function (v) { return String(item.category || '').toLowerCase() === v; });
      case 'series': return any(function (v) { return String(item.series || '').toLowerCase() === v; });
      case 'name': return any(function (v) { return String(item.name || '').toLowerCase().indexOf(v) !== -1; });
      default: return false;
    }
  }

  function isStockSel(sel) {
    return parts(sel).some(function (x) { return parseSel(x).field === 'stock'; });
  }

  // Расходник подходит, если совпала категория (stock:…) и остальные условия (name:… и т. п.).
  function stockMatches(sel, s) {
    return parts(sel).every(function (x) {
      var p = parseSel(x);
      if (p.field === 'stock') return p.values.indexOf(String(s.category || '').toLowerCase()) !== -1;
      return matchesOne(x, s);
    });
  }

  // Длина кабеля: колонка length_m или «… 5 м» / «… 2,5м» в названии.
  function lengthOf(x) {
    var v = Number(String(x.length_m === undefined ? '' : x.length_m).replace(',', '.'));
    if (v > 0) return v;
    // «м» как отдельное слово (не «мама»), берём последнее такое число в названии.
    var re = /(\d+(?:[.,]\d+)?)\s*м(?![а-яёa-z])/gi;
    var m;
    var last = 0;
    while ((m = re.exec(String(x.name || ''))) !== null) last = Number(m[1].replace(',', '.'));
    return last;
  }

  function matchList(rule) {
    return String(rule.match || '').split(',').map(function (m) { return m.trim(); }).filter(Boolean);
  }

  function isRequired(rule) {
    return /^(yes|да|1|true)$/i.test(String(rule.required).trim());
  }

  function isWarn(rule) {
    return /^(warn|предупреждать)$/i.test(String(rule.required).trim());
  }

  function lower(v) {
    return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  }

  // Общие частоты: хотя бы один отрезок пересекается.
  function bandsMatch(a, b) {
    var ra = a.band_ranges;
    var rb = b.band_ranges;
    if (ra && ra.length && rb && rb.length) {
      return ra.some(function (x) { return rb.some(function (y) { return x[0] < y[1] && y[0] < x[1]; }); });
    }
    return String(a.band || '') === String(b.band || '');
  }

  function compatible(rule, main, c) {
    var m = matchList(rule);
    var sameMaker = !lower(main.manufacturer) || !lower(c.manufacturer) || lower(main.manufacturer) === lower(c.manufacturer);
    if (m.indexOf('same_series') !== -1 && sameMaker && String(c.series || '') !== String(main.series || '')) return false;
    if (m.indexOf('same_band') !== -1 && !bandsMatch(main, c)) return false;
    return true;
  }

  // Сколько основных позиций может обслужить одна подобранная.
  function capacity(item) {
    var s = String(item.model || '') + ' ' + String(item.name || '');
    if (/\bquad\b/i.test(s)) return 4;
    if (/\btriple\b/i.test(s)) return 3;
    if (/\bdual\b/i.test(s)) return 2;
    return 1;
  }

  function usable(item) {
    return item.status === 'active' || !item.status;
  }

  // Правила, которые относятся к позиции и активны (в инвентаре есть что подбирать).
  function rulesFor(main, rules, items, stock) {
    return rules.filter(function (r) {
      if (!r.applies_to || !r.pick_from || !matchesSel(r.applies_to, main)) return false;
      if (isStockSel(r.pick_from)) return stock.some(function (s) { return stockMatches(r.pick_from, s); });
      return items.some(function (i) { return i.id !== main.id && usable(i) && matchesSel(r.pick_from, i); });
    });
  }

  function firstWord(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  // «Вид» того, что подбирает правило: категория + тип + первое слово названия подходящих позиций
  // («Цеппелин …» → одна потребность, сколько бы моделей цеппелинов ни было). null — позиции разные или расходник.
  function kindOf(rule, items) {
    if (isStockSel(rule.pick_from)) return null;
    var keys = {};
    var word = '';
    items.forEach(function (i) {
      if (!usable(i) || !matchesSel(rule.pick_from, i)) return;
      word = word || firstWord(i.name);
      keys[lower(i.category) + '|' + lower(i.subtype) + '|' + lower(firstWord(i.name))] = true;
    });
    var list = Object.keys(keys);
    return list.length === 1 ? { key: list[0], label: word } : null;
  }

  // Потребности основной позиции: правила одного вида сливаются в одну (alts — все варианты подбора).
  function needsFor(main, rules, items, stock) {
    var out = [];
    var byKind = {};
    rulesFor(main, rules, items, stock).forEach(function (r) {
      var kind = kindOf(r, items);
      var g = kind && byKind[kind.key];
      if (!g) {
        g = Object.assign({}, r, { alts: [r.pick_from] });
        if (kind) byKind[kind.key] = g;
        out.push(g);
        g.kindLabel = kind ? kind.label : '';
        return;
      }
      g.alts.push(r.pick_from);
      g.slot = g.kindLabel; // вариантов несколько — слот называем по виду, а не по первой модели
      if (isRequired(r)) g.required = 'yes';
      else if (isWarn(r) && !isRequired(g)) g.required = 'warn';
    });
    return out;
  }

  function matchesAny(rule, item) {
    return (rule.alts || [rule.pick_from]).some(function (sel) { return matchesSel(sel, item); });
  }

  // Порядок предпочтения кандидатов по default и match.
  function preference(rule, main) {
    var def = parseSel(rule.default);
    var preferPair = rule.default === 'pair' || matchList(rule).indexOf('prefer_same_pair_no') !== -1;
    if (String(rule.default).trim() === 'longest') {
      // Сначала самые длинные (например, кабели), при равной длине — по коду.
      return function (a, b) {
        return lengthOf(b) - lengthOf(a) || String(a.id).localeCompare(String(b.id), 'ru', { numeric: true });
      };
    }
    return function (a, b) {
      var score = function (c) {
        var s = 0;
        if (preferPair && main.pair_no && String(c.pair_no) === String(main.pair_no)) s -= 4;
        if (def.field === 'name' && def.values.some(function (v) { return String(c.name || '').toLowerCase().indexOf(v) !== -1; })) s -= 2;
        if (def.field === 'series' && def.values.indexOf(String(c.series || '').toLowerCase()) !== -1) s -= 2;
        return s;
      };
      return score(a) - score(b) || String(a.id).localeCompare(String(b.id), 'ru', { numeric: true });
    };
  }

  // Что добавить к main. ctx: { isFree(itemId), stockFree(stockId), taken: {itemId: true}, lines? }.
  // lines — строки брони без main: многоканальная позиция из них со свободным каналом закрывает слот,
  // ничего не добавляя (ответ { item_id, existing: true }).
  // Возвращает [{ rule_id, slot, required, item_id | stock_id+qty, existing, missing, message }].
  function resolve(main, rules, items, stock, ctx) {
    var taken = Object.assign({}, ctx.taken || {});
    taken[main.id] = true;
    var spare = ctx.lines ? spareChannels(ctx.lines.filter(function (l) { return l.item_id !== main.id; }), items, stock, rules) : {};
    return needsFor(main, rules, items, stock).map(function (r) {
      var base = { rule_id: r.id, slot: r.slot, required: isRequired(r), parent: main.id };
      if (isStockSel(r.pick_from)) {
        var qty = Number(r.qty) || 1;
        var s = stock.filter(function (x) { return stockMatches(r.pick_from, x) && (ctx.stockFree(x.id) || 0) >= qty; })
          .sort(preference(r, main))[0];
        return s ? Object.assign(base, { stock_id: s.id, qty: qty })
          : Object.assign(base, { missing: true, message: 'нет свободных: ' + r.slot + ' (' + qty + ' шт.)' });
      }
      var spareSel = function (i) {
        return (r.alts || [r.pick_from]).filter(function (sel) { return (spare[sel] || {})[i.id] > 0 && matchesSel(sel, i); })[0];
      };
      var shared = items.filter(function (i) {
        return spareSel(i) && compatible(r, main, i);
      }).sort(preference(r, main))[0];
      if (shared) {
        spare[spareSel(shared)][shared.id]--;
        return Object.assign(base, { item_id: shared.id, existing: true });
      }
      var c = items.filter(function (i) {
        return !taken[i.id] && usable(i) && matchesAny(r, i) && compatible(r, main, i) && ctx.isFree(i.id);
      }).sort(preference(r, main))[0];
      if (!c) return Object.assign(base, { missing: true, message: 'нет свободного: ' + r.slot });
      taken[c.id] = true;
      return Object.assign(base, { item_id: c.id });
    });
  }

  // Проверка брони: всем ли основным позициям хватает обязательных слотов.
  // lines: [{ item_id, separate } | { stock_id, qty }]. Позиции со separate проверяются без комплекта.
  // Каждый подходящий предмет закрывает столько потребностей одного вида, сколько у него каналов (Quad — 4).
  function validate(lines, items, stock, rules) {
    return allocate(lines, items, stock, rules).errors;
  }

  // Свободные каналы подобранных позиций: { pick_from: { itemId: сколько ещё } } (только у многоканальных).
  function spareChannels(lines, items, stock, rules) {
    var res = allocate(lines, items, stock, rules);
    var out = {};
    Object.keys(res.used).forEach(function (sel) {
      out[sel] = {};
      Object.keys(res.used[sel]).forEach(function (id) {
        var it = res.byId[id];
        if (it && capacity(it) > 1) out[sel][id] = capacity(it) - res.used[sel][id];
      });
    });
    // Многоканальные позиции брони, ещё никому не назначенные, тоже свободны.
    lines.forEach(function (l) {
      var it = l.item_id && res.byId[l.item_id];
      if (!it || capacity(it) < 2) return;
      rules.forEach(function (r) {
        if (!r.pick_from || isStockSel(r.pick_from) || !matchesSel(r.pick_from, it)) return;
        out[r.pick_from] = out[r.pick_from] || {};
        if (out[r.pick_from][it.id] === undefined) out[r.pick_from][it.id] = capacity(it);
      });
    });
    return out;
  }

  function allocate(lines, items, stock, rules) {
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });
    var bookedItems = lines.filter(function (l) { return l.item_id && byId[l.item_id]; }).map(function (l) {
      return { item: byId[l.item_id], separate: !!l.separate && l.separate !== 'no' };
    });
    var stockLeft = {};
    lines.forEach(function (l) {
      if (l.stock_id) stockLeft[l.stock_id] = (stockLeft[l.stock_id] || 0) + (Number(l.qty) || 0);
    });
    var stockById = {};
    stock.forEach(function (s) { stockById[s.id] = s; });

    var used = {}; // pick_from → {itemId: сколько потребностей закрыто}
    var errors = [];
    bookedItems.forEach(function (b) {
      if (b.separate) return;
      needsFor(b.item, rules, items, stock).filter(function (r) { return isRequired(r) || isWarn(r); }).forEach(function (r) {
        if (isStockSel(r.pick_from)) {
          var need = Number(r.qty) || 1;
          Object.keys(stockLeft).forEach(function (sid) {
            if (need > 0 && stockById[sid] && stockMatches(r.pick_from, stockById[sid])) {
              var take = Math.min(need, stockLeft[sid]);
              stockLeft[sid] -= take;
              need -= take;
            }
          });
          if (need > 0) errors.push(missing(b.item, r));
          return;
        }
        var u = used[r.pick_from] = used[r.pick_from] || {};
        var c = bookedItems.map(function (x) { return x.item; }).filter(function (i) {
          return i.id !== b.item.id && (u[i.id] || 0) < capacity(i) && matchesAny(r, i) && compatible(r, b.item, i);
        }).sort(function (x, y) {
          // сначала уже занятые многоканальные (заполняем их), затем по обычному порядку
          return ((u[y.id] || 0) > 0) - ((u[x.id] || 0) > 0) || preference(r, b.item)(x, y);
        })[0];
        if (c) u[c.id] = (u[c.id] || 0) + 1;
        else errors.push(missing(b.item, r));
      });
    });
    return { errors: errors, used: used, byId: byId };
  }

  // warn — только предупреждение (правило «предупреждать»): бронь сохраняется и подтверждается.
  function missing(main, rule) {
    return {
      kind: 'kit', item_id: main.id, rule_id: rule.id, warn: isWarn(rule),
      message: main.name + ': не хватает «' + rule.slot + '»'
    };
  }

  return {
    parseSel: parseSel,
    lengthOf: lengthOf,
    matchesSel: matchesSel,
    rulesFor: rulesFor,
    needsFor: needsFor,
    bandsMatch: bandsMatch,
    resolve: resolve,
    validate: validate,
    isRequired: isRequired,
    isWarn: isWarn
  };
})();

if (typeof module !== 'undefined') module.exports = Kits;
