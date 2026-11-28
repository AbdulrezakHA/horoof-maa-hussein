/* ==================================================================
   لوحة الحكم — لعبة «الكلمة الممنوعة»
   تُرسم داخل #tabooCard حسب مرحلة اللعبة:
     rules → ready → turn ⇄ paused → turnEnd → ready … → over
   ================================================================== */
import { TABOO_FOULS, TABOO_RULES, UNLIMITED, skipsLeft } from "/shared/taboo.js";

/** نص التخطّيات المتبقّية: ●●○ أو ∞ */
export function skipDots(t, k) {
  if (t.skipsPerGame === UNLIMITED) return "⏭ ∞";
  if (!t.skipsPerGame) return "⏭ 0";
  const left = skipsLeft(t, k);
  return `⏭ ${"●".repeat(left)}${"○".repeat(Math.max(0, t.skipsPerGame - left))}`;
}
export const skipsRule = (t) =>
  t.skipsPerGame === UNLIMITED ? "التخطّي بلا حدّ" : !t.skipsPerGame ? "لا تخطّي في هذه اللعبة" : `لكل فريق ${t.skipsPerGame} تخطّي طوال اللعبة`;

let ctx = null; // { act, toast, getState, getPeers, inkFor, remainingMs, offset }
let foulOpen = false; // قائمة أسباب المخالفة مفتوحة؟
let tick = null;
let packs = [];
let packsKey = "";

const $ = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function btn(label, cls, onClick, { disabled = false, color = null } = {}) {
  const b = $("button", `btn ${cls || ""}`, label);
  b.type = "button";
  b.disabled = disabled;
  if (color) {
    b.style.background = color;
    b.style.color = ctx.inkFor(color);
  }
  b.addEventListener("click", onClick);
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
    ctx.toast(Number(e.target.value) < 0 ? "⏭ التخطّي بلا حدّ" : `⏭ ${e.target.value} تخطّي لكل فريق`);
  });
  document.getElementById("tabooNewBtn")?.addEventListener("click", () => {
    if (confirm("بدء لعبة «الكلمة الممنوعة» جديدة؟ تُصفَّر النقاط وتتجدّد التخطّيات.")) {
      ctx.act("tabooNew");
      ctx.toast("🔁 لعبة جديدة — القوانين على الشاشة");
    }
  });

  // اختصارات لوحة المفاتيح أثناء الدور: 1 صح · 2 مخالفة · 3 تخطّي · مسافة إيقاف/استئناف
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
    const row = $("label", "pst-item");
    const cb = $("input", "pst-item-check");
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
        ctx.toast("لا بد من موضوع واحد على الأقل");
        return;
      }
      ctx.act("tabooConfig", { packs: next.length >= packs.length ? [] : next });
    });
    row.append(cb, $("span", "pst-item-name", `${p.icon} ${p.name}`), $("span", "pst-item-meta", `${p.total} بطاقة`));
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
  ctx.toast("✅ صح +1");
}
function skip() {
  const st = ctx.getState();
  const t = st.taboo;
  if (skipsLeft(t, t.turnTeam) <= 0) return ctx.toast("لا تخطّيات متبقية لهذا الفريق");
  ctx.act("tabooSkip");
  ctx.toast("⏭ تخطّي");
}
function pass() {
  ctx.act("tabooPass");
  ctx.toast("🔄 كلمة أخرى — لا تُحسب على الفريق");
}
function foul(reason) {
  foulOpen = false;
  ctx.act("tabooFoul", { reason });
  ctx.toast(`🚫 ${TABOO_FOULS[reason]} — ⁦-1⁩ وانتهى الدور`);
}

/* ---------------- الرسم ---------------- */

function scoreboard(st) {
  const t = st.taboo;
  const wrap = $("div", "tb-score");
  for (const k of ["a", "b"]) {
    const team = st.teams[k];
    const box = $("div", "tb-team");
    box.classList.toggle("active", t.turnTeam === k && ["ready", "turn", "paused", "turnEnd"].includes(t.phase));
    box.style.setProperty("--team", team.color);
    box.style.setProperty("--team-ink", ctx.inkFor(team.color));
    box.append($("div", "tb-team-name", team.name), $("div", "tb-team-score", String(t.score[k])));
    const skips = $("div", "tb-team-skips", skipDots(t, k));
    const left = skipsLeft(t, k);
    skips.title = `تخطّيات متبقية: ${left === Infinity ? "بلا حدّ" : left}`;
    const adj = $("div", "tb-adjust");
    adj.append(
      btn("−", "btn-sm", () => ctx.act("tabooAdjust", { team: k, delta: -1 })),
      btn("+", "btn-sm", () => ctx.act("tabooAdjust", { team: k, delta: 1 }))
    );
    box.append(skips, adj);
    wrap.appendChild(box);
  }
  const mid = $("div", "tb-target", `الهدف\n${t.target}`);
  wrap.insertBefore(mid, wrap.children[1]);
  return wrap;
}

function teamOnline(st, team) {
  const on = new Set(ctx.getPeers()?.players || []);
  return Object.values(st.players || {}).filter((p) => !p.pseudo && p.team === team && on.has(p.id)).length;
}

export function renderTaboo() {
  const card = document.getElementById("tabooCard");
  const st = ctx?.getState();
  if (!card || !st || st.game !== "taboo") return;
  renderPacks();
  const t = st.taboo;
  const tName = (k) => st.teams[k]?.name || "";
  const tColor = (k) => st.teams[k]?.color || "#999";

  const tInput = document.getElementById("tabooTarget");
  if (tInput && document.activeElement !== tInput) tInput.value = t.target;
  const sInput = document.getElementById("tabooSeconds");
  if (sInput && document.activeElement !== sInput) sInput.value = t.turnSeconds;
  const kInput = document.getElementById("tabooSkips");
  if (kInput && document.activeElement !== kInput) kInput.value = String(t.skipsPerGame ?? 2);

  card.replaceChildren();
  card.style.setProperty("--team", t.turnTeam ? tColor(t.turnTeam) : "#ffd93d");
  card.appendChild($("div", "section-title", "🚫 الكلمة الممنوعة"));
  card.appendChild(scoreboard(st));

  const body = $("div", "tb-body");
  card.appendChild(body);

  if (t.phase === "setup") {
    body.append($("p", "tb-msg", "ابدأ لعبة جديدة لعرض القوانين على الشاشة."), btn("🔁 لعبة جديدة", "btn-lg btn-yellow", () => ctx.act("tabooNew")));
  }

  if (t.phase === "rules") {
    body.append($("p", "tb-msg", `📜 القوانين ظاهرة على الشاشة الآن. القرعة: يبدأ ${tName(t.startTeam)}.`));
    const ul = $("ol", "tb-rules");
    for (const r of TABOO_RULES) ul.appendChild($("li", "", r));
    body.append(ul, $("p", "tiny", `أي مخالفة = ⁦-1⁩ وينتهي الدور فوراً · ${skipsRule(t)}`));
    body.append(btn("▶️ ابدأ اللعبة", "btn-lg btn-green", () => ctx.act("tabooBegin")));
  }

  if (t.phase === "ready") {
    const who = t.describer;
    body.append($("div", "tb-turn-banner", `دور ${tName(t.turnTeam)}`));
    body.append($("div", "tb-describer", who ? `🎤 الشارح: ${who.name}` : "لا يوجد لاعب متصل في هذا الفريق!"));
    const n = teamOnline(st, t.turnTeam);
    if (n < 2) body.append($("p", "tb-warn", `⚠️ ${tName(t.turnTeam)} فيه ${n} لاعب متصل فقط — يحتاج الشارح زميلاً واحداً على الأقل ليخمّن.`));
    // بطاقة الدور الأولى: يراها الحكم وحده قبل البدء، ويبدّلها إن أراد (ترجع لآخر المجموعة)
    if (t.card) {
      const preview = $("div", "tb-preview");
      preview.append($("div", "tb-preview-label", "👁️ أول كلمة في الدور (لا يراها غيرك)"));
      preview.append($("div", "tb-topic", `${t.card.icon || "🃏"} ${t.card.topic || ""}`), $("div", "tb-word", t.card.word));
      const fb = $("div", "tb-forbidden");
      for (const w of t.card.forbidden || []) fb.appendChild($("span", "tb-fword", w));
      preview.append(fb, btn("🔄 كلمة أخرى", "", () => ctx.act("tabooSwap")));
      body.append(preview);
    }
    body.append($("p", "tiny", "تأكّد أن الشارح يمسك جواله وجاهز، ثم ابدأ الدور."));
    const row = $("div", "btn-row");
    row.append(
      btn("🎲 قرعة أخرى", "", () => ctx.act("tabooPick")),
      btn("▶️ ابدأ الدور", "btn-lg btn-green", () => ctx.act("tabooStartTurn"), { disabled: !who })
    );
    body.append(row);
  }

  if (t.phase === "turn" || t.phase === "paused") {
    const head = $("div", "tb-live");
    const timer = $("span", "tb-timer", "—");
    timer.id = "tbTimer";
    head.append($("span", "tb-live-who", `🎤 ${t.describer?.name || ""} · ${tName(t.turnTeam)}`), timer);
    body.append(head);
    if (t.card) {
      body.append($("div", "tb-topic", `${t.card.icon || "🃏"} ${t.card.topic || ""}`));
      body.append($("div", "tb-word", t.card.word));
      const fb = $("div", "tb-forbidden");
      for (const w of t.card.forbidden || []) fb.appendChild($("span", "tb-fword", w));
      body.append(fb);
    }
    const got = t.turnLog.filter((l) => l.result === "right").length;
    body.append($("div", "tb-tally", `هذا الدور: +${got}`));

    if (foulOpen) {
      const grid = $("div", "tb-fouls");
      grid.appendChild($("div", "tb-fouls-title", "سبب المخالفة؟ (⁦-1⁩ وينتهي الدور)"));
      for (const [k, label] of Object.entries(TABOO_FOULS)) {
        grid.appendChild(btn(label, "btn-danger", () => foul(k)));
      }
      grid.appendChild(btn("إلغاء", "", () => { foulOpen = false; renderTaboo(); }));
      body.append(grid);
    } else {
      const actions = $("div", "tb-actions");
      const left = skipsLeft(t, t.turnTeam);
      actions.append(
        btn("✅ صح", "tb-big tb-right", right, { disabled: t.phase !== "turn" }),
        btn("🚫 مخالفة", "tb-big tb-foul", () => { foulOpen = true; renderTaboo(); }),
        btn(`⏭ تخطّي الفريق (${left === Infinity ? "∞" : left})`, "tb-skip", skip, { disabled: t.phase !== "turn" || left <= 0 }),
        btn("🔄 كلمة أخرى (مجاناً)", "tb-skip", pass),
        btn(t.phase === "turn" ? "⏸ إيقاف" : "▶️ استئناف", "tb-pause", () => ctx.act(t.phase === "turn" ? "tabooPause" : "tabooResume"))
      );
      body.append(actions);
    }
  }

  if (t.phase === "turnEnd") {
    if (t.foul) body.append($("div", "tb-foul-banner", `🚫 ممنوع: ${t.foul.label} — ⁦-1⁩`));
    const got = t.turnLog.filter((l) => l.result === "right").length;
    body.append($("div", "tb-turn-banner", `انتهى دور ${tName(t.turnTeam)} · +${got}`));
    body.append(summary(t));
    body.append(btn(`➡️ الدور التالي: ${tName(t.turnTeam === "a" ? "b" : "a")}`, "btn-lg btn-yellow", () => ctx.act("tabooNextTurn")));
  }

  if (t.phase === "over") {
    body.append($("div", "tb-winner", `🏆 فاز ${tName(t.winner)}!`));
    body.append($("p", "tiny", "+1 لنقاط السهرة"));
    body.append(summary(t));
    body.append(btn("🔁 لعبة جديدة", "btn-lg btn-yellow", () => ctx.act("tabooNew")));
  }

  updateTimer();
}

function summary(t) {
  const ICON = { right: "✅", skip: "⏭", pass: "🔄", foul: "🚫", timeout: "⏰" };
  const ul = $("div", "tb-summary");
  for (const l of t.turnLog || []) ul.appendChild($("span", `tb-chip ${l.result}`, `${ICON[l.result] || ""} ${l.word}`));
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
    el.textContent = t.phase === "paused" ? `⏸ ${secs}` : String(secs);
    el.classList.toggle("urgent", t.phase === "turn" && secs <= 10);
  }
  const running = st.game === "taboo" && t.phase === "turn";
  if (running && !tick) tick = setInterval(updateTimer, 250);
  else if (!running && tick) {
    clearInterval(tick);
    tick = null;
  }
}
