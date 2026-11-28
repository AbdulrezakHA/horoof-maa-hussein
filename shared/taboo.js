/**
 * لعبة «الكلمة الممنوعة» — منطق خالص (pure) مشترك بين الخادم والمتصفح.
 *
 * القواعد المعتمدة:
 *  - فريقان يتناوبان الأدوار. في كل دور يُختار شارح عشوائي من الفريق (بلا تكرار حتى يلعب الجميع).
 *  - على جوال الشارح فقط: الكلمة + الكلمات الممنوعة. فريقه لا يرى شيئاً، والفريق الآخر يرى الممنوعة فقط.
 *  - الشرح بالكلام فقط. خلال مدة الدور: كل كلمة صحيحة +1 وتظهر التالية فوراً.
 *  - أي مخالفة (كلمة ممنوعة، حرف، عدد حروف، قافية، ترجمة، إشارة، صوت، كتابة، عرض الجوال)
 *    = ⁦-1⁩ وينتهي الدور فوراً. النتيجة لا تنزل تحت الصفر.
 *  - لكل فريق عدد تخطّيات طوال اللعبة يحدّده الحكم (٠–١٠ أو بلا حدّ، افتراضياً ٢)، والشارح يتخطّى من جواله.
 *  - الحكم يرى بطاقة الدور الأولى قبل بدئه ويستطيع تبديلها (ترجع لآخر المجموعة)،
 *    وأثناء الدور له «تبديل مجاني» لا يُحسب من تخطّيات الفريق.
 *  - أول فريق يصل إلى حدّ الفوز يفوز.
 *
 * العشوائية (البطاقة التالية، الشارح، الفريق البادئ) يجهّزها الخادم ويمرّرها في payload.
 */

export const TABOO_FOULS = {
  word: "قال كلمة ممنوعة",
  letter: "ذكر حرفاً من الكلمة",
  count: "ذكر عدد الحروف",
  rhyme: "قافية أو تشابه صوتي",
  translate: "ترجمة إلى لغة أخرى",
  gesture: "إشارة أو تمثيل",
  sound: "تقليد صوت",
  writing: "كتابة أو رسم",
  show: "عرض الجوال",
  other: "مخالفة للقوانين",
};

export const TABOO_RULES = [
  "ممنوع قول الكلمة نفسها أو جزء منها أو أي كلمة من عائلتها",
  "ممنوع قول أي كلمة من الكلمات الممنوعة أو مشتقّاتها",
  "ممنوع ذكر حروف الكلمة: «تبدأ بحرف…» أو «آخرها…»",
  "ممنوع ذكر عدد الحروف أو المقاطع أو الكلمات",
  "ممنوع القافية والتشابه الصوتي: «على وزن…» أو «تشبه كلمة…»",
  "ممنوع الترجمة إلى أي لغة أخرى",
  "ممنوع الإشارات والتمثيل والإشارة إلى أشياء في المكان",
  "ممنوع تقليد الأصوات",
  "ممنوع الكتابة أو الرسم في الهواء أو على أي شيء",
  "ممنوع عرض الجوال على أي أحد",
];

/** قيمة «بلا حدّ» للتخطّيات (رقم لأن الحالة تُرسل JSON). */
export const UNLIMITED = -1;

/** نص قاعدة التخطّي بحسب إعداد اللعبة. */
export const skipsRule = (t) =>
  t.skipsPerGame === UNLIMITED ? "التخطّي بلا حدّ" : !t.skipsPerGame ? "لا تخطّي في هذه اللعبة" : `لكل فريق ${t.skipsPerGame} تخطّي طوال اللعبة`;

/** كم تخطّياً بقي للفريق (Infinity = بلا حدّ). */
export function skipsLeft(t, team) {
  if (t.skipsPerGame === UNLIMITED) return Infinity;
  return Math.max(0, (t.skipsPerGame ?? 2) - (t.skipsUsed?.[team] || 0));
}

function syncSkips(t) {
  for (const k of ["a", "b"]) t.skips[k] = t.skipsPerGame === UNLIMITED ? UNLIMITED : skipsLeft(t, k);
}

const IDLE = { running: false, total: 0, endsAt: 0, remaining: 0 };

export function createTaboo() {
  return {
    phase: "setup", // setup | rules | ready | turn | paused | turnEnd | over
    target: 10, // حدّ الفوز
    turnSeconds: 60, // مدة الدور
    skipsPerGame: 2, // التخطّي المسموح لكل فريق طوال اللعبة (UNLIMITED = بلا حدّ)
    packs: [], // المواضيع المفعّلة (فارغة = كل المواضيع)
    score: { a: 0, b: 0 },
    skips: { a: 2, b: 2 }, // المتبقّي (UNLIMITED = بلا حدّ) — يُشتقّ من skipsPerGame - skipsUsed
    skipsUsed: { a: 0, b: 0 },
    startTeam: null,
    turnTeam: null,
    describer: null, // { id, name, team }
    used: { a: [], b: [] }, // من شرح في هذه الدورة (لا يتكرّر حتى يلعب الجميع)
    card: null, // { id, word, forbidden: [], topic, icon }
    turnLog: [], // [{ word, result: 'right'|'skip'|'foul', reason? }]
    foul: null, // { reason, label } آخر مخالفة أنهت الدور
    timer: { ...IDLE },
    turn: 0, // عدد الأدوار (مفتاح تتبعه الجوالات)
    winner: null,
  };
}

export function cloneTaboo(t) {
  const x = t || createTaboo();
  return {
    ...x,
    packs: [...(x.packs || [])],
    score: { ...x.score },
    skips: { ...x.skips },
    // الحالات المحفوظة قبل skipsUsed: نشتقّه من المتبقّي
    skipsUsed: x.skipsUsed
      ? { ...x.skipsUsed }
      : {
          a: Math.max(0, (x.skipsPerGame ?? 2) - (x.skips?.a ?? 2)),
          b: Math.max(0, (x.skipsPerGame ?? 2) - (x.skips?.b ?? 2)),
        },
    describer: x.describer ? { ...x.describer } : null,
    used: { a: [...(x.used?.a || [])], b: [...(x.used?.b || [])] },
    card: x.card ? { ...x.card, forbidden: [...(x.card.forbidden || [])] } : null,
    turnLog: (x.turnLog || []).map((l) => ({ ...l })),
    foul: x.foul ? { ...x.foul } : null,
    timer: { ...x.timer },
  };
}

const other = (t) => (t === "a" ? "b" : "a");

function startTimer(secs) {
  const total = Math.max(1, Number(secs) || 60);
  return { running: true, total, endsAt: Date.now() + total * 1000, remaining: 0 };
}

function endTurn(t, foul = null) {
  t.timer = { ...IDLE };
  t.foul = foul;
  t.phase = "turnEnd";
}

function checkWin(t) {
  for (const team of ["a", "b"]) {
    if (t.score[team] >= t.target) {
      t.winner = team;
      t.phase = "over";
      t.timer = { ...IDLE };
      return team;
    }
  }
  return null;
}

/** يسجّل الشارح المختار (ويحدّث قائمة «من شرح»). */
function setDescriber(t, d) {
  if (!d || !d.id) {
    t.describer = null;
    return;
  }
  const team = d.team === "b" ? "b" : "a";
  if (d.resetUsed) t.used[team] = []; // الجميع شرحوا: دورة جديدة
  t.describer = { id: d.id, name: d.name || "لاعب", team };
  if (!t.used[team].includes(d.id)) t.used[team].push(d.id);
}

/**
 * يطبّق إجراء «الكلمة الممنوعة» على حالة السهرة `st` (يعدّلها مباشرة — الاستنساخ يتم قبلها).
 * يعيد نص سجلّ اختياري ونغمته، أو null.
 */
export function applyTaboo(st, type, p = {}) {
  if (!st.taboo) st.taboo = createTaboo();
  const t = st.taboo;
  const teamName = (k) => st.teams?.[k]?.name || (k === "a" ? "الفريق الأول" : "الفريق الثاني");

  switch (type) {
    // الإعدادات (حدّ الفوز، مدة الدور، المواضيع)
    case "tabooConfig": {
      if (Number.isFinite(Number(p.target))) t.target = Math.max(3, Math.min(50, Math.round(Number(p.target))));
      if (Number.isFinite(Number(p.turnSeconds))) t.turnSeconds = Math.max(20, Math.min(180, Math.round(Number(p.turnSeconds))));
      if (p.skipsPerGame != null && Number.isFinite(Number(p.skipsPerGame))) {
        const n = Math.round(Number(p.skipsPerGame));
        t.skipsPerGame = n < 0 ? UNLIMITED : Math.min(10, n);
        syncSkips(t); // يُطبَّق فوراً مع احتساب ما استُهلك
      }
      if (Array.isArray(p.packs)) t.packs = p.packs.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
      return null;
    }

    // لعبة جديدة: تصفير النقاط والتخطّيات، قرعة الفريق البادئ، وعرض القوانين على الشاشة
    case "tabooNew": {
      const keep = { target: t.target, turnSeconds: t.turnSeconds, skipsPerGame: t.skipsPerGame, packs: t.packs };
      const fresh = { ...createTaboo(), ...keep };
      fresh.skipsUsed = { a: 0, b: 0 };
      syncSkips(fresh);
      fresh.startTeam = p.startTeam === "b" ? "b" : "a";
      fresh.phase = "rules";
      st.taboo = fresh;
      return { text: `لعبة «الكلمة الممنوعة» جديدة — يبدأ ${teamName(fresh.startTeam)}`, tone: "info", icon: "hush" };
    }

    // بعد قراءة القوانين: الدور الأول للفريق البادئ مع شارح عشوائي
    case "tabooBegin": {
      if (t.phase !== "rules") return null;
      t.turnTeam = t.startTeam || "a";
      setDescriber(t, p.describer);
      t.card = p.card || null; // بطاقة الدور الأولى: يراها الحكم فقط قبل البدء
      t.turnLog = [];
      t.foul = null;
      t.phase = "ready";
      return null;
    }

    // 🎲 قرعة شارح جديدة (قبل بدء الدور)
    case "tabooPick": {
      if (t.phase !== "ready") return null;
      setDescriber(t, p.describer);
      return t.describer ? { text: `الشارح: ${t.describer.name}`, tone: t.describer.team, icon: "dice" } : null;
    }

    // 🔄 الحكم يبدّل بطاقة الدور قبل بدئه (القديمة ترجع لآخر المجموعة — يتولّاها الخادم)
    case "tabooSwap": {
      if (t.phase !== "ready" || !p.card) return null;
      t.card = p.card;
      return null;
    }

    // ▶️ بدء الدور: البطاقة الأولى (التي رآها الحكم) + العدّاد
    case "tabooStartTurn": {
      if (t.phase !== "ready" || !t.describer) return null;
      t.card = t.card || p.card || null;
      if (!t.card) return null;
      t.turnLog = [];
      t.foul = null;
      t.timer = startTimer(t.turnSeconds);
      t.turn += 1;
      t.phase = "turn";
      return { text: `${t.describer.name} يشرح لـ ${teamName(t.turnTeam)}`, tone: t.turnTeam, icon: "play" };
    }

    // ✅ صح: +1 والبطاقة التالية فوراً
    case "tabooRight": {
      if (t.phase !== "turn" || !t.card) return null;
      t.turnLog.push({ word: t.card.word, result: "right" });
      t.score[t.turnTeam] += 1;
      if (checkWin(t)) {
        return { text: `${teamName(t.winner)} وصل إلى ${t.target} وفاز!`, tone: "win", icon: "trophy" };
      }
      t.card = p.card || null;
      if (!t.card) endTurn(t);
      return null;
    }

    // ⏭ تخطّي (من جوال الشارح أو الحكم): من رصيد الفريق طوال اللعبة
    case "tabooSkip": {
      if (t.phase !== "turn" || !t.card) return null;
      const team = t.turnTeam;
      if (skipsLeft(t, team) <= 0) return null;
      if (!t.skipsUsed) t.skipsUsed = { a: 0, b: 0 };
      t.skipsUsed[team] += 1;
      syncSkips(t);
      t.turnLog.push({ word: t.card.word, result: "skip" });
      t.card = p.card || null;
      if (!t.card) endTurn(t);
      const left = skipsLeft(t, team);
      return { text: `تخطّي — بقي لـ ${teamName(team)} ${left === Infinity ? "∞" : left}`, tone: "warn", icon: "skip" };
    }

    // 🔄 تبديل مجاني من الحكم أثناء الدور (كلمة غامضة مثلاً): لا يُحسب من تخطّيات الفريق
    case "tabooPass": {
      if ((t.phase !== "turn" && t.phase !== "paused") || !t.card) return null;
      t.turnLog.push({ word: t.card.word, result: "pass" });
      t.card = p.card || null;
      if (!t.card) endTurn(t);
      return { text: "الحكم بدّل الكلمة (مجاناً)", tone: "info", icon: "swap" };
    }

    // 🚫 مخالفة: ⁦-1⁩ (لا تحت الصفر) وينتهي الدور فوراً
    case "tabooFoul": {
      if (t.phase !== "turn" && t.phase !== "paused") return null;
      const reason = TABOO_FOULS[p.reason] ? p.reason : "other";
      if (t.card) t.turnLog.push({ word: t.card.word, result: "foul", reason });
      t.score[t.turnTeam] = Math.max(0, t.score[t.turnTeam] - 1);
      endTurn(t, { reason, label: TABOO_FOULS[reason] });
      return { text: `ممنوع: ${TABOO_FOULS[reason]} — ⁦-1⁩ لـ ${teamName(t.turnTeam)}`, tone: "warn", icon: "ban" };
    }

    // انتهى وقت الدور
    case "tabooTimerEnd": {
      if (t.phase !== "turn" || !t.timer.running) return null;
      if (t.card) t.turnLog.push({ word: t.card.word, result: "timeout" });
      endTurn(t);
      const got = t.turnLog.filter((l) => l.result === "right").length;
      return { text: `انتهى الدور — ${teamName(t.turnTeam)} +${got}`, tone: "info", icon: "timer" };
    }

    // ⏸ إيقاف مؤقّت / ▶️ استئناف
    case "tabooPause": {
      if (t.phase !== "turn") return null;
      t.timer = { ...IDLE, total: t.timer.total, remaining: Math.max(0, t.timer.endsAt - Date.now()) };
      t.phase = "paused";
      return null;
    }
    case "tabooResume": {
      if (t.phase !== "paused") return null;
      const ms = Math.max(1000, t.timer.remaining || 1000);
      t.timer = { running: true, total: t.timer.total || t.turnSeconds, endsAt: Date.now() + ms, remaining: 0 };
      t.phase = "turn";
      return null;
    }

    // ➡️ الدور التالي: الفريق الآخر مع شارح عشوائي
    case "tabooNextTurn": {
      if (t.phase !== "turnEnd") return null;
      t.turnTeam = other(t.turnTeam || t.startTeam || "a");
      setDescriber(t, p.describer);
      t.card = p.card || null;
      t.turnLog = [];
      t.foul = null;
      t.phase = "ready";
      return null;
    }

    // الحكم يصحّح النتيجة يدوياً (±1)
    case "tabooAdjust": {
      const team = p.team === "b" ? "b" : "a";
      const d = Number(p.delta) > 0 ? 1 : -1;
      t.score[team] = Math.max(0, t.score[team] + d);
      if (t.phase !== "over") checkWin(t);
      return { text: `تعديل يدوي: ${teamName(team)} ${d > 0 ? "+1" : "⁦-1⁩"}`, tone: "warn", icon: "pen" };
    }

    default:
      return null;
  }
}

/** مَن مِن اللاعبين يستطيع الشرح لفريق معيّن (متصلون، وليسوا أجراس فرق قديمة). */
export function tabooCandidates(st, team, online) {
  const on = new Set(online || []);
  return Object.values(st.players || {}).filter((pl) => !pl.pseudo && pl.team === team && on.has(pl.id));
}

/** قرعة شارح: عشوائي بلا تكرار حتى يلعب كل أعضاء الفريق المتصلين. */
export function pickDescriber(st, team, online, rng = Math.random) {
  const pool = tabooCandidates(st, team, online);
  if (!pool.length) return null;
  const used = new Set(st.taboo?.used?.[team] || []);
  let fresh = pool.filter((pl) => !used.has(pl.id));
  let resetUsed = false;
  if (!fresh.length) {
    // الجميع شرحوا: دورة جديدة (يُصفّرها المحرّك عند التطبيق)
    resetUsed = true;
    fresh = pool;
  }
  // لا نكرّر الشارح الحالي إن وُجد غيره
  const cur = st.taboo?.describer?.id;
  const choices = fresh.length > 1 ? fresh.filter((pl) => pl.id !== cur) : fresh;
  const pick = choices[Math.floor(rng() * choices.length)];
  return { id: pick.id, name: pick.name, team, resetUsed };
}
