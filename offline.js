// Последние ответы сервера на устройстве — чтобы без интернета можно было смотреть каталог и брони.
// Хранится в localStorage (данных немного); при выходе из аккаунта очищается.

const PREFIX = 'gr.cache.';
const PROFILE_KEY = 'gr.profile';
export const PERSONAL_CACHE = 'app-personal'; // то же имя — в sw.js

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function cacheKey(action, params) {
  return PREFIX + action + ':' + JSON.stringify(params || {});
}

export function saveCache(key, data) {
  safe(() => localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })));
}

export function readCache(key) {
  return safe(() => JSON.parse(localStorage.getItem(key) || 'null'), null);
}

export function clearCache() {
  if ('caches' in window) caches.delete(PERSONAL_CACHE).catch(() => {});
  safe(() => {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) || k === PROFILE_KEY)
      .forEach((k) => localStorage.removeItem(k));
  });
}

// Профиль последнего входа: без сети вход Google недоступен, но кэш смотреть можно.
export function saveProfile(profile) {
  safe(() => localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: profile.name || '', email: profile.email || '', title: profile.title || readProfile()?.title || '' })));
}

export function readProfile() {
  return safe(() => JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'), null);
}

// Состояние связи для интерфейса: { offline, at } — at — время данных из кэша.
export const connection = new EventTarget();
connection.state = { offline: false, at: null };

export function setOffline(offline, at = null) {
  const prev = connection.state;
  if (prev.offline === offline && prev.at === at) return;
  connection.state = { offline, at };
  connection.dispatchEvent(new Event('change'));
}

// Манифест с названием приложения — только на этом устройстве (см. setAppName в app.js и sw.js).
export async function savePersonalManifest(title) {
  if (!('caches' in window)) return false;
  try {
    const base = await (await fetch('manifest.webmanifest', { cache: 'no-cache' })).json();
    const manifest = { ...base, name: title, short_name: title };
    const cache = await caches.open(PERSONAL_CACHE);
    await cache.put(new URL('manifest.webmanifest', location.href).href, new Response(JSON.stringify(manifest), {
      headers: { 'Content-Type': 'application/manifest+json' }
    }));
    return true;
  } catch {
    return false;
  }
}

// Название приложения с последнего входа на этом устройстве — чтобы ярлык получал его сразу при загрузке.
export function saveTitle(title) {
  safe(() => {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...p, title }));
  });
}
