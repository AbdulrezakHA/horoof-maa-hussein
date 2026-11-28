/**
 * اختبار تكاملي للعبة عبر WebSocket (يحاكي الشاشة + الحكم).
 *   node scripts/test-game.mjs [port]
 */
import { shuffleBoardLetters, normalizeBoardLetters, randomBoardLetters } from "../shared/engine.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = process.argv[2] || 3111;
const BASE = `http://127.0.0.1:${PORT}`;

const log = (...a) => console.log(...a);
let failures = 0;

function check(label, cond, extra = "") {
  if (cond) {
    log(`  \x1b[32m✓\x1b[0m ${label}${extra ? " — " + extra : ""}`);
  } else {
    failures++;
    log(`  \x1b[31m✗ ${label}${extra ? " — " + extra : ""}\x1b[0m`);
  }
}

function connect(role, room = "main", pairCode = "", extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
    ws.states = [];
    ws.onmessage = (e) => ws.states.push(JSON.parse(e.data));
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", role, room, pairCode, ...extra }));
      resolve(ws);
    };
    ws.onerror = reject;
    setTimeout(() => reject(new Error("timeout connecting " + role)), 4000);
  });
}

const last = (ws) => ws.states[ws.states.length - 1];
/** آخر رسالة من نوع معيّن (لأن رسائل الحالة تتخلّل ردود الخادم) */
const lastOf = (ws, t) => [...ws.states].reverse().find((m) => m.t === t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log("\n\x1b[35m▸ اختبار حروف مع حسين\x1b[0m\n");

  // --- الصفحات والملفات الثابتة ---
  // قواعد نظام التصميم (DESIGN.md): لا إيموجي، لا ألوان/خطوط مكتوبة، لا مكوّنات خارج المكتبة
  log("\x1b[36m▸ نظام التصميم\x1b[0m");
  {
    const run = (script, args = []) =>
      spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { encoding: "utf8" });
    const ds = run("./check-ds.mjs");
    check("قواعد نظام التصميم: لا مخالفات خارج الشاشات القديمة", ds.status === 0, (ds.stdout || "").trim().split("\n").slice(-3).join(" | "));
    const th = run("./gen-ds-theme.mjs", ["--check"]);
    check("ألوان ds.css تطابق محرّك الثيم (shared/ds-theme.js)", th.status === 0, (th.stdout + th.stderr).trim());
  }

  log("\x1b[36m▸ الصفحات\x1b[0m");
  for (const [path, needle] of [
    ["/", "<html"],
    ["/screen", "<html"],
    ["/referee", "<html"],
    ["/buzzer?team=a", "buzzer"],
    ["/buzzer?team=b", "buzzer"],
    ["/css/buzzer.css", "--team"],
    ["/js/buzzer.js", "Transport"],
    ["/js/qr.js", "getBuzzerUrls"],
  ]) {
    let ok = false;
    let status = 0;
    try {
      const res = await fetch(BASE + path);
      status = res.status;
      const body = await res.text();
      ok = res.ok && body.includes(needle);
    } catch {
      ok = false;
    }
    check(`تقديم ${path}`, ok, ok ? "" : `status=${status}`);
  }

  // --- معلومات الشبكة (تُبنى عليها رموز QR) ---
  log("\x1b[36m▸ معلومات الشبكة\x1b[0m");
  {
    const info = await (await fetch(BASE + "/api/network")).json();
    check("/api/network يعيد المنفذ الفعلي للخادم", info.port === Number(PORT),
      `أعاد ${info.port} والمتوقع ${PORT}`);
    check("/api/network يعيد عناوين الشبكة", Array.isArray(info.addresses));
    check("/api/network يعيد اسم المضيف", typeof info.host === "string" && info.host.length > 0);
    const qrUrl = `http://127.0.0.1:${info.port}/buzzer?room=main&team=a`;
    let qrStatus = 0;
    try { qrStatus = (await fetch(qrUrl)).status; } catch { /* ignore */ }
    check("الرابط المُرمَّز في QR يفتح بنجاح (لا 404)", qrStatus === 200, `${qrUrl} → ${qrStatus}`);
  }

  // --- الاتصال ---
  const screen = await connect("screen");
  await sleep(300);
  const pairCode = last(screen).pairing.code;
  const ref = await connect("referee", "main", pairCode);
  await sleep(300);

  // جولة نظيفة (الخادم قد يكون مستخدماً من تشغيل سابق)
  ref.send(JSON.stringify({ t: "action", action: { type: "reset" } }));
  await sleep(250);

  check("الشاشة استلمت لقطة الحالة", last(screen).t === "state");
  check("الحكم استلم لقطة الحالة", last(ref).t === "state");
  check("عدد الوصلات (شاشة + حكم)", last(ref).peers.screen >= 1 && last(ref).peers.referee >= 1,
    `screen=${last(ref).peers.screen} referee=${last(ref).peers.referee}`);

  // --- التحقق من بيانات اللوحة ---
  const board = last(ref).board;
  check("اللوحة فيها 25 خلية", board.cells.length === 25);
  check("الحواف معرّفة", !!board.edges.top && !!board.edges.left);
  check("الفريق أ: أعلى↔أسفل", JSON.stringify(board.teams.a.goals) === '[["top"],["bottom"]]');
  check("الفريق ب: يمين↔يسار", JSON.stringify(board.teams.b.goals) === '[["left"],["right"]]');

  // --- خلط الحروف: عشوائي في كل جولة ---
  const ALPHA = "abcdefghijklmnopqrstuvwxy";
  const makeCells = () => ALPHA.split("").map((letter, i) => ({ id: `c${i}`, letter }));
  const fakeBoard = { cells: makeCells() };
  const shuffled = shuffleBoardLetters(fakeBoard);

  check("الخلط يحافظ على 25 خلية", shuffled.cells.length === 25);
  check("الخلط يحافظ على نفس المعرّفات والترتيب",
    shuffled.cells.every((c, i) => c.id === fakeBoard.cells[i].id));
  check("الخلط يحافظ على مجموعة الحروف نفسها",
    [...shuffled.cells].map((c) => c.letter).sort().join("") ===
      [...fakeBoard.cells].map((c) => c.letter).sort().join(""));
  check("الخلط لا يعدّل اللوحة الأصلية",
    fakeBoard.cells.map((c) => c.letter).join("") === ALPHA);

  let differs = 0;
  for (let i = 0; i < 20; i++) {
    if (shuffleBoardLetters(fakeBoard).cells.map((c) => c.letter).join("") !== ALPHA) differs++;
  }
  check("الخلط يعطي ترتيباً مختلفاً عن الأصل", differs >= 18, `${differs}/20`);

  // ترتيب حروف الغرفة يتغيّر مع كل «إعادة الجولة»
  // (اللوحة تعرض الحروف من الحالة state.cells، لا من board.cells الثابتة)
  const orderFrom = (msg) => msg.board.cells.map((c) => msg.state.cells[c.id]?.letter ?? "").join("");
  const liveOrder = orderFrom(last(ref));
  ref.send(JSON.stringify({ t: "action", action: { type: "reset" } }));
  await sleep(300);
  const liveOrder2 = orderFrom(last(ref));
  check("لوحة الشاشة مبنية من الحالة (25 حرفاً)", liveOrder.length === 25 && liveOrder2.length === 25);
  check("إعادة الجولة تخلط الحروف من جديد", liveOrder !== liveOrder2);

  // كل جولة تُسحب ٢٥ حرفاً بالقرعة من الـ٢٨ في مواقع جديدة
  const samePositions = board.cells.every((c) => last(ref).state.cells[c.id].letter === c.letter);
  check("لوحة الجولة ليست نسخة حرفية من قالب اللوحة (سحب عشوائي)", !samePositions,
    board.cells.map((c) => last(ref).state.cells[c.id].letter).join(""));

  // الدوران: مع عدّة جولات يجب أن تظهر حروف كانت خارج الشبكة في جولة سابقة
  const seenLetters = new Set(board.cells.map((c) => last(ref).state.cells[c.id].letter));
  for (let round = 0; round < 4; round++) {
    ref.send(JSON.stringify({ t: "action", action: { type: "reset" } }));
    await sleep(220);
    for (const c of board.cells) seenLetters.add(last(ref).state.cells[c.id].letter);
  }
  check("الحروف تدور بين الجولات (تظهر حروف كانت مستبعدة)", seenLetters.size > 25,
    `ظهر ${seenLetters.size} حرفاً مختلفاً في ٥ جولات`);

  // --- الحروف الأساسية فقط، وبلا تكرار في الشبكة ---
  const GRID_BASE = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];
  const gridLetters = board.cells.map((c) => last(ref).state.cells[c.id].letter);
  const nonBase = gridLetters.filter((l) => !GRID_BASE.includes(l));
  check("كل حروف الشبكة من الحروف الأساسية (٢٨ حرفاً)", nonBase.length === 0,
    nonBase.length ? "وجدنا: " + nonBase.join(" ") : `مثال: ${gridLetters.join("")}`);
  check("لا يوجد حرف مكرّر في الشبكة", new Set(gridLetters).size === gridLetters.length,
    `${new Set(gridLetters).size} حرفاً مختلفاً في ${gridLetters.length} خلية`);
  check("كل خلية لها حرف", gridLetters.every((l) => !!l));

  // تطبيع لوحة قديمة فيها ؤ/أ/ى/ة/ئ وتكرار
  const legacyBoard = {
    cells: [
      { id: "x1", letter: "ؤ" },
      { id: "x2", letter: "أ" },
      { id: "x3", letter: "ى" },
      { id: "x4", letter: "ة" },
      { id: "x5", letter: "ئ" },
      { id: "x6", letter: "ب" },
      { id: "x7", letter: "ب" },
      { id: "x8", letter: "ب" },
      { id: "x9", letter: "ي" },
      { id: "x10", letter: "و" },
    ],
  };
  const fixed = normalizeBoardLetters(legacyBoard);
  check("التطبيع يحافظ على عدد الخلايا والمعرّفات",
    fixed.cells.length === 10 && fixed.cells.every((c, i) => c.id === legacyBoard.cells[i].id));
  check("التطبيع يحوّل ؤ ← و / أ ← ا / ى ← ي / ة ← ه",
    fixed.cells[0].letter === "و" && fixed.cells[1].letter === "ا" &&
      fixed.cells[2].letter === "ي" && fixed.cells[3].letter === "ه",
    fixed.cells.map((c) => c.letter).join(""));
  check("التكرار بعد التطبيع يُستبدل بحرف أساسي حرّ (ئ ← ي مكرّر)",
    fixed.cells[4].letter !== "ي" && GRID_BASE.includes(fixed.cells[4].letter) &&
      fixed.cells[5].letter === "ب" && fixed.cells[8].letter !== "ي",
    fixed.cells.map((c) => c.letter).join(""));
  check("التطبيع يجعل كل حروف اللوحة أساسية",
    fixed.cells.every((c) => GRID_BASE.includes(c.letter)), fixed.cells.map((c) => c.letter).join(""));
  check("التطبيع يزيل التكرار تماماً",
    new Set(fixed.cells.map((c) => c.letter)).size === fixed.cells.length,
    fixed.cells.map((c) => c.letter).join(""));
  check("التطبيع لا يعدّل اللوحة الأصلية",
    legacyBoard.cells.map((c) => c.letter).join("") === "ؤأىةئبببيو");

  // توزيع الحروف العشوائي: ٢٥ حرفاً بالقرعة من الـ٢٨، بلا تكرار، والحروف المستبعدة تتغيّر
  const beforeLetters = board.cells.map((c) => c.letter).join("");
  const seeded = (seed) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const drawA = randomBoardLetters(board, seeded(7));
  const drawB = randomBoardLetters(board, seeded(99));
  const lettersOf = (b) => new Set(b.cells.map((c) => c.letter));
  check("السحب العشوائي يعطي ٢٥ حرفاً أساسياً بلا تكرار",
    drawA.cells.length === 25 &&
      new Set(drawA.cells.map((c) => c.letter)).size === 25 &&
      drawA.cells.every((c) => GRID_BASE.includes(c.letter)),
    drawA.cells.map((c) => c.letter).join(""));
  check("كل جولة تستبعد ٣ حروف فقط من الـ٢٨",
    GRID_BASE.filter((l) => !lettersOf(drawA).has(l)).length === 3,
    "المستبعد: " + GRID_BASE.filter((l) => !lettersOf(drawA).has(l)).join(" "));
  check("السحب يحافظ على معرّفات الخلايا ولا يعدّل لوحة المصدر",
    drawA.cells.every((c, i) => c.id === board.cells[i].id) &&
      board.cells.map((c) => c.letter).join("") === beforeLetters);
  check("سحبتان مختلفتان تُستبعد فيهما حروف مختلفة",
    GRID_BASE.filter((l) => !lettersOf(drawA).has(l)).join("") !==
      GRID_BASE.filter((l) => !lettersOf(drawB).has(l)).join(""),
    `${GRID_BASE.filter((l) => !lettersOf(drawA).has(l)).join("")} | ${GRID_BASE.filter((l) => !lettersOf(drawB).has(l)).join("")}`);

  // تغيير حرف من الحكم: يُردّ دائماً إلى الحرف الأساسي
  const targetCell = board.cells.find((c) => last(ref).state.cells[c.id].letter === "ص")?.id || "r1c2";
  ref.send(JSON.stringify({ t: "action", action: { type: "setLetter", payload: { cellId: targetCell, letter: "ؤ" } } }));
  await sleep(250);
  check("تغيير حرف إلى «ؤ» يُحسب «و»", last(ref).state.cells[targetCell].letter === "و",
    `أصبح ${last(ref).state.cells[targetCell].letter}`);
  ref.send(JSON.stringify({ t: "action", action: { type: "reset" } }));
  await sleep(250);
  check("بعد إعادة الجولة تعود الحروف أساسية وبلا تكرار", (() => {
    const g = board.cells.map((c) => last(ref).state.cells[c.id].letter);
    return g.every((l) => GRID_BASE.includes(l)) && new Set(g).size === g.length;
  })());

  // --- الشاشة لا تستطيع الإرسال أوامر ---
  const before = last(ref).state.rev;
  screen.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: "r0c0", team: "a" } } }));
  await sleep(250);
  check("الشاشة لا تستطيع تعديل الحالة", last(ref).state.rev === before,
    `rev ${before} → ${last(ref).state.rev}`);

  // --- اختيار خلية ---
  ref.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: "r2c2" } } }));
  await sleep(250);
  let st = last(ref).state;
  check("تم اختيار الخلية r2c2", st.current.cellId === "r2c2");
  check("السؤال جاهز للحكم", !!st.current.question, st.current.question?.question?.answer);
  check("السؤال لم يظهر بعد على الشاشة", st.current.revealed === false);
  check("السؤال يطابق حرف الخلية", st.current.question?.letter === st.cells.r2c2.letter,
    `${st.current.question?.letter} / ${st.cells.r2c2.letter}`);
  check("الشاشة رأت نفس السؤال",
    last(screen).state.current.question?.answer === st.current.question?.answer);

  // --- إظهار السؤال ---
  ref.send(JSON.stringify({ t: "action", action: { type: "reveal" } }));
  await sleep(250);
  check("السؤال ظاهر الآن", last(ref).state.current.revealed === true);
  check("الشركة صارت مرئية على الشاشة أيضاً", last(screen).state.current.revealed === true);

  // --- تغيير السؤال ---
  const firstAnswer = last(ref).state.current.question.answer;
  ref.send(JSON.stringify({ t: "action", action: { type: "newQuestion" } }));
  await sleep(250);
  const secondAnswer = last(ref).state.current.question.answer;
  check("سؤال مختلف لنفس الحرف", firstAnswer !== secondAnswer, `${firstAnswer} → ${secondAnswer}`);
  check("الحرف لم يتغيّر", last(ref).state.current.cellId === "r2c2");
  check("السؤال أُخفي مجدداً", last(ref).state.current.revealed === false);

  // ---award ---
  ref.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: "r2c2", team: "a" } } }));
  await sleep(250);
  st = last(ref).state;
  check("الخلية صارت ملكاً للفريق أ", st.cells.r2c2.owner === "a");
  check("نقاط الفريق أ = 1", st.teams.a.score === 1);
  check("الشاشة يرى نفس الملكية", last(screen).state.cells.r2c2.owner === "a");

  // --- award لنفس الفريق لا يضاعف النقاط ---
  ref.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: "r2c2", team: "a" } } }));
  await sleep(250);
  check("تكرار النقاط لا يضاعفها", last(ref).state.teams.a.score === 1);

  // --- نقل الملكية ---
  ref.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: "r2c2", team: "b" } } }));
  await sleep(250);
  st = last(ref).state;
  check("نقل الخلية للفريق ب", st.cells.r2c2.owner === "b");
  check("النقاط انتقلت (أ=0، ب=1)", st.teams.a.score === 0 && st.teams.b.score === 1,
    `أ=${st.teams.a.score} ب=${st.teams.b.score}`);

  // --- إزالة ---
  ref.send(JSON.stringify({ t: "action", action: { type: "unclaim", payload: { cellId: "r2c2" } } }));
  await sleep(250);
  st = last(ref).state;
  check("الإزالة تعيد الخلية للحرة", st.cells.r2c2.owner === null);
  check("النقاط عادت لصفر", st.teams.b.score === 0);

  // --- المؤقّت ---
  ref.send(JSON.stringify({ t: "action", action: { type: "setTurn", payload: { turn: "a" } } }));
  ref.send(JSON.stringify({ t: "action", action: { type: "startTimer", payload: { seconds: 3 } } }));
  await sleep(250);
  st = last(ref).state;
  check("المؤقّت يعمل", st.current.timer.running === true && st.current.timer.total === 3);
  check("الوقت المتبقي محسوب", st.current.timer.endsAt > Date.now());
  await sleep(3200);
  check("المؤقّت توقّف تلقائياً بعد انتهائه", last(ref).state.current.timer.running === false,
    `phase=${last(ref).state.phase}`);

  // --- ربط طرفي الفريق أ (أعلى↔أسفل) = الفوز ---
  // العمود r2c2 فوق r1c2 فوق r0c2 (أعلى) وبجوار r3c2 ثم r4c2 (أسفل)
  const chain = ["r0c2", "r1c2", "r2c2", "r3c2", "r4c2"];
  for (const id of chain) {
    ref.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: id, team: "a" } } }));
  }
  await sleep(400);
  st = last(ref).state;
  check("الفريق أ ربط الأعلى بالأسفل", st.winner === "a", `winner=${st.winner}`);
  check("الشاشة ترى الفوز", last(screen).state.winner === "a");
  check("لعبة انتهت", st.phase === "over");

  // --- إعادة الجولة ---
  ref.send(JSON.stringify({ t: "action", action: { type: "reset" } }));
  await sleep(300);
  st = last(ref).state;
  check("الجولة الجديدة تفرّغ اللوحة", Object.values(st.cells).every((c) => c.owner === null));
  check("النقاط صفر", st.teams.a.score === 0 && st.teams.b.score === 0);
  check("لا يوجد فائز", st.winner === null);

  // --- ربط طرفي الفريق ب (يمين↔يسار) = الفوز ---
  const row2 = ["r2c0", "r2c1", "r2c2", "r2c3", "r2c4"];
  for (const id of row2) {
    ref.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: id, team: "b" } } }));
  }
  await sleep(400);
  check("الفريق ب ربط اليمين باليسار", last(ref).state.winner === "b");

  // --- إعادة الاتصال ---
  ref.close();
  await sleep(400);
  const ref2 = await connect("referee", "main", pairCode);
  await sleep(300);
  check("الحكم استعاد الحالة بعد إعادة الاتصال", ref2.states.length >= 1 && last(ref2).t === "state");
  check("الحالة المستعادة مطابقة", last(ref2).state.winner === "b");

  /* ---------------- أجراس الجوال (buzzers) ---------------- */
  log("\n\x1b[36m▸ أجراس اللاعبين\x1b[0m");

  ref2.send(JSON.stringify({ t: "action", action: { type: "reset" } }));
  await sleep(250);

  const buzzA = await connect("buzzer", "main", "", { team: "a" });
  const buzzB = await connect("buzzer", "main", "", { team: "b" });
  await sleep(250);

  check("الحكم يرى جرسي الفريقين متّصلين",
    last(ref2).peers.buzzerA >= 1 && last(ref2).peers.buzzerB >= 1,
    `a=${last(ref2).peers.buzzerA} b=${last(ref2).peers.buzzerB}`);

  check("الأجراس مفعّلة افتراضياً (تجربة تلقائية)", last(ref2).state.current.buzz.enabled === true);
  check("مؤقّت الضاغط الأول الافتراضي 3 ثوانٍ",
    last(ref2).state.current.buzz.seconds === 3, String(last(ref2).state.current.buzz.seconds));
  check("مؤقّت اللاعب الثاني الافتراضي 10 ثوانٍ",
    last(ref2).state.current.buzz.otherSeconds === 10, String(last(ref2).state.current.buzz.otherSeconds));

  // إيقاف الأجراس يدوياً ثم الضغط → مرفوضة
  ref2.send(JSON.stringify({
    t: "action",
    action: { type: "buzzConfig", payload: { enabled: false } },
  }));
  await sleep(200);
  check("يمكن إيقاف الأجراس يدوياً", last(ref2).state.current.buzz.enabled === false);
  buzzA.send(JSON.stringify({ t: "buzz" }));
  await sleep(200);
  check("الضغط والأجراس متوقفة يُرفض",
    lastOf(buzzA, "buzzed")?.ok === false && lastOf(buzzA, "buzzed")?.reason === "disabled",
    lastOf(buzzA, "buzzed")?.reason);
  check("لا فائز من ضغطة مرفوضة", last(ref2).state.current.buzz.winner === null);

  // تفعيل الأجراس + ضبط مؤقّتي اللاعبين
  ref2.send(JSON.stringify({
    t: "action",
    action: { type: "buzzConfig", payload: { enabled: true, autoArm: true, seconds: 5, otherSeconds: 5 } },
  }));
  await sleep(200);
  st = last(ref2).state;
  check("تم تفعيل الأجراس", st.current.buzz.enabled === true && st.current.buzz.autoArm === true);
  check("مدة مؤقّت الجرس = 5", st.current.buzz.seconds === 5, String(st.current.buzz.seconds));
  check("مدة مؤقّت اللاعب الثاني = 5", st.current.buzz.otherSeconds === 5, String(st.current.buzz.otherSeconds));

  // اختيار خلية + كشف السؤال → تُفتح الأجراس تلقائياً
  const roundBefore = last(ref2).state.current.round;
  ref2.send(JSON.stringify({
    t: "action",
    action: { type: "select", payload: { cellId: "r1c1", question: { letter: "أ", text: "سؤال تجريبي", answer: "الجواب" } } },
  }));
  await sleep(200);
  st = last(ref2).state;
  check("اختيار خلية يغلق الأجراس", st.current.buzz.open === false);
  check("اختيار خلية يزيد عدّاد الجولة (تصفير تلقائي)",
    st.current.round > roundBefore, `${roundBefore} → ${st.current.round}`);
  check("اختيار خلية يصفّر المؤقّت والدور والنقطة",
    st.current.timer.running === false && st.current.turn === null && st.current.verdict === null);

  ref2.send(JSON.stringify({ t: "action", action: { type: "reveal" } }));
  await sleep(200);
  st = last(ref2).state;
  check("كشف السؤال يفتح الأجراس تلقائياً", st.current.buzz.open === true);
  check("لا يصل نص الإجابة إلى جوال اللاعب",
    last(buzzA).state.current.question?.answer === undefined,
    JSON.stringify(last(buzzA).state.current.question));
  check("نص السؤال يصل إلى جوال اللاعب",
    last(buzzA).state.current.question?.text === last(ref2).state.current.question?.text);
  check("الحكم يرى الإجابة كاملة",
    typeof last(ref2).state.current.question?.answer === "string" &&
      last(ref2).state.current.question.answer.length > 0);

  // ضغطتان في الوقت نفسه → أول ضغطة فقط
  buzzA.send(JSON.stringify({ t: "buzz" }));
  buzzB.send(JSON.stringify({ t: "buzz" }));
  await sleep(350);
  st = last(ref2).state;
  const buzzWinner = st.current.buzz.winner;
  const buzzLoser = buzzWinner === "a" ? "b" : "a";
  const buzzWinWs = buzzWinner === "a" ? buzzA : buzzB;
  const buzzLoseWs = buzzWinner === "a" ? buzzB : buzzA;
  check("أول ضغطة تُثبّت فائزاً", buzzWinner === "a" || buzzWinner === "b", `winner=${buzzWinner}`);
  check("الفائز استلم تأكيد ok", lastOf(buzzWinWs, "buzzed")?.ok === true);
  check("الخاسر استلم رفضاً (taken)",
    lastOf(buzzLoseWs, "buzzed")?.ok === false && lastOf(buzzLoseWs, "buzzed")?.reason === "taken",
    lastOf(buzzLoseWs, "buzzed")?.reason);
  check("الأجراس أُغلقت بعد الفوز", st.current.buzz.open === false);
  check("الدور انتقل للفائز", st.current.turn === buzzWinner, `turn=${st.current.turn}`);
  check("المؤقّت انطلق تلقائياً بمدّة الجرس",
    st.current.timer.running === true && st.current.timer.total === 5,
    `${st.current.timer.running}/${st.current.timer.total}`);
  check("المؤقّت مؤقّت إجابة (answer) في الجولة ١",
    st.current.timer.stage === "answer" && st.current.buzz.stage === 1,
    `${st.current.timer.stage}/${st.current.buzz.stage}`);
  check("الشاشة ترى فائز الجرس", last(screen).state.current.buzz.winner === buzzWinner);
  check("الحكم يرى المؤقّت يعمل", last(ref2).state.current.timer.running === true);

  // ضغطات إضافية تُتجاهل
  const atBefore = st.current.buzz.at;
  buzzA.send(JSON.stringify({ t: "buzz" }));
  buzzB.send(JSON.stringify({ t: "buzz" }));
  await sleep(250);
  check("الضغطات اللاحقة لا تغيّر الفائز",
    last(ref2).state.current.buzz.winner === buzzWinner &&
    last(ref2).state.current.buzz.at === atBefore);

  // انتهاء وقت أول ضاغط → الجولة ٢: دور الفريق الآخر (يجيبون بصوت عالٍ) لمدة otherSeconds
  ref2.send(JSON.stringify({ t: "action", action: { type: "timerEnd" } }));
  await sleep(250);
  st = last(ref2).state;
  check("انتهاء وقت أول ضاغط يبدأ دور الفريق الآخر (الجولة ٢)",
    st.current.buzz.stage === 2 && st.current.buzz.phase === "team" &&
    st.current.buzz.allowed === buzzLoser && st.current.turn === buzzLoser,
    `stage=${st.current.buzz.stage} phase=${st.current.buzz.phase} allowed=${st.current.buzz.allowed}`);
  check("مؤقّت الجولة ٢ يعمل بمدة otherSeconds",
    st.current.timer.stage === "team" && st.current.timer.running === true && st.current.timer.total === 5,
    `${st.current.timer.stage}/${st.current.timer.running}/${st.current.timer.total}`);
  check("أول ضاغط سُجّل «انتهى الوقت» في التاريخ",
    st.current.buzz.history[0]?.team === buzzWinner && st.current.buzz.history[0]?.result === "timeout");
  check("الشاشة ترى دور الفريق الآخر", last(screen).state.current.turn === buzzLoser);

  // لا أجراس في الجولة ٢ (الفريق يجيب بصوت عالٍ)
  buzzLoseWs.send(JSON.stringify({ t: "buzz" }));
  await sleep(200);
  check("الأجراس لا تعمل في الجولة ٢",
    last(ref2).state.current.buzz.phase === "team" && lastOf(buzzLoseWs, "buzzed")?.ok === false);

  // ❌ لا يُنهي الجولة ٢ مبكراً
  ref2.send(JSON.stringify({ t: "action", action: { type: "buzzWrong" } }));
  await sleep(200);
  check("❌ لا يُنهي دور الفريق الآخر مبكراً", last(ref2).state.current.buzz.phase === "team");

  // انتهى وقت الفريق الآخر → الجولة ٣ مفتوحة للجميع بلا وقت
  ref2.send(JSON.stringify({ t: "action", action: { type: "timerEnd" } }));
  await sleep(250);
  st = last(ref2).state;
  check("انتهاء الجولة ٢ يفتح الجولة ٣ للجميع بلا وقت",
    st.current.buzz.stage === 3 && st.current.buzz.phase === "all" && st.current.timer.running === false,
    `stage=${st.current.buzz.stage} phase=${st.current.buzz.phase} timer=${st.current.timer.running}`);

  // إعلان النقطة يُسجّل verdict (يُظهر الاحتفال على جوال الفائز)
  ref2.send(JSON.stringify({ t: "action", action: { type: "award", payload: { cellId: "r1c1", team: buzzWinner } } }));
  await sleep(250);
  st = last(ref2).state;
  check("إعلان النقطة يسجّل verdict للفريق الصحيح",
    st.current.verdict?.team === buzzWinner, JSON.stringify(st.current.verdict));
  check("الشاشة ترى النقطة المُعلنة", last(screen).state.current.verdict?.team === buzzWinner);

  // منح النقطة يكشف الجواب على الشاشة تلقائياً (ليعرف الجميع الجواب الصحيح)
  check("منح النقطة يكشف السؤال والجواب على الشاشة",
    st.current.revealed === true && st.current.answerRevealed === true,
    `${st.current.revealed}/${st.current.answerRevealed}`);
  check("منح النقطة يوقف المؤقّت ويغلق الأجراس",
    st.current.timer.running === false && st.current.buzz.open === false);
  const bzAfterAward = last(buzzA).state.current.question;
  check("جوال اللاعب يرى الجواب بعد كشفه على الشاشة",
    !!bzAfterAward?.answer && bzAfterAward.answer === st.current.question.answer,
    JSON.stringify(bzAfterAward));

  // «لم يُجب أحد»: يكشف الجواب بلا نقطة لأحد، وتبقى الخلية حرّة
  {
    ref2.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: "r2c2" } } }));
    await sleep(250);
    const bzQ = last(buzzA).state.current.question;
    check("جوال اللاعب لا يرى الجواب قبل كشفه", bzQ && bzQ.answer === undefined, JSON.stringify(bzQ));
    const before = last(ref2).state;
    const scoreSum = before.teams.a.score + before.teams.b.score;
    ref2.send(JSON.stringify({ t: "action", action: { type: "noPoint", payload: { cellId: "r2c2" } } }));
    await sleep(250);
    const s2 = last(ref2).state;
    check("«لم يُجب أحد» يكشف الجواب على الشاشة",
      s2.current.revealed === true && s2.current.answerRevealed === true);
    check("«لم يُجب أحد» يسجّل missed ولا يسجّل نقطة",
      s2.current.missed?.cellId === "r2c2" && s2.current.verdict === null &&
      s2.teams.a.score + s2.teams.b.score === scoreSum);
    check("«لم يُجب أحد» يُبقي الخلية حرّة ويلغي تحديدها",
      s2.cells.r2c2.owner === null && s2.current.cellId === null);
    check("جوال اللاعب يرى الجواب بعد «لم يُجب أحد»", !!last(buzzA).state.current.question?.answer);
  }

  // نظام اللاعبين: QR واحد، اسم + فريق، الجولات الثلاث، ✅/❌، التراجع
  {
    let pageOk = false;
    try {
      const r = await fetch(BASE + "/play");
      pageOk = r.ok && (await r.text()).includes("joinView");
    } catch {}
    check("صفحة اللاعبين /play تعمل وفيها شاشة الانضمام", pageOk);

    // نوقف أجراس الفرق القديمة حتى لا تدخل في حساب «من متصل»
    buzzA.close();
    buzzB.close();
    const p1 = await connect("player", "main", "", { playerId: "testP1xx" });
    const p2 = await connect("player", "main", "", { playerId: "testP2xx" });
    const p3 = await connect("player", "main", "", { playerId: "testP3xx" });
    await sleep(200);
    p1.send(JSON.stringify({ t: "join", name: "أحمد", team: "a" }));
    p2.send(JSON.stringify({ t: "join", name: "سارة", team: "a" }));
    p3.send(JSON.stringify({ t: "join", name: "أحمد", team: "b" }));
    await sleep(300);
    let s3 = last(ref2).state;
    check("ثلاثة لاعبين انضمّوا بأسمائهم وفرقهم",
      s3.players.testP1xx?.team === "a" && s3.players.testP2xx?.team === "a" && s3.players.testP3xx?.team === "b");
    check("الاسم المكرّر يُميَّز تلقائياً", s3.players.testP3xx?.name === "أحمد 2", s3.players.testP3xx?.name);
    check("الحكم يرى اللاعبين المتصلين",
      ["testP1xx", "testP2xx", "testP3xx"].every((id) => (last(ref2).peers?.players || []).includes(id)));

    ref2.send(JSON.stringify({ t: "action", action: { type: "buzzConfig", payload: { enabled: true, autoArm: true, seconds: 5, otherSeconds: 8 } } }));
    ref2.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: "r0c0" } } }));
    await sleep(200);
    ref2.send(JSON.stringify({ t: "action", action: { type: "reveal" } }));
    await sleep(250);
    check("جوال اللاعب لا يرى الجواب قبل كشفه", last(p1).state.current.question && last(p1).state.current.question.answer === undefined);
    check("كشف السؤال يفتح الجولة ١ للجميع",
      last(ref2).state.current.buzz.stage === 1 && last(ref2).state.current.buzz.phase === "open");

    p3.send(JSON.stringify({ t: "buzz" }));
    await sleep(250);
    s3 = last(ref2).state;
    check("أول ضاغط يجيب ويظهر اسمه", s3.current.buzz.player?.id === "testP3xx" && s3.current.buzz.player?.name === "أحمد 2");
    check("أسرع ضغطة تُسجَّل للاعب", s3.players.testP3xx.buzzes === 1 && s3.players.testP3xx.fastest != null);

    ref2.send(JSON.stringify({ t: "action", action: { type: "buzzWrong" } }));
    await sleep(250);
    s3 = last(ref2).state;
    check("❌ خطأ في الجولة ١ يبدأ دور الفريق الآخر",
      s3.current.buzz.stage === 2 && s3.current.buzz.phase === "team" && s3.current.buzz.allowed === "a");

    p2.send(JSON.stringify({ t: "buzz" }));
    await sleep(200);
    check("لا أجراس في الجولة ٢", lastOf(p2, "buzzed")?.ok === false);

    ref2.send(JSON.stringify({ t: "action", action: { type: "buzzCorrect" } }));
    await sleep(250);
    s3 = last(ref2).state;
    check("✅ في الجولة ٢: الخلية للفريق صاحب الدور بلا نقطة لاعب",
      s3.cells.r0c0.owner === "a" && s3.current.verdict?.playerId === null &&
      s3.players.testP1xx.score === 0 && s3.players.testP2xx.score === 0);
    check("✅ صح يكشف الجواب على الشاشة", s3.current.answerRevealed === true);

    // الجولة ١ صح → نقطة للاعب نفسه
    ref2.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: "r0c1" } } }));
    await sleep(200);
    ref2.send(JSON.stringify({ t: "action", action: { type: "reveal" } }));
    await sleep(200);
    p1.send(JSON.stringify({ t: "buzz" }));
    await sleep(250);
    ref2.send(JSON.stringify({ t: "action", action: { type: "buzzCorrect" } }));
    await sleep(250);
    s3 = last(ref2).state;
    check("✅ في الجولة ١: الخلية للفريق ونقطة للاعب الذي ضغط",
      s3.cells.r0c1.owner === "a" && s3.players.testP1xx.score === 1 && s3.current.verdict?.playerId === "testP1xx");

    // الجولة ٣: الحكم يختار الفريق
    ref2.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: "r0c2" } } }));
    await sleep(200);
    ref2.send(JSON.stringify({ t: "action", action: { type: "reveal" } }));
    await sleep(200);
    p1.send(JSON.stringify({ t: "buzz" }));
    await sleep(200);
    ref2.send(JSON.stringify({ t: "action", action: { type: "buzzWrong" } }));
    await sleep(200);
    ref2.send(JSON.stringify({ t: "action", action: { type: "timerEnd" } }));
    await sleep(200);
    check("الجولة ٣ مفتوحة للجميع", last(ref2).state.current.buzz.phase === "all");
    ref2.send(JSON.stringify({ t: "action", action: { type: "buzzCorrect", payload: { team: "b" } } }));
    await sleep(250);
    s3 = last(ref2).state;
    check("✅ في الجولة ٣: الحكم يختار الفريق بلا نقطة لاعب",
      s3.cells.r0c2.owner === "b" && s3.players.testP3xx.score === 0 && s3.current.verdict?.team === "b");

    // ↩️ تراجع عن آخر قرار
    ref2.send(JSON.stringify({ t: "action", action: { type: "undo" } }));
    await sleep(250);
    s3 = last(ref2).state;
    check("↩️ التراجع يعيد الخلية حرّة", s3.cells.r0c2.owner === null, String(s3.cells.r0c2.owner));
    check("↩️ التراجع يُبقي اللاعبين المسجّلين", !!s3.players.testP1xx && !!s3.players.testP3xx);

    // الحكم ينقل لاعباً ويخرج آخر
    ref2.send(JSON.stringify({ t: "action", action: { type: "playerSetTeam", payload: { id: "testP1xx", team: "b" } } }));
    ref2.send(JSON.stringify({ t: "action", action: { type: "playerRemove", payload: { id: "testP3xx" } } }));
    await sleep(300);
    s3 = last(ref2).state;
    check("الحكم ينقل لاعباً للفريق الآخر", s3.players.testP1xx?.team === "b");
    check("الحكم يخرج لاعباً", !s3.players.testP3xx);
    check("جوال اللاعب المُخرج يُبلَّغ", p3.states.some((m) => m.t === "kicked"));

    // 🔀 خلط الحروف الحرّة لا يمسّ النقاط
    const before = last(ref2).state;
    ref2.send(JSON.stringify({ t: "action", action: { type: "shuffle" } }));
    await sleep(250);
    const after = last(ref2).state;
    const ownedSame = Object.values(before.cells).filter((c) => c.owner).every((c) => after.cells[c.id].letter === c.letter && after.cells[c.id].owner === c.owner);
    check("🔀 الخلط يُبقي الخلايا المملوكة والنقاط",
      ownedSame && after.teams.a.score === before.teams.a.score && after.teams.b.score === before.teams.b.score);
    check("🔀 الخلط لا يكرّر الحروف", new Set(Object.values(after.cells).map((c) => c.letter)).size === Object.keys(after.cells).length);

    p1.close(); p2.close(); p3.close();
    await sleep(150);
  }

  // ================= السهرة: قائمة الألعاب + «الكلمة الممنوعة» =================
  {
    log("\x1b[36m▸ قائمة الألعاب والكلمة الممنوعة\x1b[0m");
    const packsRes = await (await fetch(BASE + "/api/taboo/packs")).json();
    const totalCards = (packsRes.packs || []).reduce((n, p) => n + p.total, 0);
    check("مواضيع الكلمة الممنوعة: ١٠ مواضيع على الأقل", (packsRes.packs || []).length >= 10, String(packsRes.packs?.length));
    check("٥٠٠ بطاقة على الأقل", totalCards >= 500, String(totalCards));
    check("كل موضوع فيه ٥٠ بطاقة على الأقل", (packsRes.packs || []).every((p) => p.total >= 50));
    let pageOk = false;
    try {
      const r = await fetch(BASE + "/taboo-packs");
      pageOk = r.ok && (await r.text()).includes("الكلمة الممنوعة");
    } catch {}
    check("صفحة إدارة المواضيع /taboo-packs تعمل", pageOk);

    const send = (type, payload = {}) => ref2.send(JSON.stringify({ t: "action", action: { type, payload } }));
    const st = () => last(ref2).state;

    // لاعبان في كل فريق
    const pa1 = await connect("player", "main", "", { playerId: "tabooA1x" });
    const pa2 = await connect("player", "main", "", { playerId: "tabooA2x" });
    const pb1 = await connect("player", "main", "", { playerId: "tabooB1x" });
    const pb2 = await connect("player", "main", "", { playerId: "tabooB2x" });
    await sleep(200);
    pa1.send(JSON.stringify({ t: "join", name: "عمر", team: "a" }));
    pa2.send(JSON.stringify({ t: "join", name: "هند", team: "a" }));
    pb1.send(JSON.stringify({ t: "join", name: "زياد", team: "b" }));
    pb2.send(JSON.stringify({ t: "join", name: "رنا", team: "b" }));
    await sleep(300);
    const phones = { tabooA1x: pa1, tabooA2x: pa2, tabooB1x: pb1, tabooB2x: pb2 };

    send("setGame", { game: null });
    await sleep(200);
    check("قائمة الألعاب: لا لعبة مختارة", st().game === null);
    check("نقاط السهرة موجودة", typeof st().night?.a === "number" && typeof st().night?.b === "number");
    const nightBefore = { ...st().night };

    // ثيم نظام التصميم: مفتاح ds صالح يُحفظ، وغير الصالح يُتجاهل
    check("الثيم الافتراضي ds = hussein", st().theme.ds === "hussein", String(st().theme.ds));
    send("setTheme", { ds: "ramadan" });
    await sleep(150);
    check("setTheme {ds:'ramadan'} يحفظ الثيم", st().theme.ds === "ramadan", String(st().theme.ds));
    send("setTheme", { ds: "bogus" });
    await sleep(150);
    check("setTheme {ds:'bogus'} يُتجاهل", st().theme.ds === "ramadan", String(st().theme.ds));
    send("setTheme", { ds: "hussein" });
    await sleep(150);

    send("tabooConfig", { target: 3, turnSeconds: 60 });
    send("setGame", { game: "taboo" });
    await sleep(250);
    check("اختيار «الكلمة الممنوعة» ينقل الجميع إليها", st().game === "taboo" && last(screen).state.game === "taboo" && last(pa1).state.game === "taboo");
    check("لعبة جديدة تبدأ بشاشة القوانين وقرعة الفريق البادئ",
      st().taboo.phase === "rules" && ["a", "b"].includes(st().taboo.startTeam), st().taboo.phase);
    check("لكل فريق تخطّيان", st().taboo.skips.a === 2 && st().taboo.skips.b === 2);

    send("tabooBegin");
    await sleep(250);
    let t = st().taboo;
    const T = t.turnTeam;
    const O = T === "a" ? "b" : "a";
    check("الدور الأول للفريق البادئ مع شارح من الفريق نفسه",
      t.phase === "ready" && T === t.startTeam && t.describer && st().players[t.describer.id]?.team === T);

    // 👁️ الحكم يرى بطاقة الدور القادم قبل البدء، ولا يراها غيره
    const preview1 = last(ref2).state.taboo.card;
    check("👁️ الحكم يرى أول كلمة قبل بدء الدور", !!preview1?.word && preview1.forbidden?.length > 0);
    check("🔒 قبل الدور: الشاشة والجوالات لا تصلها البطاقة",
      !last(screen).state.taboo.card && Object.values(phones).every((ws) => !last(ws).state.taboo.card));
    send("tabooSwap");
    await sleep(250);
    const preview2 = last(ref2).state.taboo.card;
    check("🔄 الحكم يبدّل الكلمة قبل الدور", preview2?.word && preview2.word !== preview1.word, `${preview1.word} → ${preview2?.word}`);

    send("tabooStartTurn");
    await sleep(300);
    t = st().taboo;
    check("▶️ الدور يبدأ بالكلمة التي اختارها الحكم", t.card?.word === preview2.word);
    check("بدء الدور: بطاقة فيها كلمة وكلمات ممنوعة والعدّاد يعمل",
      t.phase === "turn" && !!t.card?.word && t.card.forbidden.length >= 3 && t.timer.running === true);

    // السرّية: كل جهاز يرى ما يحقّ له فقط
    const descId = t.describer.id;
    const mate = Object.keys(phones).find((id) => id !== descId && st().players[id].team === T);
    const rival = Object.keys(phones).find((id) => st().players[id].team === O);
    const cardOf = (ws) => last(ws).state.taboo.card || {};
    check("🔒 الشارح يرى الكلمة والممنوعة", cardOf(phones[descId]).word === t.card.word && cardOf(phones[descId]).forbidden?.length > 0);
    check("🔒 زميل الشارح لا يرى الكلمة ولا الممنوعة", !cardOf(phones[mate]).word && !cardOf(phones[mate]).forbidden);
    check("🔒 الفريق الآخر يرى الممنوعة فقط بلا الكلمة", !cardOf(phones[rival]).word && cardOf(phones[rival]).forbidden?.length > 0);
    check("🔒 التلفاز لا يرى الكلمة ولا الممنوعة", !cardOf(screen).word && !cardOf(screen).forbidden && !!cardOf(screen).topic);
    check("🔒 الحكم يرى كل شيء", last(ref2).state.taboo.card.word === t.card.word);

    // ✅ صح → +1 وبطاقة جديدة
    const firstWord = t.card.word;
    send("tabooRight");
    await sleep(250);
    t = st().taboo;
    check("✅ صح: +1 وتظهر الكلمة التالية فوراً", t.score[T] === 1 && t.card?.word && t.card.word !== firstWord && t.phase === "turn");

    // ⏭ التخطّي من جوال الشارح فقط
    phones[mate].send(JSON.stringify({ t: "tabooSkip" }));
    await sleep(200);
    check("⏭ غير الشارح لا يستطيع التخطّي", st().taboo.skips[T] === 2);
    phones[descId].send(JSON.stringify({ t: "tabooSkip" }));
    await sleep(250);
    check("⏭ الشارح يتخطّى من جواله (بقي واحد)", st().taboo.skips[T] === 1);

    // 🔄 تبديل مجاني من الحكم: كلمة جديدة ولا يُحسب على الفريق
    const beforePass = st().taboo.card.word;
    send("tabooPass");
    await sleep(250);
    check("🔄 التبديل المجاني يغيّر الكلمة ولا ينقص التخطّيات",
      st().taboo.card.word !== beforePass && st().taboo.skips[T] === 1 &&
      st().taboo.turnLog.some((l) => l.result === "pass" && l.word === beforePass));

    // 🚫 مخالفة → ‎-1 وينتهي الدور
    send("tabooFoul", { reason: "letter" });
    await sleep(250);
    t = st().taboo;
    check("🚫 مخالفة: ‎-1 وينتهي الدور فوراً مع السبب",
      t.score[T] === 0 && t.phase === "turnEnd" && t.foul?.reason === "letter");
    check("بعد انتهاء الدور تُكشف كلماته للجميع", last(screen).state.taboo.turnLog.length >= 3);

    // الدور التالي للفريق الآخر
    send("tabooNextTurn");
    await sleep(250);
    t = st().taboo;
    check("الدور التالي للفريق الآخر مع شارح منه", t.phase === "ready" && t.turnTeam === O && st().players[t.describer?.id]?.team === O);

    send("tabooStartTurn");
    await sleep(200);
    send("tabooFoul", { reason: "word" });
    await sleep(250);
    check("النتيجة لا تنزل تحت الصفر", st().taboo.score[O] === 0);

    // الوصول لحدّ الفوز
    send("tabooNextTurn");
    await sleep(200);
    send("tabooStartTurn");
    await sleep(200);
    for (let i = 0; i < 3; i++) {
      send("tabooRight");
      await sleep(150);
    }
    await sleep(200);
    t = st().taboo;
    check("أول فريق يصل حدّ الفوز يفوز", t.phase === "over" && t.winner === T && t.score[T] === 3);
    check("الفوز يضيف +1 لنقاط السهرة", st().night[T] === nightBefore[T] + 1);

    // التبديل بين الألعاب يحفظ الحالة
    send("setGame", { game: "huroof" });
    await sleep(200);
    send("setGame", { game: "taboo" });
    await sleep(200);
    check("التبديل بين الألعاب يحفظ حالة كل لعبة", st().taboo.phase === "over" && st().taboo.winner === T);

    send("tabooNew");
    await sleep(200);
    check("لعبة جديدة: النقاط صفر والتخطّيات تتجدّد ونقاط السهرة تبقى",
      st().taboo.score.a === 0 && st().taboo.score.b === 0 && st().taboo.skips[T] === 2 && st().night[T] === nightBefore[T] + 1);

    // ⏭ عدد التخطّيات يحدّده الحكم (٠–١٠ أو بلا حدّ)
    send("tabooConfig", { skipsPerGame: 5 });
    await sleep(150);
    check("⏭ الحكم يغيّر عدد التخطّيات إلى ٥", st().taboo.skipsPerGame === 5 && st().taboo.skips.a === 5 && st().taboo.skips.b === 5);
    send("tabooConfig", { skipsPerGame: -1 });
    await sleep(150);
    check("⏭ خيار «بلا حدّ»", st().taboo.skipsPerGame === -1 && st().taboo.skips.a === -1);
    send("tabooBegin");
    await sleep(200);
    send("tabooStartTurn");
    await sleep(200);
    const T2 = st().taboo.turnTeam;
    for (let i = 0; i < 4; i++) {
      send("tabooSkip");
      await sleep(120);
    }
    check("⏭ بلا حدّ: التخطّي يعمل مراراً", st().taboo.turnLog.filter((l) => l.result === "skip").length === 4 && st().taboo.phase === "turn");
    send("tabooConfig", { skipsPerGame: 6 });
    await sleep(150);
    check("⏭ تغيير العدد أثناء اللعبة يحتسب ما استُهلك", st().taboo.skips[T2] === 2 && st().taboo.skips[T2 === "a" ? "b" : "a"] === 6,
      JSON.stringify(st().taboo.skips));
    send("tabooConfig", { skipsPerGame: 2 });
    await sleep(150);
    check("⏭ لا يصبح المتبقّي سالباً", st().taboo.skips[T2] === 0);
    send("tabooConfig", { skipsPerGame: 2 });
    send("tabooNew");
    await sleep(200);

    send("setGame", { game: "huroof" });
    await sleep(200);
    pa1.close(); pa2.close(); pb1.close(); pb2.close();
    await sleep(150);
  }

  // التحكم بالشاشة الكبيرة من جوال الحكم
  {
    check("قائمة البداية ظاهرة افتراضياً", last(screen).state.screen?.lobby === true);
    ref2.send(JSON.stringify({ t: "action", action: { type: "screen", payload: { lobby: false } } }));
    await sleep(200);
    check("الحكم يُخفي قائمة البداية من جواله", last(screen).state.screen.lobby === false);
    ref2.send(JSON.stringify({ t: "action", action: { type: "screen", payload: { sound: false } } }));
    await sleep(200);
    check("الحكم يكتم صوت الشاشة دون تغيير القائمة",
      last(screen).state.screen.sound === false && last(screen).state.screen.lobby === false);
    ref2.send(JSON.stringify({ t: "action", action: { type: "screen", payload: { qr: "net" } } }));
    await sleep(200);
    check("🔗 الحكم يختار رموز الإنترنت فقط على التلفاز", last(screen).state.screen.qr === "net");
    ref2.send(JSON.stringify({ t: "action", action: { type: "screen", payload: { qr: "both" } } }));
    await sleep(150);
    // الشاشة لا تستطيع إرسال أوامر (للعرض فقط)
    screen.send(JSON.stringify({ t: "action", action: { type: "screen", payload: { lobby: true, sound: true } } }));
    await sleep(200);
    check("الشاشة نفسها لا تستطيع تغيير إعداداتها", last(ref2).state.screen.lobby === false);
    ref2.send(JSON.stringify({ t: "action", action: { type: "screen", payload: { lobby: true, sound: true } } }));
    await sleep(200);
  }

  // إعادة الأجراس يدوياً
  ref2.send(JSON.stringify({ t: "action", action: { type: "buzzReset" } }));
  await sleep(200);
  check("زر إعادة الأجراس يفرّغ الفائز", last(ref2).state.current.buzz.winner === null);
  check("زر إعادة الأجراس يوقف المؤقّت", last(ref2).state.current.timer.running === false);

  // اختيار حرف آخر يصفّر الأجراس والمؤقّت ويمسح النقطة
  ref2.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: "r3c3" } } }));
  await sleep(250);
  st = last(ref2).state;
  check("اختيار حرف جديد يصفّر الأجراس والمؤقّت",
    st.current.buzz.winner === null && st.current.buzz.open === false && st.current.timer.running === false);
  check("اختيار حرف جديد يمسح النقطة السابقة", st.current.verdict === null);

  // الحكم يفتح الإجابة يدوياً بدون كشف السؤال
  ref2.send(JSON.stringify({ t: "action", action: { type: "buzzOpen" } }));
  await sleep(200);
  st = last(ref2).state;
  check("زر «افتح الإجابة» يفتح الأجراس بدون كشف السؤال",
    st.current.buzz.open === true && st.current.revealed === false);
  check("الشاشة تُظهر شارة «اضغط الآن»",
    last(screen).state.current.buzz.open === true && last(screen).state.current.revealed === false);

  // إيقاف الأجراس يصفّرها
  ref2.send(JSON.stringify({
    t: "action",
    action: { type: "buzzConfig", payload: { enabled: false } },
  }));
  await sleep(200);
  st = last(ref2).state;
  check("إيقاف الأجراس يغلقها ويصفّر الفائز",
    st.current.buzz.enabled === false && st.current.buzz.open === false && st.current.buzz.winner === null);

  buzzA.close();
  buzzB.close();
  await sleep(200);
  check("مغادرة الأجراس تُحدّث العدّاد",
    last(ref2).peers.buzzerA === 0 && last(ref2).peers.buzzerB === 0,
    `a=${last(ref2).peers.buzzerA} b=${last(ref2).peers.buzzerB}`);


  // --- غرف منفصلة ---
  const otherScreen = await connect("screen", "room2");
  await sleep(150);
  const other = await connect("referee", "room2", last(otherScreen).pairing.code);
  await sleep(250);
  check("الغرفة الأخرى معزولة", last(other).state.teams.b.score === 0 && last(other).state.winner === null);

  // ================= مجموعات الأسئلة (Presets) =================
  log("\n\x1b[36m— مجموعات الأسئلة —\x1b[0m");

  const apiGet = (p) => fetch(`${BASE}${p}`).then((r) => r.json());
  const apiPost = (p, body) =>
    fetch(`${BASE}${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  // تنظيف بقايا تشغيل سابق
  await apiPost("/api/presets/delete", { id: "__test__" }).catch(() => {});

  const list1 = await apiGet("/api/presets");
  check("واجهة المجموعات تستجيب", list1.ok === true && Array.isArray(list1.presets));

  const pageRes = await fetch(`${BASE}/presets`);
  check("صفحة إدارة المجموعات تُخدم", pageRes.ok === true);
  const cssRes = await fetch(`${BASE}/css/presets.css`);
  check("تنسيق المجموعات يُخدم", cssRes.ok === true);
  const jsRes = await fetch(`${BASE}/js/presets.js`);
  check("سكربت المجموعات يُخدم", jsRes.ok === true);
  const unitRes = await fetch(`${BASE}/shared/letters.js`);
  const unitTxt = await unitRes.text();
  check("وحدة تطبيع الحروف تُخدم للمتصفّح", unitRes.ok && unitTxt.includes("letterOfAnswer"));
  check("الأسئلة القديمة رُحِّلت إلى مجموعة", list1.presets.length >= 1,
    list1.presets.map((p) => `${p.name}:${p.total}`).join(", "));
  const migratedPreset = list1.presets.find((p) => p.id !== "__test__");
  check("المجموعة المرحّلة فيها أسئلة", (migratedPreset?.total || 0) > 0, String(migratedPreset?.total));

  // استنتاج الحرف تلقائياً من الجواب
  const sheet = [
    "سؤال\tجواب",
    "ما عاصمة فرنسا؟\tباريس",
    "من كتب المقدمة؟\tابن خلدون",
    "ما أكبر كوكب؟\tالمشتري",
    "سؤال بلا جواب\t",
  ].join("\n");
  const parsed = await apiPost("/api/presets/parse", { text: sheet });
  check("تحليل جدول ملصوق يعطي ٣ صفوف صالحة", parsed.ok === true && parsed.total === 3, String(parsed.total));
  const rowOf = (t) => (parsed.rows || []).find((r) => r.text === t);
  check("حرف «باريس» = ب", rowOf("ما عاصمة فرنسا؟")?.letter === "ب", rowOf("ما عاصمة فرنسا؟")?.letter);
  check("«ابن خلدون» = ا (لا يُنزع منتصف الكلمة)", rowOf("من كتب المقدمة؟")?.letter === "ا",
    rowOf("من كتب المقدمة؟")?.letter);
  check("«المشتري» = م (نُزعت «ال»)", rowOf("ما أكبر كوكب؟")?.letter === "م",
    rowOf("ما أكبر كوكب؟")?.letter);
  check("تنبيه على صف بلا جواب", (parsed.warnings || []).some((w) => w.type === "missing"));

  // تشكيل وتنوين لا يؤثّران
  const tashkeel = await apiPost("/api/presets/parse", { text: "سؤال\tمُحَمَّد" });
  check("التشكيل يُنزع قبل استنتاج الحرف", tashkeel.rows?.[0]?.letter === "م", tashkeel.rows?.[0]?.letter);

  // إنشاء → حفظ → قراءة → حذف
  const created = await apiPost("/api/presets/create", { name: "__test__" });
  check("إنشاء مجموعة جديدة", created.ok === true && created.id === "__test__", created.id);
  const saved = await apiPost("/api/presets/save", {
    id: "__test__",
    rows: [
      { text: "كم عدد أيام الأسبوع؟", answer: "سبعة" },
      { text: "حرف مخصّص يدوياً", answer: "كرة القدم", letter: "ط" },
    ],
  });
  check("حفظ الأسئلة في المجموعة", saved.ok === true && saved.total === 2, String(saved.total));

  const got = await apiGet("/api/presets/get?id=__test__");
  check("قراءة الأسئلة المحفوظة", got.ok === true && got.rows.length === 2);
  check("الحرف يُستنتج ويُحفظ", got.rows[0].letter === "س", got.rows[0].letter);
  check("تخصيص الحرف يدوياً يُحفظ", got.rows[1].letter === "ط", got.rows[1].letter);

  // تفعيل مجموعة واحدة فقط ← البنك يصير من أسئلتها
  ref2.send(JSON.stringify({ t: "action", action: { type: "presets", payload: { active: ["__test__"] } } }));
  await sleep(300);
  check("الحكم يستطيع اختيار مجموعات مفعّلة",
    JSON.stringify(last(ref2).state.presets?.active) === '["__test__"]',
    JSON.stringify(last(ref2).state.presets?.active));
  const letters1 = await apiGet("/api/letters");
  const sum1 = letters1.reduce((n, x) => n + x.count, 0);
  check("البنك يستخدم المجموعة المفعّلة فقط", sum1 === 2, String(sum1));

  // اختيار خلية من حرف موجود في المجموعة يعطي سؤالها
  const cellsRaw = last(ref2).state.cells;
  const cellsA = Array.isArray(cellsRaw) ? cellsRaw : Object.values(cellsRaw || {});
  const cellS = cellsA.find((c) => c.letter === "س") || cellsA.find((c) => c.letter === "ط");
  if (cellS) {
    ref2.send(JSON.stringify({ t: "action", action: { type: "select", payload: { cellId: cellS.id } } }));
    await sleep(250);
    const ans = last(ref2).state.current.question?.answer;
    check("السؤال يأتي من المجموعة المفعّلة",
      ans === "سبعة" || ans === "كرة القدم",
      `${cellS.letter} → ${ans}`);
  }

  // رجوع إلى «كل المجموعات»
  ref2.send(JSON.stringify({ t: "action", action: { type: "presets", payload: { active: [] } } }));
  await sleep(300);
  const lettersAll = await apiGet("/api/letters");
  const sumAll = lettersAll.reduce((n, x) => n + x.count, 0);
  check("قائمة فارغة = كل المجموعات", sumAll > 2, String(sumAll));

  // تصدير
  const expRes = await fetch(`${BASE}/api/presets/export?id=__test__`);
  const expText = await expRes.text();
  check("التصدير يعطي ملف TSV", expRes.ok && expText.includes("\t") && expText.includes("سبعة"));

  // حذف
  const del = await apiPost("/api/presets/delete", { id: "__test__" });
  check("حذف المجموعة", del.ok === true);
  const after = await apiGet("/api/presets");
  check("المجموعة المحذوفة لم تعد موجودة", !after.presets.some((p) => p.id === "__test__"));
  check("الاختيار المفعّل نُظِّف بعد الحذف", !(after.active || []).includes("__test__"),
    JSON.stringify(after.active));

  screen.close(); ref2.close(); other.close(); otherScreen.close();
  await sleep(200);

  log("");
  if (failures === 0) {
    log("\x1b[32m✔ كل الاختبارات نجحت\x1b[0m\n");
    process.exit(0);
  } else {
    log(`\x1b[31m✖ فشل ${failures} اختبار\x1b[0m\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\x1b[31mخطأ:\x1b[0m", err);
  process.exit(1);
});
