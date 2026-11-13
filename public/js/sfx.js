/* ==================================================================
   مؤثرات صوتية مشتركة (WebAudio — بدون أي ملفات صوتية)
   - إعداد الكتم يُحفظ لكل جهاز على حدة في localStorage
   - زر الكتم: أي عنصر فيه data-sfx-toggle
   - الصوت يحتاج "إيماءة" أولى من المستخدم (سياسة المتصفحات)،
     لذلك يظهر زر صغير "اضغط لتشغيل الصوت" عند الحاجة.
   ================================================================== */

const LS_MUTED = "horoof-sfx-muted";

let ctx = null;
let muted = false;
let overlay = null;
let hooksInstalled = false;

try {
  muted = localStorage.getItem(LS_MUTED) === "1";
} catch {
  /* التخزين غير متاح — يكفي الافتراضي */
}

/* ---------------- محرّك الصوت ---------------- */

function audio() {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  if (!ctx) {
    try {
      ctx = new C();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function running() {
  const c = audio();
  return c && c.state === "running" ? c : null;
}

/** نغمة واحدة. `slideTo` يجعل التردد ينزلق (للتنبيه والانتهاء). */
function blip(freq, { dur = 0.12, type = "sine", peak = 0.16, at = 0, slideTo = null } = {}) {
  const c = running();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** ضجيج قصير (للانتقالات). */
function whoosh(dur = 0.28, peak = 0.1) {
  const c = running();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(320, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(2400, c.currentTime + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
}

const seq = (notes, { gap = 0.09, dur = 0.16, type = "triangle", peak = 0.18 } = {}) =>
  notes.forEach((f, i) => blip(f, { at: i * gap, dur, type, peak }));

const SOUNDS = {
  /* واجهة */
  click: () => blip(740, { dur: 0.055, type: "triangle", peak: 0.12 }),
  toggleOn: () => seq([660, 990], { gap: 0.07, dur: 0.1 }),
  toggleOff: () => seq([660, 440], { gap: 0.07, dur: 0.1 }),

  /* اللعب */
  reveal: () => whoosh(0.3, 0.1),
  arm: () => seq([620, 930], { gap: 0.1, dur: 0.12, type: "square", peak: 0.12 }),
  tick: () => blip(1180, { dur: 0.035, type: "sine", peak: 0.085 }),
  tickUrgent: () => blip(1500, { dur: 0.045, type: "square", peak: 0.12 }),
  buzz: () => {
    blip(230, { dur: 0.16, type: "sawtooth", peak: 0.22 });
    blip(175, { at: 0.18, dur: 0.22, type: "sawtooth", peak: 0.22 });
  },
  win: () => seq([523, 659, 784], { gap: 0.085, dur: 0.16 }),
  correct: () => seq([659, 784, 988, 1319], { gap: 0.075, dur: 0.18, type: "sine" }),
  wrong: () => blip(300, { dur: 0.2, type: "square", peak: 0.14, slideTo: 170 }),
  point: () => {
    blip(880, { dur: 0.09, type: "sine", peak: 0.16 });
    blip(1320, { at: 0.09, dur: 0.18, type: "sine", peak: 0.16 });
  },
  timeout: () => blip(420, { dur: 0.55, type: "sawtooth", peak: 0.15, slideTo: 150 }),
  turnSwitch: () => seq([500, 700, 950], { gap: 0.08, dur: 0.14, type: "square", peak: 0.12 }),
  celebrate: () => seq([523, 659, 784, 1047, 784, 1047], { gap: 0.11, dur: 0.2 }),
  gameWin: () => seq([523, 659, 784, 1047], { gap: 0.14, dur: 0.32, type: "square", peak: 0.18 }),
  open: () => seq([784, 1047], { gap: 0.08, dur: 0.14, type: "sine" }),
};

/* ---------------- الواجهة (زر الكتم + طلب الإذن) ---------------- */

function updateButtons() {
  document.querySelectorAll("[data-sfx-toggle]").forEach((el) => {
    el.textContent = muted ? "🔇" : "🔊";
    el.setAttribute("aria-label", muted ? "تشغيل الأصوات" : "كتم الأصوات");
    el.classList.toggle("sfx-off", muted);
  });
}

function hideOverlay() {
  if (overlay) overlay.classList.remove("show");
}

function ensureOverlay() {
  if (overlay || typeof document === "undefined") return overlay;
  overlay = document.createElement("button");
  overlay.type = "button";
  overlay.className = "sfx-unlock";
  overlay.innerHTML = "<span>🔊</span> اضغط لتشغيل الصوت";
  overlay.addEventListener("click", (e) => {
    e.stopPropagation();
    unlock();
  });
  document.body.appendChild(overlay);
  return overlay;
}

/** يُظهر زر «شغّل الصوت» فقط إذا كان الصوت مكتوماً أو محجوباً بواسطة المتصفح. */
function maybeShowOverlay() {
  if (muted) return hideOverlay();
  const c = audio();
  if (c && c.state === "running") return hideOverlay();
  ensureOverlay()?.classList.add("show");
}

/** إيماءة أولى من المستخدم → نفتح الصوت. */
function unlock() {
  const c = audio();
  const done = () => {
    if (c && c.state === "running") hideOverlay();
  };
  if (c) c.resume().then(done).catch(() => {});
  done();
}

function installHooks() {
  if (hooksInstalled || typeof document === "undefined") return;
  hooksInstalled = true;

  const once = () => {
    unlock();
    setTimeout(maybeShowOverlay, 400);
  };
  for (const ev of ["pointerdown", "touchstart", "keydown", "mousedown"]) {
    window.addEventListener(ev, once, { passive: true });
  }

  // أزرار الكتم
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-sfx-toggle]");
    if (!btn) return;
    e.preventDefault();
    sfx.toggle();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      updateButtons();
      setTimeout(maybeShowOverlay, 1200);
    });
  } else {
    updateButtons();
    setTimeout(maybeShowOverlay, 1200);
  }
}

installHooks();

export const sfx = {
  get muted() {
    return muted;
  },

  setMuted(value) {
    muted = !!value;
    try {
      localStorage.setItem(LS_MUTED, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    updateButtons();
    if (muted) hideOverlay();
    else unlock();
    return muted;
  },

  toggle() {
    const next = !muted;
    this.setMuted(next);
    SOUNDS[next ? "toggleOff" : "toggleOn"]?.();
    return next;
  },

  unlock,
  ensureOverlay: maybeShowOverlay,

  /** يشغّل مؤثّراً بالاسم (يتجاهل الطلبات إذا كان الصوت مكتوماً). */
  play(name) {
    if (muted) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    if (!running()) {
      maybeShowOverlay();
      return;
    }
    try {
      fn();
    } catch {
      /* ignore */
    }
  },

  /** اهتزاز الجوال (يتبع نفس إعداد الكتم). */
  vibrate(pattern) {
    if (muted) return;
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* ignore */
      }
    }
  },
};

export default sfx;
