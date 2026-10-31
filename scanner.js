// Сканирование штрихкодов (CODE128) и QR камерой телефона.
// Chrome на Android умеет это сам (BarcodeDetector); в Firefox, на iPhone и в остальных браузерах
// кадры распознаёт zxing-cpp (WebAssembly). Bluetooth-сканер работает как клавиатура — через поле ввода.
import { swapLayout } from './format.js';

const WASM_DIR = 'vendor/zxing-wasm/'; // zxing-wasm 3.1.4, лежит рядом с сайтом
const FORMATS = ['code_128', 'qr_code', 'code_39', 'ean_13'];
const WASM_FORMATS = ['Code128', 'QRCode', 'Code39', 'EAN13'];
const REPEAT_MS = 2500; // один и тот же код не чаще раза в 2,5 с
const FRAME_GAP_MS = 120; // пауза между кадрами, чтобы не греть телефон

// Код позиции без владельца (RF07) из любой записи: rf7, RF07-AM, старая EMP-RF07; null — не код.
// Номер уникален для всех владельцев, поэтому по нему позиция находится однозначно.
export function codeKey(raw) {
  const m = /^(?:([A-Z]+)-)?([A-Z]+)(\d+)(?:-([A-Z]+))?$/.exec(String(raw || '').trim().toUpperCase());
  return m && !(m[1] && m[4]) ? `${m[2]}${String(Number(m[3])).padStart(2, '0')}` : null;
}

// Скан или ручной ввод: код без владельца (RF07) или, если это не код, — как есть, заглавными.
// Русская раскладка (Bluetooth-сканер «печатает» как клавиатура): «ка07-уьз» → RF07.
export function normalizeCode(raw) {
  const s = String(raw || '').trim();
  const typed = /[а-яё]/i.test(s) ? swapLayout(s) : s;
  return codeKey(typed) || typed.toUpperCase();
}

let wasmPromise = null;
function loadWasmReader() {
  if (!wasmPromise) {
    wasmPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = WASM_DIR + 'reader.js';
      s.onload = () => (window.ZXingWASM ? resolve(window.ZXingWASM) : reject(new Error('Сканер не загрузился')));
      s.onerror = () => reject(new Error('Нет связи для загрузки сканера'));
      document.head.append(s);
    }).then(async (Z) => {
      const wasmUrl = new URL(WASM_DIR + 'zxing_reader.wasm', location.href).href;
      await Z.prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
        fireImmediately: true
      });
      return Z;
    });
    wasmPromise.catch(() => { wasmPromise = null; });
  }
  return wasmPromise;
}

// Задняя камера в высоком разрешении (тонкие штрихи CODE128 на малом кадре не читаются) и автофокус, если есть.
async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
  });
  const [track] = stream.getVideoTracks();
  try {
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {
    // автофокус не настраивается — камера справится сама
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  return stream;
}

// Негатив кадра (на месте): белое на чёрном → чёрное на белом.
function negative(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  return img;
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    if (!supported.includes('code_128')) return null;
    return new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
  } catch {
    return null;
  }
}

// Запускает камеру в video и вызывает onCode(код) для каждого нового кода. Возвращает stop().
export async function startCamera(video, onCode) {
  let stopped = false;
  let last = { code: '', at: 0 };
  const emit = (raw) => {
    const code = normalizeCode(raw);
    const now = Date.now();
    if (code === last.code && now - last.at < REPEAT_MS) return;
    last = { code, at: now };
    onCode(code);
  };

  const detector = await nativeDetector();
  // библиотеку грузим до камеры: если её нет (офлайн без кэша), камера не включается зря
  const Z = detector ? null : await loadWasmReader();
  const stream = await openCamera(video);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Кадр в canvas → ImageData; invert — негативом (этикетки «белым на чёрном»). Инверсия попиксельная:
  // ни встроенный распознаватель, ни библиотека (tryInvert) негатив линейного кода не читают,
  // а фильтр canvas есть не во всех браузерах.
  const frame = (invert) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return invert ? negative(img) : img;
  };
  // В кадре пусто — через раз пробуем негатив (обычные коды читаются без задержки).
  let tries = 0;
  const wantInverted = () => ++tries % 2 === 0;
  const readWasm = async (img) => (await Z.readBarcodes(img, {
    formats: WASM_FORMATS, tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1
  })).filter((r) => r.isValid && r.text).map((r) => r.text);
  const scan = async () => {
    if (detector) {
      const found = (await detector.detect(video)).map((b) => b.rawValue);
      if (found.length || !wantInverted()) return found;
      const img = frame(true);
      if (!img) return found;
      ctx.putImageData(img, 0, 0);
      return (await detector.detect(canvas)).map((b) => b.rawValue);
    }
    const img = frame(false);
    if (!img) return [];
    const found = await readWasm(img);
    if (found.length || !wantInverted()) return found;
    return readWasm(negative(img)); // тот же кадр негативом
  };

  const tick = async () => {
    if (stopped) return;
    try {
      (await scan()).forEach((code) => { if (!stopped) emit(code); });
    } catch {
      // кадр не готов — пропускаем
    }
    if (!stopped) setTimeout(tick, FRAME_GAP_MS);
  };
  tick();
  return () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

// ---------- сигналы и вибрация ----------

let audio = null;

// Браузеры разрешают аудио только после нажатия пользователя: вызывать в обработчике нажатия
// (открытие сканера), иначе сигналы из обработчика камеры молчат.
export function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    // iPhone «просыпается» только после проигранного сигнала — короткая тишина.
    const silent = audio.createBuffer(1, 1, 22050);
    const src = audio.createBufferSource();
    src.buffer = silent;
    src.connect(audio.destination);
    src.start(0);
  } catch {
    // аудио недоступно — останется вибрация
  }
}

// Сигналы различаются на слух: [частота Гц, длительность с, форма волны].
const SIGNALS = {
  ok: { tones: [[1200, 0.08, 'sine']], vibrate: 60 }, // отмечено
  repeat: { tones: [[1200, 0.05, 'sine'], [1200, 0.05, 'sine']], vibrate: [40, 60, 40] }, // уже отмечено
  wrong: { tones: [[520, 0.14, 'square'], [330, 0.3, 'square']], vibrate: [150, 80, 150, 80, 150] }, // не из этой брони
  unknown: { tones: [[200, 0.45, 'sawtooth']], vibrate: 500 } // кода нет в базе
};

// kind: 'ok' | 'repeat' | 'wrong' | 'unknown' (true/false — как ok/unknown).
export function feedback(kind) {
  const sig = SIGNALS[kind === true ? 'ok' : kind === false ? 'unknown' : kind] || SIGNALS.ok;
  try {
    navigator.vibrate?.(sig.vibrate);
  } catch {
    // вибрации нет
  }
  try {
    if (!audio) unlockAudio();
    if (audio.state === 'suspended') audio.resume();
    let t = audio.currentTime + 0.01;
    sig.tones.forEach(([freq, dur, type]) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(type === 'sine' ? 0.15 : 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur + 0.06;
    });
  } catch {
    // аудио недоступно — не страшно
  }
}
