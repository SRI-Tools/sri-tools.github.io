// Фоновые сохранения: форма закрывается сразу, запрос уходит в очередь. Задачи выполняются по одной
// (две правки одной позиции не перепутаются), внизу экрана — счётчик и уведомления.
// Пока очередь не пуста, браузер предупреждает при закрытии вкладки.

import { el } from './format.js';

const queue = [];
const idle = new Map(); // ключ → что сделать, когда очередь опустеет (обновить каталог и т. п.)
let running = false;
let pending = 0;
let area = null;
let status = null;
let clearAll = null;

export function hasPending() {
  return pending > 0;
}

// task() → Promise; onDone(результат) и onError(ошибка) вызываются по очереди с задачами.
export function runInBackground({ label, task, onDone, onError }) {
  pending++;
  queue.push({ label, task, onDone, onError });
  renderStatus();
  pump();
}

// fn выполнится один раз, когда все задачи завершатся (повторный вызов с тем же ключом — заменяет).
export function whenIdle(key, fn) {
  idle.set(key, fn);
  if (!pending) flushIdle();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const t = queue.shift();
    try {
      const res = await t.task();
      await t.onDone?.(res);
    } catch (err) {
      try {
        t.onError?.(err);
      } catch {
        // ошибка в обработчике ошибки — не мешаем остальной очереди
      }
    } finally {
      pending--;
      renderStatus();
    }
  }
  running = false;
  flushIdle();
}

async function flushIdle() {
  const fns = [...idle.values()];
  idle.clear();
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      // обновление после сохранения не удалось — данные подтянутся при следующем открытии
    }
  }
}

// Уведомление. kind: ok (исчезает само) | warn | bad (висят до закрытия). actions: [{ text, onClick }].
export function toast({ kind = 'ok', text, actions = [], timeout }) {
  const box = ensureArea();
  // такое же уведомление уже висит — второе не добавляем
  const same = [...box.querySelectorAll('.toast')].find((t) => t.dataset.key === `${kind}|${text}` && !actions.length);
  if (same) return () => { same.remove(); renderClearAll(); };
  const close = () => { node.remove(); renderClearAll(); };
  const node = el('div', { class: `toast ${kind}`, role: kind === 'bad' ? 'alert' : 'status' },
    el('span', { class: 'toast-text' }, text),
    ...actions.map((a) => el('button', {
      class: 'button small', type: 'button',
      onclick: () => { close(); a.onClick(); }
    }, a.text)),
    el('button', { class: 'toast-close', type: 'button', 'aria-label': 'Закрыть', onclick: close }, '✕'));
  node.dataset.key = `${kind}|${text}`;
  box.append(node);
  renderClearAll();
  raise();
  const ms = timeout ?? (kind === 'ok' ? 3500 : 0);
  if (ms) setTimeout(close, ms);
  return close;
}

function ensureArea() {
  if (area) return area;
  area = el('div', { class: 'bg-area', 'aria-live': 'polite' });
  status = el('div', { class: 'bg-status', hidden: true });
  // «Закрыть все» — когда уведомлений больше одного
  clearAll = el('button', {
    class: 'button small bg-clear-all', type: 'button', hidden: true,
    onclick: () => { area.querySelectorAll('.toast').forEach((t) => t.remove()); renderClearAll(); }
  }, 'Закрыть все');
  area.append(status, clearAll);
  // Поверх открытых окон (dialog): через popover, если браузер умеет, иначе просто в конце страницы.
  if (typeof area.showPopover === 'function') area.setAttribute('popover', 'manual');
  document.body.append(area);
  // Новое окно открылось поверх — поднимаем уведомления выше него.
  document.addEventListener('toggle', (e) => { if (e.target !== area && e.newState === 'open') raise(); }, true);
  return area;
}

let raising = false;
function raise() {
  if (!area || raising || typeof area.showPopover !== 'function') return;
  raising = true;
  try {
    if (area.matches(':popover-open')) area.hidePopover();
    area.showPopover();
  } catch {
    // popover недоступен — уведомления остаются в странице
  } finally {
    raising = false;
  }
}

function renderClearAll() {
  if (clearAll) clearAll.hidden = area.querySelectorAll('.toast').length < 2;
}

function renderStatus() {
  ensureArea();
  status.hidden = !pending;
  status.textContent = pending ? `Сохраняется в фоне: ${pending}…` : '';
  raise();
}

window.addEventListener('beforeunload', (e) => {
  if (!pending) return;
  e.preventDefault();
  e.returnValue = ''; // старые браузеры показывают предупреждение только так
});
