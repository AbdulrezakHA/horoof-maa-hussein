/* ==================================================================
   جوال اللاعب — لعبة «الكلمة الممنوعة»
   - الشارح: الكلمة + الممنوعة + العدّاد + زر «تخطّي»
   - فريقه: «فلان يشرح — خمّنوا!» (بلا أي كلمة)
   - الفريق الآخر: الكلمات الممنوعة فقط + «راقبوه!»
   (الخادم نفسه لا يرسل لكل جوال إلا ما يحقّ له رؤيته)
   ================================================================== */
import { TABOO_RULES, skipsLeft } from "/shared/taboo.js";

let ctx = null; // { me, myTeam, sendRaw, sfx, remainingMs, inkFor, getState }
let root = null;
let lastKey = "";
let tick = null;
let lastSec = -1;
const seen = { phase: null, describer: null, turn: -1, logLen: 0, winner: null };

const $ = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const REMINDER = "🚫 لا حروف · لا عدد حروف · لا قافية · لا ترجمة · لا إشارات · لا أصوات";

export function initTabooPhone(context) {
  ctx = context;
  root = document.getElementById("tabooPhone");
}

export function renderTabooPhone(st) {
  if (!root || !st) return;
  const t = st.taboo;
  sounds(st);
  const key = JSON.stringify([t.phase, t.score, t.skips, t.turnTeam, t.describer, t.card, t.turnLog.length, t.foul, t.winner, ctx.myTeam(), st.teams]);
  if (key !== lastKey) {
    lastKey = key;
    draw(st);
  }
  updateClock(st);
}

function draw(st) {
  const t = st.taboo;
  const mine = ctx.myTeam();
  const tName = (k) => st.teams[k]?.name || "";
  const isDescriber = t.describer?.id === ctx.me;
  const myTurn = t.turnTeam === mine;
  root.replaceChildren();

  // النتيجة دائماً في الأعلى
  const score = $("div", "tp-score");
  for (const k of ["a", "b"]) {
    const s = $("div", "tp-score-team", `${tName(k)}  ${t.score[k]}`);
    s.style.background = st.teams[k].color;
    s.style.color = ctx.inkFor(st.teams[k].color);
    s.classList.toggle("mine", k === mine);
    score.appendChild(s);
  }
  root.append(score, $("div", "tp-target", `🎯 أول فريق يصل ${t.target} يفوز`));

  const body = $("div", "tp-body");
  root.appendChild(body);

  if (t.phase === "setup") {
    body.append($("div", "tp-big", "🚫 الكلمة الممنوعة"), $("div", "tp-sub", "بانتظار الحكم…"));
  }

  if (t.phase === "rules") {
    body.append($("div", "tp-big", "📜 القوانين"));
    const ol = $("ol", "tp-rules");
    for (const r of TABOO_RULES) ol.appendChild($("li", "", r));
    body.append(ol, $("div", "tp-sub", "أي مخالفة = ⁦-1⁩ وينتهي الدور فوراً"));
  }

  if (t.phase === "ready") {
    if (isDescriber) {
      body.append($("div", "tp-icon", "🎤"), $("div", "tp-big", "أنت الشارح!"), $("div", "tp-sub", "امسك جوالك واستعدّ — الحكم سيبدأ الدور"));
      body.classList.add("tp-me");
    } else {
      body.append(
        $("div", "tp-big", `دور ${tName(t.turnTeam)}`),
        $("div", "tp-sub", t.describer ? `🎤 الشارح: ${t.describer.name}` : "بانتظار القرعة…"),
        $("div", "tp-sub", myTurn ? "استعدّوا للتخمين!" : "استعدّوا لمراقبة الكلمات الممنوعة")
      );
    }
  }

  if (t.phase === "turn" || t.phase === "paused") {
    const clock = $("div", "tp-clock", "—");
    clock.id = "tpClock";
    body.appendChild(clock);
    if (t.phase === "paused") body.appendChild($("div", "tp-paused", "⏸ متوقف مؤقتاً"));
    const topic = t.card?.topic ? $("div", "tp-topic", `${t.card.icon || "🃏"} ${t.card.topic}`) : null;

    if (isDescriber) {
      body.classList.add("tp-me");
      if (topic) body.appendChild(topic);
      body.appendChild($("div", "tp-word", t.card?.word || "…"));
      const fb = $("div", "tp-forbidden");
      for (const w of t.card?.forbidden || []) fb.appendChild($("span", "tp-fword", w));
      body.append(fb, $("div", "tp-reminder", REMINDER));
      const left = skipsLeft(t, mine);
      const skip = $("button", "tp-skip", left === Infinity ? "⏭ تخطّي" : `⏭ تخطّي (${left} متبقٍ للفريق)`);
      skip.type = "button";
      skip.disabled = left <= 0 || t.phase !== "turn";
      skip.addEventListener("click", () => {
        if (skip.disabled) return;
        skip.disabled = true;
        ctx.sendRaw({ t: "tabooSkip" });
        ctx.sfx.play("toggleOff");
      });
      body.appendChild(skip);
    } else if (myTurn) {
      body.append(
        $("div", "tp-icon", "🤔"),
        $("div", "tp-big", `${t.describer?.name || ""} يشرح`),
        $("div", "tp-sub", "خمّنوا بصوت عالٍ!")
      );
      if (topic) body.appendChild(topic);
    } else {
      body.append($("div", "tp-big", `👀 راقبوا ${t.describer?.name || ""}!`));
      if (topic) body.appendChild(topic);
      const fb = $("div", "tp-forbidden");
      for (const w of t.card?.forbidden || []) fb.appendChild($("span", "tp-fword", w));
      body.append(fb, $("div", "tp-reminder", "إن قال أي كلمة منها أو خالف القوانين اصرخوا: ممنوع!"), $("div", "tp-reminder tp-dim", REMINDER));
    }
    const got = t.turnLog.filter((l) => l.result === "right").length;
    body.appendChild($("div", "tp-tally", `هذا الدور: +${got}`));
  }

  if (t.phase === "turnEnd") {
    if (t.foul) body.appendChild($("div", "tp-foul", `🚫 ممنوع: ${t.foul.label} (⁦-1⁩)`));
    const got = t.turnLog.filter((l) => l.result === "right").length;
    body.append($("div", "tp-big", `انتهى دور ${tName(t.turnTeam)}: +${got}`));
    const ICON = { right: "✅", skip: "⏭", pass: "🔄", foul: "🚫", timeout: "⏰" };
    const chips = $("div", "tp-chips");
    for (const l of t.turnLog) chips.appendChild($("span", `tp-chip ${l.result}`, `${ICON[l.result] || ""} ${l.word}`));
    body.appendChild(chips);
  }

  if (t.phase === "over") {
    const won = t.winner === mine;
    body.append($("div", "tp-icon", won ? "🏆" : "👏"), $("div", "tp-big", won ? "فاز فريقك!" : `فاز ${tName(t.winner)}`), $("div", "tp-sub", `${t.score.a} : ${t.score.b}`));
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
  const el = document.getElementById("tpClock");
  if (!el) return;
  const ms = t.phase === "paused" ? t.timer.remaining : ctx.remainingMs(t.timer);
  const secs = Math.max(0, Math.ceil((ms || 0) / 1000));
  el.textContent = String(secs);
  el.classList.toggle("urgent", live && secs <= 10);
  // صوت العدّ الأخير على جوال الشارح فقط
  if (live && secs !== lastSec) {
    lastSec = secs;
    if (t.describer?.id === ctx.me && secs > 0 && secs <= 5) {
      ctx.sfx.play("tickUrgent");
      ctx.sfx.vibrate(30);
    }
  }
}

function sounds(st) {
  const t = st.taboo;
  const iAmDescriber = t.describer?.id === ctx.me;
  // اختِرتَ شارحاً
  if (t.phase === "ready" && iAmDescriber && seen.describer !== ctx.me) {
    ctx.sfx.play("win");
    ctx.sfx.vibrate([60, 60, 160]);
  }
  seen.describer = t.phase === "ready" || t.phase === "turn" ? t.describer?.id || null : null;

  if (t.phase !== seen.phase) {
    if (t.phase === "turn" && seen.phase === "ready") {
      ctx.sfx.play("turnSwitch");
      if (t.turnTeam === ctx.myTeam()) ctx.sfx.vibrate([30, 40, 30]);
    }
    if (t.phase === "turnEnd" && t.foul) {
      ctx.sfx.play("wrong");
      ctx.sfx.vibrate(150);
    }
    if (t.phase === "over" && t.winner && t.winner !== seen.winner) {
      ctx.sfx.play(t.winner === ctx.myTeam() ? "celebrate" : "wrong");
    }
    seen.phase = t.phase;
    seen.winner = t.winner;
  }
  if (t.turn !== seen.turn) {
    seen.turn = t.turn;
    seen.logLen = 0;
  }
  const n = t.turnLog.length;
  if (n > seen.logLen && t.phase === "turn" && t.turnLog[n - 1].result === "right") {
    ctx.sfx.play("point");
    if (t.turnTeam === ctx.myTeam()) ctx.sfx.vibrate(40);
  }
  seen.logLen = n;
}
