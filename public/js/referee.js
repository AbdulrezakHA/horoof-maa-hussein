/* ==================================================================
   منطق واجهة الحكم (الهاتف)
   ================================================================== */
import { createBoard } from "/js/board.js";
import { Transport, remainingMs } from "/js/transport.js";
import { drawQR, getBuzzerUrls } from "/js/qr.js";
import { sfx } from "/js/sfx.js";

const params = new URLSearchParams(location.search);
const room = params.get("room") || "main";

const el = (id) => document.getElementById(id);

const ui = {
  board: el("board"),
  roomLabel: el("roomLabel"),
  connChip: el("connChip"),
  connText: el("connText"),
  scoreNameA: el("scoreNameA"),
  scoreNameB: el("scoreNameB"),
  scoreA: el("scoreA"),
  scoreB: el("scoreB"),
  qLetter: el("qLetter"),
  qStatus: el("qStatus"),
  qOwner: el("qOwner"),
  qText: el("qText"),
  answerBox: el("answerBox"),
  answerText: el("answerText"),
  peekBtn: el("peekBtn"),
  revealBtn: el("revealBtn"),
  hideBtn: el("hideBtn"),
  revealAnswerBtn: el("revealAnswerBtn"),
  hideAnswerBtn: el("hideAnswerBtn"),
  newQBtn: el("newQBtn"),
  letterBtn: el("letterBtn"),
  awardA: el("awardA"),
  awardB: el("awardB"),
  awardALabel: el("awardALabel"),
  awardBLabel: el("awardBLabel"),
  unclaimBtn: el("unclaimBtn"),
  clearBtn: el("clearBtn"),
  turnA: el("turnA"),
  turnB: el("turnB"),
  turnOpen: el("turnOpen"),
  stopTimer: el("stopTimer"),
  timerReadout: el("timerReadout"),
  randomBtn: el("randomBtn"),
  resetBtn: el("resetBtn"),
  nameA: el("nameA"),
  nameB: el("nameB"),
  colorA: el("colorA"),
  colorB: el("colorB"),
  bgColor: el("bgColor"),
  cellColor: el("cellColor"),
  selectedColor: el("selectedColor"),
  presetSelect: el("presetSelect"),
  presetList: el("presetList"),
  presetReadout: el("presetReadout"),
  reloadPresets: el("reloadPresets"),
  managePresets: el("managePresets"),
  boardEditor: el("boardEditor"),
  declareA: el("declareA"),
  declareB: el("declareB"),
  declareNone: el("declareNone"),
  logList: el("logList"),
  letterModal: el("letterModal"),
  letterGrid: el("letterGrid"),
  letterModalTitle: el("letterModalTitle"),
  letterModalNote: el("letterModalNote"),
  letterModalClose: el("letterModalClose"),
  toast: el("toast"),
  pairingGate: el("pairingGate"),
  pairingForm: el("pairingForm"),
  pairCodeInput: el("pairCodeInput"),
  pairingNote: el("pairingNote"),
  buzzEnabled: el("buzzEnabled"),
  buzzAuto: el("buzzAuto"),
  buzzSeconds: el("buzzSeconds"),
  buzzOtherSeconds: el("buzzOtherSeconds"),
  buzzOpenBtn: el("buzzOpenBtn"),
  buzzResetBtn: el("buzzResetBtn"),
  buzzReadout: el("buzzReadout"),
  buzzQrA: el("buzzQrA"),
  buzzQrB: el("buzzQrB"),
  sfxBtn: el("sfxBtn"),
};

// الحروف الأساسية فقط (٢٨ حرفاً) — لا نستخدم ة/ء/ئ/ؤ/أ/إ/آ/ى في الشبكة أبداً.
// أي إجابة تبدأ بأحد هذه الحروف تُحسب على حرفها الأساسي في المحرك.
const ALL_LETTERS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز",
  "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك",
  "ل", "م", "ن", "ه", "و", "ي",
];

const PRESETS = {
  hussein: {
    name: "حروف مع حسين (الأصلي)",
    nameA: "الفريق البنفسجي",
    colorA: "#6965ae",
    nameB: "الفريق السماوي",
    colorB: "#4b9cbf",
    theme: {
      bgColor: "#73c4ee",
      cellColor: "#ede5bb",
      cellTextColor: "#635e48",
      selectedColor: "#fcb017",
      selectedTextColor: "#ffffff",
    },
  },
  classic: {
    name: "كلاسيكي (أخضر وبرتقالي)",
    nameA: "الفريق الأخضر",
    colorA: "#3fa65a",
    nameB: "الفريق البرتقالي",
    colorB: "#f0872b",
    theme: {
      bgColor: "#2c0f4d",
      cellColor: "#ffffff",
      cellTextColor: "#4a1479",
      selectedColor: "#ffd93d",
      selectedTextColor: "#3a2c00",
    },
  },
  night: {
    name: "الوضع الليلي الكحلي",
    nameA: "فريق الياقوت",
    colorA: "#e94560",
    nameB: "فريق الزمرد",
    colorB: "#00b4d8",
    theme: {
      bgColor: "#16213e",
      cellColor: "#1f4068",
      cellTextColor: "#e0e0e0",
      selectedColor: "#f39c12",
      selectedTextColor: "#ffffff",
    },
  },
  sunset: {
    name: "أرجواني وغروب",
    nameA: "الفريق الوردي",
    colorA: "#ff5e7e",
    nameB: "الفريق البنفسجي",
    colorB: "#845ec2",
    theme: {
      bgColor: "#4b4453",
      cellColor: "#fbeaff",
      cellTextColor: "#4b4453",
      selectedColor: "#ff9671",
      selectedTextColor: "#ffffff",
    },
  },
};

let state = null;
let boardCfg = null;
let board = null;
let peers = null; // عدد الأجهزة المتّصلة (يأتي مع رسالة الحالة)
let buzzQrDrawn = false;
let letterStats = {}; // { letter: count }
let letterTarget = null; // { cellId } عند فتح نافذة الحروف
let answerVisible = true;
let toastTimer = null;

const savedPairCode = sessionStorage.getItem(`hive-pair-${room}`) || "";
const transport = new Transport("referee", room, savedPairCode);

transport.onStatus = (s) => {
  ui.connChip.className = `conn ${s === "online" ? "online" : s === "offline" ? "offline" : ""}`;
  ui.connText.textContent =
    s === "online" ? "متصل" : s === "offline" ? "منقطع — إعادة المحاولة…" : "جارٍ الاتصال…";
};

transport.onPairing = (msg) => {
  ui.pairingGate.classList.add("show");
  ui.pairingNote.textContent = msg.status === "invalid"
    ? "الرمز غير صحيح — راجعه من شاشة اللعبة."
    : "أدخل رمز الأمان الظاهر على الشاشة.";
};

transport.onState = (msg) => {
  state = msg.state;
  boardCfg = msg.board;
  peers = msg.peers || null;
  ui.pairingGate.classList.remove("show");

  if (!board) {
    board = createBoard(ui.board, boardCfg, {
      width: 62,
      padding: 4,
      interactive: true,
      onSelect: onCellTap,
    });
  }

  board.update(state);
  refereeSfx(msg.state);
  render();
};

/* ---------------- مؤثرات صوتية للحكم ---------------- */

const rfSfx = { round: -1, revealed: false, open: false, winner: null, verdictAt: 0, over: false };

function refereeSfx(st) {
  if (!st) return;
  const c = st.current || {};
  const b = c.buzz || {};
  const round = c.round ?? 0;

  if (rfSfx.round !== round) {
    rfSfx.round = round;
    rfSfx.revealed = false;
    rfSfx.open = false;
    rfSfx.winner = null;
    rfSfx.verdictAt = 0;
    rfSfx.over = false;
  }

  if (c.revealed && !rfSfx.revealed) {
    rfSfx.revealed = true;
    sfx.play("reveal");
  } else if (!c.revealed) {
    rfSfx.revealed = false;
  }

  if (b.open && !rfSfx.open && !b.winner) {
    rfSfx.open = true;
    sfx.play("arm");
  } else if (!b.open) {
    rfSfx.open = false;
  }

  const w = b.winner || null;
  if (w && w !== rfSfx.winner) {
    rfSfx.winner = w;
    sfx.play("buzz");
  } else if (!w) {
    rfSfx.winner = null;
  }

  const at = c.verdict?.at || 0;
  if (c.verdict && at !== rfSfx.verdictAt) {
    rfSfx.verdictAt = at;
    sfx.play("point");
  }

  if (st.winner && !rfSfx.over) {
    rfSfx.over = true;
    sfx.play("gameWin");
  } else if (!st.winner) {
    rfSfx.over = false;
  }
}

// نقرة خفيفة على كل زر (ما عدا زر كتم الصوت الذي له مؤثر خاص)
document.addEventListener(
  "click",
  (event) => {
    const btn = event.target?.closest?.("button");
    if (!btn || btn.dataset.sfxToggle !== undefined) return;
    sfx.play("click");
  },
  true
);

transport.connect();

ui.pairingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = ui.pairCodeInput.value.replace(/\D/g, "");
  if (code.length !== 6) {
    ui.pairingNote.textContent = "أدخل رمزًا من ستة أرقام.";
    return;
  }
  sessionStorage.setItem(`hive-pair-${room}`, code);
  ui.pairingNote.textContent = "جارٍ التحقق…";
  transport.setPairCode(code);
});

/* ---------------- التفاعل ---------------- */

function onCellTap(cellId) {
  const cell = state?.cells[cellId];
  if (!cell) return;

  // خلية مملوكة: ما زلنا نحددها حتى يمكن التعديل أو الإزالة
  transport.send({ type: "select", payload: { cellId } });

  if (cell.owner) {
    toast(`الخلية "${cell.letter}" مملوكة — اختر الفريق أو أزلها`);
  }
}

function act(type, payload = {}) {
  transport.send({ type, payload });
}

/* ---------------- العرض ---------------- */

function render() {
  if (!state) return;

  syncPresetsFromState();

  ui.roomLabel.textContent = `الجولة ${state.rev} · ${boardCfg.cells.length} خلية`;

  // النقاط
  ui.scoreNameA.textContent = state.teams.a.name;
  ui.scoreNameB.textContent = state.teams.b.name;
  ui.scoreA.textContent = state.teams.a.score;
  ui.scoreB.textContent = state.teams.b.score;

  // الخلية الحالية
  const cell = state.current.cellId ? state.cells[state.current.cellId] : null;
  const q = state.current.question;
  const hasCell = !!cell;

  ui.qLetter.textContent = hasCell ? cell.letter : "؟";
  ui.qLetter.classList.toggle("idle", !hasCell);

  if (!hasCell) {
    ui.qStatus.textContent = "لم يتم اختيار أي حرف بعد";
    ui.qOwner.textContent = "";
    ui.qText.textContent = "—";
    ui.answerText.textContent = "—";
  } else {
    let statusText = state.current.revealed ? "السؤال ظاهر على الشاشة" : "السؤال مخفي عن اللاعبين";
    if (state.current.answerRevealed) {
      statusText += " · [الجواب ظاهر]";
    }
    ui.qStatus.textContent = statusText;
    ui.qOwner.textContent = cell.owner
      ? `مملوكة حالياً: ${state.teams[cell.owner].name}`
      : "خلية حرة";
    ui.qText.textContent = q ? q.text : "لا يوجد سؤال لهذا الحرف — غيّر الحرف";
    ui.answerText.textContent = q ? q.answer : "—";
  }

  // أزرار النقاط
  const owner = cell?.owner || null;
  ui.awardALabel.textContent =
    owner === "a" ? "مملوكة — تأكيد" : owner === "b" ? "نقل إلى الفريق الأول" : "نقطة للفريق الأول";
  ui.awardBLabel.textContent =
    owner === "b" ? "مملوكة — تأكيد" : owner === "a" ? "نقل إلى الفريق الثاني" : "نقطة للفريق الثاني";
  ui.unclaimBtn.disabled = !owner;

  // الأزرار المعطّلة
  ui.revealBtn.disabled = !hasCell || !q;
  ui.hideBtn.disabled = !hasCell;
  ui.revealAnswerBtn.disabled = !hasCell || !q;
  ui.hideAnswerBtn.disabled = !hasCell || !state.current.answerRevealed;
  ui.newQBtn.disabled = !hasCell;
  ui.letterBtn.disabled = !hasCell;
  ui.awardA.disabled = !hasCell;
  ui.awardB.disabled = !hasCell;

  // تمييز أزرار الشاشة
  ui.revealBtn.classList.toggle("active-screen", !!state.current.revealed);
  ui.revealAnswerBtn.classList.toggle("active-screen", !!state.current.answerRevealed);

  // زر إظهار الجواب للحكم
  ui.peekBtn.textContent = answerVisible ? "إخفاء الجواب" : "إظهار الجواب";
  ui.answerBox.classList.toggle("hidden-answer", !answerVisible);

  // الإعدادات
  if (document.activeElement !== ui.nameA) ui.nameA.value = state.teams.a.name;
  if (document.activeElement !== ui.nameB) ui.nameB.value = state.teams.b.name;
  ui.colorA.value = state.teams.a.color;
  ui.colorB.value = state.teams.b.color;
  if (state.theme) {
    if (ui.bgColor) ui.bgColor.value = state.theme.bgColor || "#73c4ee";
    if (ui.cellColor) ui.cellColor.value = state.theme.cellColor || "#ede5bb";
    if (ui.selectedColor) ui.selectedColor.value = state.theme.selectedColor || "#fcb017";
    document.documentElement.style.setProperty("--bg-color", state.theme.bgColor || "#73c4ee");
    document.documentElement.style.setProperty("--cell-color", state.theme.cellColor || "#ede5bb");
    document.documentElement.style.setProperty("--selected-color", state.theme.selectedColor || "#fcb017");
  }
  document.documentElement.style.setProperty("--team-a-color", state.teams.a.color);
  document.documentElement.style.setProperty("--team-b-color", state.teams.b.color);

  renderBoardEditor();
  renderLog();
  renderBuzzControls();
}

/* ---------------- أجراس اللاعبين ---------------- */

function renderBuzzControls() {
  const b = state.current.buzz || {
    enabled: false,
    autoArm: true,
    seconds: 3,
    otherSeconds: 10,
    open: false,
    winner: null,
  };

  if (document.activeElement !== ui.buzzEnabled) ui.buzzEnabled.checked = !!b.enabled;
  if (document.activeElement !== ui.buzzAuto) ui.buzzAuto.checked = b.autoArm !== false;
  if (document.activeElement !== ui.buzzSeconds) ui.buzzSeconds.value = b.seconds || 3;
  if (ui.buzzOtherSeconds && document.activeElement !== ui.buzzOtherSeconds) {
    ui.buzzOtherSeconds.value = b.otherSeconds || 10;
  }

  const on = !!b.enabled;
  ui.buzzOpenBtn.disabled = !on || !!b.open;
  ui.buzzResetBtn.disabled = !on;
  ui.buzzOpenBtn.classList.toggle("active-screen", on && !!b.open && !b.winner);

  updateBuzzReadout();

  if (!buzzQrDrawn) drawBuzzerQRs();
}

let readoutTick = null;

function updateBuzzReadout() {
  if (!state) return;
  const b = state.current.buzz || {};
  const timer = state.current.timer || {};
  const on = !!b.enabled;

  // اسم الجهاز المتّصل (إن توفّر)
  const conn = peers ? ` · الأجراس: ${peers.buzzerA || 0}/${peers.buzzerB || 0}` : "";

  let text;
  if (!on) {
    text = "الأجراس متوقفة — فعّلها ثم امسح رمز كل فريق.";
  } else if (state.current.verdict) {
    text = `✅ ${state.teams[state.current.verdict.team].name} أخذ النقطة — السؤال القادم يصفّر كل شيء تلقائياً${conn}`;
  } else if (timer.running) {
    const secs = Math.max(0, Math.ceil(remainingMs(timer, transport.serverOffset) / 1000));
    const who = state.teams[state.current.turn]?.name || "—";
    const stage = timer.stage === "buzz2" ? "دور اللاعب الثاني" : "دور اللاعب الأول";
    text = `⏱️ ${stage}: ${who} — بقي ${secs} ثانية${conn}`;
  } else if (b.winner) {
    text = `🔔 ${state.teams[b.winner].name} ضغط أولاً — انتهى الوقت${conn}`;
  } else if (b.open) {
    text = `🔔 الأجراس مفتوحة — بانتظار أول ضغطة${conn}`;
  } else {
    text = `الأجراس جاهزة${b.autoArm !== false ? " — تُفتح تلقائياً عند عرض السؤال" : ""}${conn}`;
  }
  ui.buzzReadout.textContent = text;
  ui.buzzReadout.classList.toggle("running", on && (!!b.open || !!b.winner || !!timer.running));

  // تحديث العدّاد الحيّ كل ربع ثانية أثناء دوران المؤقّت
  const running = !!timer.running;
  if (running && !readoutTick) {
    readoutTick = setInterval(updateBuzzReadout, 250);
  } else if (!running && readoutTick) {
    clearInterval(readoutTick);
    readoutTick = null;
  }
}

let buzzQrBusy = false;
async function drawBuzzerQRs() {
  if (buzzQrBusy) return;
  buzzQrBusy = true;
  try {
    const [listA, listB] = await Promise.all([
      getBuzzerUrls(room, "a"),
      getBuzzerUrls(room, "b"),
    ]);
    drawQR(listA[0]?.url || "", ui.buzzQrA);
    drawQR(listB[0]?.url || "", ui.buzzQrB);
    buzzQrDrawn = true;
  } catch {
    buzzQrBusy = false;
  }
}

/* ---------------- محرّر اللوحة ---------------- */

function renderBoardEditor() {
  const wrap = ui.boardEditor;
  wrap.innerHTML = "";
  for (const cell of boardCfg.cells) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = state.cells[cell.id]?.letter ?? cell.letter;
    btn.className = "";
    if (state.cells[cell.id]?.owner === "a") btn.classList.add("owned-a");
    if (state.cells[cell.id]?.owner === "b") btn.classList.add("owned-b");
    if (state.current.cellId === cell.id) btn.classList.add("selected");
    btn.addEventListener("click", () => openLetterModal(cell.id));
    wrap.appendChild(btn);
  }
}

/* ---------------- السجل ---------------- */

function renderLog() {
  const list = ui.logList;
  list.innerHTML = "";
  for (const item of state.log || []) {
    const li = document.createElement("li");
    li.textContent = item.text;
    li.className = `tone-${item.tone || "info"}`;
    list.appendChild(li);
  }
}

/* ---------------- المؤقّت ---------------- */

function updateTimerReadout() {
  if (!state) return;
  const t = state.current.timer;
  const rem = remainingMs(t, transport.serverOffset);
  if (t.running && rem > 0) {
    const turn =
      state.current.turn === "a" ? "الفريق الأول" :
      state.current.turn === "b" ? "الفريق الثاني" :
      "مفتوح للجميع";
    ui.timerReadout.textContent = `${turn} — ${Math.ceil(rem / 1000)} ثانية`;
    ui.timerReadout.classList.add("running");
  } else {
    ui.timerReadout.textContent = "المؤقّت متوقف";
    ui.timerReadout.classList.remove("running");
  }
}
setInterval(updateTimerReadout, 120);

/* ---------------- نافذة الحروف ---------------- */

function openLetterModal(cellId) {
  letterTarget = { cellId };
  const cell = state.cells[cellId];
  ui.letterModalTitle.textContent = `اختر الحرف للخلية (${cell.letter})`;
  ui.letterModalNote.textContent =
    cellId === state.current.cellId
      ? "سيُعاد اختيار السؤال تلقائياً بعد التغيير. الحروف المستخدمة في خلايا أخرى معطّلة."
      : "سيُطبّق على الشاشة فوراً. الحروف المستخدمة في خلايا أخرى معطّلة.";

  ui.letterGrid.innerHTML = "";
  // الحروف المستخدمة في خلايا أخرى تُعطَّل: لا نكرّر أي حرف داخل الشبكة.
  const usedElsewhere = new Set(
    Object.keys(state.cells)
      .filter((id) => id !== cellId)
      .map((id) => state.cells[id].letter)
  );
  for (const letter of ALL_LETTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = letter;
    const count = letterStats[letter];
    if (!count) btn.classList.add("empty");
    if (letter === cell.letter) btn.classList.add("current");
    if (usedElsewhere.has(letter)) {
      btn.classList.add("used");
      btn.disabled = true;
      btn.title = "مستخدم في خلية أخرى — الحروف لا تتكرّر في الشبكة";
    } else if (count) {
      btn.title = `${count} سؤال متاح`;
    } else {
      btn.title = "لا يوجد سؤال لهذا الحرف";
    }
    btn.addEventListener("click", () => {
      act("setLetter", { cellId, letter });
      closeLetterModal();
      toast(`تم تغيير الحرف إلى "${letter}"`);
      if (cellId === state.current.cellId) setTimeout(() => act("newQuestion"), 120);
    });
    ui.letterGrid.appendChild(btn);
  }

  ui.letterModal.classList.add("show");
}

function closeLetterModal() {
  ui.letterModal.classList.remove("show");
  letterTarget = null;
}

/* ---------------- تنبيه ---------------- */

function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2400);
}

/* ---------------- ربط الأحداث ---------------- */

ui.revealBtn.addEventListener("click", () => act("reveal"));
ui.hideBtn.addEventListener("click", () => act("hide"));
ui.revealAnswerBtn.addEventListener("click", () => {
  act("revealAnswer");
  toast("تم إظهار الجواب على الشاشة");
});
ui.hideAnswerBtn.addEventListener("click", () => {
  act("hideAnswer");
  toast("تم إخفاء الجواب عن الشاشة");
});
ui.newQBtn.addEventListener("click", () => {
  act("newQuestion");
  toast("تم اختيار سؤال جديد لنفس الحرف");
});
ui.letterBtn.addEventListener("click", () => {
  if (state.current.cellId) openLetterModal(state.current.cellId);
});

ui.awardA.addEventListener("click", () => {
  act("award", { cellId: state.current.cellId, team: "a" });
  toast(`نقطة لـ ${state.teams.a.name}`);
});
ui.awardB.addEventListener("click", () => {
  act("award", { cellId: state.current.cellId, team: "b" });
  toast(`نقطة لـ ${state.teams.b.name}`);
});
ui.unclaimBtn.addEventListener("click", () => {
  act("unclaim", { cellId: state.current.cellId });
  toast("تمت الإزالة من الفريق");
});
ui.clearBtn.addEventListener("click", () => act("clear"));

ui.turnA.addEventListener("click", () => {
  act("setTurn", { turn: "a" });
  act("startTimer", { seconds: 3 });
});
ui.turnB.addEventListener("click", () => {
  act("setTurn", { turn: "b" });
  act("startTimer", { seconds: 10 });
});
ui.turnOpen.addEventListener("click", () => {
  act("setTurn", { turn: "open" });
  act("startTimer", { seconds: 15 });
});
ui.stopTimer.addEventListener("click", () => act("stopTimer"));

ui.randomBtn.addEventListener("click", () => {
  const cells = boardCfg.cells;
  const free = cells.filter((c) => !state.cells[c.id].owner);
  const pool = free.length ? free : cells;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  act("select", { cellId: pick.id });
  toast(`تم اختيار الحرف "${state.cells[pick.id].letter}"`);
});

ui.resetBtn.addEventListener("click", () => {
  if (confirm("بدء جولة جديدة؟ سيتم مسح كل النقاط والخلايا المملوكة.")) {
    act("reset");
    toast("جولة جديدة");
  }
});

ui.peekBtn.addEventListener("click", () => {
  answerVisible = !answerVisible;
  ui.peekBtn.textContent = answerVisible ? "إخفاء الجواب" : "إظهار الجواب";
  ui.answerBox.classList.toggle("hidden-answer", !answerVisible);
});

ui.nameA.addEventListener("change", () => act("setTeam", { team: "a", name: ui.nameA.value }));
ui.nameB.addEventListener("change", () => act("setTeam", { team: "b", name: ui.nameB.value }));
ui.colorA.addEventListener("input", () => act("setTeam", { team: "a", color: ui.colorA.value }));
ui.colorB.addEventListener("input", () => act("setTeam", { team: "b", color: ui.colorB.value }));
if (ui.bgColor) ui.bgColor.addEventListener("input", () => act("setTheme", { bgColor: ui.bgColor.value }));
if (ui.cellColor) ui.cellColor.addEventListener("input", () => act("setTheme", { cellColor: ui.cellColor.value }));
if (ui.selectedColor) ui.selectedColor.addEventListener("input", () => act("setTheme", { selectedColor: ui.selectedColor.value }));

if (ui.presetSelect) {
  ui.presetSelect.addEventListener("change", () => {
    const p = PRESETS[ui.presetSelect.value];
    if (!p) return;
    act("setTeam", { team: "a", name: p.nameA, color: p.colorA });
    act("setTeam", { team: "b", name: p.nameB, color: p.colorB });
    act("setTheme", p.theme);
    toast(`تم تطبيق قالب: ${p.name}`);
  });
}

/* ---------------- أجراس اللاعبين: الأحداث ---------------- */

ui.buzzEnabled.addEventListener("change", () => {
  act("buzzConfig", { enabled: ui.buzzEnabled.checked });
  toast(ui.buzzEnabled.checked ? "تم تفعيل الأجراس" : "تم إيقاف الأجراس");
});

ui.buzzAuto.addEventListener("change", () => {
  act("buzzConfig", { autoArm: ui.buzzAuto.checked });
});

ui.buzzSeconds.addEventListener("change", () => {
  const v = Math.max(3, Math.min(120, Number(ui.buzzSeconds.value) || 3));
  ui.buzzSeconds.value = v;
  act("buzzConfig", { seconds: v });
});

if (ui.buzzOtherSeconds) {
  ui.buzzOtherSeconds.addEventListener("change", () => {
    const v = Math.max(3, Math.min(120, Number(ui.buzzOtherSeconds.value) || 10));
    ui.buzzOtherSeconds.value = v;
    act("buzzConfig", { otherSeconds: v });
  });
}

ui.buzzOpenBtn.addEventListener("click", () => {
  act("buzzOpen");
  toast("الأجراس مفتوحة — اضغطوا الآن!");
});

ui.buzzResetBtn.addEventListener("click", () => {
  act("buzzReset");
  toast("تمت إعادة الأجراس");
});

ui.declareA.addEventListener("click", () => act("declareWinner", { team: "a" }));
ui.declareB.addEventListener("click", () => act("declareWinner", { team: "b" }));
ui.declareNone.addEventListener("click", () => act("declareWinner", { team: null }));

ui.letterModalClose.addEventListener("click", closeLetterModal);
ui.letterModal.addEventListener("click", (e) => {
  if (e.target === ui.letterModal) closeLetterModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLetterModal();
});

/* منع التكبير بالنقر المزدوج على الجوال */
document.addEventListener(
  "dblclick",
  (e) => e.preventDefault(),
  { passive: false }
);

/* ================= مجموعات الأسئلة (Presets) ================= */
let presetFiles = [];
let presetsKey = null;

function activePresetIds() {
  return (state && state.presets && state.presets.active) || [];
}

function presetsSig() {
  return JSON.stringify(activePresetIds());
}

/** يعيد رسم قائمة المجموعات فقط عند تغيّر الاختيار فعلاً. */
function syncPresetsFromState() {
  const sig = presetsSig();
  if (sig === presetsKey) return;
  presetsKey = sig;
  renderPresets();
}

async function loadPresets() {
  try {
    const res = await fetch("/api/presets");
    const data = await res.json();
    presetFiles = data.presets || [];
  } catch {
    presetFiles = [];
  }
  presetsKey = null;
  syncPresetsFromState();
  renderPresets();
}

function presetSummary() {
  const active = activePresetIds();
  const chosen = active.length ? presetFiles.filter((p) => active.includes(p.id)) : presetFiles;
  const total = chosen.reduce((n, p) => n + (p.total || 0), 0);
  return { count: chosen.length, total, names: chosen.map((p) => p.name) };
}

function renderPresets() {
  if (!ui.presetList) return;
  ui.presetList.textContent = "";

  if (!presetFiles.length) {
    const d = document.createElement("div");
    d.className = "pst-list-empty";
    d.textContent = "لا توجد مجموعات بعد — اضغط «إدارة وتعديل المجموعات».";
    ui.presetList.appendChild(d);
  }

  const active = activePresetIds();
  const allActive = active.length === 0;

  for (const p of presetFiles) {
    const row = document.createElement("div");
    row.className = "pst-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "pst-item-check";
    cb.checked = allActive || active.includes(p.id);
    cb.title = "تفعيل/تعطيل هذه المجموعة";
    cb.addEventListener("change", () => {
      const current = active.length ? active.slice() : presetFiles.map((x) => x.id);
      const set = new Set(current);
      if (cb.checked) set.add(p.id);
      else set.delete(p.id);
      const list = [...set];
      const payload = list.length >= presetFiles.length ? [] : list;
      presetsKey = JSON.stringify(payload);
      act("presets", { active: payload });
      renderPresets();
      try {
        sfx.play("toggleOn");
      } catch {}
    });
    row.appendChild(cb);

    const name = document.createElement("span");
    name.className = "pst-item-name";
    name.textContent = p.name;
    row.appendChild(name);

    const meta = document.createElement("span");
    const bad = p.warnings ? `⚠${p.warnings}` : "";
    meta.className = "pst-item-meta" + (p.warnings ? " pst-bad" : "");
    meta.textContent = bad ? `${p.total || 0} سؤال ${bad}` : `${p.total || 0} سؤال`;
    row.appendChild(meta);

    const eye = document.createElement("a");
    eye.className = "pst-item-btn";
    eye.href = `/presets?id=${encodeURIComponent(p.id)}`;
    eye.target = "_blank";
    eye.rel = "noopener";
    eye.textContent = "👁";
    eye.title = "معاينة وتعديل";
    row.appendChild(eye);

    const edit = document.createElement("a");
    edit.className = "pst-item-btn";
    edit.href = `/presets?id=${encodeURIComponent(p.id)}`;
    edit.target = "_blank";
    edit.rel = "noopener";
    edit.textContent = "✏️";
    edit.title = "تعديل الأسئلة";
    row.appendChild(edit);

    ui.presetList.appendChild(row);
  }

  const sum = presetSummary();
  if (ui.presetReadout) {
    ui.presetReadout.textContent = presetFiles.length
      ? `المفعّل الآن: ${sum.count} مجموعة · ${sum.total} سؤال${
          sum.count ? " (" + sum.names.join(" + ") + ")" : ""
        }`
      : "";
  }
}

if (ui.reloadPresets) {
  ui.reloadPresets.addEventListener("click", async () => {
    await loadPresets();
    syncPresetsFromState();
  });
}

loadPresets();

/* ================= نهاية مجموعات الأسئلة ================= */

/* ---------------- بيانات مساعدة ---------------- */
fetch("/api/letters")
  .then((r) => r.json())
  .then((list) => {
    for (const item of list) letterStats[item.letter] = item.count;
    // الحروف البديلة بلا أسئلة خاصة
    const extra = { ة: "ت", ء: "ا", ئ: "ي", ؤ: "و" };
    for (const [from, to] of Object.entries(extra)) {
      if (!letterStats[from] && letterStats[to]) letterStats[from] = letterStats[to];
    }
  })
  .catch(() => {});
