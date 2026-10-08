// Стоимость брони: цена строки за смену × количество, число смен, наценка для работы по договору.
// Работает в Apps Script, браузере и тестах. Публикуется вместе с сайтом — только формулы, без цен и названий.
//
// Цена строки (price) — снимок прейскуранта в момент, когда строка попала в бронь; дальше не меняется.
// price: число ≥ 0 (0 — бесплатно / входит в комплект); '' — цены нет (позиция не привязана к прейскуранту).
// С договором цена за единицу = округлить(цена / 0,91): после вычета 9 % остаётся прежняя сумма.
// От 10 смен — скидка 10 % на сумму за период: в брони, календаре и договоре (в договоре — вместе с наценкой).
// Скидка считается по строкам (rows) с округлением до рубля — итоги брони и договора совпадают.
//
// Бесплатно в комплекте: у строки прейскуранта может быть правило «бесплатно вместе с» (free_with —
// разделы или названия основных позиций через запятую: «основные», «раздел А, раздел Б», «раздел А ×2»).
// На каждую платную основную позицию из этих разделов в брони одна (или ×N) такая единица бесплатна,
// остальные — по цене. Считается заново при каждом расчёте: убрали основную позицию — комплектующая стала платной.
// Снимок в строке брони: price, price_name, price_cat (раздел прейскуранта), free_with.

var Prices = (function () {
  var CONTRACT_DIVISOR = 0.91;
  var DISCOUNT_FROM_SHIFTS = 10;
  var DISCOUNT_PCT = 10;

  function dayNumber(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }

  function isYes(v) {
    return v === true || /^(yes|да|true|1)$/i.test(String(v === undefined || v === null ? '' : v).trim());
  }

  // Смен в брони: заданное вручную (shifts) или по датам — полные сутки по полудням:
  // 22 утро → 24 вечер = 3; 22 вечер → 24 утро = 2; 22 утро → 23 утро = 1; в один день = 1.
  function shiftsAuto(b) {
    var a = dayNumber(b.start);
    var z = dayNumber(b.end);
    if (a === null || z === null) return 1;
    var from = a * 2 + (b.start_half === 'pm' ? 1 : 0);
    var to = z * 2 + (b.end_half === 'am' ? 0 : 1);
    return Math.max(1, Math.floor((to - from + 1) / 2));
  }

  function shifts(b) {
    var n = Math.floor(Number(b.shifts));
    return n > 0 ? n : shiftsAuto(b);
  }

  function hasPrice(l) {
    return l.price !== '' && l.price !== undefined && l.price !== null && !isNaN(Number(l.price));
  }

  // Цена за единицу за смену с учётом договора.
  function unit(price, contract) {
    var p = Number(price) || 0;
    return contract ? Math.round(p / CONTRACT_DIVISOR) : p;
  }

  function qtyOf(l) {
    return l.item_id ? 1 : Number(l.qty) || 0;
  }

  function norm(s) {
    return String(s === undefined || s === null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }

  // «основные, разделы ×2» → [{ stem: 'основн', n: 1 }, { stem: 'раздел', n: 2 }].
  // Основа слова — без двух последних букв (разделы / раздел / разделов), у коротких слов — целиком.
  function parseFreeWith(text) {
    return norm(text).split(/[,;]/).map(function (part) {
      var m = /^(.*?)(?:\s*[×xх*]\s*(\d+))?$/.exec(part.trim());
      var word = m[1].trim();
      if (!word) return null;
      var stem = word.length > 6 ? word.slice(0, word.length - 2) : word;
      return { stem: stem, n: m[2] ? Math.max(0, +m[2]) : 1 };
    }).filter(Boolean);
  }

  function paid(l) {
    return hasPrice(l) && Number(l.price) > 0;
  }

  // Сколько единиц каждой строки бесплатны в комплекте (массив по индексам lines).
  // Основные позиции — платные строки без своего правила; у одной строки прейскуранта — общий запас.
  function kitFree(lines) {
    var rules = lines.map(function (l) { return paid(l) ? parseFreeWith(l.free_with) : []; });
    var pools = {};
    return lines.map(function (l, i) {
      if (!rules[i].length) return 0;
      var key = norm(l.price_name) || '#' + i;
      if (pools[key] === undefined) {
        pools[key] = lines.reduce(function (sum, m, j) {
          if (!paid(m) || rules[j].length) return sum;
          var text = norm(m.price_cat) + ' | ' + norm(m.price_name);
          var per = 0;
          rules[i].forEach(function (r) { if (text.indexOf(r.stem) !== -1) per = Math.max(per, r.n); });
          return sum + per * qtyOf(m);
        }, 0);
      }
      var take = Math.min(pools[key], qtyOf(l));
      pools[key] -= take;
      return take;
    });
  }

  // Строки для расчёта и договора: одинаковая позиция прейскуранта и цена — одной строкой с количеством.
  // name(line) — подпись строки (название из прейскуранта или позиции). Бесплатные (0) — отдельно, без суммы.
  function rows(booking, lines, name) {
    return rowsWith(booking, lines, name, kitFree(lines));
  }

  // rows() с уже посчитанным kitFree (totals считает его один раз).
  function rowsWith(booking, lines, name, free) {
    var contract = isYes(booking.contract);
    var byKey = {};
    var order = [];
    lines.forEach(function (l, i) {
      if (!hasPrice(l) || Number(l.price) === 0) return;
      var qty = qtyOf(l) - free[i];
      if (qty <= 0) return; // целиком в комплекте — в стоимость не идёт (в актах есть)
      var title = name(l);
      var key = title + '|' + Number(l.price);
      if (!byKey[key]) {
        byKey[key] = { name: title, qty: 0, unit: unit(l.price, contract) };
        order.push(key);
      }
      byKey[key].qty += qty;
    });
    var n = shifts(booking);
    var pct = discountPct(n);
    return order.map(function (k) {
      var r = byKey[k];
      r.perShift = r.unit * r.qty;
      r.period = Math.round(r.perShift * n * (100 - pct) / 100);
      return r;
    });
  }

  function discountPct(n) {
    return n >= DISCOUNT_FROM_SHIFTS ? DISCOUNT_PCT : 0;
  }

  // Итоги брони: { perShift, shifts, gross (без скидки), discountPct, period (со скидкой), contract, missing,
  // free — [{ line, qty }] бесплатные в комплекте }.
  function totals(booking, lines) {
    var contract = isYes(booking.contract);
    var perShift = 0;
    var missing = [];
    var freeQty = kitFree(lines);
    var free = [];
    lines.forEach(function (l, i) {
      if (!hasPrice(l)) {
        if (l.item_id) missing.push(l);
        return;
      }
      if (freeQty[i]) free.push({ line: l, qty: freeQty[i] });
      perShift += unit(l.price, contract) * (qtyOf(l) - freeQty[i]);
    });
    var n = shifts(booking);
    var gross = perShift * n;
    var pct = discountPct(n);
    // как в договоре: по строкам (одинаковая цена — одна строка), каждая округляется до рубля
    var period = rowsWith(booking, lines, function () { return ''; }, freeQty).reduce(function (s, r) { return s + r.period; }, 0);
    return { perShift: perShift, shifts: n, gross: gross, discountPct: pct, period: period, contract: contract, missing: missing, free: free };
  }

  // 12345.5 → «12 345,5»; целые — без дробной части.
  function money(n) {
    var v = Math.round(Number(n) * 100) / 100;
    var parts = String(Math.abs(v).toFixed(v % 1 ? 2 : 0)).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (v < 0 ? '−' : '') + int + (parts[1] ? ',' + parts[1] : '');
  }

  return {
    CONTRACT_DIVISOR: CONTRACT_DIVISOR,
    DISCOUNT_FROM_SHIFTS: DISCOUNT_FROM_SHIFTS,
    isYes: isYes,
    shifts: shifts,
    shiftsAuto: shiftsAuto,
    hasPrice: hasPrice,
    unit: unit,
    parseFreeWith: parseFreeWith,
    kitFree: kitFree,
    rows: rows,
    totals: totals,
    money: money
  };
})();

if (typeof module !== 'undefined') module.exports = Prices;
