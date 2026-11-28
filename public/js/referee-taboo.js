/* ==================================================================
   لوحة الحكم — لعبة «الكلمة الممنوعة»
   تُرسم داخل #tabooCard حسب مرحلة اللعبة:
     rules → ready → turn ⇄ paused → turnEnd → ready … → over
   كل العناصر من مكتبة نظام التصميم (ds-*)، والرموز من /icons.svg.
   ================================================================== */
import { TABOO_FOULS, TABOO_RULES, UNLIMITED, skipsLeft, skipsRule } from "/shared/taboo.js";
import { icon } from "/js/ds.js";

let ctx = null; // { act, toast(text, icon), getState, getPeers, remainingMs }
let foulOpen = false; // قائمة أسباب المخالفة مفتوحة؟
let tick = null;
let packs = [];
let packsKey = "";

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

/** زر ds-btn: btn("نص", "ds-btn--primary", onClick, { icon: "play", disabled }) */
function btn(label, cls, onClick, { disabled = false, iconName = null } = {}) {
  const b = withIcon("button", `ds-btn ${cls || ""}`.trim(), iconName, label);
  b.type = "button";
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function banner(tone, iconName, text) {
  const b = $("div", `ds-banner${tone ? ` ds-banner--${tone}` : ""}`);
  const ic = $("span", "ds-banner-icon");
  ic.appendChild(icon(iconName));
  b.append(ic, $("span", "ds-banner-text", text));
  return b;
}

export function initTaboo(context) {
  ctx = context;
  loadPacks();

  document.getElementById("tabooTarget")?.addEventListener("change", (e) => {
    ctx.act("tabooConfig", { target: Number(e.target.value) });
  });
  document.getElementById("tabooSeconds")?.addEventListener("change", (e) => {
    ctx.act("tabooConfig", { turnSeconds: Number(e.target.value) });
  });
  document.getElementById("tabooSkips")?.addEventListener("change", (e) => {
    ctx.act("tabooConfig", { skipsPerGame: Number(e.target.value) });
    ctx.toast(Number(e.target.value) < 0 ? "التخطّي بلا حدّ" : `${e.target.value} تخطّي لكل فريق`, "skip");
  });
  document.getElementById("tabooNewBtn")?.addEventListener("click", () => {
    if (confirm("بدء لعبة «الكلمة الممنوعة» جديدة؟ تُصفَّر النقاط وتتجدّد التخطّيات.")) {
      ctx.act("tabooNew");
      ctx.toast("لعبة جديدة — القوانين على الشاشة", "undo");
    }
  });

  // اختصارات لوحة المفاتيح أثناء الدور: 1 صح · 2 مخالفة · 3 تخطّي · 4 كلمة أخرى · مسافة إيقاف/استئناف
  document.addEventListener("keydown", (e) => {
    const st = ctx.getState();
    if (st?.game !== "taboo") return;
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = st.taboo;
    if (e.key === "1" && t.phase === "turn") right();
    else if (e.key === "2" && (t.phase === "turn" || t.phase === "paused")) {
      foulOpen = !foulOpen;
      renderTaboo();
    } else if (e.key === "3" && t.phase === "turn") skip();
    else if (e.key === "4" && (t.phase === "turn" || t.phase === "paused")) pass();
    else if (e.key === " " && (t.phase === "turn" || t.phase === "paused")) {
      e.preventDefault();
      ctx.act(t.phase === "turn" ? "tabooPause" : "tabooResume");
    }
  });
}

/* ---------------- المواضيع ---------------- */

async function loadPacks() {
  try {
    const res = await fetch("/api/taboo/packs");
    packs = (await res.json()).packs || [];
  } catch {
    packs = [];
  }
  packsKey = "";
  renderPacks();
}

function renderPacks() {
  const list = document.getElementById("tabooPacks");
  const st = ctx?.getState();
  if (!list || !st) return;
  const active = st.taboo?.packs || [];
  const key = JSON.stringify([packs.map((p) => p.id + p.total), active]);
  if (key === packsKey) return;
  packsKey = key;
  list.replaceChildren();
  const all = active.length === 0;
  for (const p of packs) {
    const row = $("label", "ds-list-item");
    const cb = $("input", "ds-switch");
    cb.type = "checkbox";
    cb.checked = all || active.includes(p.id);
    cb.addEventListener("change", () => {
      const base = active.length ? [...active] : packs.map((x) => x.id);
      const set = new Set(base);
      if (cb.checked) set.add(p.id);
      else set.delete(p.id);
      const next = [...set];
      if (!next.length) {
        cb.checked = true;
        ctx.toast("لا بد من موضوع واحد على الأقل", "warning");
        return;
      }
      ctx.act("tabooConfig", { packs: next.length >= packs.length ? [] : next });
    });
    row.append(cb, withIcon("span", "ds-text", p.icon || "shapes", ` ${p.name}`), $("span", "ds-hint", `${p.total} بطاقة`));
    list.appendChild(row);
  }
  const chosen = all ? packs : packs.filter((p) => active.includes(p.id));
  const total = chosen.reduce((n, p) => n + p.total, 0);
  const readout = document.getElementById("tabooPacksReadout");
  if (readout) readout.textContent = `المفعّل: ${chosen.length} موضوع · ${total} بطاقة`;
}

/* ---------------- الأفعال ---------------- */

function right() {
  ctx.act("tabooRight");
  ctx.toast("صح +1", "check");
}
function skip() {
  const st = ctx.getState();
  const t = st.taboo;
  if (skipsLeft(t, t.turnTeam) <= 0) return ctx.toast("لا تخطّيات متبقية لهذا الفريق", "warning");
  ctx.act("tabooSkip");
  ctx.toast("تخطّي", "skip");
}
function pass() {
  ctx.act("tabooPass");
  ctx.toast("كلمة أخرى — لا تُحسب على الفريق", "swap");
}
function foul(reason) {
  foulOpen = false;
  ctx.act("tabooFoul", { reason });
  ctx.toast(`${TABOO_FOULS[reason]} — ⁦-1⁩ وانتهى الدور`, "ban");
}

/* ---------------- الرسم ---------------- */

/** التخطّيات المتبقية: رمز + نقاط (∞ لبلا حدّ، ٠ بلا تخطّي). */
function skipMeta(t, k) {
  const m = $("div", "ds-team-meta");
  m.appendChild(icon("skip"));
  if (t.skipsPerGame === UNLIMITED) m.appendChild(document.createTextNode(" ∞"));
  else if (!t.skipsPerGame) m.appendChild(document.createTextNode(" 0"));
  else {
    const left = skipsLeft(t, k);
    const dots = $("span", "ds-dots");
    for (let i = 0; i < t.skipsPerGame; i++) dots.appendChild($("span", `ds-dot${i >= left ? " is-used" : ""}`));
    m.append(document.createTextNode(" "), dots);
  }
  const left = skipsLeft(t, k);
  m.title = `تخطّيات متبقية: ${left === Infinity ? "بلا حدّ" : left}`;
  return m;
}

function scoreboard(st) {
  const t = st.taboo;
  const wrap = $("div", "ds-stack ds-stack--tight");
  const duo = $("div", "ds-duo");
  const live = ["ready", "turn", "paused", "turnEnd"].includes(t.phase);
  for (const k of ["a", "b"]) {
    const team = st.teams[k];
    const box = $("div", `ds-team ds-team-${k}`);
    box.classList.toggle("is-turn", live && t.turnTeam === k);
    box.classList.toggle("is-waiting", live && t.turnTeam && t.turnTeam !== k);
    const info = $("div", "ds-stack ds-stack--tight");
    const adj = $("div", "ds-cluster ds-cluster--tight");
    adj.append(
      withBtnIcon("minus", "تقليل نقطة", () => ctx.act("tabooAdjust", { team: k, delta: -1 })),
      withBtnIcon("plus", "زيادة نقطة", () => ctx.act("tabooAdjust", { team: k, delta: 1 }))
    );
    info.append($("div", "ds-team-name", team.name), skipMeta(t, k), adj);
    box.append(info, $("div", "ds-score", String(t.score[k])));
    duo.appendChild(box);
  }
  wrap.append(duo, withIcon("span", "ds-pill", "target", `الهدف ${t.target}`));
  return wrap;
}

/** زر أيقونة صغير دائري. */
function withBtnIcon(iconName, label, onClick) {
  const b = withIcon("button", "ds-btn ds-btn--icon ds-btn--sm", iconName);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function teamOnline(st, team) {
  const on = new Set(ctx.getPeers()?.players || []);
  return Object.values(st.players || {}).filter((p) => !p.pseudo && p.team === team && on.has(p.id)).length;
}

function forbiddenChips(card) {
  const fb = $("div", "ds-cluster ds-cluster--center");
  for (const w of card?.forbidden || []) fb.appendChild($("span", "ds-chip ds-chip--forbidden", w));
  return fb;
}

function topicChip(card) {
  return card?.topic ? withIcon("span", "ds-chip", card.icon || "shapes", card.topic) : null;
}

export function renderTaboo() {
  const card = document.getElementById("tabooCard");
  const st = ctx?.getState();
  if (!card || !st || st.game !== "taboo") return;
  renderPacks();
  const t = st.taboo;
  const tName = (k) => st.teams[k]?.name || "";

  const tInput = document.getElementById("tabooTarget");
  if (tInput && document.activeElement !== tInput) tInput.value = t.target;
  const sInput = document.getElementById("tabooSeconds");
  if (sInput && document.activeElement !== sInput) sInput.value = t.turnSeconds;
  const kInput = document.getElementById("tabooSkips");
  if (kInput && document.activeElement !== kInput) kInput.value = String(t.skipsPerGame ?? 2);

  card.replaceChildren();
  card.appendChild(withIcon("div", "ds-card-title", "hush", " الكلمة الممنوعة"));
  card.appendChild(scoreboard(st));

  const body = $("div", "ds-stack");
  card.appendChild(body);
  const cluster = (...kids) => {
    const c = $("div", "ds-cluster");
    c.append(...kids.filter(Boolean));
    return c;
  };

  if (t.phase === "setup") {
    body.append($("p", "ds-text", "ابدأ لعبة جديدة لعرض القوانين على الشاشة."), btn("لعبة جديدة", "ds-btn--primary ds-btn--lg", () => ctx.act("tabooNew"), { iconName: "undo" }));
  }

  if (t.phase === "rules") {
    body.append(banner("info", "scroll", `القوانين ظاهرة على الشاشة الآن. القرعة: يبدأ ${tName(t.startTeam)}.`));
    const list = $("div", "ds-list");
    TABOO_RULES.forEach((r, i) => {
      const row = $("div", "ds-list-item");
      const b = $("span", "ds-badge-icon");
      b.appendChild(icon(RULE_ICONS[i] || "ban"));
      row.append(b, $("span", "ds-text", r));
      list.appendChild(row);
    });
    body.append(list, $("p", "ds-hint", `أي مخالفة = ⁦-1⁩ وينتهي الدور فوراً · ${skipsRule(t)}`));
    body.append(btn("ابدأ اللعبة", "ds-btn--success ds-btn--lg", () => ctx.act("tabooBegin"), { iconName: "play" }));
  }

  if (t.phase === "ready") {
    const who = t.describer;
    body.append(withIcon("span", `ds-pill ds-pill--lg ds-pill--team ds-team-${t.turnTeam}`, "users", `دور ${tName(t.turnTeam)}`));
    body.append(who ? withIcon("div", "ds-card-title", "megaphone", ` الشارح: ${who.name}`) : banner("danger", "warning", "لا يوجد لاعب متصل في هذا الفريق!"));
    const n = teamOnline(st, t.turnTeam);
    if (n < 2) body.append(banner("danger", "warning", `${tName(t.turnTeam)} فيه ${n} لاعب متصل فقط — يحتاج الشارح زميلاً واحداً على الأقل ليخمّن.`));
    // بطاقة الدور الأولى: يراها الحكم وحده قبل البدء، ويبدّلها إن أراد (ترجع لآخر المجموعة)
    if (t.card) {
      const preview = $("div", "ds-card ds-card--preview ds-center");
      preview.append(
        withIcon("span", "ds-label", "eye", " أول كلمة في الدور (لا يراها غيرك)"),
        topicChip(t.card) || "",
        $("div", "ds-word", t.card.word),
        forbiddenChips(t.card),
        btn("كلمة أخرى", "", () => ctx.act("tabooSwap"), { iconName: "swap" })
      );
      body.append(preview);
    }
    body.append($("p", "ds-hint", "تأكّد أن الشارح يمسك جواله وجاهز، ثم ابدأ الدور."));
    body.append(
      cluster(
        btn("قرعة أخرى", "", () => ctx.act("tabooPick"), { iconName: "dice" }),
        btn("ابدأ الدور", "ds-btn--success ds-btn--lg", () => ctx.act("tabooStartTurn"), { iconName: "play", disabled: !who })
      )
    );
  }

  if (t.phase === "turn" || t.phase === "paused") {
    const timer = withIcon("span", "ds-pill ds-pill--dark", "timer");
    const num = $("span", "", "—");
    num.id = "tbTimer";
    timer.appendChild(num);
    const got = t.turnLog.filter((l) => l.result === "right").length;
    const head = $("div", "ds-cluster ds-cluster--between");
    head.append(withIcon("span", `ds-pill ds-pill--team ds-team-${t.turnTeam}`, "megaphone", `${t.describer?.name || ""} · ${tName(t.turnTeam)}`), timer);
    body.append(head);
    if (t.phase === "paused") body.append(banner("info", "pause", "متوقف مؤقتاً"));
    if (t.card) {
      const c = $("div", "ds-card ds-card--preview ds-center");
      c.append(topicChip(t.card) || "", $("div", "ds-word", t.card.word), forbiddenChips(t.card));
      body.append(c);
    }
    body.append($("span", `ds-pill ds-pill--team ds-team-${t.turnTeam}`, `هذا الدور: +${got}`));

    if (foulOpen) {
      const grid = $("div", "ds-stack");
      grid.appendChild(withIcon("div", "ds-card-title", "ban", " سبب المخالفة؟ (⁦-1⁩ وينتهي الدور)"));
      const g = $("div", "ds-grid");
      for (const [k, label] of Object.entries(TABOO_FOULS)) {
        g.appendChild(btn(label, "ds-btn--danger ds-btn--sm", () => foul(k)));
      }
      g.appendChild(btn("إلغاء", "ds-btn--sm", () => { foulOpen = false; renderTaboo(); }, { iconName: "close" }));
      grid.appendChild(g);
      body.append(grid);
    } else {
      const left = skipsLeft(t, t.turnTeam);
      body.append(
        cluster(
          btn("صح", "ds-btn--success ds-btn--lg", right, { iconName: "check", disabled: t.phase !== "turn" }),
          btn("مخالفة", "ds-btn--danger ds-btn--lg", () => { foulOpen = true; renderTaboo(); }, { iconName: "ban" })
        ),
        cluster(
          btn(`تخطّي الفريق (${left === Infinity ? "∞" : left})`, "", skip, { iconName: "skip", disabled: t.phase !== "turn" || left <= 0 }),
          btn("كلمة أخرى (مجاناً)", "ds-btn--info", pass, { iconName: "swap" }),
          btn(t.phase === "turn" ? "إيقاف" : "استئناف", "", () => ctx.act(t.phase === "turn" ? "tabooPause" : "tabooResume"), { iconName: t.phase === "turn" ? "pause" : "play" })
        )
      );
    }
  }

  if (t.phase === "turnEnd") {
    if (t.foul) body.append(banner("danger", "ban", `ممنوع: ${t.foul.label} — ⁦-1⁩`));
    const got = t.turnLog.filter((l) => l.result === "right").length;
    body.append(withIcon("div", "ds-card-title", "timer", ` انتهى دور ${tName(t.turnTeam)} · +${got}`));
    body.append(summary(t));
    body.append(btn(`الدور التالي: ${tName(t.turnTeam === "a" ? "b" : "a")}`, "ds-btn--primary ds-btn--lg", () => ctx.act("tabooNextTurn"), { iconName: "arrow" }));
  }

  if (t.phase === "over") {
    const w = withIcon("div", "ds-winner ds-pop-in", null, `فاز ${tName(t.winner)}!`);
    body.append(icon("trophy", "ds-trophy"), w);
    body.append(withIcon("span", "ds-pill", "star", "نقطة لنقاط السهرة"));
    body.append(summary(t));
    body.append(btn("لعبة جديدة", "ds-btn--primary ds-btn--lg", () => ctx.act("tabooNew"), { iconName: "undo" }));
  }

  updateTimer();
}

function summary(t) {
  const ul = $("div", "ds-cluster");
  for (const l of t.turnLog || []) {
    const [cls, ic] = CHIP[l.result] || ["", "shapes"];
    ul.appendChild(withIcon("span", `ds-chip ${cls}`.trim(), ic, l.word));
  }
  return ul;
}

function updateTimer() {
  const st = ctx?.getState();
  const el = document.getElementById("tbTimer");
  const t = st?.taboo;
  if (!t) return;
  if (el) {
    const ms = t.phase === "paused" ? t.timer.remaining : ctx.remainingMs(t.timer);
    const secs = Math.max(0, Math.ceil((ms || 0) / 1000));
    el.textContent = t.phase === "paused" ? `${secs} (متوقف)` : String(secs);
    const urgent = t.phase === "turn" && secs <= 10;
    const pill = el.closest(".ds-pill");
    pill?.classList.toggle("ds-pill--coral", urgent);
    pill?.classList.toggle("ds-pill--dark", !urgent);
  }
  const running = st.game === "taboo" && t.phase === "turn";
  if (running && !tick) tick = setInterval(updateTimer, 250);
  else if (!running && tick) {
    clearInterval(tick);
    tick = null;
  }
}
