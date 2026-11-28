/* ==================================================================
   مؤثرات صوتية مشتركة — طابع مرح وخفيف مثل ألعاب الجوال
   - تُولَّد كلها بالكود (WebAudio) فتعمل بلا إنترنت وبلا ملفات.
   - إن وُضعت ملفات صوت حقيقية في public/sounds/ مع manifest.json
     ( { "buzz": "buzz.ogg", ... } ) تُستخدم هي بدل الصوت المولَّد تلقائياً.
   - إعداد الكتم يُحفظ لكل جهاز على حدة في localStorage
   - زر الكتم: أي عنصر فيه data-sfx-toggle
   - الصوت يحتاج "إيماءة" أولى من المستخدم (سياسة المتصفحات)،
     لذلك يظهر زر صغير "اضغط لتشغيل الصوت" عند الحاجة.
   ================================================================== */

import { icon } from "/js/ds.js";

const LS_MUTED = "horoof-sfx-muted";

let ctx = null;
let master = null;
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
      // ضاغط خفيف على المخرج: أصوات متوازنة بلا تشويش عند تداخلها
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp).connect(ctx.destination);
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

/** مغلّف صوتي (هجوم سريع ثم خفوت ناعم). */
function envGain(c, t0, peak, attack, dur) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(master);
  return g;
}

/** نغمة بسيطة مع انزلاق اختياري في التردد. */
function tone(freq, { at = 0, dur = 0.15, type = "sine", vol = 0.2, attack = 0.008, slideTo = null, slideTime = null } = {}) {
  const c = running();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + (slideTime ?? dur));
  osc.connect(envGain(c, t0, vol, attack, dur));
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** «ماريمبا»: نغمة خشبية دافئة (الأساس + هارمونيك عالٍ يخفت بسرعة). */
function marimba(freq, at = 0, vol = 0.22, dur = 0.45) {
  tone(freq, { at, dur, type: "sine", vol, attack: 0.004 });
  tone(freq * 4, { at, dur: 0.07, type: "sine", vol: vol * 0.35, attack: 0.002 });
  tone(freq * 2, { at, dur: dur * 0.5, type: "triangle", vol: vol * 0.25, attack: 0.004 });
}

/** «جرس» لامع (هارمونيكات غير منتظمة كالأجراس الحقيقية). */
function bell(freq, at = 0, vol = 0.18, dur = 0.9) {
  tone(freq, { at, dur, vol, attack: 0.003 });
  tone(freq * 2.76, { at, dur: dur * 0.55, vol: vol * 0.45, attack: 0.003 });
  tone(freq * 5.4, { at, dur: dur * 0.3, vol: vol * 0.25, attack: 0.002 });
}

/** «فقاعة»: نغمة قصيرة تقفز للأعلى. */
function pop(at = 0, from = 380, to = 1100, vol = 0.22, dur = 0.09) {
  tone(from, { at, dur, type: "sine", vol, attack: 0.003, slideTo: to, slideTime: dur * 0.8 });
}

/** ضجيج مُرشَّح (طرقة خشبية / نفحة هواء). */
function noise({ at = 0, dur = 0.05, vol = 0.15, freq = 2000, q = 1, type = "bandpass", sweepTo = null } = {}) {
  const c = running();
  if (!c) return;
  const t0 = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  src.connect(f).connect(envGain(c, t0, vol, Math.min(0.02, dur / 3), dur));
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** طرقة خشبية قصيرة (للعدّاد). */
function woodblock(freq = 1700, at = 0, vol = 0.16) {
  tone(freq, { at, dur: 0.05, type: "sine", vol, attack: 0.001, slideTo: freq * 0.85 });
  noise({ at, dur: 0.025, vol: vol * 0.5, freq: freq * 1.6, q: 6 });
}

/** بريق: نغمات عالية سريعة متتابعة. */
function sparkle(at = 0, count = 6, vol = 0.07) {
  const notes = [2093, 2637, 3136, 2349, 2794, 3520, 3951];
  for (let i = 0; i < count; i++) {
    tone(notes[(i * 3) % notes.length], { at: at + i * 0.045, dur: 0.18, vol, attack: 0.002 });
  }
}

/** «بوينغ» نابض (انتقال الدور). */
function boing(at = 0, vol = 0.18) {
  const c = running();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(260, t0);
  osc.frequency.exponentialRampToValueAtTime(620, t0 + 0.12);
  osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.4);
  lfo.frequency.setValueAtTime(18, t0);
  lfo.frequency.linearRampToValueAtTime(6, t0 + 0.4);
  lfoGain.gain.setValueAtTime(40, t0);
  lfoGain.gain.linearRampToValueAtTime(4, t0 + 0.4);
  lfo.connect(lfoGain).connect(osc.frequency);
  osc.connect(envGain(c, t0, vol, 0.01, 0.42));
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + 0.5);
  lfo.stop(t0 + 0.5);
}

/** «وا وا وا» — ترومبون حزين مرح لانتهاء الوقت. */
function sadTrombone(at = 0, vol = 0.13) {
  const c = running();
  if (!c) return;
  const notes = [392, 370, 349, 330];
  notes.forEach((f, i) => {
    const t0 = c.currentTime + at + i * 0.26;
    const last = i === notes.length - 1;
    const dur = last ? 0.7 : 0.24;
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, t0);
    if (last) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = 9;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0 + 0.1);
      lfo.stop(t0 + dur + 0.05);
    }
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1100, t0);
    lp.Q.value = 3;
    osc.connect(lp).connect(envGain(c, t0, vol, 0.03, dur));
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  });
}

// نوتات (Hz)
const N = {
  C4: 261.63, E4: 329.63, G4: 392,
  C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77,
  C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093,
};

const SOUNDS = {
  /* واجهة */
  click: () => pop(0, 600, 900, 0.1, 0.05),
  toggleOn: () => { pop(0, 500, 900, 0.14, 0.07); pop(0.07, 700, 1300, 0.12, 0.07); },
  toggleOff: () => { pop(0, 900, 600, 0.12, 0.07); pop(0.07, 700, 420, 0.1, 0.08); },

  /* اللعب */
  // كشف السؤال: نفحة ناعمة + نغمتان صاعدتان
  reveal: () => {
    noise({ dur: 0.32, vol: 0.06, freq: 500, sweepTo: 3200, q: 0.8 });
    marimba(N.C5, 0.12, 0.16);
    marimba(N.G5, 0.2, 0.16);
  },
  // فتح الأجراس: ثلاث فقاعات صاعدة «بلوب-بلوب-بليب»
  arm: () => { pop(0, 300, 700, 0.18); pop(0.1, 420, 950, 0.18); pop(0.2, 560, 1400, 0.2, 0.11); },
  open: () => { pop(0, 420, 950, 0.18); pop(0.1, 560, 1400, 0.18); },
  tick: () => woodblock(1500, 0, 0.26),
  tickUrgent: () => woodblock(2100, 0, 0.34),
  // أحدهم ضغط الجرس: «دينغ-دونغ» جرس برامج المسابقات
  buzz: () => { bell(N.E6, 0, 0.2, 0.6); bell(N.C6, 0.16, 0.2, 0.8); },
  // فريقي ضغط أولاً (على جوال اللاعب)
  win: () => { marimba(N.C6, 0, 0.2); marimba(N.E6, 0.08, 0.2); marimba(N.G6, 0.16, 0.22, 0.6); sparkle(0.2, 4); },
  correct: () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => marimba(f, i * 0.08, 0.2)); sparkle(0.3, 5); },
  // نقطة لفريق الخصم (على جوال اللاعب) — هبوط لطيف غير مزعج
  wrong: () => { tone(520, { dur: 0.32, vol: 0.26, slideTo: 200, slideTime: 0.3 }); pop(0.05, 300, 220, 0.08, 0.12); },
  // نقطة محسوبة: «تشينغ» عملة + بريق
  point: () => { marimba(N.B5, 0, 0.2, 0.25); bell(N.E6, 0.08, 0.18, 0.7); sparkle(0.15, 4, 0.05); },
  timeout: () => sadTrombone(),
  turnSwitch: () => boing(0, 0.42),
  celebrate: () => {
    [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6].forEach((f, i) => marimba(f, i * 0.07, 0.18));
    sparkle(0.42, 7, 0.06);
  },
  // فوز باللعبة: لحن احتفالي + جرس + بريق
  gameWin: () => {
    const melody = [[N.G5, 0], [N.G5, 0.13], [N.G5, 0.26], [N.E5, 0.39], [N.G5, 0.65], [N.C6, 0.9]];
    melody.forEach(([f, t]) => marimba(f, t, 0.22, 0.4));
    tone(N.C4, { at: 0.9, dur: 1.1, type: "triangle", vol: 0.14 });
    tone(N.E4, { at: 0.9, dur: 1.1, type: "triangle", vol: 0.1 });
    bell(N.C6, 0.9, 0.16, 1.4);
    sparkle(1.0, 7, 0.07);
  },
};

/* ---------------- ملفات صوت حقيقية (اختيارية) ---------------- */

const fileBuffers = {};
let filesLoading = false;

/** يحمّل public/sounds/manifest.json إن وُجد، ويجهّز ملفاته لتحلّ محل الأصوات المولّدة. */
async function loadSoundFiles() {
  if (filesLoading || typeof fetch === "undefined") return;
  filesLoading = true;
  try {
    const res = await fetch("/sounds/manifest.json", { cache: "no-cache" });
    if (!res.ok) return;
    const manifest = await res.json();
    const c = audio();
    if (!c) return;
    await Promise.all(
      Object.entries(manifest).map(async ([name, file]) => {
        try {
          const r = await fetch(`/sounds/${encodeURIComponent(file)}`);
          if (!r.ok) return;
          fileBuffers[name] = await c.decodeAudioData(await r.arrayBuffer());
        } catch {
          /* ملف تالف — نبقى على الصوت المولّد */
        }
      })
    );
  } catch {
    /* لا ملفات — الأصوات المولّدة تكفي */
  }
}

function playFile(name) {
  const buf = fileBuffers[name];
  const c = running();
  if (!buf || !c) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.start();
  return true;
}

/* ---------------- الواجهة (زر الكتم + طلب الإذن) ---------------- */

function updateButtons() {
  document.querySelectorAll("[data-sfx-toggle]").forEach((el) => {
    el.replaceChildren(icon(muted ? "volume-off" : "volume"));
    el.setAttribute("aria-label", muted ? "تشغيل الأصوات" : "كتم الأصوات");
    el.classList.toggle("sfx-off", muted);
  });
}

function hideOverlay() {
  if (overlay) overlay.hidden = true;
}

function ensureOverlay() {
  if (overlay || typeof document === "undefined") return overlay;
  overlay = document.createElement("button");
  overlay.type = "button";
  overlay.className = "ds-btn ds-btn--primary ds-dock";
  overlay.hidden = true;
  overlay.append(icon("volume"), document.createTextNode("اضغط لتشغيل الصوت"));
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
  const o = ensureOverlay();
  if (o) o.hidden = false;
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
loadSoundFiles();

export const sfx = {
  get muted() {
    return muted;
  },

  /** persist:false = أمر مؤقّت من جهاز آخر (مثل الحكم للشاشة) لا يُحفظ على هذا الجهاز. */
  setMuted(value, { persist = true } = {}) {
    if (!persist && muted === !!value) return muted;
    muted = !!value;
    if (persist) {
      try {
        localStorage.setItem(LS_MUTED, muted ? "1" : "0");
      } catch {
        /* ignore */
      }
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
    const fn = SOUNDS[name] || (() => {});
    if (!SOUNDS[name] && !fileBuffers[name]) return;
    if (!running()) {
      maybeShowOverlay();
      return;
    }
    try {
      if (!playFile(name)) fn();
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
