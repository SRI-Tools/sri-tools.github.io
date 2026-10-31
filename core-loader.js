// Загружает общий модуль из core/ (тот же код, что в Apps Script).
// На сайте он лежит в ./core/, при локальном запуске из репозитория — в ../core/.

const cache = new Map();

export function loadCore(name, globalName) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      for (const base of ['core/', '../core/']) {
        const res = await fetch(`${base}${name}.js`).catch(() => null);
        if (!res || !res.ok) continue;
        const src = await res.text();
        // Модули core/ — обычные скрипты с глобальной переменной; module/require для Node здесь не нужны.
        const value = new Function('module', 'require', `${src}\nreturn ${globalName};`)(undefined, undefined);
        globalThis[globalName] = value;
        return value;
      }
      throw new Error(`Не удалось загрузить модуль ${name}`);
    })());
  }
  return cache.get(name);
}
