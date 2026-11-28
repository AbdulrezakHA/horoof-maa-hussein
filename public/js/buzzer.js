/**
 * جوال اللاعب — جرس شخصي لكل لاعب (نظام اللاعبين v2).
 *
 *  /play?room=main           ← رمز QR واحد للجميع: يكتب اللاعب اسمه ويختار فريقه ثم يضغط جرسه
 *  /buzzer?room=main&team=a  ← الوضع القديم (خطة بديلة): جرس واحد لكل فريق
 *
 * كل شيء يُشتقّ من حالة الخادم:
 *   الجولة ١: الجميع يفكّر بلا حدّ زمني ← أول من يضغط جرسه يجيب
 *   الجولة ٢: خطأ/انتهى وقته ← الفريق الآخر يجيب بصوت عالٍ (بلا أجراس) مع عدّاد
 *   الجولة ٣: مفتوح للجميع بلا أجراس وبلا وقت
 *
 * الحالات المرئية (body[data-view]):
 *   off · idle · arm · mine · rival · correct · rivalPoint · expired · over
 */
import { Transport, remainingMs } from "/js/transport.js";
import { sfx } from "/js/sfx.js";
import { inkFor } from "/shared/colors.js";
import { initTabooPhone, renderTabooPhone } from "/js/phone-taboo.js";

window.__appStarted = true; // انظر /js/diag.js

const params = new URLSearchParams(location.search);
const room = params.get("room") || "main";
const PLAYER_MODE = location.pathname.startsWith("/play");
const LEGACY_TEAM = params.get("team") === "b" ? "b" : "a";

// ألوان احتياطية قبل وصول حالة الخادم
const FALLBACK_COLOR = { a: "#6965ae", b: "#4b9cbf" };

/* ---------------- هوية اللاعب (ثابتة على هذا الجوال) ---------------- */

function playerIdOnThisPhone() {
  const KEY = "horoof-player-id";
  let id = "";
  try {
    id = localStorage.getItem(KEY) || "";
  } catch {}
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = "p" + [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 18);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }
  return id;
}

const ME = PLAYER_MODE ? playerIdOnThisPhone() : `team:${LEGACY_TEAM}`;

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
  stage: document.querySelector(".bz-stage"),
  join: document.getElementById("joinView"),
  joinForm: document.getElementById("joinForm"),
  joinName: document.getElementById("joinName"),
  joinTeams: document.getElementById("joinTeams"),
  joinNote: document.getElementById("joinNote"),
  stats: document.getElementById("myStats"),
  taboo: document.getElementById("tabooPhone"),
};

const link = PLAYER_MODE
  ? new Transport("player", room, "", { playerId: ME })
  : new Transport("buzzer", room, "", { team: LEGACY_TEAM });

initTabooPhone({
  me: ME,
  myTeam: () => myTeam(),
  sendRaw: (m) => link.sendRaw(m),
  sfx,
  inkFor,
  getState: () => snap?.state,
  remainingMs: (t) => remainingMs(t, link.serverOffset),
});

let snap = null; // آخر لقطة حالة
let sent = false; // أرسلنا ضغطة وننتظر رد الخادم
let sentGuard = 0;
let joining = false; // اللاعب فتح شاشة الانضمام (أول مرة أو لتغيير الاسم/الفريق)
let chosenTeam = null; // الفريق المختار في شاشة الانضمام

const seen = {
  round: -1,
  revealed: false,
  canPress: false,
  answerer: null,
  stage: 0,
  verdictAt: 0,
  missedAt: 0,
  expired: false,
  over: false,
};

let clockId = null;
let lastSec = -1;
let clockEndsAt = 0;

/* ================= من أنا؟ ================= */

const st = () => snap?.state;
const me = () => st()?.players?.[ME] || null;
function myTeam() {
  if (!PLAYER_MODE) return LEGACY_TEAM;
  return me()?.team || chosenTeam || "a";
}
const rivalOf = (t) => (t === "a" ? "b" : "a");
const teamName = (t) => st()?.teams?.[t]?.name || (t === "a" ? "الفريق الأول" : "الفريق الثاني");
const teamColor = (t = myTeam()) => st()?.teams?.[t]?.color || FALLBACK_COLOR[t];
const joined = () => !PLAYER_MODE || !!me();

/** هل يحقّ لي الضغط الآن؟ ولماذا لا (لشرح الجرس الرمادي). */
function pressRight(state) {
  const b = state?.current?.buzz || {};
  if (!b.enabled) return { ok: false, why: "off" };
  if (!b.open || b.phase !== "open" || b.stage !== 1) return { ok: false, why: "closed" };
  if (b.noRepeat && state.lastFirst === ME && PLAYER_MODE) return { ok: false, why: "repeat" };
  return { ok: true };
}

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
  for (let i = 0; i < 90; i++) {
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
  const c = st()?.current;
  const timer = c?.timer;
  if (!timer?.running) {
    stopClock();
    return;
  }
  const rem = remainingMs(timer, link.serverOffset);
  const total = Math.max(1, timer.total || 1);
  const ratio = Math.max(0, Math.min(1, rem / (total * 1000)));
  const secs = Math.ceil(rem / 1000);
  const answering =
    (c.buzz?.phase === "answer" && c.buzz?.player?.id === ME) ||
    (c.buzz?.phase === "team" && c.buzz?.allowed === myTeam());

  document.documentElement.style.setProperty("--p", ratio.toFixed(3));
  if (el.ringNum) el.ringNum.textContent = String(secs);
  if (el.ringSub) el.ringSub.textContent = answering ? "ثانية" : "ثانية متبقية";

  if (secs === lastSec) return;
  lastSec = secs;

  // صوت كل ثانية — فقط عندما أكون أنا من يجيب
  if (secs > 0 && answering) {
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

function derive(state) {
  if (!state) {
    return { v: "off", icon: "⏳", title: "جارٍ التحميل...", sub: "", note: "", body: true };
  }
  if (!state.game) {
    return { v: "idle", icon: "🎮", title: "بانتظار اختيار اللعبة", sub: "الحكم يختار اللعبة الآن…", note: "", body: true };
  }
  const c = state.current || {};
  const b = c.buzz || {};
  const mine = myTeam();
  const answer = c.answerRevealed ? c.question?.answer || "" : "";
  const answerNote = answer ? `الجواب: ${answer}` : "";

  if (state.winner) {
    return {
      v: "over",
      icon: "🏆",
      title: state.winner === mine ? "فاز فريقك! 🎉" : "انتهت اللعبة",
      sub: `فاز ${teamName(state.winner)}`,
      note: me() && !me().pseudo ? `نقاطك: ${me().score} · ضغطاتك: ${me().buzzes}` : "",
      body: true,
    };
  }

  if (!b.enabled) {
    return { v: "off", icon: "🔇", title: "الأجراس متوقفة", sub: "سيُفتح الضغط من الحكم", note: "", body: true };
  }

  if (c.verdict) {
    if (c.verdict.playerId === ME) {
      return { v: "correct", icon: "✅", title: "إجابتك صحيحة!", sub: "لك النقطة 🎉", note: answerNote || "أحسنت!", body: true };
    }
    if (c.verdict.team === mine) {
      const who = state.players?.[c.verdict.playerId];
      return {
        v: "correct",
        icon: "✅",
        title: "فريقك أخذ النقطة!",
        sub: who && !who.pseudo ? `أجاب ${who.name} 👏` : "🎉",
        note: answerNote,
        body: true,
      };
    }
    return {
      v: "rivalPoint",
      icon: "❌",
      title: `${teamName(c.verdict.team)} أخذ النقطة`,
      sub: "السؤال القادم فرصتك",
      note: answerNote,
      body: true,
    };
  }

  if (c.missed) {
    return { v: "expired", icon: "🤷", title: "لم يُجب أحد", sub: "لا نقطة لأحد هذه المرة", note: answerNote, body: true };
  }

  // أحدهم يجيب الآن
  if (b.phase === "answer" && b.player) {
    if (b.player.id === ME) {
      return {
        v: "mine",
        icon: "",
        title: "أنت تجيب!",
        sub: "قل الجواب بصوت عالٍ",
        note: "أسرِع!",
        body: true,
        ring: true,
      };
    }
    const sameTeam = b.player.team === mine;
    const label = b.player.id.startsWith("team:") ? teamName(b.player.team) : b.player.name;
    return {
      v: "rival",
      icon: "",
      title: sameTeam ? `زميلك ${label} يجيب` : `${label} يجيب`,
      sub: sameTeam ? "ساعده بالصمت 🤫" : `من ${teamName(b.player.team)}`,
      note: "ليس دورك الآن",
      body: true,
      ring: true,
    };
  }

  if (b.phase === "open") {
    const right = pressRight(state);
    if (right.ok) {
      return { v: "arm", icon: "🔔", title: "اضغط الآن!", sub: "خذ وقتك للتفكير — أول ضغطة تفوز", note: "أول ضغطة فقط تُحتسب", pad: true };
    }
    if (right.why === "repeat") {
      return { v: "rival", icon: "✋", title: "دع غيرك يضغط أولاً", sub: "ضغطت أولاً في السؤال السابق", note: "", body: true };
    }
  }

  // الجولة ٢: دور الفريق الآخر — يجيبون بصوت عالٍ بلا أجراس
  if (b.phase === "team") {
    if (b.allowed === mine) {
      return {
        v: "mine",
        icon: "",
        title: "دوركم!",
        sub: "جاوبوا بصوت عالٍ — حاولوا قدر ما تريدون",
        note: "بلا جرس",
        body: true,
        ring: true,
      };
    }
    return {
      v: "rival",
      icon: "",
      title: `دور ${teamName(b.allowed)}`,
      sub: "انتظروا — إن لم يعرفوا يُفتح السؤال للجميع",
      note: "",
      body: true,
      ring: true,
    };
  }

  // الجولة ٣: مفتوح للجميع بلا أجراس وبلا وقت
  if (b.phase === "all") {
    return {
      v: "mine",
      icon: "🗣️",
      title: "مفتوح للجميع!",
      sub: "من يعرف الجواب؟ قولوه بصوت عالٍ",
      note: "الحكم يحدّد الفريق الذي أجاب",
      body: true,
    };
  }

  if (b.phase === "done") {
    return { v: "expired", icon: "⌛", title: "حُسم السؤال", sub: "بانتظار السؤال القادم", note: "", body: true };
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
    if (sent) {
      if (el.hitIcon) el.hitIcon.textContent = "📡";
      if (el.hitLabel) el.hitLabel.textContent = "لحظة...";
    } else {
      if (el.hitIcon) el.hitIcon.textContent = "🔔";
      if (el.hitLabel) el.hitLabel.textContent = "اضغط الآن!";
    }
  }
}

/* ---------------- شاشة الانضمام (اسم + فريق) ---------------- */

function renderJoin() {
  const showJoin = PLAYER_MODE && (joining || (snap && !me()));
  show(el.join, showJoin);
  show(el.stage, !showJoin);
  if (!showJoin || !el.joinTeams) return;

  const state = st();
  const counts = { a: 0, b: 0 };
  for (const pl of Object.values(state?.players || {})) {
    if (!pl.pseudo) counts[pl.team] = (counts[pl.team] || 0) + 1;
  }
  if (!chosenTeam) chosenTeam = me()?.team || (counts.a <= counts.b ? "a" : "b");

  el.joinTeams.replaceChildren();
  for (const t of ["a", "b"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bz-team-pick";
    btn.classList.toggle("active", chosenTeam === t);
    btn.style.setProperty("--pick", teamColor(t));
    btn.style.setProperty("--pick-ink", inkFor(teamColor(t)));
    const name = document.createElement("span");
    name.className = "bz-team-pick-name";
    name.textContent = teamName(t);
    const n = document.createElement("span");
    n.className = "bz-team-pick-count";
    n.textContent = `${counts[t]} ${counts[t] === 1 ? "لاعب" : "لاعبين"}`;
    btn.append(name, n);
    btn.addEventListener("click", () => {
      chosenTeam = t;
      sfx.play("click");
      renderJoin();
    });
    el.joinTeams.appendChild(btn);
  }
  if (el.joinName && document.activeElement !== el.joinName && !el.joinName.value) {
    el.joinName.value = me()?.name || localStorage.getItem("horoof-player-name") || "";
  }
}

el.joinForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = (el.joinName?.value || "").trim();
  if (!name) {
    if (el.joinNote) el.joinNote.textContent = "اكتب اسمك أولاً";
    el.joinName?.focus();
    return;
  }
  try {
    localStorage.setItem("horoof-player-name", name);
  } catch {}
  link.sendRaw({ t: "join", name, team: chosenTeam || "a" });
  joining = false;
  sfx.unlock();
  sfx.play("toggleOn");
  if (el.joinNote) el.joinNote.textContent = "";
  render();
});

// الضغط على شارة الاسم يفتح شاشة تغيير الاسم/الفريق
el.chip?.addEventListener("click", () => {
  if (!PLAYER_MODE) return;
  joining = true;
  chosenTeam = me()?.team || chosenTeam;
  render();
});

function render() {
  const state = st();

  // الألوان: لون فريقي
  const color = teamColor();
  const root = document.documentElement.style;
  root.setProperty("--team", color);
  root.setProperty("--team-ink", inkFor(color));
  const theme = state?.theme || {};
  if (theme.bgColor) root.setProperty("--bg", theme.bgColor);
  if (theme.cellColor) root.setProperty("--cell", theme.cellColor);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);

  if (el.dot) el.dot.style.background = color;
  if (el.teamName) {
    el.teamName.textContent = PLAYER_MODE
      ? me()
        ? `${me().name} · ${teamName(myTeam())}`
        : "انضمّ للعبة"
      : teamName(LEGACY_TEAM);
  }
  if (el.stats) {
    const m = me();
    show(el.stats, PLAYER_MODE && !!m);
    if (m) el.stats.textContent = `نقاطك ${m.score} · ضغطاتك ${m.buzzes}${m.fastest != null ? ` · أسرع ضغطة ${(m.fastest / 1000).toFixed(2)}ث` : ""}`;
  }

  renderJoin();

  // اللعبة الحالية: «الكلمة الممنوعة» لها واجهتها الخاصة على الجوال
  const game = state?.game || null;
  const inJoin = el.join && !el.join.hidden;
  const tabooOn = game === "taboo" && !inJoin && joined();
  show(el.taboo, tabooOn);
  if (tabooOn) {
    show(el.stage, false);
    renderTabooPhone(state);
    return;
  }

  // السؤال: يظهر فقط بعد كشف الحكم
  const q = state?.current?.question;
  const revealed = !!state?.current?.revealed && !!q;
  show(el.question, revealed);
  if (el.qLetter) el.qLetter.textContent = revealed ? q.letter || "؟" : "";
  if (el.qText) el.qText.textContent = revealed ? q.text || "" : "";

  // الحرف المختار يظهر دائماً
  const selectedLetter = state?.current?.question?.letter || "";
  if (el.letterBar) {
    show(el.letterBar, !!selectedLetter);
    if (el.letterBarValue) el.letterBarValue.textContent = selectedLetter || "؟";
  }

  paint(derive(state));

  const timer = state?.current?.timer;
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

/* ================= المؤثرات عند الانتقالات ================= */

function transitions(state) {
  if (!state || state.game !== "huroof") return;
  const c = state.current || {};
  const b = c.buzz || {};

  const round = c.round ?? 0;
  if (seen.round !== round) {
    seen.round = round;
    seen.revealed = false;
    seen.canPress = false;
    seen.answerer = null;
    seen.stage = 0;
    seen.verdictAt = 0;
    seen.missedAt = 0;
    seen.expired = false;
    lastSec = -1;
    clearConfetti();
  }

  if (c.revealed && !seen.revealed) {
    seen.revealed = true;
    sfx.play("reveal");
  }

  // فُتح جرسي (الجولة ١)
  const can = pressRight(state).ok;
  if (can && !seen.canPress) {
    sfx.play("arm");
    sfx.vibrate([20, 40, 20]);
  }
  seen.canPress = can;

  // انتقال الجولة: دور فريقي (٢) يرنّ عندنا فقط، والجولة ٣ ترنّ عند الجميع
  if ((b.stage || 0) !== seen.stage) {
    if (b.stage === 2 && b.phase === "team" && b.allowed === myTeam()) {
      sfx.play("turnSwitch");
      sfx.vibrate([30, 40, 30, 40, 120]);
    } else if (b.stage === 3 && b.phase === "all") {
      sfx.play("open");
      sfx.vibrate([20, 40, 20]);
    }
    seen.stage = b.stage || 0;
  }

  // أحدهم ضغط
  const answerer = b.phase === "answer" ? b.player?.id || null : null;
  if (answerer && answerer !== seen.answerer) {
    if (answerer === ME) {
      sfx.play("win");
      sfx.vibrate([50, 60, 160]);
    } else {
      sfx.play("buzz");
      sfx.vibrate(60);
    }
  }
  seen.answerer = answerer;

  // انتهى وقتي بلا حكم
  const last = (b.history || [])[b.history?.length - 1];
  if (last?.id === ME && last.result === "timeout" && !seen.expired) {
    seen.expired = true;
    sfx.play("timeout");
    sfx.vibrate([120, 60, 120]);
  }

  // إعلان النقطة
  const at = c.verdict?.at || 0;
  if (c.verdict && at !== seen.verdictAt) {
    seen.verdictAt = at;
    if (c.verdict.team === myTeam()) {
      flash();
      confettiBurst();
      sfx.play("celebrate");
      sfx.vibrate([40, 50, 40, 50, 240]);
    } else {
      sfx.play("wrong");
      sfx.vibrate(120);
    }
  }

  if (state.winner && !seen.over) {
    seen.over = true;
    sfx.play("gameWin");
    if (state.winner === myTeam()) confettiBurst();
    sfx.vibrate([60, 80, 60, 80, 300]);
  } else if (!state.winner) {
    seen.over = false;
  }
}

/* ================= الضغط ================= */

let lastPress = 0;

function buzz() {
  const state = st();
  if (!pressRight(state).ok || sent) return;
  // منع ارتداد الضغط (لمستان متتاليتان بالخطأ)
  const now = Date.now();
  if (now - lastPress < 300) return;
  lastPress = now;

  sent = true;
  sfx.play("buzz");
  sfx.vibrate(30);
  el.pad?.classList.add("bz-pressed");
  setTimeout(() => el.pad?.classList.remove("bz-pressed"), 380);

  link.buzz();
  render();

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
  if (status !== "online") sent = false;
  render();
};

link.onState = (msg) => {
  snap = msg;
  if (msg.state?.current?.buzz?.player) {
    sent = false;
    clearTimeout(sentGuard);
  }
  transitions(msg.state);
  render();
};

link.onBuzzed = () => {
  sent = false;
  clearTimeout(sentGuard);
  render();
};

// الحكم أخرج هذا اللاعب: نعود لشاشة الانضمام
link.onMessage = (msg) => {
  if (msg.t === "kicked") {
    joining = true;
    if (el.joinNote) el.joinNote.textContent = "أخرجك الحكم من اللعبة — يمكنك الانضمام من جديد";
    render();
  }
};

/* ================= إضافات ================= */

async function keepAwake() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {}
}
keepAwake();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) keepAwake();
});

document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("dblclick", (event) => event.preventDefault());

render();
link.connect();
