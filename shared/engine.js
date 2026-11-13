/**
 * محرك اللعبة — منطق خالص (pure) مشترك بين الخادم والمتصفح.
 * لا يحتوي على أي I/O ليبقى قابلاً لإعادة الاستخدام على أي منصة استضافة.
 */
import { BASE_LETTERS, toBaseLetter } from "./letters.js";

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
      a: { name: board.teams.a?.name || "الفريق الأول", color: board.teams.a?.color || "#6965ae", score: 0 },
      b: { name: board.teams.b?.name || "الفريق الثاني", color: board.teams.b?.color || "#4b9cbf", score: 0 },
    },
    theme: {
      bgColor: "#73c4ee",
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
      // stage: 'manual' (الحكم) | 'buzz1' (من ضغط أولاً) | 'buzz2' (اللاعب الثاني)
      timer: { running: false, total: 0, endsAt: 0, stage: null },
      // أجراس الجوال: أول ضغطة تفوز وتشغّل المؤقّت تلقائياً
      buzz: {
        enabled: true, // الميزة مفعّلة افتراضياً (تجربة تلقائية) — وتُطفأ من إعدادات الحكم
        autoArm: true, // تُفتح تلقائياً عند كشف السؤال
        seconds: 3, // مدة اللاعب الذي ضغط أولاً
        otherSeconds: 10, // مدة اللاعب الثاني (تبدأ تلقائياً بعد الأولى)
        open: false, // هل يمكن الضغط الآن؟
        winner: null, // 'a' | 'b' | null
        at: 0, // وقت أول ضغطة (ms)
      },
      // آخر نقطة أعلنها الحكم: { team, cellId, at } — تبني عليها الجوالات شاشة النتيجة
      verdict: null,
      // يزيد مع كل سؤال جديد (المفتاح الذي تراقبه جوالات اللاعبين)
      round: 0,
    },
    // مجموعات الأسئلة المختارة (فارغة = كل المجموعات الموجودة على القرص)
    presets: { active: [] },
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
      buzz: { ...(state.current.buzz || {}) },
      verdict: state.current.verdict ? { ...state.current.verdict } : null,
      question: state.current.question ? { ...state.current.question } : null,
    },
    presets: { active: [...(state.presets?.active || [])] },
    log: [...state.log],
  };
}

/** مؤقّت متوقف جاهز لإعادة الاستخدام. */
const IDLE_TIMER = { running: false, total: 0, endsAt: 0, stage: null };

/** يصفّر جولة السؤال: الأجراس + المؤقّت + النتيجة، ويعلّم «سؤال جديد». */
function clearRound(st) {
  st.current.timer = { ...IDLE_TIMER };
  st.current.buzz = { ...st.current.buzz, open: false, winner: null, at: 0 };
  st.current.verdict = null;
  st.current.turn = null;
  st.current.round = (st.current.round || 0) + 1;
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
      // إذا كانت الأجراس مفعّلة، تُفتح تلقائياً مع كشف السؤال
      // (لا نعيد فتحها إن كان هناك فائز بالفعل — تُصفَّر مع سؤال جديد)
      const b = st.current.buzz;
      if (b.enabled && b.autoArm && !b.winner) {
        st.current.buzz = { ...b, open: true, at: 0 };
      }
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
      const cell = st.cells[p.cellId];
      if (!cell) return st;
      const team = p.team === "b" ? "b" : "a";
      const previous = cell.owner;
      st.current.verdict = { team, cellId: p.cellId, at: Date.now() };
      if (previous === team) {
        pushLog(st, `${cell.letter} → ${st.teams[team].name} (بدون تغيير)`, "info");
        break;
      }
      if (previous) st.teams[previous].score = Math.max(0, st.teams[previous].score - 1);
      cell.owner = team;
      st.teams[team].score += 1;
      st.phase = "awarded";
      pushLog(
        st,
        `${cell.letter} → ${st.teams[team].name}${previous ? " (تعديل)" : ""}`,
        team
      );
      const w = findWinner(st, board);
      if (w) {
        st.winner = w;
        st.phase = "over";
        pushLog(st, `🏆 ${st.teams[w].name} ربط الطرفين!`, "win");
      }
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

    // انتهى الوقت — إن كان دور من ضغط أولاً، يبدأ دور اللاعب الثاني تلقائياً
    case "timerEnd": {
      const t = st.current.timer;
      if (!t.running) break;
      const b = st.current.buzz;
      const other = b.winner === "a" ? "b" : b.winner === "b" ? "a" : null;

      if (t.stage === "buzz1" && b.enabled && other) {
        const secs = Math.max(0, Math.min(120, Number(b.otherSeconds) || 0));
        st.current.turn = other;
        st.current.timer = {
          running: secs > 0,
          total: secs,
          endsAt: Date.now() + secs * 1000,
          stage: secs > 0 ? "buzz2" : null,
        };
        pushLog(
          st,
          `⏳ انتهى وقت ${st.teams[b.winner].name} — دور ${st.teams[other].name}`,
          other
        );
        break;
      }

      st.current.timer = { ...IDLE_TIMER };
      st.current.turn = null;
      if (st.phase === "question") st.phase = "timeout";
      pushLog(st, "⏰ انتهى الوقت", "warn");
      break;
    }

    /* ---------------- أجراس الجوال ---------------- */

    // إعدادات الأجراس: التفعيل، الفتح التلقائي، ومدة اللاعبين
    case "buzzConfig": {
      const b = st.current.buzz;
      if (typeof p.enabled === "boolean") b.enabled = p.enabled;
      if (typeof p.autoArm === "boolean") b.autoArm = p.autoArm;
      if (Number.isFinite(Number(p.seconds))) {
        b.seconds = Math.max(3, Math.min(120, Math.round(Number(p.seconds))));
      }
      if (Number.isFinite(Number(p.otherSeconds))) {
        b.otherSeconds = Math.max(5, Math.min(120, Math.round(Number(p.otherSeconds))));
      }
      if (!b.enabled) {
        b.open = false;
        b.winner = null;
        b.at = 0;
      }
      break;
    }

    // فتح باب الضغط (الحكم يضغط «يمكنكم الإجابة الآن» أو تلقائياً مع السؤال)
    case "buzzOpen": {
      if (!st.current.buzz.enabled) break;
      st.current.buzz = { ...st.current.buzz, open: true, winner: null, at: 0 };
      pushLog(st, "🔔 الأجراس مفتوحة — اضغطوا الآن!", "warn");
      break;
    }

    case "buzzClose": {
      st.current.buzz = { ...st.current.buzz, open: false };
      break;
    }

    // إعادة تصفير الأجراس دون فتحها (الحكم يريد إعادة الجولة الحالية)
    case "buzzReset": {
      st.current.buzz = { ...st.current.buzz, open: false, winner: null, at: 0 };
      st.current.timer = { ...IDLE_TIMER };
      st.current.turn = null;
      pushLog(st, "↺ أُعيدت الأجراس", "warn");
      break;
    }

    // أول ضغطة فقط تُقبل: تُثبّت الفائز وتشغّل المؤقّت تلقائياً
    case "buzzWin": {
      const b = st.current.buzz;
      const team = p.team === "b" ? "b" : "a";
      if (!b.enabled || !b.open || b.winner) break; // الضغطات التالية تُتجاهل
      st.current.buzz = { ...b, open: false, winner: team, at: Number(p.at) || Date.now() };
      st.current.turn = team;
      st.current.verdict = null;
      st.current.timer = {
        running: true,
        total: b.seconds,
        endsAt: Date.now() + b.seconds * 1000,
        stage: "buzz1",
      };
      pushLog(st, `🔔 ${st.teams[team].name} ضغط أولاً!`, team);
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
      fresh.current.buzz = { ...st.current.buzz, open: false, winner: null, at: 0 };
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
      fresh.current.buzz = { ...st.current.buzz, open: false, winner: null, at: 0 };
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
