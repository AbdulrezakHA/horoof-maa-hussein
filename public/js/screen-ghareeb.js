import { icon } from "./ds.js";

/* =========================================================================
   في بينا غريب — شاشة التلفاز
   لا تُعرض الكلمة هنا أبداً أثناء اللعب: التلفاز يراه الجميع، والغريب لا يجب
   أن يعرف أنه غريب. الكشف الكامل يحدث فقط في شاشة النهاية.
   ========================================================================= */

const TEAM = { a: "الفريق الأزرق", b: "الفريق الأحمر" };
const SHORT = { a: "الأزرق", b: "الأحمر" };

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

function bigTitle(name, text) {
  return withIcon("h1", "ds-title", name, text);
}

function line(text, dim = false) {
  return el("p", `ds-text${dim ? " ds-text--dim" : ""}`, text);
}

function pill(tone, name, text, large = false) {
  return withIcon("span", `ds-pill${large ? " ds-pill--lg" : ""} ds-pill--${tone}`, name, text);
}

function banner(tone, name, text, sub) {
  const node = el("div", `ds-banner ds-banner--${tone}`);
  node.appendChild(withIcon("span", "ds-banner-icon", name || "info"));
  const box = el("div", "ds-banner-text");
  box.appendChild(el("span", null, text));
  if (sub) box.appendChild(el("span", "ds-banner-sub", sub));
  node.appendChild(box);
  return node;
}

function members(state, team) {
  return Object.values(state?.players || {}).filter((p) => p && p.team === team);
}

function nameOf(state, id) {
  return state?.players?.[id]?.name || "لاعب";
}

export function renderGhareebScreen(state) {
  const host = document.getElementById("ghareebScreen");
  if (!host) return;
  const g = state?.ghareeb;
  host.replaceChildren();
  if (!g) return;

  if (g.phase === "setup" || !g.phase) {
    host.appendChild(bigTitle("eye", "في بينا غريب"));
    host.appendChild(line("الحكم يجهّز الجولة…", true));
    return;
  }

  host.appendChild(renderTop(state, g));

  if (g.phase === "rules") {
    host.appendChild(banner("info", "info", "كلمة واحدة للجميع… وغريب واحد بينكم"));
    host.appendChild(line("اسألوا، لاحظوا، ثم صوّتوا في السرّ."));
    return;
  }

  if (g.phase === "deal") {
    host.appendChild(bigTitle("gift", "وُزّعت الكلمات"));
    host.appendChild(line("انظروا إلى جوالاتكم: كل واحد يرى كلمته وحده، ثم تختفي."));
    return;
  }

  if (g.phase === "turn") {
    host.appendChild(bigTitle("chat", `الدور ${g.n}`));
    host.appendChild(renderTurnPair(state, g));
    if (g.lastResult && !g.lastResult.winner) {
      host.appendChild(banner("danger", "warning", g.lastResult.reason || "لم يكتمل أي تصويت"));
    }
    host.appendChild(line(`سؤال من ${SHORT[g.askTeam] || "—"} — ثم يتبادلون الأدوار.`, true));
    if (g.n < 3) host.appendChild(line("من الدور الثالث يُفتح التصويت.", true));
    return;
  }

  if (g.phase === "vote") {
    host.appendChild(bigTitle("lock", "التصويت مفتوح"));
    host.appendChild(banner("danger", "lock", "التصويت سرّي تماماً", "لا أحد يرى اختيار الآخرين — ولا تُعلن النتائج إلا في النهاية."));
    host.appendChild(renderVoteProgress(state, g));
    return;
  }

  if (g.phase === "guess") {
    host.appendChild(bigTitle("eye", "الغريب نجا!"));
    host.appendChild(line("له محاولة واحدة لتخمين الكلمة الحقيقية…"));
    return;
  }

  if (g.phase === "p2") {
    host.appendChild(bigTitle("bolt", "المرحلة الثانية"));
    host.appendChild(
      banner("danger", "bolt", "كل فريق يسمّي الغريب الذي داخله هو", "محاولة واحدة فقط: من يصيب يكسب النقطة ومن يخطئ يخسرها."),
    );
    host.appendChild(renderVoteProgress(state, g));
    return;
  }

  if (g.phase === "result") {
    const r = g.lastResult || {};
    host.appendChild(bigTitle(r.winner ? "trophy" : "info", r.winner ? "نقطة!" : "انتهت الجولة"));
    host.appendChild(banner(r.winner ? "success" : "info", "info", r.reason || "لم يكتمل أي تصويت هذه الجولة"));
    host.appendChild(renderScore(g));
    return;
  }

  if (g.phase === "over") {
    host.appendChild(bigTitle("trophy", "انتهت اللعبة"));
    host.appendChild(renderReveal(state, g));
  }
}

function renderTop(state, g) {
  void state;
  const top = el("div", "ds-cluster ds-cluster--center ds-cluster--tight");
  top.appendChild(pill("sky", "eye", g.mode === "ffa" ? " الكل ضد الكل" : " بالفرق"));
  if (g.fieldName) top.appendChild(pill("dark", "shapes", ` ${g.fieldName}`));
  if (g.mode === "teams" && ["turn", "vote", "p2", "result"].includes(g.phase)) {
    top.appendChild(pill("sun", "target", ` محاولات ${SHORT.a} ${g.chances?.a ?? 0}`));
    top.appendChild(pill("sun", "target", ` محاولات ${SHORT.b} ${g.chances?.b ?? 0}`));
  }
  if (g.mode === "teams" && g.phase !== "over") {
    top.appendChild(pill("mint", "crown", ` ${g.points?.a ?? 0} — ${g.points?.b ?? 0}`));
  }
  return top;
}

function renderTurnPair(state, g) {
  const row = el("div", "ds-cluster ds-cluster--center");
  const asker = el("div", "ds-stack ds-stack--tight");
  asker.appendChild(pill("sky", "user", ` ${nameOf(state, g.askerId)}`, true));
  asker.appendChild(line(SHORT[g.askTeam] || "—", true));
  row.appendChild(asker);

  row.appendChild(withIcon("span", "ds-title ds-title--sm", "arrow"));

  const target = el("div", "ds-stack ds-stack--tight");
  target.appendChild(pill("coral", "user", ` ${nameOf(state, g.targetId)}`, true));
  target.appendChild(line(SHORT[g.askTeam === "a" ? "b" : "a"] || "—", true));
  row.appendChild(target);
  return row;
}

function renderVoteProgress(state, g) {
  const grid = el("div", "ds-cluster ds-cluster--center");
  if (g.mode === "ffa") {
    const total = Object.keys(state?.players || {}).length;
    grid.appendChild(pill("sky", "users", ` صوّت ${Object.keys(g.ballots?.all || {}).length} من ${total}`, true));
    return grid;
  }
  for (const team of ["a", "b"]) {
    const all = members(state, team);
    const voted = Object.keys(g.ballots?.[team] || {}).length;
    grid.appendChild(pill(team === "a" ? "sky" : "coral", "users", ` ${TEAM[team]}: ${voted} / ${all.length}`, true));
  }
  return grid;
}

function renderScore(g) {
  const row = el("div", "ds-cluster ds-cluster--center ds-cluster--tight");
  row.appendChild(pill("mint", "crown", ` ${SHORT.a} ${g.points?.a ?? 0}`, true));
  row.appendChild(pill("mint", "crown", ` ${SHORT.b} ${g.points?.b ?? 0}`, true));
  row.appendChild(pill("sun", "target", ` ${g.chances?.a ?? 0} / ${g.chances?.b ?? 0}`, true));
  return row;
}

function renderReveal(state, g) {
  const wrap = el("div", "ds-stack ds-stack--tight");
  wrap.appendChild(pill("dark", "shapes", ` الكلمة كانت: ${g.word || "—"}`, true));

  if (g.mode === "ffa") {
    wrap.appendChild(banner("info", "eye", `الغريب: ${nameOf(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
    wrap.appendChild(
      pill("coral", "crown", ` الفائز: ${g.winner === "players" ? "اللاعبون" : g.winner === "odd" ? "الغريب" : "بلا فائز"}`, true),
    );
  } else {
    wrap.appendChild(banner("info", "eye", `غريب ${SHORT.a}: ${nameOf(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
    wrap.appendChild(banner("info", "eye", `غريب ${SHORT.b}: ${nameOf(state, g.odd?.b)}`, `كلمته: ${g.oddWord?.b || "—"}`));
    wrap.appendChild(renderScore(g));
  }

  const history = Array.isArray(g.history) ? g.history : [];
  const rows = [];
  history.forEach((h) => {
    const votes = h?.votes && typeof h.votes === "object" ? h.votes : {};
    for (const [voterId, targetId] of Object.entries(votes)) {
      rows.push(targetId ? `${nameOf(state, voterId)} صوّت لـ ${nameOf(state, targetId)}` : `${nameOf(state, voterId)} تخطّى`);
    }
  });
  if (rows.length) {
    wrap.appendChild(withIcon("h2", "ds-title ds-title--sm", "lock", " كل التصويتات"));
    const list = el("ul", "ds-list");
    rows.slice(-10).forEach((text) => list.appendChild(el("li", "ds-list-item", text)));
    wrap.appendChild(list);
  }
  return wrap;
}