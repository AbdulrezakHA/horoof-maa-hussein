/* ==================================================================
   جوال اللاعب — لعبة «الكلمة الممنوعة»
   - الشارح: الكلمة + الممنوعة + العدّاد + زر «تخطّي»
   - فريقه: «فلان يشرح — خمّنوا!» (بلا أي كلمة)
   - الفريق الآخر: الكلمات الممنوعة فقط + «راقبوه!»
   (الخادم نفسه لا يرسل لكل جوال إلا ما يحقّ له رؤيته)
   كل العناصر من مكتبة نظام التصميم (ds-*)، والرموز من /icons.svg.
   ================================================================== */
import { TABOO_RULES, skipsLeft } from "/shared/taboo.js";
import { icon, confetti, replay } from "/js/ds.js";

let ctx = null; // { me, myTeam, sendRaw, sfx, remainingMs, getState }
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

/** عنصر فيه رمز ثم نص (شارة، رقاقة، زر…). */
const withIcon = (tag, cls, iconName, text) => {
  const n = $(tag, cls);
  if (iconName) n.appendChild(icon(iconName));
  if (text != null) n.appendChild(document.createTextNode(text));
  return n;
};

/** لافتة بأيقونة: ds-banner + نبرة. */
function banner(tone, iconName, text) {
  const b = $("div", `ds-banner${tone ? ` ds-banner--${tone}` : ""}`);
  const ic = $("span", "ds-banner-icon");
  ic.appendChild(icon(iconName));
  b.append(ic, $("span", "", text));
  return b;
}

const REMINDER = "لا حروف · لا عدد حروف · لا قافية · لا ترجمة · لا إشارات · لا أصوات";
/** أيقونة كل قانون (بنفس ترتيب TABOO_RULES). */
const RULE_ICONS = ["hush", "ban", "no-letters", "hash", "music", "translate", "hand", "wave", "pen", "phone"];
/** رقاقة سجلّ الدور: صنف + أيقونة. */
const CHIP = {
  right: ["ds-chip--right", "check"],
  skip: ["ds-chip--skip", "skip"],
  pass: ["ds-chip--pass", "swap"],
  foul: ["ds-chip--foul", "ban"],
  timeout: ["", "timer"],
};

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

function forbiddenChips(card) {
  const fb = $("div", "ds-cluster ds-cluster--center");
  for (const w of card?.forbidden || []) fb.appendChild($("span", "ds-chip ds-chip--forbidden", w));
  return fb;
}

function topicChip(card) {
  return card?.topic ? withIcon("span", "ds-chip", card.icon || "shapes", card.topic) : null;
}

function draw(st) {
  const t = st.taboo;
  const mine = ctx.myTeam();
  const tName = (k) => st.teams[k]?.name || "";
  const isDescriber = t.describer?.id === ctx.me;
  const myTurn = t.turnTeam === mine;
  root.replaceChildren();

  // النتيجة دائماً في الأعلى
  const head = $("div", "ds-stack ds-stack--tight");
  const score = $("div", "ds-cluster ds-cluster--between");
  for (const k of ["a", "b"]) {
    score.appendChild(withIcon("span", `ds-pill ds-pill--team ds-team-${k}`, k === mine ? "user" : null, `${tName(k)} ${t.score[k]}`));
  }
  head.append(score, withIcon("span", "ds-pill ds-pill--dark", "target", `أول فريق يصل ${t.target} يفوز`));
  root.appendChild(head);

  const body = $("div", "ds-stack");
  root.appendChild(body);
  const center = (...kids) => {
    const c = $("div", "ds-center");
    c.append(...kids.filter(Boolean));
    return c;
  };
  const badge = (name, extra = "") => {
    const b = $("span", `ds-badge-icon ds-badge-icon--lg ${extra}`.trim());
    b.appendChild(icon(name));
    return b;
  };
  const title = (text, iconName) => withIcon("h2", "ds-title ds-title--sm", iconName, text);
  const dim = (text) => $("p", "ds-text ds-text--dim", text);

  if (t.phase === "setup") {
    body.appendChild(center(badge("hush", "ds-float"), title("الكلمة الممنوعة"), dim("بانتظار الحكم…")));
  }

  if (t.phase === "rules") {
    body.appendChild(center(title("القوانين", "scroll")));
    const card = $("div", "ds-card ds-stack ds-stack--tight");
    TABOO_RULES.forEach((r, i) => {
      const row = $("div", "ds-row");
      const b = $("span", "ds-badge-icon");
      b.appendChild(icon(RULE_ICONS[i] || "ban"));
      row.append(b, $("span", "ds-text", r));
      card.appendChild(row);
    });
    body.append(card, banner("danger", "warning", "أي مخالفة = ⁦-1⁩ وينتهي الدور فوراً"));
  }

  if (t.phase === "ready") {
    if (isDescriber) {
      body.appendChild(center(badge("megaphone", "ds-glow-turn"), title("أنت الشارح!"), dim("امسك جوالك واستعدّ — الحكم سيبدأ الدور")));
    } else {
      body.appendChild(
        center(
          title(`دور ${tName(t.turnTeam)}`),
          t.describer ? withIcon("span", "ds-pill", "user", `الشارح: ${t.describer.name}`) : dim("بانتظار القرعة…"),
          dim(myTurn ? "استعدّوا للتخمين!" : "استعدّوا لمراقبة الكلمات الممنوعة")
        )
      );
    }
  }

  if (t.phase === "turn" || t.phase === "paused") {
    const clock = withIcon("span", "ds-pill ds-pill--dark", "timer");
    const num = $("span", "", "—");
    num.id = "tpClock";
    clock.appendChild(num);
    const row = $("div", "ds-cluster ds-cluster--between");
    row.appendChild(clock);
    const got = t.turnLog.filter((l) => l.result === "right").length;
    row.appendChild($("span", `ds-pill ds-pill--team ds-team-${t.turnTeam}`, `هذا الدور +${got}`));
    body.appendChild(row);
    if (t.phase === "paused") body.appendChild(banner("info", "pause", "متوقف مؤقتاً"));

    if (isDescriber) {
      const card = $("div", "ds-card ds-center");
      card.append(topicChip(t.card) || "", $("div", "ds-word", t.card?.word || "…"), forbiddenChips(t.card), withIcon("p", "ds-hint", "ban", REMINDER));
      body.appendChild(card);
      const left = skipsLeft(t, mine);
      const skip = withIcon("button", "ds-btn ds-btn--block", "skip", left === Infinity ? "تخطّي" : `تخطّي (${left} متبقٍ للفريق)`);
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
      body.appendChild(center(badge("question", "ds-float"), title(`${t.describer?.name || ""} يشرح`), dim("خمّنوا بصوت عالٍ!"), topicChip(t.card)));
    } else {
      body.appendChild(
        center(
          title(`راقبوا ${t.describer?.name || ""}!`, "eye"),
          topicChip(t.card),
          forbiddenChips(t.card),
          banner("danger", "megaphone", "إن قال أي كلمة منها أو خالف القوانين اصرخوا: ممنوع!"),
          dim(REMINDER)
        )
      );
    }
  }

  if (t.phase === "turnEnd") {
    if (t.foul) body.appendChild(banner("danger", "ban", `ممنوع: ${t.foul.label} (⁦-1⁩)`));
    const got = t.turnLog.filter((l) => l.result === "right").length;
    body.appendChild(center(title(`انتهى دور ${tName(t.turnTeam)}: +${got}`)));
    const chips = $("div", "ds-cluster ds-cluster--center");
    for (const l of t.turnLog) {
      const [cls, ic] = CHIP[l.result] || ["", "shapes"];
      chips.appendChild(withIcon("span", `ds-chip ${cls}`.trim(), ic, l.word));
    }
    body.appendChild(chips);
  }

  if (t.phase === "over") {
    const won = t.winner === mine;
    const trophy = icon("trophy", "ds-trophy ds-float");
    body.appendChild(
      center(won ? trophy : badge("star", "ds-float"), title(won ? "فاز فريقك!" : `فاز ${tName(t.winner)}`), withIcon("span", "ds-pill", null, `${t.score.a} : ${t.score.b}`))
    );
    if (won) replay(body, "ds-pop-in");
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
  // آخر ١٠ ثوانٍ: الشارة تحمرّ
  const pill = el.closest(".ds-pill");
  const urgent = live && secs <= 10;
  pill?.classList.toggle("ds-pill--coral", urgent);
  pill?.classList.toggle("ds-pill--dark", !urgent);
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
      if (t.winner === ctx.myTeam()) confetti(null, 90);
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
