import { icon } from "./ds.js";

/* =========================================================================
   في بينا غريب — لوحة الحكم
   القاعدة الذهبية: لا أحد يعرف من هو الغريب… ولا الغريب نفسه. الحكم وحده.
   لذلك هذا الملف هو المكان الوحيد الذي يُعرض فيه الغريب وكلمته.
   ========================================================================= */

const TEAM = { a: "الفريق الأزرق", b: "الفريق الأحمر" };
const SHORT = { a: "الأزرق", b: "الأحمر" };
const MODES = [
  ["teams", "بالفرق", "لكل فريق غريب خاص به — والنقاط تُحسب لسهرة الفرق"],
  ["ffa", "الكل ضد الكل", "غريب واحد فقط — للّعب والتسلية بلا نقاط"],
];

let ctx = null;
let packs = null;
let picked = null;
let modeDraft = "teams";
let revealOdd = false;
let guessDraft = "";

/* ------------------------------- أدوات ------------------------------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function withIcon(tag, cls, name, text) {
  const node = el(tag, cls);
  const svg = name ? icon(name) : null;
  if (svg) node.appendChild(svg);
  if (text != null) node.appendChild(document.createTextNode(text));
  return node;
}

function btn(label, cls, onClick, opts = {}) {
  const node = withIcon("button", ["ds-btn", cls].filter(Boolean).join(" "), opts.iconName || "", label);
  node.type = "button";
  if (opts.disabled) node.disabled = true;
  if (opts.pressed) node.setAttribute("aria-pressed", "true");
  node.addEventListener("click", onClick);
  return node;
}

function banner(tone, iconName, text, sub) {
  const node = el("div", `ds-banner ds-banner--${tone}`);
  node.appendChild(withIcon("span", "ds-banner-icon", iconName || "info"));
  const box = el("div", "ds-banner-text");
  box.appendChild(el("span", null, text));
  if (sub) box.appendChild(el("span", "ds-banner-sub", sub));
  node.appendChild(box);
  return node;
}

function pill(tone, iconName, text) {
  return withIcon("span", `ds-pill ds-pill--${tone}`, iconName, text);
}

function title(text, iconName) {
  return withIcon("h3", "ds-title ds-title--sm", iconName, text);
}

function hint(iconName, text) {
  return withIcon("p", "ds-hint", iconName, text);
}

function chip(active, iconName, text) {
  return withIcon("span", `ds-chip${active ? " ds-chip--right" : " ds-chip--skip"}`, iconName, text);
}

function playerTag(name, online = true) {
  const node = el("span", `ds-player${online ? "" : " is-offline"}`);
  node.appendChild(el("span", "ds-avatar", (name || "؟").trim().charAt(0)));
  node.appendChild(el("span", null, name || "لاعب"));
  return node;
}

function playerName(state, id) {
  if (!id) return "—";
  return state?.players?.[id]?.name || "لاعب";
}

function members(state, team) {
  return Object.values(state?.players || {}).filter((p) => p && p.team === team);
}

function needVotes(state, team) {
  const count = members(state, team).length;
  return Math.floor(count / 2) + 1;
}

function votedCount(g, team) {
  return Object.keys(g?.ballots?.[team] || {}).length;
}

/* --------------------------- المجالات --------------------------- */

function loadPacks(force = false) {
  if (packs && !force) return;
  fetch("/api/ghareeb/packs")
    .then((r) => r.json())
    .then((data) => {
      packs = Array.isArray(data?.packs) ? data.packs : [];
      renderGhareeb();
    })
    .catch(() => {
      packs = [];
      renderGhareeb();
    });
}

/* ------------------------------ الرسم ------------------------------ */

export function initGhareeb(context) {
  ctx = context;
}

export function renderGhareeb() {
  const host = document.getElementById("ghareebCard");
  if (!host) return;
  const state = ctx?.getState?.();
  const g = state?.ghareeb;
  host.replaceChildren();
  if (!g) return;

  loadPacks();

  if (g.phase === "setup") {
    host.appendChild(renderSetup(state, g));
    return;
  }

  host.appendChild(renderHeader(state, g));

  if (g.phase === "rules") host.appendChild(renderRules(state, g));
  else if (g.phase === "deal") host.appendChild(renderDeal(state, g));
  else if (g.phase === "turn") host.appendChild(renderTurn(state, g));
  else if (g.phase === "vote") host.appendChild(renderVote(state, g));
  else if (g.phase === "guess") host.appendChild(renderGuess(state, g));
  else if (g.phase === "p2") host.appendChild(renderPhase2(state, g));
  else if (g.phase === "result") host.appendChild(renderResult(state, g));
  else if (g.phase === "over") host.appendChild(renderOver(state, g));

  host.appendChild(renderFooter(state, g));
}

/* ----------------------------- الإعداد ----------------------------- */

function renderSetup() {
  const wrap = el("div", "ds-stack");
  wrap.appendChild(
    banner(
      "info",
      "eye",
      "لعبة استنتاج: الجميع يأخذ نفس الكلمة، إلا الغريب فيأخذ كلمة قريبة منها.",
      "المطلوب: اكتشافه بالأسئلة ثم بالتصويت السرّي.",
    ),
  );

  wrap.appendChild(title("طريقة اللعب", "target"));
  const seg = el("div", "ds-seg");
  for (const [id, label] of MODES) {
    const option = withIcon("button", null, id === "teams" ? "users" : "target", label);
    option.type = "button";
    if (modeDraft === id) option.setAttribute("aria-pressed", "true");
    option.addEventListener("click", () => {
      modeDraft = id;
      renderGhareeb();
    });
    seg.appendChild(option);
  }
  wrap.appendChild(seg);
  const modeHint = MODES.find((m) => m[0] === modeDraft);
  if (modeHint) wrap.appendChild(hint("info", modeHint[2]));

  wrap.appendChild(title("المجالات", "sliders"));
  wrap.appendChild(hint("shapes", "اختر المجالات التي تُسحب منها الكلمات — كل مجال فيه أزواج كلمات قريبة من بعضها."));
  const chips = el("div", "ds-cluster ds-cluster--tight");
  const chosen = picked || new Set();
  for (const pack of packs || []) {
    const isOn = chosen.has(pack.id);
    chips.appendChild(
      btn(` ${pack.name} (${pack.total})`, "ds-btn--sm", () => {
        if (!picked) picked = new Set((packs || []).map((p) => p.id));
        if (picked.has(pack.id)) picked.delete(pack.id);
        else picked.add(pack.id);
        renderGhareeb();
      }, { iconName: pack.icon || "shapes", pressed: isOn }),
    );
  }
  if (!packs || !packs.length) chips.appendChild(el("span", "ds-hint", "لا توجد مجالات — أضِفها من صفحة كلمات اللعبة."));
  wrap.appendChild(chips);

  const actions = el("div", "ds-cluster");
  actions.appendChild(
    btn("توزيع الكلمات وبدء", "ds-btn--primary", () => {
      const fields = [...(picked || new Set((packs || []).map((p) => p.id)))];
      if (!fields.length) {
        ctx?.toast?.("اختر مجالاً واحداً على الأقل", "warning");
        return;
      }
      ctx.act("ghareebNew", { mode: modeDraft, fields });
    }, { iconName: "play" }),
  );
  actions.appendChild(
    btn("تعديل الكلمات", "ds-btn--ghost", () => window.open("/ghareeb-words", "_blank"), { iconName: "pen" }),
  );
  wrap.appendChild(actions);
  return wrap;
}

/* ----------------------------- الترويسة ----------------------------- */

function renderHeader(state, g) {
  const head = el("div", "ds-cluster ds-cluster--tight");
  head.appendChild(pill("sky", "eye", g.mode === "ffa" ? " الكل ضد الكل" : " بالفرق"));
  head.appendChild(pill("sky", "hash", ` الدور ${g.n || 0}`));
  if (g.mode === "teams") {
    head.appendChild(pill("mint", "crown", ` النقاط ${g.points?.a ?? 0} — ${g.points?.b ?? 0}`));
  }
  if (["turn", "vote", "p2", "result"].includes(g.phase)) {
    head.appendChild(pill("sun", "target", ` محاولات ${SHORT.a} ${g.chances?.a ?? 0} / ${SHORT.b} ${g.chances?.b ?? 0}`));
  }
  return head;
}

/* ------------------------------ القواعد ------------------------------ */

function renderRules(state, g) {
  void state;
  void g;
  const wrap = el("div", "ds-stack");
  wrap.appendChild(banner("info", "info", "كلمة واحدة للجميع… وكلمة قريبة للغريب.", "لا أحد يعرف من هو الغريب — ولا الغريب نفسه."));

  wrap.appendChild(title("كيف نلعب", "question"));
  const items = [
    "كل لاعب يرى كلمته على هاتفه لثوانٍ ثم تختفي، فلا تبقى الكلمة أمام أحد.",
    "الأدوار تتبادل: لاعب عشوائي من فريق يسأل لاعباً عشوائياً من الفريق الآخر عن الكلمة.",
    "من الدور الثالث يمكن فتح تصويت. التصويت سرّي تماماً: لا أحد يرى اختيار الآخرين.",
    "في وضع الفرق يصوّت كل فريق على غريب الفريق الآخر، والأغلبية = نصف الفريق + واحد.",
    "الإصابة تكسب النقطة. الخطأ يحرق محاولة من محاولتين، والثانية الخطأ تخسر النقطة فوراً.",
    "إذا كشف الفريقان غريب الخصم في جولة واحدة — أو أحرق كلاهما محاولته الثانية — تبدأ المرحلة الثانية.",
  ];
  const list = el("ul", "ds-list");
  for (const text of items) list.appendChild(el("li", "ds-list-item", text));
  wrap.appendChild(list);

  const actions = el("div", "ds-cluster");
  actions.appendChild(btn("توزيع الكلمات", "ds-btn--primary", () => ctx.act("ghareebDeal"), { iconName: "gift" }));
  actions.appendChild(btn("تغيير الإعدادات", "ds-btn--ghost", () => ctx.act("ghareebReset"), { iconName: "undo" }));
  wrap.appendChild(actions);
  return wrap;
}

/* ------------------------------ التوزيع ------------------------------ */

function renderDeal(state, g) {
  const wrap = el("div", "ds-stack");
  wrap.appendChild(banner("success", "check", "تم توزيع الكلمات.", "كل لاعب يرى كلمته على هاتفه فقط."));
  if (g.fieldName) wrap.appendChild(hint("shapes", ` المجال: ${g.fieldName}`));

  wrap.appendChild(
    btn(revealOdd ? "إخفاء هوية الغريب" : "اكشف لي الغريب (الحكم فقط)", "ds-btn--ghost", () => {
      revealOdd = !revealOdd;
      renderGhareeb();
    }, { iconName: revealOdd ? "hush" : "eye" }),
  );

  if (revealOdd) {
    const box = el("div", "ds-stack ds-stack--tight");
    if (g.mode === "ffa") {
      box.appendChild(banner("danger", "eye", `الغريب: ${playerName(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
    } else {
      box.appendChild(banner("danger", "eye", `غريب ${SHORT.a}: ${playerName(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
      box.appendChild(banner("danger", "eye", `غريب ${SHORT.b}: ${playerName(state, g.odd?.b)}`, `كلمته: ${g.oddWord?.b || "—"}`));
    }
    box.appendChild(hint("shapes", `الكلمة المشتركة: ${g.word || "—"}`));
    wrap.appendChild(box);
  }

  wrap.appendChild(btn("ابدأ الأدوار", "ds-btn--primary", () => ctx.act("ghareebBegin"), { iconName: "play" }));
  return wrap;
}

/* ------------------------------- الأدوار ------------------------------- */

function renderTurn(state, g) {
  const wrap = el("div", "ds-stack");
  const asker = playerName(state, g.askerId);
  const target = playerName(state, g.targetId);
  wrap.appendChild(
    banner("info", "chat", `دور ${g.n}: ${asker} يسأل ${target}`, `سؤال من ${SHORT[g.askTeam] || "—"} — ويتبادلون الأدوار بعدها.`),
  );

  if (g.lastResult && !g.lastResult.winner) {
    wrap.appendChild(banner("danger", "warning", g.lastResult.reason || "لم يكتمل أي تصويت"));
  }

  const actions = el("div", "ds-cluster");
  actions.appendChild(btn("الدور التالي", "ds-btn--primary", () => ctx.act("ghareebNextTurn"), { iconName: "swap" }));
  actions.appendChild(
    btn("فتح تصويت", "ds-btn--ghost", () => ctx.act("ghareebVoteOpen"), { iconName: "target", disabled: g.n < 3 }),
  );
  wrap.appendChild(actions);
  if (g.n < 3) wrap.appendChild(hint("timer", "الدوران الأول والثاني بلا تصويت — دعوا الأسئلة تتكشّف أولاً."));
  return wrap;
}

/* ------------------------------ التصويت ------------------------------ */

function renderVote(state, g) {
  const wrap = el("div", "ds-stack");
  wrap.appendChild(
    banner("danger", "lock", "التصويت مفتوح — سرّي تماماً.", "لا أحد يرى اختيار الآخرين، وكل التصويتات تُكشف بعد نهاية اللعبة."),
  );

  if (g.mode === "ffa") {
    const total = Object.keys(state?.players || {}).length;
    wrap.appendChild(hint("info", `صوّت ${Object.keys(g.ballots?.all || {}).length} من ${total} — المطلوب ${Math.floor(total / 2) + 1}.`));
  } else {
    wrap.appendChild(hint("info", "الأغلبية المطلوبة: نصف الفريق + صوت واحد."));
    for (const team of ["a", "b"]) {
      const all = members(state, team);
      const box = el("div", `ds-card ds-team-${team} ds-stack ds-stack--tight`);
      box.appendChild(
        withIcon("h4", "ds-team-name", "users", ` ${TEAM[team]} — صوّت ${votedCount(g, team)} من ${all.length} (المطلوب ${needVotes(state, team)})`),
      );
      const row = el("div", "ds-cluster ds-cluster--tight");
      for (const p of all) {
        const did = Object.prototype.hasOwnProperty.call(g.ballots?.[team] || {}, p.id);
        row.appendChild(playerTag(p.name));
        row.appendChild(chip(did, did ? "check" : "timer", did ? " صوّت" : " ينتظر"));
      }
      if (!all.length) row.appendChild(el("span", "ds-hint", "لا يوجد لاعبون في هذا الفريق"));
      box.appendChild(row);
      wrap.appendChild(box);
    }
  }

  wrap.appendChild(
    btn("أغلق التصويت وأظهر النتيجة", "ds-btn--primary", () => ctx.act("ghareebVoteClose"), { iconName: "check" }),
  );
  wrap.appendChild(hint("timer", "من لم يصوّت يُحسب متخطياً — لا تنتظروا أحداً إن أردتم المضي."));
  return wrap;
}

/* --------------------------- تخمين الغريب --------------------------- */

function renderGuess(state, g) {
  void state;
  void g;
  const wrap = el("div", "ds-stack");
  wrap.appendChild(
    banner("danger", "eye", "التصويت أخطأ… الغريب نجا وفاز بالجولة.", "له محاولة واحدة لتخمين الكلمة الحقيقية — يكتبها الحكم هنا فقط."),
  );
  const row = el("div", "ds-row");
  const input = el("input", "ds-input");
  input.type = "text";
  input.placeholder = "الكلمة الحقيقية";
  input.value = guessDraft;
  input.addEventListener("input", () => {
    guessDraft = input.value;
  });
  row.appendChild(input);
  row.appendChild(
    btn("تأكيد التخمين", "ds-btn--primary", () => {
      const value = (guessDraft || "").trim();
      if (!value) {
        ctx?.toast?.("اكتب الكلمة أولاً", "warning");
        return;
      }
      ctx.act("ghareebGuess", { word: value });
      guessDraft = "";
    }, { iconName: "hand" }),
  );
  wrap.appendChild(row);
  return wrap;
}

/* --------------------------- المرحلة الثانية --------------------------- */

function renderPhase2(state, g) {
  const wrap = el("div", "ds-stack");
  wrap.appendChild(
    banner("danger", "bolt", "المرحلة الثانية — موت مفاجئ.", "كل فريق يسمّي الغريب الذي داخله هو: محاولة واحدة، من يصب يكسب ومن يخطئ يخسر."),
  );

  for (const team of ["a", "b"]) {
    const all = members(state, team);
    const box = el("div", `ds-card ds-team-${team} ds-stack ds-stack--tight`);
    box.appendChild(
      withIcon("h4", "ds-team-name", "users", ` ${TEAM[team]} — صوّت ${votedCount(g, team)} من ${all.length} (المطلوب ${needVotes(state, team)})`),
    );
    const row = el("div", "ds-cluster ds-cluster--tight");
    for (const p of all) {
      const did = Object.prototype.hasOwnProperty.call(g.ballots?.[team] || {}, p.id);
      row.appendChild(playerTag(p.name));
      row.appendChild(chip(did, did ? "check" : "timer", did ? " صوّت" : " ينتظر"));
    }
    if (!all.length) row.appendChild(el("span", "ds-hint", "لا يوجد لاعبون في هذا الفريق"));
    box.appendChild(row);
    wrap.appendChild(box);
  }

  wrap.appendChild(btn("أغلق المرحلة الثانية", "ds-btn--primary", () => ctx.act("ghareebP2Close"), { iconName: "check" }));
  return wrap;
}

/* ------------------------------- النتيجة ------------------------------- */

function renderResult(state, g) {
  const wrap = el("div", "ds-stack");
  const r = g.lastResult || {};
  wrap.appendChild(banner(r.winner ? "success" : "info", r.winner ? "trophy" : "info", r.reason || "انتهت الجولة"));

  const score = el("div", "ds-cluster ds-cluster--tight");
  if (g.mode === "teams") {
    score.appendChild(pill("mint", "crown", ` ${SHORT.a} ${g.points?.a ?? 0}`));
    score.appendChild(pill("mint", "crown", ` ${SHORT.b} ${g.points?.b ?? 0}`));
    score.appendChild(pill("sun", "target", ` محاولات ${SHORT.a} ${g.chances?.a ?? 0} / ${SHORT.b} ${g.chances?.b ?? 0}`));
  } else {
    score.appendChild(pill("coral", "eye", ` الفائز: ${r.winner === "players" ? "اللاعبون" : r.winner === "odd" ? "الغريب" : "—"}`));
    if (g.odd?.a) score.appendChild(pill("dark", "eye", ` الغريب: ${playerName(state, g.odd.a)}`));
  }
  wrap.appendChild(score);

  const actions = el("div", "ds-cluster");
  actions.appendChild(btn("جولة جديدة", "ds-btn--primary", () => ctx.act("ghareebDeal"), { iconName: "gift" }));
  actions.appendChild(btn("إنهاء اللعبة", "ds-btn--danger", () => ctx.act("ghareebEnd"), { iconName: "flag" }));
  wrap.appendChild(actions);
  return wrap;
}

/* -------------------------------- النهاية -------------------------------- */

function renderOver(state, g) {
  const wrap = el("div", "ds-stack");
  wrap.appendChild(banner("success", "trophy", "انتهت اللعبة — الآن يُكشف كل شيء.", "الكلمة، الغريب، وكل تصويت جرى في السرّ."));

  if (g.mode === "ffa") {
    wrap.appendChild(banner("info", "eye", `الغريب: ${playerName(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
    wrap.appendChild(hint("shapes", `الكلمة المشتركة: ${g.word || "—"}`));
    wrap.appendChild(pill("coral", "crown", ` الفائز: ${g.winner === "players" ? "اللاعبون" : g.winner === "odd" ? "الغريب" : "—"}`));
  } else {
    wrap.appendChild(banner("info", "eye", `غريب ${SHORT.a}: ${playerName(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
    wrap.appendChild(banner("info", "eye", `غريب ${SHORT.b}: ${playerName(state, g.odd?.b)}`, `كلمته: ${g.oddWord?.b || "—"}`));
    wrap.appendChild(hint("shapes", `الكلمة المشتركة: ${g.word || "—"}`));
    wrap.appendChild(pill("mint", "crown", ` النقاط ${g.points?.a ?? 0} — ${g.points?.b ?? 0}`));
  }

  const rounds = Array.isArray(g.rounds) ? g.rounds : [];
  if (rounds.length) {
    wrap.appendChild(title("جولات اللعب", "scroll"));
    const grid = el("div", "ds-grid");
    rounds.forEach((r, i) => {
      const card = el("div", "ds-card");
      card.appendChild(withIcon("h4", "ds-title ds-title--xs", r.winner ? "trophy" : "info", ` الجولة ${r.n ?? i + 1}`));
      card.appendChild(el("p", "ds-hint", r.reason || "بلا تصويت"));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  const history = Array.isArray(g.history) ? g.history : [];
  if (history.length) {
    wrap.appendChild(title("كل التصويتات", "lock"));
    const list = el("ul", "ds-list");
    history.forEach((h) => {
      const votes = h?.votes && typeof h.votes === "object" ? h.votes : {};
      const parts = Object.entries(votes).map(([voterId, targetId]) =>
        targetId ? `${playerName(state, voterId)} صوّت لـ ${playerName(state, targetId)}` : `${playerName(state, voterId)} تخطّى`,
      );
      if (parts.length) list.appendChild(el("li", "ds-list-item", `الدور ${h.n ?? "—"}: ${parts.join(" • ")}`));
    });
    if (list.children.length) wrap.appendChild(list);
  }

  const actions = el("div", "ds-cluster");
  actions.appendChild(btn("لعبة جديدة", "ds-btn--primary", () => ctx.act("ghareebReset"), { iconName: "refresh" }));
  actions.appendChild(btn("العودة للألعاب", "ds-btn--ghost", () => ctx?.goHome?.(), { iconName: "arrow" }));
  wrap.appendChild(actions);
  return wrap;
}

/* -------------------------------- التذييل -------------------------------- */

function renderFooter() {
  const foot = el("div", "ds-cluster");
  foot.appendChild(btn("تصفير اللعبة", "ds-btn--ghost", () => ctx.act("ghareebReset"), { iconName: "undo" }));
  foot.appendChild(btn("العودة للألعاب", "ds-btn--ghost", () => ctx?.goHome?.(), { iconName: "arrow" }));
  return foot;
}