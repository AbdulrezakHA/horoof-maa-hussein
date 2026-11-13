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
import { fileURLToPath } from "node:url";

import { WsServer } from "./ws.js";
import {
  createState,
  applyAction,
  pickQuestion,
  hasQuestionsFor,
  findWinner,
  shuffleBoardLetters,
  normalizeBoardLetters,
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
  "/buzzer.html": "public/buzzer.html",
  "/presets": "public/presets.html",
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

function getRoom(id = "main") {
  if (!rooms.has(id)) {
    // كل غرفة تبدأ بلوحة مخلوطة (نفس الحروف، لكن مواضعها مختلفة كل مرة).
    // normalizeBoardLetters تضمن حروفاً أساسية فقط (٢٨ حرفاً) وبلا أي تكرار.
    const board = shuffleBoardLetters(normalizeBoardLetters(structuredClone(DEFAULT_BOARD)));
    rooms.set(id, {
      id,
      board,
      bank: buildBankFromPresets([]),
      pools: {},
      state: createState(board),
      clients: new Set(),
      // يتغير عند إعادة تشغيل الخادم؛ لا يُرسل إلا إلى شاشة العرض.
      pairCode: String(crypto.randomInt(100000, 1000000)),
      timerHandle: null,
    });
  }
  return rooms.get(id);
}

/** نسخة الحالة المرسلة لجهاز معيّن (بحسب دوره). */
function stateFor(room, client) {
  // جوال اللاعب يرى السؤال لكن **لا يرى الجواب أبداً**
  if (client?.meta?.role !== "buzzer") return room.state;
  const st = room.state;
  return {
    ...st,
    current: {
      ...st.current,
      question: st.current.question
        ? { letter: st.current.question.letter, text: st.current.question.text }
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

/** يجهّز الإجراء (الأسئلة العشوائية) ثم يطبّقه ويبثّ النتيجة. */
function handleAction(room, action) {
  const type = action?.type;
  const payload = action?.payload || {};

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

  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
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
      case "buzz": {
        if (conn.meta.role !== "buzzer") return;
        const b = room.state.current.buzz;
        const team = conn.meta.team || "a";
        if (!b?.enabled) {
          conn.send(JSON.stringify({ t: "buzzed", ok: false, reason: "disabled", team }));
          return;
        }
        if (!b.open || b.winner) {
          conn.send(JSON.stringify({
            t: "buzzed",
            ok: false,
            reason: b.winner ? "taken" : "closed",
            team,
            winner: b.winner,
          }));
          return;
        }
        handleAction(room, { type: "buzzWin", payload: { team, at: Date.now() } });
        conn.send(JSON.stringify({ t: "buzzed", ok: true, team, at: room.state.current.buzz.at }));
        break;
      }

      case "ping": {
        conn.send(JSON.stringify({ t: "pong", serverTime: Date.now() }));
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

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) out.push({ name, address: net.address });
    }
  }
  return out;
}

function startServer(port) {
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
    const addrs = lanAddresses();
    const totalQuestions = Object.values(BANK).reduce((s, v) => s + v.length, 0);

    console.log("\n\x1b[35m╔══════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[35m║     🔤  حروف مع حسين — الخادم يعمل الآن      ║\x1b[0m");
    console.log("\x1b[35m╚══════════════════════════════════════════════╝\x1b[0m\n");
    console.log(`  📺  الشاشة الكبيرة : \x1b[36mhttp://localhost:${port}/screen\x1b[0m`);
    console.log(`  📱  واجهة الحكم   : \x1b[36mhttp://localhost:${port}/referee\x1b[0m`);
    console.log(`  🔔  أجراس اللاعبين: \x1b[36mhttp://localhost:${port}/buzzer?team=a\x1b[0m  (أو team=b)`);
    console.log(`  🏠  الصفحة الرئيسية: \x1b[36mhttp://localhost:${port}/\x1b[0m`);

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

process.on("SIGINT", () => {
  console.log("\n  إيقاف الخادم…");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

export { getRoom, hasQuestionsFor, findWinner };
