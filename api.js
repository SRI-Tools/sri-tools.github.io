// Обращения к Apps Script. text/plain — чтобы браузер не делал CORS-preflight,
// который Apps Script не поддерживает.
// Ответы на запросы чтения сохраняются на устройстве и отдаются без сети.

import { CONFIG } from './config.js';
import { getSession } from './auth.js';
import { cacheKey, saveCache, readCache, setOffline } from './offline.js';

// Только чтение: их можно показать из кэша. Всё остальное без сети недоступно.
const READ_ACTIONS = new Set(['catalog', 'bookings', 'booking', 'availability', 'item_where', 'item_history', 'clients', 'client']);

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details || null;
  }
}

export function isDemo() {
  return new URLSearchParams(location.search).has('demo');
}

function fromCache(action, params) {
  const hit = READ_ACTIONS.has(action) ? readCache(cacheKey(action, params)) : null;
  if (!hit) {
    throw new ApiError('offline', READ_ACTIONS.has(action)
      ? 'Нет связи, и этих данных нет на устройстве'
      : 'Нет связи — изменения недоступны');
  }
  setOffline(true, hit.at);
  return hit.data;
}

// Последний сохранённый на устройстве ответ (null — нет или нет сессии): чтобы показать экран сразу,
// не дожидаясь сервера, и обновить, когда придёт свежий ответ.
export function peek(action, params = {}) {
  if (isDemo() || !getSession() || !READ_ACTIONS.has(action)) return null;
  return readCache(cacheKey(action, params))?.data ?? null;
}

export async function call(action, params = {}) {
  if (isDemo()) {
    // Демо-сервер в памяти браузера; в публикацию не входит.
    const { handle } = await import('./demo-api.js');
    try {
      return await handle(action, structuredClone(params));
    } catch (err) {
      throw new ApiError(err.code || 'internal', err.message, err.details);
    }
  }

  // Без сессии (вышли или сессию завершили) данные с устройства не показываем даже без сети.
  const session = getSession();
  if (!session) throw new ApiError('unauthenticated', 'Нужен вход');
  if (!navigator.onLine) return fromCache(action, params);

  let res;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ session, action, params })
    });
  } catch {
    return fromCache(action, params);
  }
  if (!res.ok) throw new ApiError('http', `Сервер ответил ${res.status}`);

  const body = await res.json();
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, body.error.details);
  setOffline(false);
  if (READ_ACTIONS.has(action)) saveCache(cacheKey(action, params), body.data);
  return body.data;
}
