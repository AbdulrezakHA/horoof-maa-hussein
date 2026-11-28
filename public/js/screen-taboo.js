/* ==================================================================
   الشاشة الكبيرة — لعبة «الكلمة الممنوعة»
   التلفاز يراه الجميع، فلا تظهر عليه الكلمة ولا الكلمات الممنوعة أثناء الدور:
   فقط اسم الشارح والموضوع والعدّاد والنتيجة. بعد انتهاء الدور تُكشف كلماته.
   كل العناصر من مكتبة نظام التصميم (ds-*)، والرموز من /icons.svg.
   ================================================================== */
import { skipsLeft, skipsRule, UNLIMITED } from "/shared/taboo.js";
import { icon, ring } from "/js/ds.js";

let ctx = null; // { sfx, remainingMs, getState, confetti(color) }
let root = null;
let lastKey = "";
let tick = null;
let lastSec = -1;
let clockRing = null;
const seen = { phase: null, turn: -1, logLen: 0, winner: null };

/* قوانين الشرائح على التلفاز: أيقونة + كلمات قليلة (الجمل الكاملة على الجوالات وعند الحكم) */
const RULES = [
  ["hush", "لا تقل الكلمة"],
  ["ban", "لا الممنوعة"],
  ["no-letters", "لا حروف"],
  ["hash", "لا أعداد"],
  ["music", "لا قافية"],
  ["translate", "لا ترجمة"],
  ["hand", "لا إشارات"],
  ["wave", "لا أصوات"],
  ["pen", "لا كتابة"],
  ["phone", "لا تُرِ جوالك"],
];
const SLIDE_MS = 4000;
let rulesPage = 0;
let rulesTimer = null;
let rulesCards = [];

const $ = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** عنصر فيه رمز ثم نص. */
const withIcon = (tag, cls, iconName, text) => {
  const n = $(tag, cls);
  if (iconName) n.appendChild(icon(iconName));
  if (text != null) n.appendChild(document.createTextNode(text));
  return n;
};

/** رقاقة سجلّ الدور: صنف + أيقونة. */
const CHIP = {
  right: ["ds-chip--right", "check"],
  skip: ["ds-chip--skip", "skip"],
  pass: ["ds-chip--pass", "swap"],
  foul: ["ds-chip--foul", "ban"],
  timeout: ["", "timer"],
};

export function initTabooScreen(context) {
  ctx = context;
  root = document.getElementById("tabooScreen");
}

/** التخطّيات المتبقية: رمز + نقاط (∞ لبلا حدّ، ٠ بلا تخطّي). */
function skipMeta(t, k) {
  const m = $("span", "ds-team-meta");
  m.appendChild(icon("skip"));
  if (t.skipsPerGame === UNLIMITED) m.appendChild(document.createTextNode(" ∞"));
  else if (!t.skipsPerGame) m.appendChild(document.createTextNode(" 0"));
  else {
    const left = skipsLeft(t, k);
    const dots = $("span", "ds-dots");
    for (let i = 0; i < t.skipsPerGame; i++) dots.appendChild($("span", `ds-dot${i >= left ? " is-used" : ""}`));
    m.append(document.createTextNode(" "), dots);
  }
  return m;
}

function teamBox(st, k) {
  const t = st.taboo;
  const live = ["ready", "turn", "paused", "turnEnd"].includes(t.phase);
  const box = $("div", `ds-team ds-team-${k}`);
  box.classList.toggle("is-turn", live && t.turnTeam === k);
  box.classList.toggle("is-waiting", live && t.turnTeam && t.turnTeam !== k);
  const info = $("div");
  info.append($("div", "ds-team-name", st.teams[k].name), skipMeta(t, k));
  box.append(info, $("div", "ds-score", String(t.score[k])));
  return box;
}

function chips(log) {
  const wrap = $("div", "ds-cluster ds-cluster--center");
  for (const l of log || []) {
    const [cls, ic] = CHIP[l.result] || ["", "shapes"];
    wrap.appendChild(withIcon("span", `ds-pill ${cls}`.trim(), ic, l.word));
  }
  return wrap;
}

/** يرسم شاشة اللعبة (فقط عند تغيّر ما يُعرض — العدّاد يتحدّث وحده). */
export function renderTabooScreen(st) {
  if (!root || !st) return;
  const t = st.taboo;
  sounds(st);
  const key = JSON.stringify([t.phase, t.score, t.skips, t.skipsPerGame, t.turnTeam, t.describer?.id, t.card?.id, t.turnLog.length, t.foul, t.winner, st.teams, t.target]);
  if (key !== lastKey) {
    lastKey = key;
    draw(st);
  }
  updateClock(st);
}

/* ---------------- شرائح القوانين (تتبدّل وحدها) ---------------- */
function showRulesPage() {
  const grid = document.getElementById("tsRules");
  const pager = document.getElementById("tsPager");
  if (!grid || !pager) return stopRules();
  grid.replaceChildren();
  rulesCards.slice(rulesPage * 3, rulesPage * 3 + 3).forEach(([ic, text, foul], i) => {
    const d = $("div", `ds-rule ds-pop-in${foul ? " ds-rule--foul" : ""}`);
    d.style.setProperty("--i", i);
    const badge = $("span", "ds-rule-icon");
    badge.appendChild(icon(ic));
    d.append(badge, $("span", "ds-rule-text", text));
    grid.appendChild(d);
  });
  [...pager.children].forEach((s, i) => s.classList.toggle("is-on", i === rulesPage));
  rulesPage = (rulesPage + 1) % Math.ceil(rulesCards.length / 3);
}

function startRules(t) {
  rulesCards = [...RULES, ["warning", "المخالفة ⁦-1⁩ وينتهي الدور", true], ["skip", skipsRule(t)]];
  const pager = document.getElementById("tsPager");
  for (let i = 0; i < Math.ceil(rulesCards.length / 3); i++) pager.appendChild($("span"));
  rulesPage = 0;
  showRulesPage();
  clearInterval(rulesTimer);
  rulesTimer = setInterval(showRulesPage, SLIDE_MS);
}

function stopRules() {
  clearInterval(rulesTimer);
  rulesTimer = null;
}

function draw(st) {
  const t = st.taboo;
  const tName = (k) => st.teams[k]?.name || "";
  root.replaceChildren();
  clockRing = null;
  if (t.phase !== "rules") stopRules();

  const top = $("div", "ds-cluster ds-cluster--between");
  top.append(teamBox(st, "a"), withIcon("span", "ds-pill ds-pill--lg", "target", `الهدف ${t.target}`), teamBox(st, "b"));
  root.appendChild(top);

  const main = $("div", "ds-center ds-tvmain");
  root.appendChild(main);
  const title = (text, iconName) => withIcon("h1", "ds-title", iconName, text);
  const dim = (text) => $("p", "ds-text ds-text--dim", text);

  if (t.phase === "setup") {
    main.append(title("الكلمة الممنوعة", "hush"), dim("بانتظار الحكم لبدء اللعبة…"));
  }

  if (t.phase === "rules") {
    const grid = $("div", "ds-rules");
    grid.id = "tsRules";
    const pager = $("div", "ds-pager");
    pager.id = "tsPager";
    main.append(
      title("قوانين الكلمة الممنوعة", "scroll"),
      grid,
      pager,
      withIcon("span", `ds-pill ds-pill--lg ds-pill--team ds-team-${t.startTeam}`, "dice", `القرعة: يبدأ ${tName(t.startTeam)}`)
    );
    startRules(t);
  }

  if (t.phase === "ready") {
    main.append(
      withIcon("h1", `ds-pill ds-pill--lg ds-pill--team ds-team-${t.turnTeam}`, "users", `دور ${tName(t.turnTeam)}`),
      t.describer ? withIcon("h2", "ds-title", "megaphone", `الشارح: ${t.describer.name}`) : title("بانتظار اختيار الشارح…"),
      dim("استعدّوا… الحكم سيبدأ الدور")
    );
  }

  if (t.phase === "turn" || t.phase === "paused") {
    const live = $("div", "ds-cluster ds-cluster--center");
    const r = $("div", "ds-ring");
    r.id = "tsRing";
    r.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ds-ring-bg" cx="50" cy="50" r="46"></circle><circle class="ds-ring-fg" cx="50" cy="50" r="46"></circle></svg><span class="ds-ring-num">—</span>`;
    const info = $("div", `ds-stack ds-team-${t.turnTeam}`);
    const got = t.turnLog.filter((l) => l.result === "right").length;
    info.append(
      withIcon("h2", "ds-title", "megaphone", t.describer?.name || ""),
      dim(`يشرح لـ ${tName(t.turnTeam)}`),
      withIcon("span", "ds-pill ds-pill--lg", t.card?.icon || "shapes", t.card?.topic || ""),
      $("span", "ds-pill ds-pill--lg ds-pill--team", `+${got}`)
    );
    live.append(r, info);
    main.append(live, chips(t.turnLog));
    if (t.phase === "paused") main.append(banner("info", "pause", "متوقف مؤقتاً"));
    clockRing = ring(r);
  }

  if (t.phase === "turnEnd") {
    if (t.foul) main.append(banner("danger", "ban", `ممنوع! ${t.foul.label} — ⁦-1⁩`));
    const got = t.turnLog.filter((l) => l.result === "right").length;
    main.append(title(`انتهى دور ${tName(t.turnTeam)}: +${got}`), chips(t.turnLog), dim(`التالي: ${tName(t.turnTeam === "a" ? "b" : "a")}`));
  }

  if (t.phase === "over") {
    const w = $("div", "ds-winner ds-pop-in", `فاز ${tName(t.winner)}!`);
    main.append(icon("trophy", "ds-trophy ds-float"), w, withIcon("span", `ds-pill ds-pill--lg ds-pill--team ds-team-${t.winner}`, "star", `${t.score.a} : ${t.score.b} · نقطة للسهرة`));
  }
}

/** لافتة بأيقونة: ds-banner + نبرة. */
function banner(tone, iconName, text) {
  const b = $("div", `ds-banner ds-banner--${tone}`);
  const ic = $("span", "ds-banner-icon");
  ic.appendChild(icon(iconName));
  b.append(ic, $("span", "", text));
  return b;
}

function updateClock(st) {
  const t = st.taboo;
  const live = st.game === "taboo" && t.phase === "turn";
  if (live && !tick) tick = setInterval(() => updateClock(ctx.getState()), 200);
  else if (!live && tick) {
    clearInterval(tick);
    tick = null;
  }
  if (!clockRing) return;
  const ms = t.phase === "paused" ? t.timer.remaining : ctx.remainingMs(t.timer);
  const total = Math.max(1, t.timer.total || t.turnSeconds);
  const secs = Math.max(0, Math.ceil((ms || 0) / 1000));
  clockRing.set((ms || 0) / 1000, total);
  if (live && secs !== lastSec) {
    lastSec = secs;
    if (secs > 0 && secs <= 5) ctx.sfx.play("tickUrgent");
  }
}

function sounds(st) {
  const t = st.taboo;
  if (t.phase !== seen.phase) {
    if (t.phase === "turn" && seen.phase === "ready") ctx.sfx.play("reveal");
    if (t.phase === "turnEnd") ctx.sfx.play(t.foul ? "wrong" : "timeout");
    if (t.phase === "rules") ctx.sfx.play("open");
    if (t.phase === "over" && t.winner && t.winner !== seen.winner) {
      ctx.sfx.play("gameWin");
      ctx.confetti?.(getComputedStyle(document.documentElement).getPropertyValue(`--team-${t.winner}`).trim());
    }
    seen.phase = t.phase;
    seen.winner = t.winner;
  }
  // صح / تخطّي أثناء الدور
  const n = t.turnLog.length;
  if (t.turn !== seen.turn) {
    seen.turn = t.turn;
    seen.logLen = 0;
  }
  if (n > seen.logLen && t.phase === "turn") {
    const last = t.turnLog[n - 1];
    if (last.result === "right") ctx.sfx.play("point");
    else if (last.result === "skip" || last.result === "pass") ctx.sfx.play("toggleOff");
  }
  seen.logLen = n;
}
