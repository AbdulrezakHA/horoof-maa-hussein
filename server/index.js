/**
 * خادم حروف مع حسين.
 *
 *   node server/index.js            # يعمل على http://0.0.0.0:3000
 *   node server/index.js --port 8080
 *
 * بدون أي اعتمادات خارجية — Node 18+ فقط.
 *
 * الأدوار:
 *   /            صفحة اختيار الدور
 *   /screen      الشاشة الكبيرة (لل-projector أو التلفاز)
 *   /referee     واجهة الحكم (الهاتف)
 *   /buzzer      جرس اللاعب (الهاتف) — ?team=a أو ?team=b
 * يُربط الجهازان عبر WebSocket على /ws
 *
 * ملاحظة: إذا كان المنفذ المطلوب مشغولاً ينتقل الخادم تلقائياً للمنفذ التالي،
 * و /api/network يعيد المنفذ الفعلي (ACTIVE_PORT) الذي بُنيت عليه رموز QR.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { WsServer } from "./ws.js";
import { pickDescriber } from "../shared/taboo.js";
import { listTabooPacks, loadTaboo, saveTaboo, deleteTaboo, buildTabooDeck, parseTaboo } from "./taboo-packs.js";
import {
  createState,
  applyAction,
  pickQuestion,
  hasQuestionsFor,
  findWinner,
  shuffleBoardLetters,
  normalizeBoardLetters,
  randomBoardLetters,
} from "../shared/engine.js";
import {
  listPresets,
  loadPreset,
  savePreset,
  createPreset,
  duplicatePreset,
  deletePreset,
  presetExists,
  parseSheet,
  serializeSheet,
  buildBankFromPresets,
  countsFromBank,
  migrateLegacy,
  PRESETS_DIR,
} from "./presets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------------------------ */
/*  الإعدادات                                                           */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(getArg("port", process.env.PORT || 3000));
const HOST = getArg("host", process.env.HOST || "0.0.0.0");
// --open-screen: بعد بدء الخادم يفتح الشاشة الكبيرة على المنفذ الفعلي (يستخدمه ابدأ-اللعبة.bat)
const OPEN_SCREEN = args.includes("--open-screen");
// --no-save: لا يحفظ اللعبة على القرص (للاختبارات — حتى لا تُكتب فوق لعبتك الحقيقية)
const SAVE_STATE = !args.includes("--no-save");
const PUBLIC_URL = getArg("public-url", process.env.PUBLIC_URL || "").replace(/\/$/, "");

// المنفذ الفعلي بعد الاستماع — يختلف عن PORT إذا كان مشغولاً
// (لازم نستخدمه في /api/network وإلا توجّه رموز QR إلى منفذ خاطئ)
let ACTIVE_PORT = PORT;

const PATHS = {
  "/": "public/index.html",
  "/index.html": "public/index.html",
  "/screen": "public/screen.html",
  "/screen.html": "public/screen.html",
  "/referee": "public/referee.html",
  "/referee.html": "public/referee.html",
  "/buzzer": "public/buzzer.html",
  // صفحة اللاعب: رمز QR واحد للجميع — يكتب اسمه ويختار فريقه
  "/play": "public/buzzer.html",
  "/play.html": "public/buzzer.html",
  "/buzzer.html": "public/buzzer.html",
  "/presets": "public/presets.html",
  "/taboo-packs": "public/taboo-packs.html",
  "/presets.html": "public/presets.html",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/* ------------------------------------------------------------------ */
/*  البيانات                                                            */
/* ------------------------------------------------------------------ */

function readJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch (err) {
    console.error(`[تحذير] تعذّر قراءة ${rel}: ${err.message}`);
    return fallback;
  }
}

const DEFAULT_BOARD = readJson("data/board.json", {
  rows: 5,
  cols: 5,
  teams: {
    a: { name: "الفريق الأول", color: "#6965ae", goals: [["top"], ["bottom"]] },
    b: { name: "الفريق الثاني", color: "#4b9cbf", goals: [["left"], ["right"]] },
  },
  edges: { top: [], bottom: [], left: [], right: [] },
  cells: [],
});

const BANK = readJson("data/questions.json", {});

// نُهاجر الملف القديم إلى presets/ مرة واحدة (إن لم توجد مجموعات بعد)
try {
  const mig = migrateLegacy();
  if (mig.migrated) console.log(`[مجموعات] تم تحويل data/questions.json إلى presets/${mig.id}.tsv (${mig.total} سؤال)`);
} catch (err) {
  console.error("[تحذير] تعذّر ترحيل الأسئلة القديمة:", err.message);
}

/* ------------------------------------------------------------------ */
/*  الغرف (Rooms)                                                       */
/* ------------------------------------------------------------------ */

const rooms = new Map();

/* ---------------- حفظ اللعبة على القرص ---------------- */
// كل تغيير يُحفظ في data/state.json، فإغلاق الخادم (أو انقطاع الكهرباء) لا يضيّع اللوحة والنقاط.

const STATE_FILE = path.resolve(
  getArg("state-file", path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "data", "state.json"))
);
let saveTimer = null;

function saveStateSoon(room) {
  if (!SAVE_STATE || room.id !== "main") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify({ savedAt: Date.now(), state: room.state }));
      fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
    } catch (err) {
      console.log("  ⚠️  تعذّر حفظ اللعبة:", err.message);
    }
  }, 250);
}

/** يقرأ آخر لعبة محفوظة (إن وُجدت) ويجهّزها للاستئناف بأمان. */
function loadSavedState(board) {
  if (!SAVE_STATE) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))?.state;
    if (!saved?.cells || !saved?.teams) return null;
    // لا بد أن تطابق خلايا اللوحة المحفوظة خلايا اللوحة الحالية
    if (!board.cells.every((c) => saved.cells[c.id])) return null;
    const fresh = createState(board);
    const st = { ...fresh, ...saved, current: { ...fresh.current, ...saved.current } };
    // المؤقّتات والأجراس لا تُستأنف (الوقت مضى) — نبدأ السؤال الحالي بأجراس مغلقة
    st.current.timer = { running: false, total: 0, endsAt: 0, stage: null };
    st.current.buzz = {
      ...fresh.current.buzz,
      ...(saved.current?.buzz || {}),
      open: false, winner: null, at: 0, stage: 0, phase: "idle", allowed: "all",
      player: null, wrong: [], history: [], openedAt: 0,
    };
    st.screen = { ...fresh.screen, ...(saved.screen || {}), lobby: true };
    st.players = saved.players || {};
    st.night = { a: 0, b: 0, ...(saved.night || {}) };
    st.taboo = { ...fresh.taboo, ...(saved.taboo || {}) };
    // دور «الكلمة الممنوعة» كان جارياً: يُستأنف موقوفاً بما تبقّى من وقته
    if (st.taboo.phase === "turn" && st.taboo.timer?.endsAt) {
      const savedAt = Number(JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))?.savedAt) || Date.now();
      const remaining = Math.max(1000, st.taboo.timer.endsAt - savedAt);
      st.taboo.timer = { running: false, total: st.taboo.timer.total, endsAt: 0, remaining };
      st.taboo.phase = "paused";
    }
    return st;
  } catch {
    return null;
  }
}

function getRoom(id = "main") {
  if (!rooms.has(id)) {
    // كل غرفة تبدأ بلوحة عشوائية: ٢٥ حرفاً من الحروف الأساسية الـ٢٨ (بلا تكرار) في مواقع عشوائية.
    const board = randomBoardLetters(normalizeBoardLetters(structuredClone(DEFAULT_BOARD)));
    const saved = id === "main" ? loadSavedState(board) : null;
    if (saved) console.log("  💾 استُؤنفت آخر لعبة محفوظة (اللوحة والنقاط واللاعبون).");
    rooms.set(id, {
      id,
      board,
      bank: buildBankFromPresets(saved?.presets?.active || []),
      bankKey: JSON.stringify(saved?.presets?.active || []),
      pools: {},
      state: saved || createState(board),
      clients: new Set(),
      // يتغير عند إعادة تشغيل الخادم؛ لا يُرسل إلا إلى شاشة العرض.
      pairCode: String(crypto.randomInt(100000, 1000000)),
      timerHandle: null,
      undo: [], // نسخ سابقة من الحالة للتراجع عن آخر قرار
    });
  }
  return rooms.get(id);
}

/** المتصلون الآن من اللاعبين (وأجراس الفرق القديمة). */
function onlinePlayerIds(room) {
  const ids = new Set();
  for (const c of room.clients) {
    if (c.meta.role === "player" && c.meta.playerId) ids.add(c.meta.playerId);
    if (c.meta.role === "buzzer") ids.add(`team:${c.meta.team || "a"}`);
  }
  return [...ids];
}

/**
 * سرّية «الكلمة الممنوعة»: الكلمة تصل لجوال الشارح والحكم فقط،
 * والكلمات الممنوعة (بلا الكلمة) تصل للفريق الآخر فقط، وفريق الشارح والشاشة لا يرون إلا الموضوع.
 */
function tabooFor(st, client) {
  const t = st.taboo;
  if (!t?.card || client?.meta?.role === "referee") return t;
  if (!["turn", "paused"].includes(t.phase)) return t; // بعد انتهاء الدور: الكلمات مكشوفة للجميع
  const topicOnly = { id: t.card.id, topic: t.card.topic, icon: t.card.icon };
  let card = topicOnly;
  if (client?.meta?.role === "player") {
    const me = client.meta.playerId;
    const myTeam = st.players?.[me]?.team;
    if (me && me === t.describer?.id) card = t.card;
    else if (myTeam && myTeam !== t.turnTeam) card = { ...topicOnly, forbidden: t.card.forbidden };
  }
  return { ...t, card };
}

/** نسخة الحالة المرسلة لجهاز معيّن (بحسب دوره). */
function stateFor(room, client) {
  const st0 = room.state;
  const taboo = tabooFor(st0, client);
  if (taboo !== st0.taboo) return stateForHuroof({ ...st0, taboo }, client);
  return stateForHuroof(st0, client);
}

function stateForHuroof(stIn, client) {
  // جوال اللاعب يرى السؤال لكن **لا يرى الجواب** إلا بعد كشفه على الشاشة الكبيرة
  if (client?.meta?.role !== "buzzer" && client?.meta?.role !== "player") return stIn;
  const st = stIn;
  const q = st.current.question;
  return {
    ...st,
    current: {
      ...st.current,
      question: q
        ? {
            letter: q.letter,
            text: q.text,
            ...(st.current.answerRevealed ? { answer: q.answer } : {}),
          }
        : null,
    },
    log: [],
  };
}

function roomSnapshot(room, client = null) {
  return {
    t: "state",
    room: room.id,
    state: stateFor(room, client),
    board: room.board,
    serverTime: Date.now(),
    peers: {
      screen: [...room.clients].filter((c) => c.meta.role === "screen").length,
      referee: [...room.clients].filter((c) => c.meta.role === "referee").length,
      buzzerA: [...room.clients].filter((c) => c.meta.role === "buzzer" && c.meta.team === "a").length,
      buzzerB: [...room.clients].filter((c) => c.meta.role === "buzzer" && c.meta.team === "b").length,
      // هل الشاشة الكبيرة بملء الشاشة الآن؟ (تُبلغ به الشاشة نفسها)
      players: onlinePlayerIds(room),
      // آخر حالة أبلغت بها نافذة الشاشة (النافذة التي ضُغط عليها F11 هي آخر من يُبلغ)
      screenFullscreen: !!room.screenFullscreen,
    },
    pairing: client?.meta?.role === "screen"
      ? { code: room.pairCode }
      : { required: true, verified: !!client?.meta?.verified },
  };
}

function broadcast(room) {
  for (const c of room.clients) {
    if (c.open) c.send(JSON.stringify(roomSnapshot(room, c)));
  }
}

/* ------------------------------------------------------------------ */
/*  المعالجة                                                           */
/* ------------------------------------------------------------------ */

function scheduleTimer(room) {
  scheduleTabooTimer(room);
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  const timer = room.state.current.timer;
  if (!timer.running || !timer.endsAt) return;

  const delay = Math.max(0, timer.endsAt - Date.now());
  room.timerHandle = setTimeout(() => {
    room.timerHandle = null;
    if (!room.state.current.timer.running) return;
    // منطق انتهاء الوقت في المحرّك: قد يبدأ دور اللاعب الثاني تلقائياً
    handleAction(room, { type: "timerEnd" });
  }, delay + 60);
}

/** القرارات التي يمكن التراجع عنها بزر ↩️ عند الحكم. */
const UNDOABLE = new Set([
  "award", "unclaim", "noPoint", "buzzCorrect", "buzzWrong", "clear",
  "reset", "shuffle", "declareWinner", "setLetter", "playerRemove", "playerSetTeam",
  "tabooRight", "tabooSkip", "tabooFoul", "tabooNew", "tabooAdjust", "nightReset",
]);

/** مؤقّت دور «الكلمة الممنوعة» (مستقل عن مؤقّت حروف). */
function scheduleTabooTimer(room) {
  if (room.tabooHandle) {
    clearTimeout(room.tabooHandle);
    room.tabooHandle = null;
  }
  const t = room.state.taboo?.timer;
  if (!t?.running || !t.endsAt) return;
  room.tabooHandle = setTimeout(() => {
    room.tabooHandle = null;
    if (!room.state.taboo?.timer?.running) return;
    handleAction(room, { type: "tabooTimerEnd" });
  }, Math.max(0, t.endsAt - Date.now()) + 60);
}

/** البطاقة التالية: كل بطاقات المواضيع المفعّلة مخلوطة، ولا تتكرّر حتى تنتهي كلها. */
function nextTabooCard(room) {
  const active = room.state.taboo?.packs || [];
  const key = JSON.stringify(active);
  if (!room.tabooDeck || room.tabooDeck.key !== key || room.tabooDeck.pos >= room.tabooDeck.cards.length) {
    const cards = buildTabooDeck(active);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    room.tabooDeck = { key, cards, pos: 0 };
  }
  const deck = room.tabooDeck;
  return deck.cards.length ? deck.cards[deck.pos++] : null;
}

/** يجهّز العشوائية لإجراءات «الكلمة الممنوعة» (البطاقة، الشارح، الفريق البادئ). */
function prepareTaboo(room, type, payload) {
  const st = room.state;
  const t = st.taboo || {};
  const online = onlinePlayerIds(room);
  const randomTeam = () => (crypto.randomInt(2) === 0 ? "a" : "b");
  switch (type) {
    case "setGame":
    case "tabooNew":
      return { ...payload, startTeam: randomTeam() };
    case "tabooBegin":
      return { ...payload, describer: pickDescriber(st, t.startTeam || "a", online) };
    case "tabooPick":
      return { ...payload, describer: pickDescriber(st, t.turnTeam || "a", online) };
    case "tabooNextTurn":
      return { ...payload, describer: pickDescriber(st, t.turnTeam === "a" ? "b" : "a", online) };
    case "tabooStartTurn":
    case "tabooRight":
    case "tabooSkip":
      return { ...payload, card: nextTabooCard(room) };
    default:
      return payload;
  }
}

/** يجهّز الإجراء (الأسئلة العشوائية) ثم يطبّقه ويبثّ النتيجة. */
function handleAction(room, action) {
  const type = action?.type;
  const payload = action?.payload || {};

  // ملء الشاشة على التلفاز: لا يغيّر حالة اللعبة — الخادم يضغط F11 على نافذة الشاشة
  if (type === "screenFullscreen") {
    toggleScreenFullscreen();
    return;
  }

  // ↩️ تراجع عن آخر قرار (اللاعبون المسجّلون يبقون كما هم)
  if (type === "undo") {
    const prev = room.undo.pop();
    if (!prev) return;
    room.state = { ...prev, players: { ...prev.players, ...room.state.players }, rev: room.state.rev + 1 };
    room.state.log = [{ at: Date.now(), text: "↩️ تراجع عن آخر قرار", tone: "warn" }, ...(prev.log || [])].slice(0, 40);
    scheduleTimer(room);
    broadcast(room);
    saveStateSoon(room);
    return;
  }
  if (UNDOABLE.has(type)) {
    room.undo.push(room.state);
    if (room.undo.length > 30) room.undo.shift();
  }

  // «الكلمة الممنوعة»: البطاقة التالية / الشارح / الفريق البادئ
  if (type === "setGame" || (typeof type === "string" && type.startsWith("taboo"))) {
    action = { ...action, payload: prepareTaboo(room, type, payload) };
  }

  // قرارات الأجراس تحتاج معرفة من هو متصل الآن (فريق بلا متصلين تُتخطّى جولته)
  if (["playerBuzz", "buzzWrong", "buzzCorrect", "timerEnd"].includes(type)) {
    action = { ...action, payload: { ...payload, online: onlinePlayerIds(room) } };
  }

  if (type === "select") {
    const cell = room.state.cells[payload.cellId];
    if (!cell) return;
    const sameCell = room.state.current.cellId === payload.cellId;
    const question = sameCell
      ? room.state.current.question
      : pickQuestion(room.bank, cell.letter, room.pools);
    room.state = applyAction(room.state, room.board, {
      type,
      payload: { ...payload, question },
    });
  } else if (type === "newQuestion") {
    const cell = room.state.cells[room.state.current.cellId];
    if (!cell) return;
    const question = pickQuestion(room.bank, cell.letter, room.pools);
    room.state = applyAction(room.state, room.board, {
      type: "setQuestion",
      payload: { question },
    });
  } else {
    room.state = applyAction(room.state, room.board, action);
  }

  syncBank(room, type === "presets" || type === "reset" || type === "loadBoard");
  scheduleTimer(room);
  broadcast(room);
  saveStateSoon(room);

  // لاعب أُخرج: نُبلغ جواله ليعود لشاشة الانضمام
  if (type === "playerRemove") {
    for (const c of room.clients) {
      if (c.meta.role === "player" && c.meta.playerId === payload.id) {
        c.send(JSON.stringify({ t: "kicked" }));
      }
    }
  }
}

/**
 * يزامن بنك الأسئلة في الذاكرة مع مجموعات الأسئلة المختارة في الحالة.
 * `force` = أعد البناء دائماً (بعد تغيير المجموعات أو تعديل ملفاتها).
 */
function syncBank(room, force = false) {
  const active = room.state?.presets?.active || [];
  const key = JSON.stringify(active);
  if (!force && key === room.bankKey) return;
  room.bankKey = key;
  room.bank = buildBankFromPresets(active);
  room.pools = {};
}

/** يعيد بناء البنك فوراً بعد أي تعديل على ملفات المجموعات. */
function refreshPresetBanks() {
  for (const room of rooms.values()) {
    syncBank(room, true);
    broadcast(room);
  }
}

/* ------------------------------------------------------------------ */
/*  HTTP                                                                */
/* ------------------------------------------------------------------ */

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null;
  return p;
}

function serveFile(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("الملف غير موجود");
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

/** مواضيع «الكلمة الممنوعة»: قائمة، قراءة، حفظ، حذف. */
async function handleTabooApi(req, res, pathname, url) {
  try {
    if (pathname === "/api/taboo/packs" && req.method === "GET") {
      return json(res, 200, { ok: true, packs: listTabooPacks() });
    }
    if (pathname === "/api/taboo/get" && req.method === "GET") {
      return json(res, 200, { ok: true, ...loadTaboo(url.searchParams.get("id") || "") });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST فقط" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (pathname === "/api/taboo/save") {
      const data = typeof body.text === "string" ? parseTaboo(body.text) : { icon: body.icon, cards: body.cards || [] };
      const saved = saveTaboo(body.id, { icon: body.icon ?? data.icon, cards: data.cards });
      for (const room of rooms.values()) room.tabooDeck = null; // إعادة بناء المجموعة
      return json(res, 200, { ok: true, ...saved });
    }
    if (pathname === "/api/taboo/delete") {
      deleteTaboo(body.id);
      for (const room of rooms.values()) room.tabooDeck = null;
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: "غير موجود" });
  } catch (err) {
    return json(res, 400, { ok: false, error: err.message });
  }
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": MIME[".json"], "Cache-Control": "no-cache" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    const LIMIT = 6 * 1024 * 1024;
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > LIMIT) {
        reject(new Error("الملف كبير جداً (٦ ميجا كحد أقصى)"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function bodyJson(req) {
  return readBody(req).then((raw) => {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("صيغة الطلب غير صحيحة");
    }
  });
}

/** اسم مجموعة غير مستخدم (يُضاف رقم عند التعارض). */
function uniquePresetName(name) {
  const base = String(name || "مجموعة").trim() || "مجموعة";
  if (!presetExists(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base} ${i}`;
    if (!presetExists(candidate)) return candidate;
  }
  throw new Error("تعذّر إيجاد اسم متاح");
}

/* ------------------------------------------------------------------ */
/*  واجهة مجموعات الأسئلة                                              */
/* ------------------------------------------------------------------ */

async function handlePresetsApi(req, res, pathname, url) {
  try {
    const roomId = url.searchParams.get("room") || "main";
    const room = getRoom(roomId);

    if (pathname === "/api/presets" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        presets: listPresets(),
        active: room.state?.presets?.active || [],
        letters: countsFromBank(room.bank),
        dir: "presets/",
      });
    }

    if (pathname === "/api/presets/get" && req.method === "GET") {
      const p = loadPreset(url.searchParams.get("id") || "");
      return json(res, 200, { ok: true, ...p });
    }

    if (pathname === "/api/presets/export" && req.method === "GET") {
      const p = loadPreset(url.searchParams.get("id") || "");
      res.writeHead(200, {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(p.name + ".tsv")}`,
        "Cache-Control": "no-cache",
      });
      return res.end(serializeSheet(p.rows));
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, error: "طريقة غير مدعومة" });

    const body = await bodyJson(req);

    if (pathname === "/api/presets/create") {
      const p = createPreset(body.name);
      refreshPresetBanks();
      return json(res, 200, { ok: true, id: p.id });
    }

    if (pathname === "/api/presets/duplicate") {
      const p = duplicatePreset(body.id, uniquePresetName(body.name || `${body.id} - نسخة`));
      refreshPresetBanks();
      return json(res, 200, { ok: true, id: p.id });
    }

    if (pathname === "/api/presets/delete") {
      deletePreset(body.id);
      const active = room.state?.presets?.active || [];
      if (active.includes(body.id)) {
        room.state = applyAction(room.state, room.board, {
          type: "presets",
          payload: { active: active.filter((x) => x !== body.id) },
        });
      }
      refreshPresetBanks();
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/presets/parse") {
      const { rows, warnings } = parseSheet(body.text);
      return json(res, 200, { ok: true, rows, warnings, total: rows.length });
    }

    if (pathname === "/api/presets/save") {
      const text = serializeSheet(Array.isArray(body.rows) ? body.rows : []);
      const parsed = parseSheet(text);
      if (!parsed.rows.length) throw new Error("لا يمكن الحفظ: لا توجد أسئلة صالحة");
      const p = savePreset(body.id, parsed.rows);
      refreshPresetBanks();
      return json(res, 200, {
        ok: true,
        id: p.id,
        total: p.total,
        letters: p.letters,
        warnings: p.warnings,
      });
    }

    if (pathname === "/api/presets/import") {
      const { rows, warnings } = parseSheet(body.text);
      if (!rows.length) throw new Error("لم يُعثر على أي صف صالح في النص");
      const name = uniquePresetName(body.name);
      const p = savePreset(name, rows);
      refreshPresetBanks();
      return json(res, 200, { ok: true, id: p.id, total: p.total, warnings });
    }

    return json(res, 404, { ok: false, error: "مسار غير معروف" });
  } catch (err) {
    return json(res, 400, { ok: false, error: String((err && err.message) || err) });
  }
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }

  // ---------- API ----------
  if (pathname === "/api/state") {
    const room = getRoom(new URL(req.url, "http://x").searchParams.get("room") || "main");
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify(roomSnapshot(room)));
  }

  if (pathname === "/api/board") {
    const room = getRoom("main");
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify(room.board));
  }

  if (pathname === "/api/letters") {
    const room = getRoom(new URL(req.url, "http://x").searchParams.get("room") || "main");
    return json(res, 200, countsFromBank(room.bank));
  }

  if (pathname.startsWith("/api/presets")) {
    handlePresetsApi(req, res, pathname, new URL(req.url, "http://x"));
    return;
  }

  if (pathname.startsWith("/api/taboo")) {
    handleTabooApi(req, res, pathname, new URL(req.url, "http://x"));
    return;
  }

  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify({ ok: true, app: "horoof-maa-hussein", port: ACTIVE_PORT, rooms: rooms.size, uptime: process.uptime() }));
  }

  if (pathname === "/api/network") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(
      JSON.stringify({
        port: ACTIVE_PORT,
        host: req.headers.host || `localhost:${ACTIVE_PORT}`,
        addresses: lanAddresses(),
        publicUrl: PUBLIC_URL || null,
      })
    );
  }

  // ---------- صفحات ----------
  if (PATHS[pathname]) {
    return serveFile(res, path.join(ROOT, PATHS[pathname]));
  }

  // ---------- ملفات ثابتة ----------
  // /css/* /js/*        → public/
  // /shared/* /data/*   → المجلدات المقابلة
  const rel = pathname.replace(/^\/+/, "");
  const segments = rel.split("/").filter(Boolean);

  const publicAbs = safeJoin(path.join(ROOT, "public"), rel);
  if (publicAbs && fs.existsSync(publicAbs) && fs.statSync(publicAbs).isFile()) {
    return serveFile(res, publicAbs);
  }

  if (segments.length && ["shared", "data"].includes(segments[0])) {
    const abs = safeJoin(path.join(ROOT, segments[0]), segments.slice(1).join("/"));
    if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return serveFile(res, abs);
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404");
});

/* ------------------------------------------------------------------ */
/*  WebSocket                                                           */
/* ------------------------------------------------------------------ */

const wss = new WsServer(server, { path: "/ws" });

wss.onconnection = (conn) => {
  let room = getRoom("main");

  conn.onmessage = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    switch (msg.t) {
      case "hello": {
        conn.meta.role = msg.role || "screen";
        conn.meta.room = msg.room || "main";
        // جرس فريق: 'a' أو 'b' — لا يحتاج رمز اقتران، وظيفته الضغط فقط
        if (conn.meta.role === "buzzer") conn.meta.team = msg.team === "b" ? "b" : "a";
        // لاعب (صفحة /play): هويته معرّف ثابت محفوظ في جواله
        if (conn.meta.role === "player") {
          const pid = String(msg.playerId || "");
          if (!/^[A-Za-z0-9_-]{6,40}$/.test(pid)) return conn.close(1008, "bad player id");
          conn.meta.playerId = pid;
        }
        room = getRoom(conn.meta.room);

        if (conn.meta.role === "referee" && msg.pairCode !== room.pairCode) {
          conn.send(JSON.stringify({
            t: "pairing",
            status: msg.pairCode ? "invalid" : "required",
          }));
          return;
        }

        conn.meta.verified = true;
        room.clients.add(conn);
        conn.send(JSON.stringify(roomSnapshot(room, conn)));
        broadcast(room); // لتحديث عدّاد المتصلين
        break;
      }

      case "action": {
        if (conn.meta.role !== "referee") return; // الشاشة للعرض فقط
        handleAction(room, msg.action);
        break;
      }

      // ضغطة جرس من هاتف لاعب — أول ضغطة فقط تُقبل، والباقي يُتجاهل
      // لاعب يكتب اسمه ويختار فريقه (أو يغيّرهما لاحقاً)
      case "join": {
        if (conn.meta.role !== "player" || !room) return;
        handleAction(room, {
          type: "playerJoin",
          payload: { id: conn.meta.playerId, name: msg.name, team: msg.team },
        });
        break;
      }

      // ضغطة جرس — من لاعب (/play) أو من جرس فريق قديم (/buzzer?team=a)
      case "buzz": {
        if (!room || (conn.meta.role !== "buzzer" && conn.meta.role !== "player")) return;
        const id = conn.meta.role === "player" ? conn.meta.playerId : `team:${conn.meta.team || "a"}`;
        const team = conn.meta.role === "player" ? room.state.players?.[id]?.team : conn.meta.team || "a";
        const b = room.state.current.buzz;
        if (!b?.enabled) {
          conn.send(JSON.stringify({ t: "buzzed", ok: false, reason: "disabled", team }));
          return;
        }
        if (!b.open || b.phase !== "open") {
          conn.send(JSON.stringify({ t: "buzzed", ok: false, reason: b.player ? "taken" : "closed", team, winner: b.winner }));
          return;
        }
        handleAction(room, { type: "playerBuzz", payload: { id, at: Date.now() } });
        const ok = room.state.current.buzz.player?.id === id;
        conn.send(JSON.stringify({
          t: "buzzed",
          ok,
          team,
          reason: ok ? undefined : "blocked",
          at: room.state.current.buzz.at,
        }));
        break;
      }

      case "ping": {
        conn.send(JSON.stringify({ t: "pong", serverTime: Date.now() }));
        break;
      }

      // ⏭ الشارح يتخطّى الكلمة من جواله (فقط الشارح الحالي)
      case "tabooSkip": {
        if (!room || conn.meta.role !== "player") return;
        if (room.state.game !== "taboo" || room.state.taboo?.describer?.id !== conn.meta.playerId) return;
        handleAction(room, { type: "tabooSkip" });
        break;
      }

      // الشاشة الكبيرة تُبلغ إن كانت بملء الشاشة (ليعرض الحكم الزر المناسب)
      case "screenInfo": {
        if (conn.meta.role !== "screen" || !room) return;
        const full = !!msg.fullscreen;
        if (room.screenFullscreen === full) return;
        room.screenFullscreen = full;
        broadcast(room);
        break;
      }
    }
  };

  conn.onclose = () => {
    // نستدعي المعالج الأصلي أولاً حتى يُزال الاتصال من قائمة الخادم
    if (conn._wsCleanup) conn._wsCleanup();
    room.clients.delete(conn);
    broadcast(room);
  };
};

/* ------------------------------------------------------------------ */
/*  التشغيل                                                             */
/* ------------------------------------------------------------------ */

/**
 * عناوين الكمبيوتر على الشبكة، الأفضل أولاً — رمز QR يستعمل الأول.
 * نتجاهل العناوين التي لا يصل إليها أي جوال: 169.254.x.x (محوّل بلا شبكة)،
 * ومحوّلات WSL وHyper-V وVirtualBox وVMware وVPN، ونقدّم الواي فاي ثم الإيثرنت.
 */
const VIRTUAL_NIC = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|VMnet|Loopback|Bluetooth|Tailscale|ZeroTier|Hamachi|Radmin|OpenVPN|WireGuard|TAP-|Tun|VPN|Docker|Npcap/i;
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" && net.family !== 4) continue;
      if (net.internal || net.address.startsWith("169.254.")) continue;
      out.push({ name, address: net.address });
    }
  }
  const score = ({ name, address }) => {
    let s = 0;
    if (VIRTUAL_NIC.test(name)) s -= 100;
    if (/wi-?fi|wlan|wireless|لاسلكي/i.test(name)) s += 30;
    else if (/ethernet|^eth|^en/i.test(name)) s += 20;
    if (/^192\.168\./.test(address) || /^10\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 10;
    return s;
  };
  return out.sort((a, b) => score(b) - score(a));
}

/**
 * هل يردّ برنامج آخر على 127.0.0.1:port؟
 * على ويندوز يمكن لبرنامجين حجز نفس رقم المنفذ (واحد على 127.0.0.1 والآخر على 0.0.0.0)،
 * فتعمل اللعبة للجوالات بينما يفتح «localhost» على الكمبيوتر برنامجاً آخر (مثل إضافات Adobe).
 * لذلك نتأكد أن المنفذ فارغ محلياً قبل استخدامه.
 */
function localPortTaken(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (taken) => {
      sock.destroy();
      resolve(taken);
    };
    sock.setTimeout(600, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** ملف صغير يحفظ المنفذ الفعلي ليعرف ابدأ-اللعبة.bat أين تعمل اللعبة إن فُتح مرة ثانية. */
const PORT_FILE = path.join(ROOT_DIR_FOR_PORT(), "data", "active-port.txt");
function ROOT_DIR_FOR_PORT() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
function writePortFile(port) {
  try {
    fs.writeFileSync(PORT_FILE, String(port));
  } catch {
    /* غير ضروري */
  }
}
function clearPortFile() {
  try {
    if (fs.readFileSync(PORT_FILE, "utf8").trim() === String(ACTIVE_PORT)) fs.unlinkSync(PORT_FILE);
  } catch {
    /* غير ضروري */
  }
}

/** يفتح الشاشة الكبيرة على هذا الكمبيوتر (Chrome أولاً) — ويندوز فقط. */
function openScreen(port) {
  if (process.platform !== "win32") return;
  const script = path.join(ROOT_DIR_FOR_PORT(), "server", "open-screen.ps1");
  try {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-Port", String(port)],
      // بلا detached: على ويندوز يفشل PowerShell بصمت إن شُغّل منفصلاً بلا نافذة طرفية.
      // السكربت ينتهي خلال ثوانٍ، والمتصفح الذي يفتحه مستقل عن الخادم تماماً.
      { stdio: "ignore", windowsHide: true }
    );
    child.on("error", () => {
      console.log(`  ⚠️  تعذّر فتح الشاشة تلقائياً — افتح: http://127.0.0.1:${port}/screen`);
    });
    child.unref();
  } catch (err) {
    console.log(`  ⚠️  تعذّر فتح الشاشة تلقائياً — افتح: http://127.0.0.1:${port}/screen`);
  }
}

/** يضغط F11 على نافذة الشاشة الكبيرة (ويندوز فقط) — بأمر من جوال الحكم. */
function toggleScreenFullscreen() {
  if (process.platform !== "win32") return;
  const script = path.join(ROOT_DIR_FOR_PORT(), "server", "screen-fullscreen.ps1");
  try {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-Port", String(ACTIVE_PORT)],
      { stdio: "ignore", windowsHide: true }
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    /* تجاهل */
  }
}

async function startServer(port) {
  if (await localPortTaken(port)) {
    console.log(`\x1b[33m[تنبيه] المنفذ ${port} مستخدم من برنامج آخر على هذا الكمبيوتر — ننتقل إلى ${port + 1}...\x1b[0m`);
    return startServer(port + 1);
  }
  server.removeAllListeners("error");
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`\x1b[33m[تنبيه] المنفذ ${port} مشغول — يبدو أن نسخة أخرى من اللعبة تعمل.\x1b[0m`);
      console.log(`\x1b[33m        جارٍ المحاولة على المنفذ ${port + 1}...\x1b[0m`);
      console.log("\x1b[33m        أغلق نافذة الخادم القديمة، ولا تفتح الشاشة من الرابط القديم،\x1b[0m");
      console.log("\x1b[33m        وإلا ستفتح رموز QR على الخادم القديم وتُرجع صفحة 404.\x1b[0m");
      startServer(port + 1);
    } else {
      console.error("Server error:", err);
    }
  });

  server.listen(port, HOST, () => {
    ACTIVE_PORT = port;
    writePortFile(port);
    if (OPEN_SCREEN) openScreen(port);
    const addrs = lanAddresses();
    const totalQuestions = Object.values(BANK).reduce((s, v) => s + v.length, 0);

    console.log("\n\x1b[35m╔══════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[35m║     🔤  حروف مع حسين — الخادم يعمل الآن      ║\x1b[0m");
    console.log("\x1b[35m╚══════════════════════════════════════════════╝\x1b[0m\n");
    console.log(`  📺  الشاشة الكبيرة : \x1b[36mhttp://127.0.0.1:${port}/screen\x1b[0m`);
    console.log(`  📱  واجهة الحكم   : \x1b[36mhttp://127.0.0.1:${port}/referee\x1b[0m`);
    console.log(`  🔔  أجراس اللاعبين: \x1b[36mhttp://127.0.0.1:${port}/buzzer?team=a\x1b[0m  (أو team=b)`);
    console.log(`  🏠  الصفحة الرئيسية: \x1b[36mhttp://127.0.0.1:${port}/\x1b[0m`);

    if (addrs.length) {
      console.log("\n  📡  للهاتف على نفس شبكة الواي-فاي:");
      for (const a of addrs) {
        console.log(`      \x1b[32mhttp://${a.address}:${port}\x1b[0m   (${a.name})`);
      }
    } else {
      console.log("\n  ⚠️  لم يُعثر على عنوان شبكة — الهاتف لن يستطيع الاتصال.");
    }

    console.log(
      `\n  📚 بنك الأسئلة: ${Object.keys(BANK).length} حرف / ${totalQuestions} سؤال`
    );
    console.log(`  🗂️  الخلايا: ${DEFAULT_BOARD.cells.length}\n`);
  });
}

startServer(PORT);

process.on("exit", clearPortFile);
process.on("SIGINT", () => {
  console.log("\n  إيقاف الخادم…");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

export { getRoom, hasQuestionsFor, findWinner };
