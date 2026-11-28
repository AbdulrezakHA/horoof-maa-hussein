/**
 * محرك اللعبة — منطق خالص (pure) مشترك بين الخادم والمتصفح.
 * لا يحتوي على أي I/O ليبقى قابلاً لإعادة الاستخدام على أي منصة استضافة.
 */
import { BASE_LETTERS, toBaseLetter } from "./letters.js";
import { DS_THEMES } from "./ds-theme.js";
import { createTaboo, cloneTaboo, applyTaboo } from "./taboo.js";

/** الألعاب المتاحة في السهرة (المفتاح ← الاسم). */
export const GAMES = {
  huroof: "حروف مع حسين",
  taboo: "الكلمة الممنوعة",
};

export const TEAM_IDS = ["a", "b"];

/* ------------------------------------------------------------------ */
/*  الهندسة: شبكة خلايا سداسية (pointy-top) بصفوف متبادلة الإزاحة       */
/* ------------------------------------------------------------------ */

/** أبعاد الخلية بالبكسل المنطقي. */
export function hexMetrics(width = 120) {
  const h = (width * 2) / Math.sqrt(3);
  return { w: width, h, rowStep: h * 0.75 };
}

/** مركز الخلية (r, c) بالبكسل المنطقي (الصفوف الزوجية 0, 2, 4 مزيحة نصف خلية لليمين كملف SVG). */
export function cellCenter(r, c, width = 120) {
  const { w, h, rowStep } = hexMetrics(width);
  return { x: c * w + (r % 2 === 0 ? w / 2 : 0), y: r * rowStep + h / 2 };
}

/** الجيران السداسيون. الصفوف الزوجية (0-indexed) مزيحة لليمين نصف خلية. */
export function neighborsOf(r, c) {
  const out = [];
  const push = (rr, cc) => out.push([rr, cc]);
  push(r, c - 1);
  push(r, c + 1);
  if (r % 2 === 0) {
    push(r - 1, c); push(r - 1, c + 1);
    push(r + 1, c); push(r + 1, c + 1);
  } else {
    push(r - 1, c - 1); push(r - 1, c);
    push(r + 1, c - 1); push(r + 1, c);
  }
  return out;
}

export function cellId(r, c) {
  return `r${r}c${c}`;
}

/* ------------------------------------------------------------------ */
/*  الحالة                                                              */
/* ------------------------------------------------------------------ */

export function createState(board) {
  const cells = {};
  for (const cell of board.cells) {
    cells[cell.id] = {
      id: cell.id,
      r: cell.r,
      c: cell.c,
      letter: cell.letter,
      owner: null, // null | 'a' | 'b'
    };
  }
  return {
    rev: 0,
    phase: "idle", // idle | question | awarded | over
    teams: {
      a: { name: board.teams.a?.name || "الفريق الأول", color: board.teams.a?.color || "#19a974", score: 0 },
      b: { name: board.teams.b?.name || "الفريق الثاني", color: board.teams.b?.color || "#e0453a", score: 0 },
    },
    theme: {
      ds: "hussein", // الثيم الأساسي (مفتاح في DS_THEMES)
      bgColor: "#fff8ea", // وجه لوحة السؤال (يمين الشاشة)
      bgSecondary: "#4b9cbf",
      accentBanner: "#6965ae",
      cellColor: "#ede5bb",
      cellBorderColor: "#070808",
      cellTextColor: "#635e48",
      selectedColor: "#fcb017",
      selectedTextColor: "#ffffff",
    },
    cells,
    current: {
      cellId: null,
      question: null, // { letter, answer, text }
      revealed: false, // هل السؤال ظاهر على الشاشة الكبيرة؟
      answerRevealed: false, // هل الجواب ظاهر على الشاشة الكبيرة؟
      turn: null, // 'a' | 'b' | 'open'
      // stage: 'manual' (مؤقّت الحكم) | 'answer' (لاعب يجيب بعد ضغط الجرس) | 'team' (دور الفريق الآخر)
      timer: { running: false, total: 0, endsAt: 0, stage: null },
      // الأجراس — نظام اللاعبين: كل لاعب جرسه على جواله، والسؤال يمرّ بثلاث جولات:
      //   ١) الجميع يفكّر بلا حدّ زمني ← أول من يضغط الجرس يجيب خلال `seconds`
      //   ٢) خطأ أو انتهى وقته ← الفريق الآخر يجيب بصوت عالٍ (بلا أجراس، محاولات بلا حدّ) خلال `otherSeconds`
      //   ٣) انتهى وقت الفريق الآخر ← مفتوح للجميع بلا أجراس وبلا وقت — الحكم يختار الفريق الفائز
      //   نقاط اللاعبين تُحسب من الجولة ١ فقط (الوحيدة التي نعرف فيها من أجاب).
      buzz: {
        enabled: true, // الميزة مفعّلة افتراضياً — وتُطفأ من إعدادات الحكم
        autoArm: true, // تُفتح تلقائياً عند كشف السؤال
        seconds: 3, // زمن إجابة أول ضاغط (الجولة ١)
        otherSeconds: 10, // زمن الجولة ٢ (دور الفريق الآخر)
        noRepeat: false, // اختياري: نفس اللاعب لا يضغط أولاً في سؤالين متتاليين
        open: false, // هل يمكن الضغط الآن؟
        winner: null, // فريق اللاعب الذي يجيب الآن: 'a' | 'b' | null
        at: 0, // وقت آخر ضغطة مقبولة (ms)
        stage: 0, // ٠ = لم تبدأ · ١ / ٢ / ٣ = الجولة الحالية
        // idle | open (الجولة ١: بانتظار ضغطة) | answer (الجولة ١: لاعب يجيب)
        // | team (الجولة ٢: دور الفريق الآخر) | all (الجولة ٣: مفتوح للجميع) | done (حُسم السؤال)
        phase: "idle",
        allowed: "all", // في الجولة ٢: الفريق صاحب الدور ('a' | 'b')، وإلا 'all'
        player: null, // من يجيب الآن في الجولة ١: { id, name, team }
        wrong: [], // (غير مستخدم حالياً — محجوز)
        history: [], // ضغطات الجولة ١: [{ id, name, team, stage, ms, result: null|'wrong'|'timeout'|'right' }]
        openedAt: 0, // متى فُتحت الأجراس (لحساب سرعة الضغط)
      },
      hintRevealed: false, // هل التلميح ظاهر على الشاشة؟
      // آخر نقطة أعلنها الحكم: { team, cellId, at } — تبني عليها الجوالات شاشة النتيجة
      verdict: null,
      // لم يُجب أحد: { cellId, at } — يُكشف الجواب على الشاشة بلا نقطة لأحد
      missed: null,
      // يزيد مع كل سؤال جديد (المفتاح الذي تراقبه جوالات اللاعبين)
      round: 0,
    },
    // مجموعات الأسئلة المختارة (فارغة = كل المجموعات الموجودة على القرص)
    presets: { active: [] },
    // ما يظهر على الشاشة الكبيرة — يتحكّم به الحكم من جواله
    screen: { lobby: true, sound: true, qr: "both" }, // qr: both | net | lan (أي رمز QR يظهر على التلفاز)
    // اللاعبون: { [id]: { id, name, team, score, correct, buzzes, fastest, pseudo? } }
    // (pseudo = جرس فريق كامل من الرابط القديم /buzzer?team=a — لا يظهر في قائمة اللاعبين)
    players: {},
    // السهرة: اللعبة الحالية (null = شاشة اختيار الألعاب) ونقاط السهرة (الفوز بأي لعبة = +1)
    game: null,
    night: { a: 0, b: 0 },
    taboo: createTaboo(),
    lastFirst: null, // أول من ضغط في السؤال السابق (لخيار «لا ضغط أول مرتين متتاليتين»)
    winner: null, // 'a' | 'b'
    log: [],
  };
}

function clone(state) {
  return {
    ...state,
    teams: {
      a: { ...state.teams.a },
      b: { ...state.teams.b },
    },
    theme: {
      ...state.theme,
    },
    cells: Object.fromEntries(
      Object.entries(state.cells).map(([k, v]) => [k, { ...v }])
    ),
    current: {
      ...state.current,
      timer: { ...state.current.timer },
      buzz: {
        ...(state.current.buzz || {}),
        wrong: [...(state.current.buzz?.wrong || [])],
        history: (state.current.buzz?.history || []).map((h) => ({ ...h })),
        player: state.current.buzz?.player ? { ...state.current.buzz.player } : null,
      },
      verdict: state.current.verdict ? { ...state.current.verdict } : null,
      missed: state.current.missed ? { ...state.current.missed } : null,
      question: state.current.question ? { ...state.current.question } : null,
    },
    presets: { active: [...(state.presets?.active || [])] },
    screen: { lobby: true, sound: true, qr: "both", ...(state.screen || {}) },
    players: Object.fromEntries(Object.entries(state.players || {}).map(([k, v]) => [k, { ...v }])),
    night: { a: 0, b: 0, ...(state.night || {}) },
    taboo: cloneTaboo(state.taboo),
    log: [...state.log],
  };
}

/** مؤقّت متوقف جاهز لإعادة الاستخدام. */
const IDLE_TIMER = { running: false, total: 0, endsAt: 0, stage: null };

/** يصفّر جولة السؤال: الأجراس + المؤقّت + النتيجة، ويعلّم «سؤال جديد». */
/** أجراس جديدة لسؤال جديد (تحتفظ بالإعدادات فقط). */
function freshBuzz(b) {
  return {
    ...b,
    open: false,
    winner: null,
    at: 0,
    stage: 0,
    phase: "idle",
    allowed: "all",
    player: null,
    wrong: [],
    history: [],
    openedAt: 0,
  };
}

function clearRound(st) {
  st.current.timer = { ...IDLE_TIMER };
  st.current.buzz = freshBuzz(st.current.buzz);
  st.current.hintRevealed = false;
  st.current.verdict = null;
  st.current.missed = null;
  st.current.turn = null;
  st.current.round = (st.current.round || 0) + 1;
}

/**
 * بعد منح النقطة: يُلغي تحديد الخلية (فيختفي التحديد الذهبي وتظهر ألوان الفرق فوراً)
 * مع إبقاء السؤال/الجواب ظاهرين على الشاشة، وإبقاء verdict لجوالات اللاعبين.
 */
function deselectAfterAward(st) {
  st.current.cellId = null;
}

/**
 * يكشف السؤال والجواب على الشاشة الكبيرة بعد حسم السؤال (نقطة لفريق أو لم يُجب أحد)
 * حتى يعرف الجميع الجواب الصحيح. يُخفى تلقائياً مع اختيار الحرف التالي.
 */
function revealAnswerAfterVerdict(st) {
  if (!st.current.question) return;
  st.current.revealed = true;
  st.current.answerRevealed = true;
}

/** يوقف المؤقّت ويغلق الأجراس (لا ضغطات بعد حسم السؤال). */
function stopRound(st) {
  st.current.timer = { ...IDLE_TIMER };
  st.current.buzz = { ...st.current.buzz, open: false, phase: st.current.buzz.stage ? "done" : "idle" };
  // (الجولة تبقى مسجّلة في stage لمعرفة أين حُسم السؤال)
  st.current.turn = null;
}

/* ------------------------------------------------------------------ */
/*  نظام اللاعبين: الجولات الثلاث                                      */
/* ------------------------------------------------------------------ */

const otherTeam = (t) => (t === "a" ? "b" : t === "b" ? "a" : null);

/** مؤقّت يعمل الآن لمدة معيّنة. */
function runTimer(secs, stage) {
  const total = Math.max(0, Number(secs) || 0);
  return total > 0
    ? { running: true, total, endsAt: Date.now() + total * 1000, stage }
    : { ...IDLE_TIMER };
}

/** الجولة ١: الأجراس مفتوحة للجميع — بلا حدّ زمني للتفكير. */
function openStage1(st) {
  const b = st.current.buzz;
  st.current.buzz = { ...b, open: true, stage: 1, phase: "open", allowed: "all", player: null, winner: null, openedAt: Date.now() };
  st.current.turn = null;
  st.current.timer = { ...IDLE_TIMER };
}

/** الجولة ٢: دور الفريق الآخر — يجيبون بصوت عالٍ (بلا أجراس) خلال `otherSeconds`. */
function openStage2(st, team) {
  const b = st.current.buzz;
  const secs = Math.max(3, Number(b.otherSeconds) || 10);
  st.current.buzz = { ...b, open: false, stage: 2, phase: "team", allowed: team, player: null, winner: team };
  st.current.turn = team;
  st.current.timer = runTimer(secs, "team");
  pushLog(st, `⏱️ الجولة ٢: دور ${st.teams[team].name} — ${secs} ثوانٍ`, team);
}

/** الجولة ٣: مفتوح للجميع بلا أجراس وبلا وقت — الحكم يختار الفريق الذي أجاب. */
function openStage3(st) {
  const b = st.current.buzz;
  st.current.buzz = { ...b, open: false, stage: 3, phase: "all", allowed: "all", player: null, winner: null };
  st.current.turn = "open";
  st.current.timer = { ...IDLE_TIMER };
  pushLog(st, "🔓 الجولة ٣: مفتوح للجميع", "warn");
}

/** خطأ أو انتهى وقت من ضغط في الجولة ١ → الجولة ٢ للفريق الآخر. */
function afterStage1Miss(st, result) {
  const b = st.current.buzz;
  const last = markLast(st, result);
  const team = last?.team || b.player?.team;
  pushLog(st, `${result === "wrong" ? "❌" : "⏳"} ${last?.name || "اللاعب"}: ${result === "wrong" ? "خطأ" : "انتهى الوقت"}`, "warn");
  openStage2(st, otherTeam(team) || "a");
}

/** يسجّل نتيجة آخر من أجاب (خطأ/انتهى الوقت/صح). */
function markLast(st, result) {
  const h = st.current.buzz.history;
  const last = h[h.length - 1];
  if (last && !last.result) last.result = result;
  return last;
}

/** إحصاءات اللاعب (تُنشأ عند أول استخدام). */
function ensurePlayer(st, id, { name, team, pseudo } = {}) {
  if (!st.players) st.players = {};
  if (!st.players[id]) {
    st.players[id] = { id, name: name || "لاعب", team: team === "b" ? "b" : "a", score: 0, correct: 0, buzzes: 0, fastest: null };
    if (pseudo) st.players[id].pseudo = true;
  }
  return st.players[id];
}

/** اسم لاعب فريد ونظيف. */
function cleanName(st, id, raw) {
  let name = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 24);
  if (!name) name = "لاعب";
  const taken = new Set(Object.values(st.players || {}).filter((p) => p.id !== id).map((p) => p.name));
  if (!taken.has(name)) return name;
  for (let i = 2; i < 100; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
  return `${name} ${Date.now() % 1000}`;
}

/**
 * يمنح الخلية لفريق ويحسب النقطة للاعب المناسب (إن وُجد).
 * يعيد false إن لم تكن هناك خلية.
 */
function doAward(st, board, cellId, team, creditId = null) {
  const cell = st.cells[cellId];
  if (!cell) return false;
  const previous = cell.owner;
  st.current.verdict = { team, cellId, at: Date.now(), playerId: creditId || null };
  st.current.missed = null;
  revealAnswerAfterVerdict(st);
  stopRound(st);

  const pl = creditId ? st.players?.[creditId] : null;
  if (pl) {
    pl.score += 1;
    pl.correct += 1;
    const h = st.current.buzz.history;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].id === creditId) {
        h[i].result = "right";
        break;
      }
    }
  }
  const who = pl && !pl.pseudo ? ` (${pl.name})` : "";

  if (previous === team) {
    pushLog(st, `${cell.letter} → ${st.teams[team].name}${who} (بدون تغيير)`, "info");
    deselectAfterAward(st);
    return true;
  }
  if (previous) st.teams[previous].score = Math.max(0, st.teams[previous].score - 1);
  cell.owner = team;
  st.teams[team].score += 1;
  st.phase = "awarded";
  pushLog(st, `${cell.letter} → ${st.teams[team].name}${who}${previous ? " (تعديل)" : ""}`, team);
  const w = findWinner(st, board);
  if (w) {
    st.winner = w;
    st.phase = "over";
    st.night[w] = (st.night[w] || 0) + 1;
    pushLog(st, `🏆 ${st.teams[w].name} ربط الطرفين! (+1 لنقاط السهرة)`, "win");
  }
  deselectAfterAward(st);
  return true;
}

/** نقطة اللاعب تُحسب فقط إن أجاب صح في الجولة ١ (بعد ضغط جرسه). */
function creditFor(st, team) {
  const b = st.current.buzz;
  if (b.stage === 1 && b.phase === "answer" && b.player && b.player.team === team) return b.player.id;
  return null;
}

function pushLog(state, text, tone = "info") {
  state.log.unshift({ at: Date.now(), text, tone });
  if (state.log.length > 40) state.log.length = 40;
}

/* ------------------------------------------------------------------ */
/*  فحص الفوز: ربط طرفي اللون                                            */
/* ------------------------------------------------------------------ */

/**
 * يتحقق إن كان أحد الفريقين قد ربط طرفيه.
 * goals = [["top"], ["bottom"]] => يجب ربط الحافة العلوية بالسفلية.
 */
export function findWinner(state, board) {
  for (const team of TEAM_IDS) {
    const goals = board.teams[team]?.goals;
    if (!Array.isArray(goals) || goals.length < 2) continue;

    const fromIds = board.edges?.[goals[0][0]] || [];
    const toIds = new Set(board.edges?.[goals[1][0]] || []);

    const seen = new Set();
    const queue = [];
    for (const id of fromIds) {
      const cell = state.cells[id];
      if (cell && cell.owner === team && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    while (queue.length) {
      const id = queue.shift();
      if (toIds.has(id)) return team;
      const cell = state.cells[id];
      if (!cell) continue;
      for (const [nr, nc] of neighborsOf(cell.r, cell.c)) {
        const nid = cellId(nr, nc);
        const n = state.cells[nid];
        if (n && n.owner === team && !seen.has(nid)) {
          seen.add(nid);
          queue.push(nid);
        }
      }
    }
  }
  return null;
}

/** يقدّم نسبة التقدّم لكل فريق (0..1) نحو ربط طرفيه — للعرض التقدمي. */
export function progressFor(state, board, team) {
  const goals = board.teams[team]?.goals;
  if (!Array.isArray(goals) || goals.length < 2) return { from: 0, to: 0 };
  const fromIds = board.edges?.[goals[0][0]] || [];
  const toIds = new Set(board.edges?.[goals[1][0]] || []);
  const owned = Object.values(state.cells).filter((c) => c.owner === team);
  if (!owned.length) return { from: 0, to: 0 };

  const bfs = (startIds) => {
    const seen = new Set();
    const queue = [];
    for (const id of startIds) {
      const cell = state.cells[id];
      if (cell && cell.owner === team && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    while (queue.length) {
      const id = queue.shift();
      const cell = state.cells[id];
      if (!cell) continue;
      for (const [nr, nc] of neighborsOf(cell.r, cell.c)) {
        const nid = cellId(nr, nc);
        const n = state.cells[nid];
        if (n && n.owner === team && !seen.has(nid)) {
          seen.add(nid);
          queue.push(nid);
        }
      }
    }
    return seen;
  };

  const fromSet = bfs(fromIds);
  const reachedTo = [...fromSet].filter((id) => toIds.has(id)).length;
  return {
    from: Math.min(1, fromSet.size / Math.max(1, owned.length)),
    to: Math.min(1, reachedTo / Math.max(1, toIds.size)),
    linked: reachedTo > 0,
  };
}

/* ------------------------------------------------------------------ */
/*  المُقلِّد (reducer)                                                  */
/* ------------------------------------------------------------------ */

/**
 * يطبّق إجراءً على الحالة ويعيد حالة جديدة.
 * الإجراءات التي تحتاج عشوائية (اختيار السؤال) يجهّزها الخادم ويمرّرها هنا.
 */
export function applyAction(state, board, action) {
  const st = clone(state);
  const type = action?.type;
  const p = action?.payload || {};

  // ---------------- السهرة: اختيار اللعبة ونقاطها ----------------
  if (type === "setGame") {
    st.game = GAMES[p.game] ? p.game : null;
    // أول دخول للكلمة الممنوعة (أو بعد انتهاء لعبة سابقة): تُجهَّز لعبة جديدة بشاشة القوانين
    if (st.game === "taboo" && (st.taboo.phase === "setup") && p.startTeam) {
      applyTaboo(st, "tabooNew", { startTeam: p.startTeam });
    }
    pushLog(st, st.game ? `🎮 اللعبة الآن: ${GAMES[st.game]}` : "🎮 العودة إلى قائمة الألعاب", "info");
    st.rev = state.rev + 1;
    return st;
  }
  if (type === "nightReset") {
    st.night = { a: 0, b: 0 };
    pushLog(st, "🏆 صُفّرت نقاط السهرة", "warn");
    st.rev = state.rev + 1;
    return st;
  }
  if (typeof type === "string" && type.startsWith("taboo")) {
    const before = st.taboo?.winner || null;
    const log = applyTaboo(st, type, p);
    const w = st.taboo.winner;
    if (w && w !== before) st.night[w] = (st.night[w] || 0) + 1;
    if (log) pushLog(st, log.text, log.tone);
    st.rev = state.rev + 1;
    return st;
  }

  switch (type) {
    case "select": {
      const cell = st.cells[p.cellId];
      if (!cell) return st;
      const sameCell = st.current.cellId === p.cellId;
      st.current.cellId = p.cellId;
      if (!sameCell) st.current.question = p.question || null;
      else if (p.question) st.current.question = p.question;
      st.current.revealed = false;
      st.current.answerRevealed = false;
      clearRound(st);
      st.phase = "question";
      pushLog(st, `تم اختيار الخلية (${cell.letter})`, "info");
      break;
    }

    case "clear": {
      st.current.cellId = null;
      st.current.question = null;
      st.current.revealed = false;
      st.current.answerRevealed = false;
      clearRound(st);
      st.phase = st.winner ? "over" : "idle";
      pushLog(st, "تم إلغاء الاختيار", "info");
      break;
    }

    case "reveal": {
      st.current.revealed = true;
      st.phase = "question";
      // إذا كانت الأجراس مفعّلة، تُفتح الجولة ١ تلقائياً مع كشف السؤال
      // (مرة واحدة لكل سؤال — لا نعيد فتحها إن بدأت الجولات بالفعل)
      const b = st.current.buzz;
      if (b.enabled && b.autoArm && !b.stage) {
        openStage1(st);
      }
      break;
    }

    case "revealHint": {
      if (st.current.question?.hint) st.current.hintRevealed = true;
      break;
    }

    case "hideHint": {
      st.current.hintRevealed = false;
      break;
    }

    case "hide": {
      st.current.revealed = false;
      st.current.answerRevealed = false;
      break;
    }

    case "revealAnswer": {
      st.current.answerRevealed = true;
      break;
    }

    case "hideAnswer": {
      st.current.answerRevealed = false;
      break;
    }

    case "setQuestion": {
      st.current.question = p.question || null;
      st.current.revealed = false;
      st.current.answerRevealed = false;
      clearRound(st); // سؤال جديد = أجراس ومؤقّت جديدان (بلا تدخّل من الحكم)
      st.phase = "question";
      break;
    }

    case "award": {
      const team = p.team === "b" ? "b" : "a";
      if (!doAward(st, board, p.cellId, team, creditFor(st, team))) return st;
      break;
    }

    // لم يُجب أحد: يُكشف الجواب على الشاشة بلا نقطة لأحد، وتبقى الخلية حرّة
    case "noPoint": {
      const id = p.cellId || st.current.cellId;
      const cell = st.cells[id];
      if (!cell) return st;
      st.current.missed = { cellId: id, at: Date.now() };
      st.current.verdict = null;
      revealAnswerAfterVerdict(st);
      stopRound(st);
      st.current.cellId = null;
      if (!st.winner) st.phase = "missed";
      const ans = st.current.question?.answer;
      pushLog(st, `🤷 ${cell.letter}: لم يُجب أحد${ans ? ` — الجواب: ${ans}` : ""}`, "warn");
      break;
    }

    // التحكم بالشاشة الكبيرة من جوال الحكم: قائمة البداية (رموز QR) وصوت الشاشة
    case "screen": {
      const scr = { lobby: true, sound: true, qr: "both", ...(st.screen || {}) };
      if (typeof p.lobby === "boolean") scr.lobby = p.lobby;
      if (typeof p.sound === "boolean") scr.sound = p.sound;
      if (["both", "net", "lan"].includes(p.qr)) scr.qr = p.qr;
      st.screen = scr;
      break;
    }

    case "unclaim": {
      const cell = st.cells[p.cellId];
      if (!cell || !cell.owner) return st;
      const prev = cell.owner;
      cell.owner = null;
      st.teams[prev].score = Math.max(0, st.teams[prev].score - 1);
      st.current.verdict = null;
      pushLog(st, `تم إزالة ${cell.letter} من ${st.teams[prev].name}`, "warn");
      break;
    }

    case "setTurn": {
      st.current.turn = p.turn;
      break;
    }

    case "startTimer": {
      const total = Math.max(0, Number(p.seconds) || 0);
      st.current.timer = {
        running: total > 0,
        total,
        endsAt: Date.now() + total * 1000,
        stage: "manual",
      };
      break;
    }

    case "stopTimer": {
      st.current.timer = { ...IDLE_TIMER };
      break;
    }

    // انتهى الوقت:
    //  - لاعب ضغط الجرس في الجولة ١ ولم يحكم الحكم → «انتهى الوقت» → الجولة ٢ للفريق الآخر
    //  - انتهى وقت الفريق الآخر (الجولة ٢) → الجولة ٣ مفتوحة للجميع بلا وقت
    //  - مؤقّت الحكم اليدوي → يتوقف فقط
    case "timerEnd": {
      const t = st.current.timer;
      if (!t.running) break;
      const b = st.current.buzz;

      if (t.stage === "answer" && b.phase === "answer") {
        afterStage1Miss(st, "timeout");
        break;
      }

      if (t.stage === "team" && b.phase === "team") {
        pushLog(st, `⏳ انتهى وقت ${st.teams[b.allowed]?.name || "الفريق"}`, "warn");
        openStage3(st);
        break;
      }

      st.current.timer = { ...IDLE_TIMER };
      st.current.turn = null;
      if (st.phase === "question") st.phase = "timeout";
      pushLog(st, "⏰ انتهى الوقت", "warn");
      break;
    }

    /* ---------------- أجراس الجوال ---------------- */

    // إعدادات الأجراس: التفعيل، الفتح التلقائي، والمدد
    case "buzzConfig": {
      const b = st.current.buzz;
      if (typeof p.enabled === "boolean") b.enabled = p.enabled;
      if (typeof p.autoArm === "boolean") b.autoArm = p.autoArm;
      if (typeof p.noRepeat === "boolean") b.noRepeat = p.noRepeat;
      if (Number.isFinite(Number(p.seconds))) {
        b.seconds = Math.max(3, Math.min(120, Math.round(Number(p.seconds))));
      }
      if (Number.isFinite(Number(p.otherSeconds))) {
        b.otherSeconds = Math.max(5, Math.min(120, Math.round(Number(p.otherSeconds))));
      }
      if (!b.enabled) {
        st.current.buzz = freshBuzz(b);
        if (st.current.timer.stage !== "manual") st.current.timer = { ...IDLE_TIMER };
      }
      break;
    }

    // الحكم يفتح الأجراس يدوياً (تبدأ الجولة ١ من جديد للجميع)
    case "buzzOpen": {
      if (!st.current.buzz.enabled) break;
      st.current.buzz = { ...st.current.buzz, wrong: [], history: [] };
      openStage1(st);
      pushLog(st, "🔔 الأجراس مفتوحة — اضغطوا الآن!", "warn");
      break;
    }

    // 🔒 إغلاق الأجراس: يوقف الضغط والمهلة (من يجيب الآن يُكمل)
    case "buzzClose": {
      const b = st.current.buzz;
      // يغلق الأجراس فقط (في الجولة ١ قبل أي ضغطة) — لا يؤثر على دور يجري الآن
      if (b.phase !== "open") break;
      st.current.buzz = { ...b, open: false, phase: "idle", stage: 0 };
      pushLog(st, "🔒 أُغلقت الأجراس", "warn");
      break;
    }

    // إعادة تصفير الأجراس دون فتحها (الحكم يريد إعادة السؤال من الصفر)
    case "buzzReset": {
      st.current.buzz = freshBuzz(st.current.buzz);
      st.current.timer = { ...IDLE_TIMER };
      st.current.turn = null;
      st.current.verdict = null;
      pushLog(st, "↺ أُعيدت الأجراس", "warn");
      break;
    }

    // ضغطة جرس من لاعب (أو من جرس فريق قديم: id = "team:a")
    case "playerBuzz": {
      const b = st.current.buzz;
      const id = String(p.id || "");
      // الأجراس تعمل في الجولة ١ فقط
      if (!b.enabled || !b.open || b.phase !== "open" || b.stage !== 1 || !id) break;
      let pl = st.players?.[id];
      if (!pl && id.startsWith("team:")) {
        const t = id.slice(5) === "b" ? "b" : "a";
        pl = ensurePlayer(st, id, { name: st.teams[t].name, team: t, pseudo: true });
      }
      if (!pl) break;
      if (b.noRepeat && st.lastFirst === id && !pl.pseudo) break;

      const at = Number(p.at) || Date.now();
      const ms = b.openedAt ? Math.max(0, at - b.openedAt) : null;
      pl.buzzes += 1;
      if (ms != null && (pl.fastest == null || ms < pl.fastest)) pl.fastest = ms;
      st.lastFirst = id;

      const secs = Number(st.current.question?.seconds) || b.seconds;
      st.current.buzz = {
        ...b,
        open: false,
        phase: "answer",
        winner: pl.team,
        at,
        player: { id, name: pl.name, team: pl.team },
        history: [...b.history, { id, name: pl.name, team: pl.team, stage: b.stage, ms, result: null }],
      };
      st.current.turn = pl.team;
      st.current.verdict = null;
      st.current.timer = runTimer(Math.max(1, Math.min(120, secs)), "answer");
      pushLog(st, `🔔 ${pl.pseudo ? st.teams[pl.team].name : pl.name} ضغط أولاً!`, pl.team);
      break;
    }

    // ✅ صح:
    //  - الجولة ١: النقطة لفريق من ضغط، وتُحسب للاعب نفسه
    //  - الجولة ٢: النقطة للفريق صاحب الدور فقط
    //  - الجولة ٣: الحكم يختار الفريق (p.team) — بلا نقطة للاعبين
    case "buzzCorrect": {
      const b = st.current.buzz;
      const cellId = p.cellId || st.current.cellId;
      if (b.stage === 1 && b.phase === "answer" && b.player) {
        if (!doAward(st, board, cellId, b.player.team, b.player.id)) return st;
      } else if (b.stage === 2 && b.phase === "team") {
        if (!doAward(st, board, cellId, b.allowed, null)) return st;
      } else if (b.stage === 3 && b.phase === "all" && (p.team === "a" || p.team === "b")) {
        if (!doAward(st, board, cellId, p.team, null)) return st;
      } else {
        break;
      }
      break;
    }

    // ❌ خطأ: فقط لمن ضغط الجرس في الجولة ١ — يقطع وقته فوراً ويبدأ دور الفريق الآخر
    case "buzzWrong": {
      const b = st.current.buzz;
      if (!b.enabled || b.stage !== 1 || b.phase !== "answer" || !b.player) break;
      afterStage1Miss(st, "wrong");
      break;
    }

    /* ---------------- اللاعبون ---------------- */

    case "playerJoin": {
      const id = String(p.id || "");
      if (!id || id.startsWith("team:")) break;
      const team = p.team === "b" ? "b" : "a";
      const pl = ensurePlayer(st, id, { team });
      const name = cleanName(st, id, p.name);
      const isNew = pl.name !== name || pl.team !== team;
      pl.name = name;
      pl.team = team;
      if (isNew) pushLog(st, `👋 ${name} انضمّ إلى ${st.teams[team].name}`, team);
      break;
    }

    // الحكم ينقل لاعباً إلى الفريق الآخر
    case "playerSetTeam": {
      const pl = st.players?.[p.id];
      if (!pl || pl.pseudo) break;
      pl.team = p.team === "b" ? "b" : "a";
      pushLog(st, `↔ ${pl.name} انتقل إلى ${st.teams[pl.team].name}`, pl.team);
      break;
    }

    case "playerRemove": {
      const pl = st.players?.[p.id];
      if (!pl) break;
      delete st.players[p.id];
      if (!pl.pseudo) pushLog(st, `🚪 أُخرج ${pl.name} من اللعبة`, "warn");
      break;
    }

    /* ---------------- الشبكة ---------------- */

    // 🔀 خلط الحروف الحرّة فقط (الخلايا المملوكة والنقاط تبقى كما هي)
    case "shuffle": {
      const owned = new Set(Object.values(st.cells).filter((c) => c.owner).map((c) => c.letter));
      const pool = BASE_LETTERS.filter((l) => !owned.has(l));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      let k = 0;
      for (const cell of Object.values(st.cells)) {
        if (!cell.owner) cell.letter = pool[k++] || cell.letter;
      }
      st.current.cellId = null;
      st.current.question = null;
      st.current.revealed = false;
      st.current.answerRevealed = false;
      clearRound(st);
      st.phase = st.winner ? "over" : "idle";
      pushLog(st, "🔀 خُلطت الحروف الحرّة", "info");
      break;
    }

    case "setTeam": {
      const team = p.team === "b" ? "b" : "a";
      if (typeof p.name === "string" && p.name.trim()) st.teams[team].name = p.name.trim().slice(0, 40);
      if (typeof p.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(p.color)) st.teams[team].color = p.color;
      break;
    }

    case "setTheme": {
      if (p && typeof p === "object") {
        for (const [key, val] of Object.entries(p)) {
          if (key === "ds") {
            if (typeof val === "string" && Object.hasOwn(DS_THEMES, val)) st.theme.ds = val;
            continue;
          }
          if (typeof val === "string" && /^#[0-9a-fA-F]{3,8}$/.test(val)) {
            st.theme[key] = val;
          }
        }
      }
      break;
    }

    case "setLetter": {
      const cell = st.cells[p.cellId];
      if (cell && typeof p.letter === "string") {
        // الحرف يُردّ دائماً إلى أصله من الحروف الأساسية (ؤ ← و، ى ← ي، ة ← ه …)
        const raw = p.letter.trim();
        cell.letter = raw ? toBaseLetter(raw[0]) || raw.slice(0, 2) : "";
      }
      break;
    }

    case "declareWinner": {
      st.winner = p.team === "a" || p.team === "b" ? p.team : null;
      st.phase = st.winner ? "over" : st.current.cellId ? "question" : "idle";
      break;
    }

    // اختيار مجموعات الأسئلة المفعّلة (الخادم يعيد بناء البنك بعدها)
    case "presets": {
      const list = Array.isArray(p.active) ? p.active : [];
      st.presets = { active: list.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) };
      pushLog(
        st,
        st.presets.active.length
          ? `📚 مجموعات الأسئلة: ${st.presets.active.join(" + ")}`
          : "📚 مجموعات الأسئلة: الكل",
        "info"
      );
      break;
    }

    case "reset": {
      // جولة جديدة: ٢٥ حرفاً عشوائياً من الـ٢٨ في مواقع عشوائية (تدور كل الحروف مع الجولات)
      const clean = normalizeBoardLetters(board);
      const fresh = createState(p.shuffle === false ? clean : randomBoardLetters(clean));
      fresh.presets = { active: [...(st.presets?.active || [])] };
      fresh.teams.a.name = st.teams.a.name;
      fresh.teams.a.color = st.teams.a.color;
      fresh.teams.b.name = st.teams.b.name;
      fresh.teams.b.color = st.teams.b.color;
      fresh.theme = { ...st.theme };
      fresh.screen = { ...st.screen };
      fresh.current.buzz = freshBuzz(st.current.buzz);
      // اللاعبون يبقون في فرقهم، وتُصفَّر نقاطهم وإحصاءاتهم
      fresh.game = st.game;
      fresh.night = { ...st.night };
      fresh.taboo = cloneTaboo(st.taboo);
      fresh.players = Object.fromEntries(
        Object.entries(st.players || {}).map(([id, pl]) => [
          id,
          { ...pl, score: 0, correct: 0, buzzes: 0, fastest: null },
        ])
      );
      fresh.rev = st.rev + 1;
      pushLog(fresh, "جولة جديدة", "info");
      return fresh;
    }

    case "loadBoard": {
      const fresh = createState(normalizeBoardLetters(p.board));
      fresh.presets = { active: [...(st.presets?.active || [])] };
      fresh.teams.a.name = st.teams.a.name;
      fresh.teams.a.color = st.teams.a.color;
      fresh.teams.b.name = st.teams.b.name;
      fresh.teams.b.color = st.teams.b.color;
      fresh.theme = { ...st.theme };
      fresh.screen = { ...st.screen };
      fresh.players = Object.fromEntries(Object.entries(st.players || {}).map(([k, v]) => [k, { ...v }]));
      fresh.game = st.game;
      fresh.night = { ...st.night };
      fresh.taboo = cloneTaboo(st.taboo);
      fresh.current.buzz = freshBuzz(st.current.buzz);
      fresh.rev = st.rev + 1;
      return fresh;
    }

    default:
      return st;
  }

  st.rev = state.rev + 1;
  return st;
}

/* ------------------------------------------------------------------ */
/*  اختيار الأسئلة                                                     */
/* ------------------------------------------------------------------ */

/** ترتيب أولويات الحروف عند البحث عن سؤال (بعض الحروف لا تملك أسئلة). */
export const LETTER_FALLBACKS = {
  ة: ["ت", "ه"],
  ء: ["ا", "ه"],
  ئ: ["ي", "ا"],
  ؤ: ["و", "ا"],
  ى: ["ي", "ا"],
  أ: ["ا", "ه"],
  إ: ["ا", "ه"],
  آ: ["ا", "ه"],
  ه: ["ه"],
};

/**
 * يختار سؤالاً لحرف معيّن مع تجنّب التكرار قدر الإمكان.
 * `pools` خريطة تُحفظ في ذاكرة الخادم: { [letter]: { queue: [], cursor } }
 */
export function pickQuestion(bank, letter, pools) {
  const candidates = [];
  if (bank[letter]) candidates.push(letter);
  for (const alt of LETTER_FALLBACKS[letter] || []) if (!candidates.includes(alt)) candidates.push(alt);

  const key = candidates.find((c) => bank[c] && bank[c].length);
  if (!key) return null;

  const list = bank[key];
  let pool = pools[key];
  if (!pool) {
    pool = { queue: shuffle(list.map((_, i) => i)), cursor: 0 };
    pools[key] = pool;
  }
  if (pool.cursor >= pool.queue.length) {
    pool.queue = shuffle(list.map((_, i) => i));
    pool.cursor = 0;
  }
  const item = list[pool.queue[pool.cursor++]];
  const out = { letter, bankKey: key, answer: item.answer, text: item.text };
  // حقول إضافية تُحمل من المجموعة (جاهزة لتحديث قادم، لا تؤثّر على اللعب حالياً)
  if (item.preset) out.preset = item.preset;
  if (item.points) out.points = item.points;
  if (item.seconds) out.seconds = item.seconds;
  if (item.hint) out.hint = item.hint;
  if (item.category) out.category = item.category;
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * يطبّع حروف اللوحة: كل حرف يُردّ إلى أصله من الحروف الأساسية الثمانية والعشرين
 * (أ/إ/آ/ء ← ا، ؤ ← و، ئ/ى ← ي، ة ← ه …) ثم يمنع تكرار أي حرف في الشبكة،
 * فيكمل النقص من الحروف الأساسية غير المستخدمة بترتيب ثابت.
 * لا يغيّر شيئاً في لوحة نظيفة أصلاً (نفس المعرّفات ونفس الترتيب).
 */
export function normalizeBoardLetters(board) {
  if (!board || !Array.isArray(board.cells)) return board;

  const cells = board.cells.map((cell) => {
    const raw = String(cell.letter ?? "").trim();
    if (!raw) return { ...cell, letter: "" };
    // الحروف العربية تُردّ إلى أصلها، وأي حرف غريب (لاتيني مثلاً) يبقى كما هو.
    return { ...cell, letter: toBaseLetter(raw[0]) || raw.slice(0, 2) };
  });

  // أول ظهور لكل حرف يبقى في مكانه، والتكرار يأخذ أول حرف أساسي غير مستخدم.
  const used = new Set();
  const spare = BASE_LETTERS.filter((l) => !cells.some((c) => c.letter === l));
  let k = 0;
  for (let i = 0; i < cells.length; i++) {
    const letter = cells[i].letter;
    if (!letter) continue;
    if (!used.has(letter)) {
      used.add(letter);
      continue;
    }
    if (k < spare.length) {
      used.add(spare[k]);
      cells[i] = { ...cells[i], letter: spare[k++] };
    } else {
      cells[i] = { ...cells[i], letter: "" };
    }
  }

  return { ...board, cells };
}

/**
 * يوزّع على خلايا اللوحة حروفاً أساسية **عشوائية**: كل جولة تُختار ٢٥ حرفاً (بعدد الخلايا)
 * من الـ٢٨ بالقرعة، فلا تبقى نفس ثلاثة حروف خارج الشبكة في كل مرة، ولا يتكرّر أي حرف.
 * يقبل مولّد أرقام عشوائي بديل (rng) لتسهيل الاختبار.
 */
export function randomBoardLetters(board, rng = Math.random) {
  if (!board || !Array.isArray(board.cells)) return board;

  const pool = [...BASE_LETTERS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  return {
    ...board,
    cells: board.cells.map((cell, i) => ({ ...cell, letter: i < pool.length ? pool[i] : "" })),
  };
}

/**
 * يتحقق أن الشبكة سليمة: حروف أساسية فقط وبلا تكرار (يُستخدم في الاختبارات والفحص).
 */
export function boardLettersReport(board) {
  const letters = (board?.cells || []).map((c) => String(c.letter ?? "")).filter(Boolean);
  const nonBase = letters.filter((l) => !BASE_LETTERS.includes(l));
  const dupes = letters.filter((l, i) => letters.indexOf(l) !== i);
  return { letters, nonBase, dupes, unique: new Set(letters).size };
}

/**
 * يخلط توزيع الحروف على الخلايا (مع الحفاظ على مواضع الخلايا وعدد كل حرف).
 * يُستخدم في كل جولة جديدة حتى لا تتكرّر نفس اللوحة دائماً.
 */
export function shuffleBoardLetters(board) {
  const letters = shuffle(board.cells.map((c) => c.letter));
  return {
    ...board,
    cells: board.cells.map((cell, i) => ({ ...cell, letter: letters[i] })),
  };
}

/** يتحقق إن كان للحرف سؤال متاح (لعرض تنبيه في واجهة الحكم). */
export function hasQuestionsFor(bank, letter) {
  const candidates = [letter, ...(LETTER_FALLBACKS[letter] || [])];
  return candidates.some((c) => bank[c] && bank[c].length);
}
