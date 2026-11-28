import { icon } from "./ds.js";

/* =========================================================================
   في بينا غريب — جوال اللاعب
   كل الجوالات متطابقة تماماً: كل لاعب يرى كلمته هو فقط، ولا يظهر على الشاشة
   أي شيء يدلّ على الغريب — ولا الغريب نفسه يعرف أنه غريب.
   ========================================================================= */

const SHORT = { a: "الأزرق", b: "الأحمر" };

let phone = {};
let hidden = true;

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
  node.appendChild(document.createTextNode(""));
  return node;
}

function btn(label, cls, onClick, opts = {}) {
  const node = withIcon("button", ["ds-btn", cls].filter(Boolean).join(" "), opts.iconName || "", label);
  node.type = "button";
  if (opts.disabled) node.disabled = true;
  node.addEventListener("click", onClick);
  return node;
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

function pill(tone, name, text) {
  return withIcon("span", `ds-pill ds-pill--${tone}`, name, text);
}

function myId() {
  const me = phone.me;
  return typeof me === "string" ? me : me?.id || "";
}

function myTeam(state, g) {
  const team = typeof phone.myTeam === "function" ? phone.myTeam() : phone.myTeam;
  if (team === "a" || team === "b") return team;
  if (g?.myTeam === "a" || g?.myTeam === "b") return g.myTeam;
  const me = myId();
  const teamFromState = state?.players?.[me]?.team;
  return teamFromState === "a" || teamFromState === "b" ? teamFromState : null;
}

function send(type, targetId) {
  phone?.sendRaw?.({ t: type, targetId: targetId || "" });
  phone?.sfx?.("tap");
  hidden = false;
  renderGhareebPhone(phone?.getState?.());
}

function nameOf(state, id) {
  return state?.players?.[id]?.name || "لاعب";
}

function roster(state, team) {
  return Object.values(state?.players || {}).filter((p) => p && p.team === team);
}

function hasVoted(state, g, team) {
  const me = myId();
  if (!me) return false;
  if (g.mode === "ffa") return Array.isArray(g.voted?.all) && g.voted.all.includes(me);
  if (!team) return false;
  return Array.isArray(g.voted?.[team]) && g.voted[team].includes(me);
}

/* ------------------------------ الرسم ------------------------------ */

export function initGhareebPhone(context) {
  phone = context || {};
}

export function renderGhareebPhone(state) {
  const host = document.getElementById("ghareebPhone");
  if (!host) return;
  const g = state?.ghareeb;
  host.replaceChildren();
  if (!g) return;

  const team = myTeam(state, g);

  if (g.phase === "setup" || g.phase === "rules") {
    host.appendChild(banner("info", "timer", "انتظر الحكم…", "سيوزّع الكلمات بعد قليل."));
    return;
  }

  if (g.phase === "over") {
    host.appendChild(withIcon("h2", "ds-title ds-title--sm", "shapes", ` الكلمة كانت: ${g.word || "—"}`));
    if (g.mode === "ffa") {
      host.appendChild(banner("info", "eye", `الغريب: ${nameOf(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
    } else {
      host.appendChild(banner("info", "eye", `غريب ${SHORT.a}: ${nameOf(state, g.odd?.a)}`, `كلمته: ${g.oddWord?.a || "—"}`));
      host.appendChild(banner("info", "eye", `غريب ${SHORT.b}: ${nameOf(state, g.odd?.b)}`, `كلمته: ${g.oddWord?.b || "—"}`));
    }
    return;
  }

  // كلمة اللاعب — تظهر له وحده
  host.appendChild(renderWordCard(g, team));

  if (g.phase === "deal") {
    host.appendChild(banner("info", "lock", "لا تُظهر جوالك لأحد", "اضغط على الكلمة لإخفائها في أي لحظة."));
    return;
  }

  if (g.phase === "turn") {
    const me = myId();
    if (g.askerId === me) host.appendChild(banner("success", "chat", "دورك في السؤال!", `اسأل ${nameOf(state, g.targetId)} سؤالاً عن الكلمة.`));
    else if (g.targetId === me) host.appendChild(banner("info", "chat", "دورك في الإجابة", `${nameOf(state, g.askerId)} يسألك الآن.`));
    else host.appendChild(banner("info", "timer", "استمع للأسئلة", "راقب إجابات الآخرين… كل كلمة قد تفضح الغريب."));
    return;
  }

  if (g.phase === "vote") {
    host.appendChild(
      banner("danger", "lock", "التصويت مفتوح", "اختيارك سرّي: لا أحد — ولا الحكم على الشاشة — يعلن من صوّت لمن."),
    );
    const done = hasVoted(state, g, team);
    if (done) {
      host.appendChild(banner("success", "check", "تم تسجيل تصويتك", "لا يمكنك التغيير. انتظر بقية اللاعبين."));
      return;
    }
    const targets =
      g.mode === "ffa"
        ? Object.values(state?.players || {}).filter((p) => p && p.id !== myId())
        : roster(state, team === "a" ? "b" : "a");
    host.appendChild(renderTargets(state, g, targets, "ghareebVote"));
    return;
  }

  if (g.phase === "p2") {
    host.appendChild(
      banner("danger", "bolt", "المرحلة الثانية", "سمِّ الغريب الذي داخلكم — محاولة واحدة فقط، فاختاروا بحكمة."),
    );
    const done = hasVoted(state, g, team);
    if (done) {
      host.appendChild(banner("success", "check", "تم تسجيل تصويتك", "انتظر بقية الفريق."));
      return;
    }
    const targets = roster(state, team).filter((p) => p.id !== myId());
    host.appendChild(renderTargets(state, g, targets, "ghareebP2Vote"));
    return;
  }

  if (g.phase === "result") {
    const r = g.lastResult || {};
    host.appendChild(banner(r.winner ? "success" : "info", r.winner ? "trophy" : "info", r.reason || "انتهت الجولة"));
    return;
  }

  if (g.phase === "guess") {
    host.appendChild(banner("info", "eye", "الغريب نجا هذه الجولة", "الحكم يسجّل تخمينه الآن."));
  }
}

function renderWordCard(g, team) {
  const card = el("div", "ds-card ds-stack ds-stack--tight");
  card.appendChild(withIcon("span", "ds-pill ds-pill--dark", "eye", " كلمتك"));
  card.appendChild(el("div", "ds-word", hidden ? "•••" : g.myWord || "—"));
  card.appendChild(
    btn(hidden ? "أظهر كلمتي" : "أخفِ كلمتي", "ds-btn--ghost ds-btn--sm", () => {
      hidden = !hidden;
      renderGhareebPhone(phone?.getState?.());
    }, { iconName: hidden ? "eye" : "hush" }),
  );
  if (team) card.appendChild(pill(team === "a" ? "sky" : "coral", "users", ` ${SHORT[team]}`));
  return card;
}

function renderTargets(state, g, targets, type) {
  void g;
  const wrap = el("div", "ds-stack ds-stack--tight");
  if (!targets.length) {
    wrap.appendChild(banner("info", "warning", "لا يوجد من تصوّت عليه", "انتظر الحكم."));
    return wrap;
  }
  for (const p of targets) {
    wrap.appendChild(
      btn(` ${p.name || "لاعب"}`, "ds-btn--ghost", () => send(type, p.id), { iconName: "hand" }),
    );
  }
  wrap.appendChild(btn(" تخطّي", "ds-btn--ghost ds-btn--sm", () => send(type, ""), { iconName: "skip" }));
  return wrap;
}