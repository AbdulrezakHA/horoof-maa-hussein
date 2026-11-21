/* ==================================================================
   الشاشة الكبيرة — لعبة «الكلمة الممنوعة»
   التلفاز يراه الجميع، فلا تظهر عليه الكلمة ولا الكلمات الممنوعة أثناء الدور:
   فقط اسم الشارح والموضوع والعدّاد والنتيجة. بعد انتهاء الدور تُكشف كلماته.
   ================================================================== */
import { TABOO_RULES } from "/shared/taboo.js";

let ctx = null; // { sfx, inkFor, remainingMs, confetti(color) }
let root = null;
let lastKey = "";
let tick = null;
let lastSec = -1;
const seen = { phase: null, turn: -1, logLen: 0, winner: null };

const $ = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const RULE_ICONS = ["🗣️", "🚫", "🔤", "🔢", "🎵", "🌐", "🤚", "🐱", "✍️", "📱"];

export function initTabooScreen(context) {
  ctx = context;
  root = document.getElementById("tabooScreen");
}

function teamBox(st, k) {
  const t = st.taboo;
  const team = st.teams[k];
  const box = $("div", "ts-team");
  box.style.setProperty("--team", team.color);
  box.style.setProperty("--team-ink", ctx.inkFor(team.color));
  box.classList.toggle("active", t.turnTeam === k && ["ready", "turn", "paused", "turnEnd"].includes(t.phase));
  const skips = "●".repeat(t.skips[k] || 0) + "○".repeat(Math.max(0, (t.skipsPerGame || 2) - (t.skips[k] || 0)));
  box.append($("div", "ts-team-name", team.name), $("div", "ts-team-score", String(t.score[k])), $("div", "ts-team-skips", `⏭ ${skips}`));
  return box;
}

function chips(log) {
  const ICON = { right: "✅", skip: "⏭", foul: "🚫", timeout: "⏰" };
  const wrap = $("div", "ts-chips");
  for (const l of log || []) wrap.appendChild($("span", `ts-chip ${l.result}`, `${ICON[l.result] || ""} ${l.word}`));
  return wrap;
}

/** يرسم شاشة اللعبة (فقط عند تغيّر ما يُعرض — العدّاد يتحدّث وحده). */
export function renderTabooScreen(st) {
  if (!root || !st) return;
  const t = st.taboo;
  sounds(st);
  const key = JSON.stringify([t.phase, t.score, t.skips, t.turnTeam, t.describer?.id, t.card?.id, t.turnLog.length, t.foul, t.winner, st.teams, t.target]);
  if (key !== lastKey) {
    lastKey = key;
    draw(st);
  }
  updateClock(st);
}

function draw(st) {
  const t = st.taboo;
  const tName = (k) => st.teams[k]?.name || "";
  const tColor = (k) => st.teams[k]?.color || "#999";
  root.replaceChildren();
  root.style.setProperty("--team", t.turnTeam ? tColor(t.turnTeam) : "#ffd93d");
  root.style.setProperty("--team-ink", ctx.inkFor(t.turnTeam ? tColor(t.turnTeam) : "#ffd93d"));

  const top = $("div", "ts-top");
  top.append(teamBox(st, "a"), $("div", "ts-target", `🎯 الهدف ${t.target}`), teamBox(st, "b"));
  root.appendChild(top);

  const main = $("div", `ts-main ts-${t.phase}`);
  root.appendChild(main);

  if (t.phase === "setup") {
    main.append($("div", "ts-title", "🚫 الكلمة الممنوعة"), $("div", "ts-sub", "بانتظار الحكم لبدء اللعبة…"));
  }

  if (t.phase === "rules") {
    main.append($("div", "ts-title", "📜 قوانين الكلمة الممنوعة"));
    const grid = $("div", "ts-rules");
    TABOO_RULES.forEach((r, i) => {
      const item = $("div", "ts-rule");
      item.style.animationDelay = `${i * 60}ms`;
      item.append($("span", "ts-rule-icon", RULE_ICONS[i] || "•"), $("span", "", r));
      grid.appendChild(item);
    });
    main.append(grid);
    main.append($("div", "ts-foot", `أي مخالفة = ⁦-1⁩ وينتهي الدور فوراً · لكل فريق تخطّيان طوال اللعبة · أول فريق يصل ${t.target} يفوز`));
    const start = $("div", "ts-starter", `🎲 القرعة: يبدأ ${tName(t.startTeam)}`);
    start.style.background = tColor(t.startTeam);
    start.style.color = ctx.inkFor(tColor(t.startTeam));
    main.append(start);
  }

  if (t.phase === "ready") {
    main.append($("div", "ts-big-team", `دور ${tName(t.turnTeam)}`));
    main.append($("div", "ts-describer", t.describer ? `🎤 الشارح: ${t.describer.name}` : "بانتظار اختيار الشارح…"));
    main.append($("div", "ts-sub", "استعدّوا… الحكم سيبدأ الدور"));
  }

  if (t.phase === "turn" || t.phase === "paused") {
    const stage = $("div", "ts-live");
    const ring = $("div", "ts-ring");
    ring.innerHTML = `<svg viewBox="0 0 120 120"><circle class="ts-ring-bg" cx="60" cy="60" r="52"/><circle class="ts-ring-fg" id="tsRingFg" cx="60" cy="60" r="52"/></svg>`;
    const num = $("div", "ts-ring-num", "—");
    num.id = "tsRingNum";
    ring.appendChild(num);
    const info = $("div", "ts-live-info");
    info.append(
      $("div", "ts-describer", `🎤 ${t.describer?.name || ""}`),
      $("div", "ts-live-team", `يشرح لـ ${tName(t.turnTeam)}`),
      $("div", "ts-topic", `${t.card?.icon || "🃏"} ${t.card?.topic || ""}`)
    );
    const got = t.turnLog.filter((l) => l.result === "right").length;
    info.append($("div", "ts-tally", `+${got}`));
    stage.append(ring, info);
    main.append(stage, chips(t.turnLog));
    if (t.phase === "paused") main.append($("div", "ts-paused", "⏸ متوقف مؤقتاً"));
  }

  if (t.phase === "turnEnd") {
    if (t.foul) main.append($("div", "ts-foul", `🚫 ممنوع! ${t.foul.label} — ⁦-1⁩`));
    const got = t.turnLog.filter((l) => l.result === "right").length;
    main.append($("div", "ts-big-team", `انتهى دور ${tName(t.turnTeam)}: +${got}`));
    main.append(chips(t.turnLog));
    main.append($("div", "ts-sub", `التالي: ${tName(t.turnTeam === "a" ? "b" : "a")}`));
  }

  if (t.phase === "over") {
    main.append($("div", "ts-trophy", "🏆"));
    const w = $("div", "ts-winner", `فاز ${tName(t.winner)}!`);
    w.style.color = tColor(t.winner);
    main.append(w, $("div", "ts-sub", `${t.score.a} : ${t.score.b} · +1 لنقاط السهرة`));
  }
}

function updateClock(st) {
  const t = st.taboo;
  const live = st.game === "taboo" && t.phase === "turn";
  if (live && !tick) tick = setInterval(() => updateClock(ctx.getState()), 200);
  else if (!live && tick) {
    clearInterval(tick);
    tick = null;
  }
  const num = document.getElementById("tsRingNum");
  const fg = document.getElementById("tsRingFg");
  if (!num) return;
  const ms = t.phase === "paused" ? t.timer.remaining : ctx.remainingMs(t.timer);
  const total = Math.max(1, t.timer.total || t.turnSeconds) * 1000;
  const secs = Math.max(0, Math.ceil((ms || 0) / 1000));
  num.textContent = String(secs);
  num.classList.toggle("urgent", live && secs <= 10);
  if (fg) fg.style.strokeDashoffset = String(327 * (1 - Math.max(0, Math.min(1, (ms || 0) / total))));
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
      ctx.confetti?.(st.teams[t.winner]?.color);
    }
    seen.phase = t.phase;
    seen.winner = t.winner;
  }
  // ✅ / ⏭ أثناء الدور
  const n = t.turnLog.length;
  if (t.turn !== seen.turn) {
    seen.turn = t.turn;
    seen.logLen = 0;
  }
  if (n > seen.logLen && t.phase === "turn") {
    const last = t.turnLog[n - 1];
    if (last.result === "right") ctx.sfx.play("point");
    else if (last.result === "skip") ctx.sfx.play("toggleOff");
  }
  seen.logLen = n;
}
