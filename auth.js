// Вход: Google нужен только при первом входе на устройстве. Сервер выдаёт ключ сессии
// на 180 дней (продлевается при использовании) — дальше приложение открывается без входа.

import { CONFIG } from './config.js';

const SESSION_KEY = 'gr.session';
const USER_KEY = 'gr.user';

function store(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // хранилище недоступно (приватный режим) — войти придётся снова в следующий раз
  }
}

function load(key, json) {
  try {
    const v = localStorage.getItem(key);
    return json ? JSON.parse(v || 'null') : v;
  } catch {
    return null;
  }
}

export function getSession() {
  return load(SESSION_KEY, false);
}

export function getUser() {
  return load(USER_KEY, true);
}

export function setUser(user) {
  store(USER_KEY, user);
}

export function clearSession() {
  store(SESSION_KEY, null);
  store(USER_KEY, null);
}

async function post(body) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) {
    const e = new Error(data.error.message);
    e.code = data.error.code;
    throw e;
  }
  return data.data;
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'устройство';
  const br = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /YaBrowser\//.test(ua) ? 'Яндекс'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'браузер';
  return `${br}, ${os}`;
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function check() {
      if (window.google?.accounts?.id) return resolve();
      if (Date.now() - started > 10_000) return reject(new Error('Не удалось загрузить вход Google'));
      setTimeout(check, 100);
    })();
  });
}

// Есть сессия — сразу onUser(сотрудник); нет — кнопка входа Google в buttonEl.
// onError(сообщение) — если вход Google прошёл, но сервер не пустил (например, нет в сотрудниках).
export async function initAuth(buttonEl, onUser, onError) {
  const session = getSession();
  const user = getUser();
  if (session && user) {
    onUser(user);
    return;
  }

  await waitForGis();
  window.google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: async (resp) => {
      try {
        const res = await post({ action: 'login', idToken: resp.credential, params: { device: deviceName() } });
        store(SESSION_KEY, res.session);
        store(USER_KEY, res.user);
        onUser(res.user);
      } catch (err) {
        onError?.(err.message);
      }
    },
    auto_select: true,
    use_fedcm_for_prompt: true
  });
  window.google.accounts.id.renderButton(buttonEl, {
    theme: 'outline', size: 'large', text: 'signin_with', locale: 'ru'
  });
  window.google.accounts.id.prompt();
}

// Выход на этом устройстве (allDevices — на всех устройствах сотрудника).
export async function signOut(allDevices = false) {
  const session = getSession();
  try {
    if (session) await post({ action: allDevices ? 'logout_all' : 'logout', session });
  } catch {
    // нет сети или сессия уже недействительна — всё равно выходим локально
  }
  clearSession();
  try {
    window.google?.accounts.id.disableAutoSelect();
  } catch {
    // вход Google не загружался — ничего страшного
  }
}
