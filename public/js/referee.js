/* ==================================================================
   منطق واجهة الحكم (الهاتف)
   ================================================================== */
import { createBoard } from "/js/board.js";
import { Transport, remainingMs } from "/js/transport.js";
import { drawQR, getRoutes } from "/js/qr.js";
import { sfx } from "/js/sfx.js";
import { findClashes, autoFixColors, COLOR_LABELS } from "/shared/colors.js";
import { DS_THEMES, PAPER, applyGameColors } from "/shared/ds-theme.js";
import { icon, hydrateIcons, toast as dsToast, replay } from "/js/ds.js";
import { initTaboo, renderTaboo } from "/js/referee-taboo.js";

window.__appStarted = true; // انظر /js/diag.js

/** بطاقات قائمة الألعاب (المفتاح ← الوصف). */
const HUB_GAMES = [
  { id: "huroof", icon: "hexagon", name: "حروف مع حسين", desc: "لوحة الحروف والأجراس" },
  { id: "taboo", icon: "hush", name: "الكلمة الممنوعة", desc: "اشرح دون الكلمات الممنوعة", tone: "coral" },
  { id: null, icon: "shapes", name: "تحدّي الصور", desc: "قريباً", tone: "sky", soon: true },
  { id: null, icon: "sparkle", name: "إيموجي", desc: "قريباً", tone: "mint", soon: true },
];

const params = new URLSearchParams(location.search);
const room = params.get("room") || "main";

const el = (id) => document.getElementById(id);

/** يغيّر رمز <svg><use/></svg> إلى رمز آخر من /icons.svg. */
function setIcon(svg, name) {
  svg?.querySelector("use")?.setAttribute("href", `/icons.svg#${name}`);
}
/** يضبط محتوى زر: رمز ثم نص. */
function setBtn(btn, iconName, text) {
  btn?.replaceChildren(icon(iconName), document.createTextNode(text));
}
/** رسالة قصيرة مع رمز اختياري. */
const toast = (msg, iconName = null) => dsToast(msg, iconName);

hydrateIcons();

const ui = {
  board: el("board"),
  roomLabel: el("roomLabel"),
  connChip: el("connChip"),
  connText: el("connText"),
  connIcon: el("connIcon"),
  qHex: el("qHex"),
  timerReadoutText: el("timerReadoutText"),
  buzzReadoutText: el("buzzReadoutText"),
  buzzReadoutIcon: el("buzzReadoutIcon"),
  judgeSteps: el("judgeSteps"),
  judgeWhoBanner: el("judgeWhoBanner"),
  judgeWhoIcon: el("judgeWhoIcon"),
  judgeTimerNum: el("judgeTimerNum"),
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
  noPointBtn: el("noPointBtn"),
  lobbyToggleBtn: el("lobbyToggleBtn"),
  screenSoundBtn: el("screenSoundBtn"),
  screenFullBtn: el("screenFullBtn"),
  screenHint: el("screenHint"),
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
  themeChips: el("themeChips"),
  colorWarn: el("colorWarn"),
  colorWarnList: el("colorWarnList"),
  colorFixBtn: el("colorFixBtn"),
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
  playQr: el("playQr"),
  playersCols: el("playersCols"),
  playersHint: el("playersHint"),
  buzzNoRepeat: el("buzzNoRepeat"),
  undoBtn: el("undoBtn"),
  shuffleBtn: el("shuffleBtn"),
  qCategory: el("qCategory"),
  qHint: el("qHint"),
  qHintText: el("qHintText"),
  hintBtn: el("hintBtn"),
  judgePanel: el("judgePanel"),
  judgeStage: el("judgeStage"),
  judgeWho: el("judgeWho"),
  judgeTimer: el("judgeTimer"),
  judgeHistory: el("judgeHistory"),
  judgeRight: el("judgeRight"),
  judgeWrong: el("judgeWrong"),
  judgeLock: el("judgeLock"),
  judgeNewQ: el("judgeNewQ"),
  sfxBtn: el("sfxBtn"),
  turnALabel: el("turnALabel"),
  turnBLabel: el("turnBLabel"),
  declareALabel: el("declareALabel"),
  declareBLabel: el("declareBLabel"),
  buzzBanner: el("buzzBanner"),
  buzzBannerIco: el("buzzBannerIco"),
  buzzBannerText: el("buzzBannerText"),
};

// الحروف الأساسية فقط (٢٨ حرفاً) — لا نستخدم ة/ء/ئ/ؤ/أ/إ/آ/ى في الشبكة أبداً.
// أي إجابة تبدأ بأحد هذه الحروف تُحسب على حرفها الأساسي في المحرك.
const ALL_LETTERS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز",
  "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك",
  "ل", "م", "ن", "ه", "و", "ي",
];

let state = null;
let boardCfg = null;
let board = null;
let peers = null; // عدد الأجهزة المتّصلة (يأتي مع رسالة الحالة)
let buzzQrDrawn = false;
let letterStats = {}; // { letter: count }
let letterTarget = null; // { cellId } عند فتح نافذة الحروف
let answerVisible = true;

const savedPairCode = sessionStorage.getItem(`hive-pair-${room}`) || "";
const transport = new Transport("referee", room, savedPairCode);

const CONN = {
  online: ["ds-pill--mint", "wifi", "متصل"],
  offline: ["ds-pill--coral", "warning", "منقطع — إعادة المحاولة…"],
  other: ["ds-pill--dark", "timer", "جارٍ الاتصال…"],
};
transport.onStatus = (s) => {
  const [cls, ic, text] = CONN[s] || CONN.other;
  ui.connChip.className = `ds-pill ${cls}`;
  setIcon(ui.connIcon, ic);
  ui.connText.textContent = text;
};

transport.onPairing = (msg) => {
  ui.pairingGate.classList.add("is-open");
  ui.pairingNote.textContent = msg.status === "invalid"
    ? "الرمز غير صحيح — راجعه من شاشة اللعبة."
    : "أدخل رمز الأمان الظاهر على الشاشة.";
};

transport.onState = (msg) => {
  state = msg.state;
  boardCfg = msg.board;
  peers = msg.peers || null;
  ui.pairingGate.classList.remove("is-open");

  if (!board) {
    board = createBoard(ui.board, boardCfg, {
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
    if (navigator.vibrate) navigator.vibrate(45);
  } else if (!b.open) {
    rfSfx.open = false;
  }

  const w = b.winner || null;
  if (w && w !== rfSfx.winner) {
    rfSfx.winner = w;
    sfx.play("buzz");
    // إشعار لمسي للحكم على الهاتف عند ضغط أحد الفريقين للجرس
    if (navigator.vibrate) navigator.vibrate([140, 70, 140]);
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
    toast(`الخلية "${cell.letter}" مملوكة — اختر الفريق أو أزلها`, "info");
  }
}

function act(type, payload = {}) {
  transport.send({ type, payload });
}

/* ---------------- العرض ---------------- */

/* ---------------- السهرة: قائمة الألعاب ونقاطها ---------------- */

function nightBoard(container) {
  if (!container || !state) return;
  container.replaceChildren();
  for (const k of ["a", "b"]) {
    const pill = document.createElement("span");
    pill.className = `ds-pill ds-pill--team ds-team-${k}`;
    pill.append(icon("trophy"), document.createTextNode(`${state.teams[k].name}: ${state.night?.[k] || 0}`));
    container.appendChild(pill);
  }
}

let hubKey = "";
function renderHub() {
  const wrap = el("hubGames");
  if (!wrap) return;
  nightBoard(el("nightBoardHub"));
  nightBoard(el("nightBoardFoot"));
  const key = JSON.stringify([state.night, state.taboo?.phase, state.winner]);
  if (key === hubKey && wrap.childElementCount) return;
  hubKey = key;
  wrap.replaceChildren();
  HUB_GAMES.forEach((g, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ds-game-tile ds-game-tile--sm${g.tone ? ` ds-game-tile--${g.tone}` : ""}`;
    b.style.setProperty("--i", i);
    b.disabled = !!g.soon;
    const art = document.createElement("span");
    art.className = "ds-game-tile-art";
    art.appendChild(icon(g.icon));
    const name = document.createElement("span");
    name.className = "ds-game-tile-name";
    name.textContent = g.name;
    const desc = document.createElement("span");
    desc.className = "ds-game-tile-tag";
    desc.textContent = g.desc;
    b.append(art, name, desc);
    if (!g.soon) {
      b.addEventListener("click", () => {
        act("setGame", { game: g.id });
        toast(g.name, g.icon);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    wrap.appendChild(b);
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ds-btn ds-btn--sm";
  reset.append(icon("undo"), document.createTextNode("تصفير نقاط السهرة"));
  reset.addEventListener("click", () => {
    if (confirm("تصفير نقاط السهرة للفريقين؟")) act("nightReset");
  });
  wrap.appendChild(reset);
}

/** الأقسام الظاهرة حسب اللعبة: data-game = none | huroof | taboo | ingame (داخل أي لعبة). */
function applyGameVisibility(game) {
  for (const n of document.querySelectorAll("[data-game]")) {
    if (n === document.body || n.id === "judgePanel") continue; // لوحة الحكم تديرها renderJudge
    const g = n.dataset.game;
    n.hidden = !(g === game || (g === "ingame" && game !== "none"));
  }
}

function render() {
  if (!state) return;

  // اللعبة الحالية تحدّد الأقسام الظاهرة (data-game في الصفحة)
  document.body.dataset.game = state.game || "none";
  applyGameVisibility(state.game || "none");
  applyGameColors(state);
  const stageColor = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim();
  if (stageColor) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", stageColor);
  renderHub();
  renderTaboo();

  syncPresetsFromState();

  ui.roomLabel.textContent = state.game === "taboo"
    ? "الكلمة الممنوعة"
    : state.game === "huroof"
      ? `حروف مع حسين · ${boardCfg.cells.length} خلية`
      : "قائمة الألعاب";

  // النقاط
  ui.scoreNameA.textContent = state.teams.a.name;
  ui.scoreNameB.textContent = state.teams.b.name;
  ui.scoreA.textContent = state.teams.a.score;
  ui.scoreB.textContent = state.teams.b.score;

  // الخلية الحالية
  const cell = state.current.cellId ? state.cells[state.current.cellId] : null;
  const q = state.current.question;
  const hasCell = !!cell;
  // بعد منح النقطة تُلغى الخلية المحددة، لكن نُبقي سؤالها ظاهراً للحكم
  const resolvedId = state.current.verdict?.cellId || state.current.missed?.cellId || null;
  const displayCell = cell || (resolvedId ? state.cells[resolvedId] : null);

  ui.qLetter.textContent = displayCell ? displayCell.letter : "؟";
  ui.qHex.classList.toggle("is-a", displayCell?.owner === "a");
  ui.qHex.classList.toggle("is-b", displayCell?.owner === "b");
  ui.qHex.classList.toggle("is-selected", !!displayCell && !displayCell.owner);

  if (!displayCell) {
    ui.qStatus.textContent = "لم يتم اختيار أي حرف بعد";
    ui.qOwner.textContent = "";
    ui.qText.textContent = "—";
    ui.answerText.textContent = "—";
  } else {
    let statusText = state.current.revealed ? "السؤال ظاهر على الشاشة" : "السؤال مخفي عن اللاعبين";
    if (state.current.answerRevealed) {
      statusText += " · الجواب ظاهر";
    }
    ui.qStatus.textContent = statusText;
    ui.qOwner.textContent = displayCell.owner
      ? `مملوكة حالياً: ${state.teams[displayCell.owner].name}`
      : "خلية حرة";
    ui.qText.textContent = q ? q.text : "لا يوجد سؤال لهذا الحرف — غيّر الحرف";
    ui.answerText.textContent = q ? q.answer : "—";
  }

  // أزرار النقاط
  const owner = cell?.owner || null;
  ui.awardALabel.textContent =
    owner === "a" ? "مملوكة — تأكيد" : owner === "b" ? `نقل إلى ${state.teams.a.name}` : `نقطة لـ ${state.teams.a.name}`;
  ui.awardBLabel.textContent =
    owner === "b" ? "مملوكة — تأكيد" : owner === "a" ? `نقل إلى ${state.teams.b.name}` : `نقطة لـ ${state.teams.b.name}`;
  ui.unclaimBtn.disabled = !owner;

  // أزرار الفرق: الأسماء والألوان الفعلية (بدل الأسماء والألوان الثابتة)
  const tA = state.teams.a;
  const tB = state.teams.b;
  const buzzSecs = Number(state.current.buzz?.seconds) || 3;
  const buzzOtherSecs = Number(state.current.buzz?.otherSeconds) || 10;
  if (ui.turnALabel) ui.turnALabel.textContent = `${tA.name} — ${buzzSecs} ث`;
  if (ui.turnBLabel) ui.turnBLabel.textContent = `${tB.name} — ${buzzOtherSecs} ث`;
  if (ui.declareALabel) ui.declareALabel.textContent = tA.name;
  if (ui.declareBLabel) ui.declareBLabel.textContent = tB.name;

  // الأزرار المعطّلة
  ui.revealBtn.disabled = !displayCell || !q;
  ui.hideBtn.disabled = !displayCell;
  ui.revealAnswerBtn.disabled = !displayCell || !q;
  ui.hideAnswerBtn.disabled = !displayCell || !state.current.answerRevealed;
  ui.newQBtn.disabled = !hasCell;
  ui.letterBtn.disabled = !hasCell;
  ui.awardA.disabled = !hasCell;
  ui.awardB.disabled = !hasCell;
  if (ui.noPointBtn) ui.noPointBtn.disabled = !hasCell;

  renderScreenControls();
  renderPlayers();
  renderJudge();
  if (ui.undoBtn) ui.undoBtn.disabled = false;

  // الفئة والتلميح (من ملف المجموعة)
  if (ui.qCategory) {
    ui.qCategory.hidden = !q?.category;
    if (q?.category) ui.qCategory.replaceChildren(icon("shapes"), document.createTextNode(q.category));
  }
  if (ui.qHint) {
    ui.qHint.hidden = !q?.hint;
    if (ui.qHintText) ui.qHintText.textContent = q?.hint || "";
    if (ui.hintBtn) {
      setBtn(ui.hintBtn, state.current.hintRevealed ? "eye" : "sparkle", state.current.hintRevealed ? "إخفاء التلميح" : "اعرض التلميح على الشاشة");
      ui.hintBtn.setAttribute("aria-pressed", String(!!state.current.hintRevealed));
    }
  }

  // تمييز أزرار الشاشة (مضغوط = ظاهر على التلفاز)
  ui.revealBtn.setAttribute("aria-pressed", String(!!state.current.revealed));
  ui.revealAnswerBtn.setAttribute("aria-pressed", String(!!state.current.answerRevealed));

  // زر إظهار الجواب للحكم
  ui.peekBtn.textContent = answerVisible ? "إخفاء الجواب" : "إظهار الجواب";
  ui.answerText.closest(".ds-answer").hidden = !answerVisible;

  // الإعدادات
  if (document.activeElement !== ui.nameA) ui.nameA.value = state.teams.a.name;
  if (document.activeElement !== ui.nameB) ui.nameB.value = state.teams.b.name;
  ui.colorA.value = state.teams.a.color;
  ui.colorB.value = state.teams.b.color;
  if (state.theme) {
    const base = DS_THEMES[state.theme.ds] || DS_THEMES.hussein;
    if (ui.bgColor) ui.bgColor.value = state.theme.bgColor || PAPER;
    if (ui.cellColor) ui.cellColor.value = state.theme.cellColor || base.cream;
    if (ui.selectedColor) ui.selectedColor.value = state.theme.selectedColor || base.sun;
  }

  renderThemeChips();
  renderColorWarnings();

  renderBoardEditor();
  renderLog();
  renderBuzzControls();
  syncPresetsFromState();
}

/* ---------------- التحكم بالشاشة الكبيرة ---------------- */

function renderScreenControls() {
  const scr = state.screen || {};
  const lobbyOn = scr.lobby !== false;
  const soundOn = scr.sound !== false;
  const screens = peers?.screen || 0;

  if (ui.lobbyToggleBtn) {
    setBtn(ui.lobbyToggleBtn, lobbyOn ? "play" : "qr", lobbyOn ? "ابدأ اللعب (إخفاء الرموز)" : "اعرض رموز QR على الشاشة");
    ui.lobbyToggleBtn.classList.toggle("ds-btn--primary", lobbyOn);
  }
  if (ui.screenSoundBtn) {
    setBtn(ui.screenSoundBtn, soundOn ? "volume" : "volume-off", soundOn ? "صوت الشاشة: يعمل" : "صوت الشاشة: مكتوم");
    ui.screenSoundBtn.setAttribute("aria-pressed", String(soundOn));
  }
  for (const b of document.querySelectorAll("#qrRouteSeg [data-value]")) {
    b.setAttribute("aria-pressed", String((scr.qr || "both") === b.dataset.value));
  }
  if (ui.screenFullBtn) {
    const full = !!peers?.screenFullscreen;
    setBtn(ui.screenFullBtn, "fullscreen", full ? "الخروج من ملء الشاشة" : "ملء الشاشة على التلفاز");
    ui.screenFullBtn.setAttribute("aria-pressed", String(full));
    ui.screenFullBtn.disabled = !screens;
  }
  if (ui.screenHint) {
    ui.screenHint.textContent = !screens
      ? "الشاشة غير متصلة"
      : lobbyOn
        ? "تعرض رموز QR الآن"
        : "تعرض اللعبة";
  }
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
  if (ui.buzzNoRepeat) ui.buzzNoRepeat.checked = !!b.noRepeat;

  const on = !!b.enabled;
  ui.buzzOpenBtn.disabled = !on || !!b.open;
  ui.buzzResetBtn.disabled = !on;
  ui.buzzOpenBtn.setAttribute("aria-pressed", String(on && !!b.open && !b.winner));

  updateBuzzReadout();

  if (!buzzQrDrawn) drawPlayQrs();
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
  let ic = "bell";
  const conn2 = peers ? ` · اللاعبون المتصلون: ${(peers.players || []).length}` : "";
  if (!on) {
    text = "الأجراس متوقفة — فعّلها ليضغط اللاعبون من جوالاتهم.";
    ic = "volume-off";
  } else if (state.current.verdict) {
    text = `${state.teams[state.current.verdict.team].name} أخذ النقطة${conn2}`;
    ic = "check";
  } else if (state.current.missed) {
    text = `لم يُجب أحد — الجواب ظاهر على الشاشة${conn2}`;
    ic = "question";
  } else if (b.phase === "answer" && b.player) {
    const secs = Math.max(0, Math.ceil(remainingMs(timer, transport.serverOffset) / 1000));
    text = `${b.player.name} يجيب — بقي ${secs} ث${conn2}`;
    ic = "bolt";
  } else if (b.phase === "open") {
    text = `الأجراس مفتوحة — بانتظار أول ضغطة${conn2}`;
  } else if (b.phase === "team") {
    const secs = Math.max(0, Math.ceil(remainingMs(timer, transport.serverOffset) / 1000));
    text = `دور ${state.teams[b.allowed]?.name} — بقي ${secs} ث${conn2}`;
    ic = "users";
  } else if (b.phase === "all") {
    text = `مفتوح للجميع — اختر الفريق الذي أجاب${conn2}`;
    ic = "megaphone";
  } else {
    text = `الأجراس جاهزة${b.autoArm !== false ? " — تُفتح تلقائياً عند عرض السؤال" : ""}${conn2}`;
  }
  ui.buzzReadoutText.textContent = text;
  setIcon(ui.buzzReadoutIcon, ic);
  // شريط ملوّن (بلا لون إضافي) أثناء جولة جارية، وأزرق هادئ عند الخمول
  ui.buzzReadout.classList.toggle("ds-banner--info", !(on && (!!b.open || !!b.winner || !!timer.running)));
  updateBuzzBanner();
  renderJudge();

  // تحديث العدّاد الحيّ كل ربع ثانية أثناء دوران المؤقّت
  const running = !!timer.running;
  if (running && !readoutTick) {
    readoutTick = setInterval(updateBuzzReadout, 250);
  } else if (!running && readoutTick) {
    clearInterval(readoutTick);
    readoutTick = null;
  }
}

/** لافتة الضغط القديمة تبقى مخفية: لوحة الحكم (judgePanel) تعرض كل شيء الآن. */
function updateBuzzBanner() {
  if (ui.buzzBanner) ui.buzzBanner.hidden = true;
}

const NET_WAIT = {
  starting: "جارٍ تجهيز رابط الإنترنت…",
  downloading: "تجهيز رابط الإنترنت لأول مرة…",
  error: "رابط الإنترنت غير متاح الآن — جارٍ المحاولة",
  off: "رابط الإنترنت مُطفأ",
};

/** رمزا دخول اللاعبين (الإنترنت + الواي فاي) كما على التلفاز. */
let playQrBusy = false;
async function drawPlayQrs() {
  if (playQrBusy || !ui.playQr) return;
  playQrBusy = true;
  try {
    const r = await getRoutes(room, "play");
    ui.playQr.replaceChildren();
    for (const kind of ["net", "lan"]) {
      const target = r[kind];
      const box = document.createElement("div");
      box.className = `ds-qr${target ? "" : " is-pending"}`;
      box.dataset.route = kind;
      const frame = document.createElement("div");
      frame.className = "ds-qr-frame";
      const canvas = document.createElement("canvas");
      const wait = document.createElement("div");
      wait.className = "ds-qr-wait";
      frame.append(canvas, wait);
      const pill = document.createElement("span");
      pill.className = `ds-pill ${kind === "net" ? "ds-pill--sun" : "ds-pill--sky"}`;
      pill.append(icon(kind === "net" ? "globe" : "wifi"), document.createTextNode(kind === "net" ? "عبر الإنترنت" : "نفس الواي فاي"));
      box.append(frame, pill);
      ui.playQr.appendChild(box);
      if (target) {
        drawQR(target.url, canvas);
        box.title = target.url;
      } else {
        wait.textContent = kind === "net" ? NET_WAIT[r.netStatus] || NET_WAIT.starting : "لا توجد شبكة محلية";
      }
    }
    buzzQrDrawn = true;
  } catch {
    buzzQrDrawn = false;
  } finally {
    playQrBusy = false;
  }
}
transport.onMessage = (msg) => {
  if (msg.t === "net") drawPlayQrs();
};

/* ---------------- اللاعبون ---------------- */

let playersKey = "";
function renderPlayers() {
  if (!ui.playersCols || !state) return;
  const online = new Set(peers?.players || []);
  const players = Object.values(state.players || {}).filter((pl) => !pl.pseudo);
  const key = JSON.stringify([players, [...online], state.teams.a, state.teams.b]);
  if (key === playersKey) return;
  playersKey = key;

  const onlineCount = players.filter((pl) => online.has(pl.id)).length;
  if (ui.playersHint) ui.playersHint.textContent = `${onlineCount} متصل من ${players.length}`;

  ui.playersCols.replaceChildren();
  for (const t of ["a", "b"]) {
    const team = state.teams[t];
    const col = document.createElement("div");
    col.className = `ds-stack ds-stack--tight ds-team-${t}`;
    const list = players.filter((pl) => pl.team === t).sort((x, y) => y.score - x.score);
    const head = document.createElement("span");
    head.className = "ds-pill ds-pill--team";
    head.textContent = `${team.name} (${list.length})`;
    col.appendChild(head);
    if (!list.length) {
      const empty = document.createElement("span");
      empty.className = "ds-hint";
      empty.textContent = "لا أحد بعد";
      col.appendChild(empty);
    }
    for (const pl of list) {
      const box = document.createElement("div");
      box.className = "ds-stack ds-stack--tight";
      const chip = document.createElement("span");
      chip.className = "ds-player";
      chip.classList.toggle("is-offline", !online.has(pl.id));
      chip.title = online.has(pl.id) ? "متصل" : "غير متصل";
      const av = document.createElement("span");
      av.className = "ds-avatar";
      av.textContent = [...(pl.name || "؟")][0];
      chip.append(av, document.createTextNode(pl.name));
      const stats = document.createElement("span");
      stats.className = "ds-hint";
      stats.textContent = `${pl.score} نقطة${pl.fastest != null ? ` · ${(pl.fastest / 1000).toFixed(1)}ث` : ""}`;
      const acts = document.createElement("div");
      acts.className = "ds-cluster ds-cluster--tight";
      const other = state.teams[t === "a" ? "b" : "a"].name;
      const move = document.createElement("button");
      move.type = "button";
      move.className = "ds-btn ds-btn--icon ds-btn--sm";
      move.append(icon("swap"));
      move.title = `نقل إلى ${other}`;
      move.setAttribute("aria-label", move.title);
      move.addEventListener("click", () => {
        act("playerSetTeam", { id: pl.id, team: t === "a" ? "b" : "a" });
        toast(`نُقل ${pl.name} إلى ${other}`, "swap");
      });
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "ds-btn ds-btn--icon ds-btn--sm ds-btn--danger";
      kick.append(icon("close"));
      kick.title = "إخراج من اللعبة";
      kick.setAttribute("aria-label", kick.title);
      kick.addEventListener("click", () => {
        if (confirm(`إخراج ${pl.name} من اللعبة؟`)) act("playerRemove", { id: pl.id });
      });
      acts.append(move, kick);
      box.append(chip, stats, acts);
      col.appendChild(box);
    }
    ui.playersCols.appendChild(col);
  }
}

/* ---------------- لوحة الحكم أثناء السؤال ---------------- */

const RESULT_ICON = { wrong: "close", timeout: "timer", right: "check" };
const JUDGE_BASE = { judgeRight: "ds-btn--success", judgeWrong: "ds-btn--danger", judgeLock: "" };
const JUDGE_KEY = { judgeRight: "1", judgeWrong: "2", judgeLock: "3" };

/** يضبط زراً من أزرار اللوحة: نصّه، فعله، فريقه (لون)، وظهوره. */
function judgeButton(btn, { iconName = null, label, action, team = null, hidden = false, disabled = false }) {
  if (!btn) return;
  btn.hidden = hidden;
  btn.disabled = disabled;
  btn.dataset.act = action || "";
  btn.classList.remove("ds-btn--success", "ds-btn--danger", "ds-btn--team", "ds-team-a", "ds-team-b");
  if (team) btn.classList.add("ds-btn--team", `ds-team-${team}`);
  else if (JUDGE_BASE[btn.id]) btn.classList.add(JUDGE_BASE[btn.id]);
  btn.replaceChildren();
  if (iconName) btn.appendChild(icon(iconName));
  btn.appendChild(document.createTextNode(label + " "));
  const key = document.createElement("kbd");
  key.className = "ds-kbd";
  key.textContent = JUDGE_KEY[btn.id] || "";
  btn.appendChild(key);
}

function renderJudge() {
  const panel = ui.judgePanel;
  if (!panel || !state) return;
  const c = state.current || {};
  const b = c.buzz || {};
  const show = state.game === "huroof" && !!b.enabled && b.stage > 0 && b.phase !== "done" && b.phase !== "idle" && !c.verdict && !c.missed;
  panel.hidden = !show;
  document.body.classList.toggle("judging", show);
  if (!show) return;

  const tA = state.teams.a;
  const tB = state.teams.b;
  const nameOf = (pl) => (pl?.id?.startsWith("team:") ? state.teams[pl.team]?.name : pl?.name) || "—";
  const answering = b.phase === "answer" && b.player;
  panel.dataset.phase = b.phase;

  const t = c.timer || {};
  const secs = t.running ? Math.max(0, Math.ceil(remainingMs(t, transport.serverOffset) / 1000)) : null;
  ui.judgeTimer.hidden = secs == null;
  if (secs != null) ui.judgeTimerNum.textContent = secs;

  // لافتة «من يجيب»: بلون الفريق عند وجود فريق، وإلا أزرق
  const setWho = (tone, team, ic) => {
    ui.judgeWhoBanner.className = `ds-banner ds-banner--sm${tone ? ` ds-banner--${tone}` : ""}${team ? ` ds-banner--team ds-team-${team}` : ""}`;
    setIcon(ui.judgeWhoIcon, ic);
  };
  let stage = 1;

  if (b.phase === "open") {
    ui.judgeStage.textContent = "الجولة ١ · الأجراس";
    ui.judgeWho.textContent = "بانتظار أول ضغطة… (بلا حدّ زمني)";
    setWho("info", null, "bell");
    judgeButton(ui.judgeRight, { iconName: "check", label: "صح", action: "", disabled: true });
    judgeButton(ui.judgeWrong, { iconName: "close", label: "خطأ", action: "", disabled: true });
    judgeButton(ui.judgeLock, { iconName: "lock", label: "إغلاق", action: "lock" });
  } else if (answering) {
    ui.judgeStage.textContent = "الجولة ١ · الأجراس";
    ui.judgeWho.textContent = `${nameOf(b.player)} يجيب — ${state.teams[b.player.team].name}`;
    setWho("", b.player.team, "bolt");
    judgeButton(ui.judgeRight, { iconName: "check", label: "صح", action: "correct" });
    judgeButton(ui.judgeWrong, { iconName: "close", label: "خطأ", action: "wrong" });
    judgeButton(ui.judgeLock, { label: "إغلاق", action: "", hidden: true });
  } else if (b.phase === "team") {
    stage = 2;
    const team = state.teams[b.allowed];
    ui.judgeStage.textContent = `الجولة ٢ · دور ${team.name}`;
    ui.judgeWho.textContent = `${team.name} يجيبون بصوت عالٍ — حتى ينتهي الوقت`;
    setWho("", b.allowed, "users");
    judgeButton(ui.judgeRight, { iconName: "check", label: `نقطة لـ ${team.name}`, action: "correct", team: b.allowed });
    judgeButton(ui.judgeWrong, { label: "", action: "", hidden: true });
    judgeButton(ui.judgeLock, { label: "", action: "", hidden: true });
  } else if (b.phase === "all") {
    stage = 3;
    ui.judgeStage.textContent = "الجولة ٣ · مفتوح للجميع";
    ui.judgeWho.textContent = "من أجاب صح؟ اختر الفريق (بلا وقت)";
    setWho("success", null, "megaphone");
    judgeButton(ui.judgeRight, { iconName: "check", label: tA.name, action: "correctA", team: "a" });
    judgeButton(ui.judgeWrong, { iconName: "check", label: tB.name, action: "correctB", team: "b" });
    judgeButton(ui.judgeLock, { iconName: "question", label: "لم يُجب أحد", action: "noPoint" });
  }

  for (const s of ui.judgeSteps.querySelectorAll(".ds-step")) {
    const n = Number(s.dataset.stage);
    s.classList.toggle("is-on", n === stage);
    s.classList.toggle("is-done", n < stage);
  }

  ui.judgeHistory.replaceChildren();
  for (const h of b.history || []) {
    const chip = document.createElement("span");
    chip.className = `ds-pill ds-pill--team ds-team-${h.team}`;
    chip.append(icon(RESULT_ICON[h.result] || "timer"), document.createTextNode(`${nameOf(h)}${h.ms != null ? ` ${(h.ms / 1000).toFixed(2)}ث` : ""}`));
    ui.judgeHistory.appendChild(chip);
  }
}

/* ---------------- محرّر اللوحة ---------------- */

function hexButton(letter, cls = "") {
  const hex = document.createElement("button");
  hex.type = "button";
  hex.className = `ds-hex ${cls}`.trim();
  hex.innerHTML = `<div class="ds-hex-in"><div class="ds-hex-face"><span class="ds-hex-letter"></span></div></div>`;
  hex.querySelector(".ds-hex-letter").textContent = letter;
  return hex;
}

function renderBoardEditor() {
  const wrap = ui.boardEditor;
  wrap.replaceChildren();
  for (const cell of boardCfg.cells) {
    const owner = state.cells[cell.id]?.owner;
    const selected = state.current.cellId === cell.id;
    const btn = hexButton(state.cells[cell.id]?.letter ?? cell.letter, `${owner ? `is-${owner}` : ""} ${selected ? "is-selected" : ""}`);
    btn.addEventListener("click", () => openLetterModal(cell.id));
    wrap.appendChild(btn);
  }
}

/* ---------------- السجل ---------------- */

const TONE_ICON = { info: "info", warn: "warning", win: "trophy", a: "check", b: "check" };

function renderLog() {
  const list = ui.logList;
  list.replaceChildren();
  for (const item of state.log || []) {
    const row = document.createElement("div");
    row.className = "ds-list-item";
    const tone = item.tone || "info";
    const badge = document.createElement("span");
    badge.className = tone === "a" || tone === "b" ? `ds-avatar ds-team-${tone}` : "ds-badge-icon";
    badge.appendChild(icon(item.icon || TONE_ICON[tone] || "info"));
    const text = document.createElement("span");
    text.className = "ds-text";
    text.textContent = item.text;
    row.append(badge, text);
    list.appendChild(row);
  }
}

/* ---------------- المؤقّت ---------------- */

function updateTimerReadout() {
  if (!state) return;
  const t = state.current.timer;
  const rem = remainingMs(t, transport.serverOffset);
  if (t.running && rem > 0) {
    const turn =
      state.current.turn === "a" ? state.teams.a.name :
      state.current.turn === "b" ? state.teams.b.name :
      "مفتوح للجميع";
    ui.timerReadoutText.textContent = `${turn} — ${Math.ceil(rem / 1000)} ثانية`;
    ui.timerReadout.classList.add("ds-pill--sun");
    ui.timerReadout.classList.remove("ds-pill--dark");
  } else {
    ui.timerReadoutText.textContent = "المؤقّت متوقف";
    ui.timerReadout.classList.remove("ds-pill--sun");
    ui.timerReadout.classList.add("ds-pill--dark");
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

  ui.letterGrid.replaceChildren();
  // الحروف المستخدمة في خلايا أخرى تُعطَّل: لا نكرّر أي حرف داخل الشبكة.
  const usedElsewhere = new Set(
    Object.keys(state.cells)
      .filter((id) => id !== cellId)
      .map((id) => state.cells[id].letter)
  );
  for (const letter of ALL_LETTERS) {
    const count = letterStats[letter];
    const btn = hexButton(letter, `${letter === cell.letter ? "is-selected" : ""} ${!count ? "is-dim" : ""}`);
    if (usedElsewhere.has(letter)) {
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
      toast(`تم تغيير الحرف إلى "${letter}"`, "type");
      if (cellId === state.current.cellId) setTimeout(() => act("newQuestion"), 120);
    });
    ui.letterGrid.appendChild(btn);
  }

  ui.letterModal.classList.add("is-open");
}

function closeLetterModal() {
  ui.letterModal.classList.remove("is-open");
  letterTarget = null;
}

/* ---------------- ربط الأحداث ---------------- */

ui.revealBtn.addEventListener("click", () => act("reveal"));
ui.hideBtn.addEventListener("click", () => act("hide"));
ui.revealAnswerBtn.addEventListener("click", () => {
  act("revealAnswer");
  toast("تم إظهار الجواب على الشاشة", "eye");
});
ui.hideAnswerBtn.addEventListener("click", () => {
  act("hideAnswer");
  toast("تم إخفاء الجواب عن الشاشة", "lock");
});
ui.newQBtn.addEventListener("click", () => {
  act("newQuestion");
  toast("تم اختيار سؤال جديد لنفس الحرف", "swap");
});
ui.letterBtn.addEventListener("click", () => {
  if (state.current.cellId) openLetterModal(state.current.cellId);
});

ui.awardA.addEventListener("click", () => {
  act("award", { cellId: state.current.cellId, team: "a" });
  toast(`نقطة لـ ${state.teams.a.name}`, "check");
});
ui.awardB.addEventListener("click", () => {
  act("award", { cellId: state.current.cellId, team: "b" });
  toast(`نقطة لـ ${state.teams.b.name}`, "check");
});
ui.unclaimBtn.addEventListener("click", () => {
  act("unclaim", { cellId: state.current.cellId });
  toast("تمت الإزالة من الفريق", "ban");
});
ui.clearBtn.addEventListener("click", () => act("clear"));
/* ---------------- لوحة الحكم: صح / خطأ / إغلاق / سؤال آخر ---------------- */

/** ينفّذ فعل زر من أزرار لوحة الحكم (الفعل يتغيّر حسب الجولة). */
function judgeDo(btn) {
  if (!state || !btn || btn.hidden || btn.disabled) return;
  const cellId = state.current.cellId;
  const b = state.current.buzz;
  switch (btn.dataset.act) {
    case "correct": {
      const team = b.phase === "team" ? b.allowed : b.player?.team;
      act("buzzCorrect", { cellId });
      toast(`نقطة لـ ${team ? state.teams[team].name : "الفريق"}`, "check");
      break;
    }
    case "correctA":
    case "correctB": {
      const team = btn.dataset.act === "correctA" ? "a" : "b";
      act("buzzCorrect", { cellId, team });
      toast(`نقطة لـ ${state.teams[team].name}`, "check");
      break;
    }
    case "wrong":
      act("buzzWrong");
      toast("خطأ — دور الفريق الآخر", "close");
      break;
    case "lock":
      act("buzzClose");
      toast("أُغلقت الأجراس", "lock");
      break;
    case "noPoint":
      act("noPoint", { cellId });
      toast("لم يُجب أحد — الجواب ظاهر على الشاشة", "question");
      break;
  }
}
const judgeRight = () => judgeDo(ui.judgeRight);
const judgeWrong = () => judgeDo(ui.judgeWrong);
const judgeLock = () => judgeDo(ui.judgeLock);
function judgeNewQ() {
  if (!state?.current?.cellId) return;
  act("newQuestion");
  toast("سؤال آخر لنفس الحرف", "swap");
}
ui.judgeRight?.addEventListener("click", judgeRight);
ui.judgeWrong?.addEventListener("click", judgeWrong);
ui.judgeLock?.addEventListener("click", judgeLock);
ui.judgeNewQ?.addEventListener("click", judgeNewQ);

ui.undoBtn?.addEventListener("click", () => {
  act("undo");
  toast("تراجع عن آخر قرار", "undo");
});
ui.shuffleBtn?.addEventListener("click", () => {
  if (confirm("خلط حروف الخلايا الحرّة؟ النقاط والخلايا الملوّنة تبقى كما هي.")) {
    act("shuffle");
    toast("خُلطت الحروف الحرّة", "swap");
  }
});
ui.hintBtn?.addEventListener("click", () => {
  act(state?.current?.hintRevealed ? "hideHint" : "revealHint");
});
ui.buzzNoRepeat?.addEventListener("change", () => {
  act("buzzConfig", { noRepeat: ui.buzzNoRepeat.checked });
});

// اختصارات لوحة المفاتيح (إن كان الحكم على لابتوب)
document.addEventListener("keydown", (e) => {
  const tag = (e.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    ui.undoBtn?.click();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (state?.game !== "huroof") return;
  if (e.key === "1") judgeRight();
  else if (e.key === "2") judgeWrong();
  else if (e.key === "3") judgeLock();
  else if (e.key === "4") judgeNewQ();
});

el("changeGameBtn")?.addEventListener("click", () => {
  if (confirm("العودة إلى قائمة الألعاب؟ اللعبة الحالية تبقى محفوظة كما هي.")) {
    act("setGame", { game: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

initTaboo({
  act,
  toast,
  getState: () => state,
  getPeers: () => peers,
  remainingMs: (t) => remainingMs(t, transport.serverOffset),
});

ui.noPointBtn?.addEventListener("click", () => {
  act("noPoint", { cellId: state.current.cellId });
  toast("لم يُجب أحد — الجواب ظاهر على الشاشة", "question");
});

ui.lobbyToggleBtn?.addEventListener("click", () => {
  const lobbyOn = state?.screen?.lobby !== false;
  act("screen", { lobby: !lobbyOn });
  toast(lobbyOn ? "بدأ اللعب — أُخفيت الرموز عن الشاشة" : "رموز QR ظاهرة على الشاشة", "qr");
});
// أي رموز QR تظهر على التلفاز (بدون حكم متصل يظهر الاثنان دائماً)
document.getElementById("qrRouteSeg")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-value]");
  if (!b) return;
  act("screen", { qr: b.dataset.value });
  toast({ both: "يظهر الرمزان على التلفاز", net: "رمز الإنترنت فقط على التلفاز", lan: "رمز الواي فاي فقط على التلفاز" }[b.dataset.value], "qr");
});

/** حالة الطريقين (يُحدَّث عند كل تغيّر في رابط الإنترنت). */
async function refreshNetStatus() {
  const line = document.getElementById("netStatusLine");
  if (!line) return;
  try {
    const info = await (await fetch("/api/network", { cache: "no-store" })).json();
    const t = info.tunnel || {};
    const net =
      t.status === "ok" ? `الإنترنت: يعمل (${new URL(t.url).host})`
      : t.status === "error" ? "الإنترنت: متعطّل — جارٍ المحاولة"
      : t.status === "off" ? "الإنترنت: مُطفأ"
      : "الإنترنت: جارٍ التجهيز…";
    const lan = info.addresses?.length ? `الواي فاي: ${info.addresses[0].address}:${info.port}` : "الواي فاي: لا توجد شبكة";
    line.textContent = `${net} · ${lan}`;
  } catch {
    line.textContent = "—";
  }
}
refreshNetStatus();
setInterval(refreshNetStatus, 30000);

ui.screenFullBtn?.addEventListener("click", () => {
  const full = !!peers?.screenFullscreen;
  act("screenFullscreen");
  toast(full ? "جارٍ الخروج من ملء الشاشة…" : "جارٍ تكبير الشاشة…", "fullscreen");
});
ui.screenSoundBtn?.addEventListener("click", () => {
  const soundOn = state?.screen?.sound !== false;
  act("screen", { sound: !soundOn });
  toast(soundOn ? "تم كتم صوت الشاشة" : "تم تشغيل صوت الشاشة", soundOn ? "volume-off" : "volume");
});

ui.turnA.addEventListener("click", () => {
  act("setTurn", { turn: "a" });
  act("startTimer", { seconds: Number(state.current.buzz?.seconds) || 3 });
});
ui.turnB.addEventListener("click", () => {
  act("setTurn", { turn: "b" });
  act("startTimer", { seconds: Number(state.current.buzz?.otherSeconds) || 10 });
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
  toast(`تم اختيار الحرف "${state.cells[pick.id].letter}"`, "dice");
});

ui.resetBtn.addEventListener("click", () => {
  if (confirm("بدء جولة جديدة؟ سيتم مسح كل النقاط والخلايا المملوكة.")) {
    act("reset");
    toast("جولة جديدة", "undo");
  }
});

ui.peekBtn.addEventListener("click", () => {
  answerVisible = !answerVisible;
  ui.peekBtn.textContent = answerVisible ? "إخفاء الجواب" : "إظهار الجواب";
  ui.answerText.closest(".ds-answer").hidden = !answerVisible;
});

ui.nameA.addEventListener("change", () => act("setTeam", { team: "a", name: ui.nameA.value }));
ui.nameB.addEventListener("change", () => act("setTeam", { team: "b", name: ui.nameB.value }));
ui.colorA.addEventListener("input", () => act("setTeam", { team: "a", color: ui.colorA.value }));
ui.colorB.addEventListener("input", () => act("setTeam", { team: "b", color: ui.colorB.value }));
if (ui.bgColor) ui.bgColor.addEventListener("input", () => act("setTheme", { bgColor: ui.bgColor.value }));
if (ui.cellColor) ui.cellColor.addEventListener("input", () => act("setTheme", { cellColor: ui.cellColor.value }));
if (ui.selectedColor) ui.selectedColor.addEventListener("input", () => act("setTheme", { selectedColor: ui.selectedColor.value }));

/* ---------------- قوالب الألوان + تنبيه الألوان المتقاربة ---------------- */

let themeChipsKey = "";

/** أزرار القوالب الجاهزة (تُرسم مرة واحدة، ويُعلَّم القالب المطابق للألوان الحالية). */
function renderThemeChips() {
  if (!ui.themeChips || !state) return;
  const current = JSON.stringify([
    state.theme?.ds, state.teams.a.color, state.teams.b.color,
    state.theme?.cellColor, state.theme?.selectedColor, state.theme?.bgColor,
  ].map((c) => String(c || "").toLowerCase()));
  if (current === themeChipsKey && ui.themeChips.childElementCount) return;
  themeChipsKey = current;

  ui.themeChips.textContent = "";
  for (const [id, t] of Object.entries(DS_THEMES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ds-btn ds-btn--sm";
    btn.setAttribute("aria-pressed", String(state.theme?.ds === id));
    const sw = document.createElement("span");
    sw.className = "ds-swatches";
    for (const c of [t.teams.a, t.teams.b, t.cream, t.sun, t.stage]) {
      const dot = document.createElement("i");
      dot.className = "ds-swatch";
      dot.style.setProperty("--sw", c);
      sw.appendChild(dot);
    }
    btn.append(sw, document.createTextNode(t.name));
    btn.addEventListener("click", () => {
      act("setTeam", { team: "a", color: t.teams.a });
      act("setTeam", { team: "b", color: t.teams.b });
      act("setTheme", { ds: id, cellColor: t.cream, selectedColor: t.sun, bgColor: PAPER });
      toast(`تم تطبيق قالب: ${t.name}`, "palette");
    });
    ui.themeChips.appendChild(btn);
  }
}

/** يعرض تنبيهاً عندما يختار الحكم ألواناً ستختلط على الشاشة، مع زر إصلاح تلقائي. */
function renderColorWarnings() {
  if (!ui.colorWarn || !state) return;
  const clashes = findClashes(state.teams, state.theme || {});
  ui.colorWarn.hidden = clashes.length === 0;
  ui.colorWarnList.textContent = "";
  for (const c of clashes) {
    const li = document.createElement("div");
    li.className = "ds-cluster ds-cluster--tight";
    const pair = document.createElement("span");
    pair.className = "ds-swatches";
    for (const col of c.colors) {
      const dot = document.createElement("i");
      dot.className = "ds-swatch";
      dot.style.setProperty("--sw", col);
      pair.appendChild(dot);
    }
    li.append(pair, document.createTextNode(` ${c.msg} — سيُعدَّل ${COLOR_LABELS[c.fix]}`));
    ui.colorWarnList.appendChild(li);
  }
}

if (ui.colorFixBtn) {
  ui.colorFixBtn.addEventListener("click", () => {
    const fix = autoFixColors(state.teams, state.theme || {});
    if (fix.teams.a) act("setTeam", { team: "a", color: fix.teams.a });
    if (fix.teams.b) act("setTeam", { team: "b", color: fix.teams.b });
    if (Object.keys(fix.theme).length) act("setTheme", fix.theme);
    const n = Object.keys(fix.teams).length + Object.keys(fix.theme).length;
    toast(n ? `تم تعديل ${n} ${n === 1 ? "لون" : "ألوان"} — الألوان الآن مميّزة بوضوح` : "لم أجد بديلاً مناسباً — جرّب قالباً جاهزاً", "sparkle");
  });
}

/* ---------------- أجراس اللاعبين: الأحداث ---------------- */

ui.buzzEnabled.addEventListener("change", () => {
  act("buzzConfig", { enabled: ui.buzzEnabled.checked });
  toast(ui.buzzEnabled.checked ? "تم تفعيل الأجراس" : "تم إيقاف الأجراس", "bell");
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
  toast("الأجراس مفتوحة — اضغطوا الآن!", "bell");
});

ui.buzzResetBtn.addEventListener("click", () => {
  act("buzzReset");
  toast("تمت إعادة الأجراس", "undo");
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

// اختيار متفائل يُعرض فوراً قبل رجوع تأكيد الخادم (يمنع الحاجة للضغط مرتين)
let optimisticPresets = null;

function activePresetIds() {
  if (optimisticPresets) return optimisticPresets;
  return (state && state.presets && state.presets.active) || [];
}

function presetsSig(list) {
  const arr = (list === undefined ? activePresetIds() : list) || [];
  return JSON.stringify([...arr].map(String).sort());
}

/** يعيد رسم قائمة المجموعات عند تغيّر الاختيار فعلاً. */
function syncPresetsFromState() {
  const serverActive = (state && state.presets && state.presets.active) || [];
  const serverSig = presetsSig(serverActive);
  // ما دام الاختيار المتفائل لم يؤكّده الخادم، أبقِ واجهة المستخدم كما هي
  if (optimisticPresets) {
    if (presetsSig(optimisticPresets) !== serverSig) return;
    optimisticPresets = null; // وصل تأكيد الخادم
  }
  if (serverSig === presetsKey) return;
  presetsKey = serverSig;
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
    d.className = "ds-hint";
    d.textContent = "لا توجد مجموعات بعد — اضغط «إدارة وتعديل المجموعات».";
    ui.presetList.appendChild(d);
  }

  const active = activePresetIds();
  const allActive = active.length === 0;

  for (const p of presetFiles) {
    const row = document.createElement("label");
    row.className = "ds-list-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "ds-switch";
    cb.checked = allActive || active.includes(p.id);
    cb.title = "تفعيل/تعطيل هذه المجموعة";
    cb.addEventListener("change", () => {
      const base = activePresetIds();
      const current = base.length ? base.slice() : presetFiles.map((x) => x.id);
      const set = new Set(current);
      if (cb.checked) set.add(p.id);
      else set.delete(p.id);
      const list = [...set];
      const payload = list.length >= presetFiles.length ? [] : list;
      optimisticPresets = payload;
      presetsKey = presetsSig(payload);
      act("presets", { active: payload });
      renderPresets();
      try {
        sfx.play("toggleOn");
      } catch {}
    });
    row.appendChild(cb);

    const name = document.createElement("span");
    name.className = "ds-text";
    name.textContent = p.name;
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "ds-hint";
    meta.textContent = `${p.total || 0} سؤال`;
    row.appendChild(meta);
    if (p.warnings) {
      const warn = document.createElement("span");
      warn.className = "ds-pill ds-pill--coral";
      warn.append(icon("warning"), document.createTextNode(String(p.warnings)));
      row.appendChild(warn);
    }

    const edit = document.createElement("a");
    edit.className = "ds-btn ds-btn--icon ds-btn--sm";
    edit.href = `/presets?id=${encodeURIComponent(p.id)}`;
    edit.target = "_blank";
    edit.rel = "noopener";
    edit.append(icon("pen"));
    edit.title = "معاينة وتعديل الأسئلة";
    edit.setAttribute("aria-label", edit.title);
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
