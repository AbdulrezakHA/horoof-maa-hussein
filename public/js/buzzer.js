/**
 * جرس اللاعب — تجربة تلقائية كاملة (بلا أي تدخّل من الحكم أثناء السؤال).
 * يُفتح من: /buzzer?room=main&team=a  (أو team=b)
 *
 * كل شيء يُشتقّ من حالة الخادم فقط:
 *   - كشف السؤال      → تُفتح الأجراس تلقائياً (المحرّك)
 *   - أول ضغطة        → يفوز صاحبها ويبدأ مؤقّته (المحرّك)
 *   - انتهاء مؤقّت #1 → يبدأ مؤقّت اللاعب الثاني تلقائياً (المحرّك)
 *   - إعلان النقطة    → شاشة احتفال للفائز وشاشة «الخصم أخذ النقطة» للآخر
 *   - سؤال جديد       → كل شيء يتصفّر تلقائياً (round يتغيّر)
 *
 * الحالات المرئية (body[data-view]):
 *   off         الأجراس متوقفة / لم تصل الحالة بعد
 *   idle        استعدّ — لم يُكشف السؤال
 *   arm         الأجراس مفتوحة — اضغط الآن!
 *   mine        دوري — عدّاد بلون فريقي + صوت لكل ثانية
 *   rival       دور الخصم — شاشة باهتة بلا صوت
 *   correct     أخذت النقطة — احتفال!
 *   rivalPoint  الخصم أخذ النقطة
 *   expired     انتهى الوقت (بلا إجابة)
 *   over        انتهت اللعبة
 */
import { Transport, remainingMs } from "/js/transport.js";
import { sfx } from "/js/sfx.js";

const params = new URLSearchParams(location.search);
const room = params.get("room") || "main";
const team = params.get("team") === "b" ? "b" : "a";
const rival = team === "a" ? "b" : "a";

// ألوان احتياطية قبل وصول حالة الخادم (تُستبدل بلون الفريق الحقيقي)
const FALLBACK_COLOR = { a: "#6965ae", b: "#4b9cbf" };

const el = {
  chip: document.getElementById("teamChip"),
  dot: document.getElementById("teamColorDot"),
  teamName: document.getElementById("teamName"),
  conn: document.getElementById("connState"),
  connText: document.getElementById("connText"),
  question: document.getElementById("bzQuestion"),
  qLetter: document.getElementById("qLetter"),
  qText: document.getElementById("qText"),
  letterBar: document.getElementById("letterBar"),
  letterBarValue: document.getElementById("letterBarValue"),
  center: document.getElementById("bzCenter"),
  bodyBox: document.querySelector(".bz-center-body"),
  ring: document.getElementById("bzRing"),
  ringNum: document.getElementById("ringNum"),
  ringSub: document.getElementById("ringSub"),
  icon: document.getElementById("centerIcon"),
  title: document.getElementById("centerTitle"),
  sub: document.getElementById("centerSub"),
  pad: document.getElementById("buzzPad"),
  hitIcon: document.getElementById("hitIcon"),
  hitLabel: document.getElementById("hitLabel"),
  note: document.getElementById("buzzNote"),
  confetti: document.getElementById("confetti"),
  flash: document.getElementById("bzFlash"),
};

const link = new Transport("buzzer", room, "", { team });

let snap = null; // آخر لقطة حالة
let sent = false; // أرسلنا ضغطة وننتظر رد الخادم
let sentGuard = 0; // مؤقّت أمان لفكّ قفل الزر

// نتتبّع الانتقالات لتشغيل كل مؤثّر مرّة واحدة فقط
const seen = {
  round: -1,
  revealed: false,
  open: false,
  winner: null,
  verdictAt: 0,
  turn: null,
  stage: null,
  expired: false,
  over: false,
};

let clockId = null;
let lastSec = -1;
let clockEndsAt = 0;

/* ================= أدوات مساعدة ================= */

const view = () => document.body.dataset.view;

function setView(name) {
  if (view() === name) return false;
  document.body.dataset.view = name;
  return true;
}

function show(node, on) {
  if (node) node.hidden = !on;
}

function setCenter(icon, title, sub) {
  if (el.icon) el.icon.textContent = icon;
  if (el.title) el.title.textContent = title;
  if (el.sub) el.sub.textContent = sub ?? "";
}

function clearConfetti() {
  if (el.confetti) el.confetti.replaceChildren();
}

function flash() {
  if (!el.flash) return;
  el.flash.classList.remove("on");
  void el.flash.offsetWidth;
  el.flash.classList.add("on");
  setTimeout(() => el.flash.classList.remove("on"), 600);
}

function confettiBurst() {
  if (!el.confetti) return;
  const colors = [teamColor(), "#ffd93d", "#4ade80", "#ff8fab", "#ffffff"];
  const n = 90;
  for (let i = 0; i < n; i++) {
    const bit = document.createElement("i");
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * 0.5}s`;
    bit.style.animationDuration = `${1.5 + Math.random() * 1.6}s`;
    bit.style.transform = `scale(${0.6 + Math.random()})`;
    el.confetti.appendChild(bit);
  }
  setTimeout(clearConfetti, 3600);
}

function teamColor() {
  return snap?.state?.teams?.[team]?.color || FALLBACK_COLOR[team];
}

/* ================= المؤقّت المرئي ================= */

function startClock() {
  if (clockId) return;
  clockId = setInterval(tickClock, 100);
  tickClock();
}

function stopClock() {
  if (!clockId) return;
  clearInterval(clockId);
  clockId = null;
}

function tickClock() {
  const c = snap?.state?.current;
  const timer = c?.timer;
  if (!timer?.running) {
    stopClock();
    return;
  }
  const rem = remainingMs(timer, link.serverOffset);
  const total = Math.max(1, timer.total || 1);
  const ratio = Math.max(0, Math.min(1, rem / (total * 1000)));
  const secs = Math.ceil(rem / 1000);

  document.documentElement.style.setProperty("--p", ratio.toFixed(3));
  if (el.ringNum) el.ringNum.textContent = String(secs);
  if (el.ringSub) el.ringSub.textContent = c.turn === team ? "ثانية" : "للخصم";

  if (secs === lastSec) return;
  lastSec = secs;

  // صوت كل ثانية — فقط عندما يكون الدور دوري (توهّج + نبض)
  if (secs > 0 && c.turn === team && view() === "mine") {
    el.ring?.classList.remove("bz-beat");
    void el.ring?.offsetWidth;
    el.ring?.classList.add("bz-beat");
    if (secs <= 3) {
      sfx.play("tickUrgent");
      sfx.vibrate(35);
    } else {
      sfx.play("tick");
    }
  }
}

/* ================= الاشتقاق والعرض ================= */

function derive(st) {
  if (!st) {
    return { v: "off", icon: "⏳", title: "جارٍ التحميل...", sub: "", note: "", body: true };
  }
  const c = st.current || {};
  const buzz = c.buzz || {};
  const timer = c.timer || {};
  const rivalName = st.teams?.[rival]?.name || "الخصم";

  if (st.winner) {
    return {
      v: "over",
      icon: "🏆",
      title: "انتهت اللعبة",
      sub: `فاز ${st.teams?.[st.winner]?.name || ""}`,
      note: "",
      body: true,
    };
  }

  if (!buzz.enabled) {
    return {
      v: "off",
      icon: "🔇",
      title: "الأجراس متوقفة",
      sub: "سيُفتح الضغط من الحكم",
      note: "",
      body: true,
    };
  }

  if (c.verdict) {
    if (c.verdict.team === team) {
      return { v: "correct", icon: "✅", title: "إجابة صحيحة!", sub: "لك النقطة 🎉", note: "أحسنت!", body: true };
    }
    return {
      v: "rivalPoint",
      icon: "❌",
      title: `${rivalName} أخذ النقطة`,
      sub: "السؤال القادم فرصتك",
      note: "",
      body: true,
    };
  }

  if (timer.running) {
    if (c.turn === team) {
      return {
        v: "mine",
        icon: "",
        title: "دورك!",
        sub: "أجب الآن قبل انتهاء الوقت",
        note: "أسرِع!",
        body: true,
        ring: true,
      };
    }
    return {
      v: "rival",
      icon: "",
      title: `${rivalName} يجيب`,
      sub: "انتظر دورك...",
      note: "ليس دورك الآن",
      body: true,
      ring: true,
    };
  }

  if (buzz.winner) {
    return { v: "expired", icon: "⌛", title: "انتهى الوقت", sub: "لا إجابة — بانتظار الحكم", note: "", body: true };
  }

  if (buzz.open) {
    return { v: "arm", icon: "🔔", title: "اضغط الآن!", sub: "أول ضغطة تفوز", note: "أول ضغطة فقط تُحتسب", pad: true };
  }

  return {
    v: "idle",
    icon: "👀",
    title: "استعدّ...",
    sub: c.revealed ? "الأجراس قيد الفتح" : "انتظر كشف السؤال",
    note: "",
    body: true,
  };
}

function paint(d) {
  setView(d.v);
  setCenter(d.icon, d.title, d.sub);
  show(el.pad, !!d.pad);
  show(el.ring, !!d.ring);
  show(el.bodyBox, !!d.body);
  if (el.note) el.note.textContent = d.note ?? "";
  if (el.center) el.center.dataset.state = d.v;

  if (d.pad) {
    // حالة «أرسلنا» تُبقى الزر ظاهراً لكن بلا استجابة
    if (sent) {
      if (el.hitIcon) el.hitIcon.textContent = "📡";
      if (el.hitLabel) el.hitLabel.textContent = "لحظة...";
    } else {
      if (el.hitIcon) el.hitIcon.textContent = "🔔";
      if (el.hitLabel) el.hitLabel.textContent = "اضغط الآن!";
    }
  }
}

function render() {
  const st = snap?.state;

  // الألوان: لون فريقي (وانعكاس إعدادات الحكم)
  const color = teamColor();
  const theme = st?.theme || {};
  const root = document.documentElement.style;
  root.setProperty("--team", color);
  if (theme.bgColor) root.setProperty("--bg", theme.bgColor);
  if (theme.cellColor) root.setProperty("--cell", theme.cellColor);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);

  if (el.dot) el.dot.style.background = color;
  if (el.teamName) {
    el.teamName.textContent = st?.teams?.[team]?.name || (team === "a" ? "الفريق الأول" : "الفريق الثاني");
  }

  // السؤال: يظهر فقط بعد كشف الحكم، ويختفي عند تغييره
  const q = st?.current?.question;
  const revealed = !!st?.current?.revealed && !!q;
  if (revealed) {
    show(el.question, true);
    if (el.qLetter) el.qLetter.textContent = q.letter || "؟";
    if (el.qText) el.qText.textContent = q.text || "";
  } else {
    show(el.question, false);
    if (el.qLetter) el.qLetter.textContent = "";
    if (el.qText) el.qText.textContent = "";
  }

  // الحرف المختار: يظهر دائماً للاعب أثناء اختيار الحرف (حتى قبل كشف السؤال)
  const selectedLetter = st?.current?.question?.letter || "";
  if (el.letterBar) {
    show(el.letterBar, !!selectedLetter);
    if (el.letterBarValue) el.letterBarValue.textContent = selectedLetter || "؟";
  }

  paint(derive(st));

  // المؤقّت
  const timer = st?.current?.timer;
  if (timer?.running) {
    if (timer.endsAt !== clockEndsAt) {
      clockEndsAt = timer.endsAt;
      lastSec = -1;
    }
    startClock();
  } else {
    stopClock();
    clockEndsAt = 0;
    root.setProperty("--p", "1");
  }
}

/* ================= المؤثرات الصوتية عند الانتقالات ================= */

function transitions(st) {
  if (!st) return;
  const c = st.current || {};
  const buzz = c.buzz || {};
  const timer = c.timer || {};

  // سؤال/جولة جديدة → تصفير كل شيء محلياً
  const round = c.round ?? 0;
  if (seen.round !== round) {
    seen.round = round;
    seen.revealed = false;
    seen.open = false;
    seen.winner = null;
    seen.verdictAt = 0;
    seen.turn = null;
    seen.stage = null;
    seen.expired = false;
    lastSec = -1;
    clearConfetti();
  }

  // كشف السؤال
  if (c.revealed && !seen.revealed) {
    seen.revealed = true;
    sfx.play("reveal");
  }

  // فتح باب الضغط
  if (buzz.open && !seen.open && !buzz.winner) {
    seen.open = true;
    sfx.play("arm");
    sfx.vibrate([20, 40, 20]);
  } else if (!buzz.open) {
    seen.open = false;
  }

  // أول ضغطة
  const winner = buzz.winner || null;
  if (winner && winner !== seen.winner) {
    seen.winner = winner;
    if (winner === team) {
      sfx.play("win");
      sfx.vibrate([50, 60, 160]);
    } else {
      sfx.play("buzz");
      sfx.vibrate(90);
    }
  } else if (!winner) {
    seen.winner = null;
  }

  // انتقال الدور إلى اللاعب الثاني تلقائياً
  if (timer.stage === "buzz2" && seen.stage !== "buzz2") {
    seen.stage = "buzz2";
    sfx.play("turnSwitch");
    if (c.turn === team) sfx.vibrate([30, 40, 30, 40, 120]);
  } else if (timer.stage !== "buzz2") {
    seen.stage = timer.stage || null;
  }

  // انتهاء الوقت
  if (seen.winner && !timer.running && !c.verdict && !st.winner) {
    if (!seen.expired) {
      seen.expired = true;
      sfx.play("timeout");
      sfx.vibrate([120, 60, 120]);
    }
  } else if (timer.running || !seen.winner) {
    seen.expired = false;
  }

  // إعلان النقطة
  const at = c.verdict?.at || 0;
  if (c.verdict && at !== seen.verdictAt) {
    seen.verdictAt = at;
    if (c.verdict.team === team) {
      flash();
      confettiBurst();
      sfx.play("celebrate");
      sfx.vibrate([40, 50, 40, 50, 240]);
    } else {
      sfx.play("wrong");
      sfx.vibrate(120);
    }
  }

  // انتهاء اللعبة
  if (st.winner && !seen.over) {
    seen.over = true;
    sfx.play("gameWin");
    if (st.winner === team) confettiBurst();
    sfx.vibrate([60, 80, 60, 80, 300]);
  }
}

/* ================= الضغط ================= */

function buzz() {
  const b = snap?.state?.current?.buzz;
  if (!b?.enabled || !b.open || b.winner || sent) return;

  sent = true;
  sfx.play("buzz");
  sfx.vibrate(30);
  el.pad?.classList.add("bz-pressed");
  setTimeout(() => el.pad?.classList.remove("bz-pressed"), 380);

  link.buzz();
  render();

  // لو تأخر رد الخادم، نفكّ القفل حتى لا يعلق الزر
  clearTimeout(sentGuard);
  sentGuard = setTimeout(() => {
    if (sent) {
      sent = false;
      render();
    }
  }, 2500);
}

el.pad?.addEventListener("click", buzz);

/* ================= الاتصال ================= */

const STATUS = {
  online: { cls: "open", text: "متصل" },
  connecting: { cls: "connecting", text: "جارٍ الاتصال..." },
  reconnecting: { cls: "connecting", text: "إعادة الاتصال..." },
  offline: { cls: "closed", text: "غير متصل" },
};

link.onStatus = (status) => {
  const s = STATUS[status] || STATUS.connecting;
  if (el.conn) el.conn.dataset.status = s.cls;
  if (el.connText) el.connText.textContent = s.text;
  if (status !== "online") {
    sent = false;
  }
  render();
};

link.onState = (msg) => {
  snap = msg;
  const c = msg.state?.current;
  if (c?.buzz?.winner) {
    sent = false;
    clearTimeout(sentGuard);
  }
  transitions(msg.state);
  render();
};

link.onBuzzed = (msg) => {
  sent = false;
  clearTimeout(sentGuard);
  if (!msg.ok && msg.reason === "taken") {
    setTimeout(render, 400);
  }
  render();
};

/* ================= إضافات ================= */

// إبقاء الشاشة مضاءة إن كان المتصفح يدعم ذلك
async function keepAwake() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {}
}
keepAwake();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) keepAwake();
});

// منع تكبير اللمس المزدوج
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("dblclick", (event) => event.preventDefault());

render();
link.connect();
