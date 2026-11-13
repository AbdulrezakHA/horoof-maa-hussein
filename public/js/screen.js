/* ==================================================================
   منطق الشاشة الكبيرة — مطابق لملف حروف مع حسين layout.svg بمقاس 1920x1080
   ================================================================== */
import { Transport, remainingMs } from "/js/transport.js";
import { drawQR, getRefereeUrls, getBuzzerUrls } from "/js/qr.js";
import { sfx } from "/js/sfx.js";

const params = new URLSearchParams(location.search);
const room = params.get("room") || "main";

const el = {
  gameSvg: document.getElementById("gameSvg"),
  bgLeft: document.getElementById("bgLeft"),
  polyTop: document.getElementById("polyTop"),
  polyBottom: document.getElementById("polyBottom"),
  bgRight: document.getElementById("bgRight"),
  selectedHexPath: document.getElementById("selectedHexPath"),
  selectedHexText: document.getElementById("selectedHexText"),
  selectedHexGroup: document.getElementById("selectedHexGroup"),
  qText: document.getElementById("qText"),
  qAnswerBox: document.getElementById("qAnswerBox"),
  qAnswerValue: document.getElementById("qAnswerValue"),
  scoreTextA: document.getElementById("scoreTextA"),
  scoreTextB: document.getElementById("scoreTextB"),
  scoreHexPathA: document.getElementById("scoreHexPathA"),
  scoreHexPathB: document.getElementById("scoreHexPathB"),
  timerOverlay: document.getElementById("timerOverlay"),
  timerNum: document.getElementById("timerNum"),
  timerTurn: document.getElementById("timerTurn"),
  winnerOverlay: document.getElementById("winnerOverlay"),
  winnerName: document.getElementById("winnerName"),
  confetti: document.getElementById("confetti"),
  lobby: document.getElementById("lobby"),
  lobbyUrl: document.getElementById("lobbyUrl"),
  lobbyStatusText: document.getElementById("lobbyStatusText"),
  qrCanvas: document.getElementById("qrCanvas"),
  lobbyPairCode: document.getElementById("lobbyPairCode"),
  lobbyHide: document.getElementById("lobbyHide"),
  lobbyStart: document.getElementById("lobbyStart"),
  connBadge: document.getElementById("connBadge"),
  connBadgeDot: document.getElementById("connBadgeDot"),
  connBadgeText: document.getElementById("connBadgeText"),
  timerBadge: document.getElementById("timerBadge"),
  timerDot: document.getElementById("timerDot"),
  buzzBanner: document.getElementById("buzzBanner"),
  buzzBannerIcon: document.getElementById("buzzBannerIcon"),
  buzzBannerText: document.getElementById("buzzBannerText"),
  buzzBannerSub: document.getElementById("buzzBannerSub"),
  buzzBannerTimer: document.getElementById("buzzBannerTimer"),
  qrCardA: document.getElementById("qrCardA"),
  qrCardB: document.getElementById("qrCardB"),
  qrCanvasA: document.getElementById("qrCanvasA"),
  qrCanvasB: document.getElementById("qrCanvasB"),
};

let state = null;
let boardCfg = null;
let lastWinner = null;
let refereeConnected = false;
let cellEls = new Map();

// ربط جميع خلايا اللوحة السداسية الـ 25 داخل SVG
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const id = `r${r}c${c}`;
    const g = document.getElementById(`cell-${id}`);
    if (g) {
      const path = g.querySelector(".cell-path");
      const text = g.querySelector(".cell-text");
      cellEls.set(id, { g, path, text });
      g.addEventListener("click", () => {
        transport.send({ type: "select", payload: { cellId: id } });
      });
    }
  }
}

const transport = new Transport("screen", room);

transport.onStatus = (s) => {
  if (el.connBadgeDot) {
    el.connBadgeDot.style.background = s === "online" ? "#10b981" : "#f87171";
  }
};

transport.onState = (msg) => {
  const prev = state;
  state = msg.state;
  boardCfg = msg.board;

  if (msg.pairing?.code) {
    if (el.lobbyPairCode) el.lobbyPairCode.textContent = msg.pairing.code;
  }

  updateLobby(msg.peers);
  render();
  renderTimer();
  screenSfx(state);
};

transport.connect();

/* ---------------- قائمة البداية ورمز QR ---------------- */
function updateLobby(peers) {
  const connected = !!(peers && peers.referee > 0);
  if (connected === refereeConnected) return;
  refereeConnected = connected;

  if (el.connBadge) {
    el.connBadge.classList.toggle("online", connected);
    el.connBadgeText.textContent = connected ? "الحكم متصل ✓" : "بانتظار الحكم";
  }

  if (el.lobby) {
    el.lobby.classList.toggle("connected", connected);
    if (el.lobbyStatusText) {
      el.lobbyStatusText.textContent = connected
        ? "تم اتصال الحكم ✅ اضغط «ابدأ اللعب»"
        : "بانتظار مسح الرمز من الجوال…";
    }
  }
}

function showLobby() {
  if (el.lobby) el.lobby.classList.remove("lobby-off");
}

function hideLobby() {
  if (el.lobby) el.lobby.classList.add("lobby-off");
}

async function initLobby() {
  try {
    const options = await getRefereeUrls(room);
    if (options && options.length > 0) {
      showRefereeUrl(options[0]);
    }
  } catch (err) {
    if (el.lobbyUrl) el.lobbyUrl.textContent = `${location.origin}/referee`;
  }
  // رمزا جرس الفريقين — يُمسحان من هاتفي اللاعبين
  drawBuzzerQr("a");
  drawBuzzerQr("b");
}

/** يرسم رمز QR لجرس فريق معيّن. */
async function drawBuzzerQr(team) {
  const canvas = team === "a" ? el.qrCanvasA : el.qrCanvasB;
  if (!canvas) return;
  try {
    const options = await getBuzzerUrls(room, team);
    if (options?.[0]) drawQR(options[0].url, canvas);
  } catch {
    /* نتجاهل: يظهر الرمز عند توفر الرابط */
  }
}

function showRefereeUrl(option) {
  if (el.lobbyUrl) el.lobbyUrl.textContent = option.url;
  if (el.qrCanvas) drawQR(option.url, el.qrCanvas);
}

if (el.lobbyStart) el.lobbyStart.addEventListener("click", hideLobby);
if (el.lobbyHide) el.lobbyHide.addEventListener("click", hideLobby);
if (el.connBadge) el.connBadge.addEventListener("click", showLobby);

initLobby();

/* ---------------- العرض والتحديث ---------------- */
function render() {
  if (!state) return;

  const teamAColor = state.teams.a?.color || "#6965ae";
  const teamBColor = state.teams.b?.color || "#4b9cbf";
  const bgColor = state.theme?.bgColor || "#73c4ee";
  const cellColor = state.theme?.cellColor || "#ede5bb";
  const cellTextColor = state.theme?.cellTextColor || "#635e48";
  const selectedColor = state.theme?.selectedColor || "#fcb017";
  const selectedTextColor = state.theme?.selectedTextColor || "#ffffff";

  document.documentElement.style.setProperty("--bg-color", bgColor);
  document.documentElement.style.setProperty("--cell-text-color", cellTextColor);
  document.documentElement.style.setProperty("--selected-color", selectedColor);
  document.documentElement.style.setProperty("--team-a-color", teamAColor);
  document.documentElement.style.setProperty("--team-b-color", teamBColor);

  // تحديث محطات التدرج في SVG
  const stopA1 = document.getElementById("stopTeamA1");
  const stopA2 = document.getElementById("stopTeamA2");
  if (stopA1 && stopA2) {
    stopA1.setAttribute("stop-color", teamAColor);
    stopA2.setAttribute("stop-color", teamAColor);
  }

  const stopB1 = document.getElementById("stopTeamB1");
  const stopB2 = document.getElementById("stopTeamB2");
  if (stopB1 && stopB2) {
    stopB1.setAttribute("stop-color", teamBColor);
    stopB2.setAttribute("stop-color", teamBColor);
  }

  const stopCell1 = document.getElementById("stopCell1");
  const stopCell2 = document.getElementById("stopCell2");
  if (stopCell1 && stopCell2) {
    stopCell1.setAttribute("stop-color", cellColor);
    stopCell2.setAttribute("stop-color", cellColor);
  }

  const stopSel1 = document.getElementById("stopSel1");
  const stopSel2 = document.getElementById("stopSel2");
  if (stopSel1 && stopSel2) {
    stopSel1.setAttribute("stop-color", selectedColor);
    stopSel2.setAttribute("stop-color", selectedColor);
  }

  if (el.bgLeft) el.bgLeft.setAttribute("fill", bgColor);

  // تحديث خلايا اللوحة الـ 25
  for (const [id, els] of cellEls) {
    const cell = state.cells[id];
    if (!cell) continue;

    els.text.textContent = cell.letter;
    const isSelected = state.current.cellId === id;
    const owner = cell.owner;

    els.g.classList.toggle("is-selected", isSelected);
    els.text.classList.toggle("is-selected", isSelected);
    els.text.classList.toggle("owner-team-a", owner === "a");
    els.text.classList.toggle("owner-team-b", owner === "b");

    if (isSelected) {
      els.path.setAttribute("fill", "url(#grad-cell-selected)");
      els.text.style.fill = selectedTextColor;
    } else if (owner === "a") {
      els.path.setAttribute("fill", "url(#grad-team-a)");
      els.text.style.fill = "#ffffff";
    } else if (owner === "b") {
      els.path.setAttribute("fill", "url(#grad-team-b)");
      els.text.style.fill = "#ffffff";
    } else {
      els.path.setAttribute("fill", "url(#grad-cell-unselected)");
      els.text.style.fill = cellTextColor;
    }
  }

  // تحديث الحرف المختار في أعلى اليمين
  const activeCellId = state.current.cellId;
  const activeCell = activeCellId ? state.cells[activeCellId] : null;

  if (!activeCell) {
    el.selectedHexText.textContent = "؟";
    el.selectedHexPath.setAttribute("fill", "url(#grad-cell-unselected)");
  } else {
    el.selectedHexText.textContent = activeCell.letter;
    if (activeCell.owner === "a") {
      el.selectedHexPath.setAttribute("fill", "url(#grad-team-a)");
    } else if (activeCell.owner === "b") {
      el.selectedHexPath.setAttribute("fill", "url(#grad-team-b)");
    } else {
      el.selectedHexPath.setAttribute("fill", "url(#grad-cell-selected)");
    }
  }

  // تحديث السؤال والجواب في منتصف اليمين
  const q = state.current.question;
  if (!activeCell) {
    el.qText.textContent = "";
    if (el.qAnswerBox) el.qAnswerBox.style.display = "none";
  } else if (!state.current.revealed) {
    el.qText.textContent = "";
    if (el.qAnswerBox) el.qAnswerBox.style.display = "none";
  } else {
    el.qText.textContent = q?.text || "";
    if (state.current.answerRevealed && q?.answer) {
      if (el.qAnswerBox) {
        el.qAnswerBox.style.display = "inline-flex";
        el.qAnswerValue.textContent = q.answer;
      }
    } else {
      if (el.qAnswerBox) el.qAnswerBox.style.display = "none";
    }
  }

  // تحديث النقاط في أسفل اليمين
  if (el.scoreTextA) el.scoreTextA.textContent = state.teams.a?.score || 0;
  if (el.scoreTextB) el.scoreTextB.textContent = state.teams.b?.score || 0;

  // لافتة الأجراس: «اضغط الآن» أو إعلان الفريق الأسرع
  renderBuzz();

  // فحص الفائز
  if (state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    showWinner(state.teams[state.winner].name, state.teams[state.winner].color);
  } else if (!state.winner && lastWinner) {
    lastWinner = null;
    if (el.winnerOverlay) el.winnerOverlay.classList.remove("show");
  }
}

/* ---------------- أجراس الجوال ---------------- */
/**
 * لافتة أعلى الشاشة تعرض «الوضع الحالي» دائماً:
 *  - «اضغط الآن!» عندما يفتح الحكم باب الإجابة
 *  - «ضغط أولاً!» + العدّاد الحيّ للفريق الذي ضغط أولاً
 *  - «الآن دور الفريق الآخر» + العدّاد الحيّ عند بدء مؤقّت الفريق الثاني
 *  - «نقطة محسوبة!» بعد حسم الحكم
 */
function renderBuzz() {
  const b = state?.current?.buzz;
  if (!el.buzzBanner) return;

  const showTimer = (val) => {
    if (!el.buzzBannerTimer) return;
    if (val == null) {
      el.buzzBannerTimer.hidden = true;
      el.buzzBannerTimer.textContent = "";
    } else {
      el.buzzBannerTimer.hidden = false;
      el.buzzBannerTimer.textContent = val;
    }
  };

  if (!b || !b.enabled) {
    showTimer(null);
    el.buzzBanner.dataset.mode = "off";
    return;
  }

  const verdict = state.current?.verdict;
  if (verdict) {
    const vcolor = state.teams[verdict.team]?.color || "#070808";
    el.buzzBanner.dataset.mode = "point";
    el.buzzBanner.style.setProperty("--team-color", vcolor);
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "✅";
    if (el.buzzBannerText) el.buzzBannerText.textContent = "نقطة محسوبة!";
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = state.teams[verdict.team]?.name || "";
    showTimer(null);
    return;
  }

  // الحالة الحيّة: مؤقّت ضغطة يعمل الآن (اللاعب الأول ثم اللاعب الثاني)
  const t = state.current?.timer;
  const isBuzzTimer = t && t.running && (t.stage === "buzz1" || t.stage === "buzz2");
  const rem = isBuzzTimer ? remainingMs(t, transport.serverOffset) : 0;

  if (isBuzzTimer && rem > 0) {
    const turn = state.current?.turn;
    const second = t.stage === "buzz2";
    const color = state.teams[turn]?.color || "#070808";
    el.buzzBanner.dataset.mode = "turn";
    el.buzzBanner.style.setProperty("--team-color", color);
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = second ? "⏱️" : "⚡";
    if (el.buzzBannerText) {
      el.buzzBannerText.textContent = second ? "الآن دور الفريق الآخر" : "ضغط أولاً!";
    }
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = state.teams[turn]?.name || "";
    showTimer(Math.ceil(rem / 1000));
    return;
  }

  // انتهى مؤقّت الضغطة بلا حسم للحكم
  if (b.winner) {
    const color = state.teams[b.winner]?.color || "#070808";
    el.buzzBanner.dataset.mode = "won";
    el.buzzBanner.style.setProperty("--team-color", color);
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "⌛";
    if (el.buzzBannerText) el.buzzBannerText.textContent = "انتهى الوقت!";
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = "بانتظار حكم الحكم";
    showTimer(null);
    return;
  }

  if (b.open) {
    el.buzzBanner.dataset.mode = "open";
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "🔔";
    if (el.buzzBannerText) el.buzzBannerText.textContent = "اضغط الآن!";
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = "أول ضغطة تفوز";
    showTimer(null);
    return;
  }

  showTimer(null);
  el.buzzBanner.dataset.mode = "off";
}

/* ---------------- المؤقّت ---------------- */
/* ---------- مؤثرات صوتية للشاشة (تلقائية بالكامل) ---------- */
const scSfx = { round: -1, revealed: false, open: false, winner: null, verdictAt: 0, over: false, sec: -1 };

function screenSfx(st) {
  if (!st) return;
  const c = st.current || {};
  const b = c.buzz || {};
  const round = c.round ?? 0;

  if (scSfx.round !== round) {
    scSfx.round = round;
    scSfx.revealed = false;
    scSfx.open = false;
    scSfx.winner = null;
    scSfx.verdictAt = 0;
    scSfx.over = false;
    scSfx.sec = -1;
  }

  if (c.revealed && !scSfx.revealed) {
    scSfx.revealed = true;
    sfx.play("reveal");
  } else if (!c.revealed) {
    scSfx.revealed = false;
  }

  if (b.open && !scSfx.open && !b.winner) {
    scSfx.open = true;
    sfx.play("arm");
  } else if (!b.open) {
    scSfx.open = false;
  }

  const w = b.winner || null;
  if (w && w !== scSfx.winner) {
    scSfx.winner = w;
    sfx.play("buzz");
  } else if (!w) {
    scSfx.winner = null;
  }

  const at = c.verdict?.at || 0;
  if (c.verdict && at !== scSfx.verdictAt) {
    scSfx.verdictAt = at;
    sfx.play("point");
  }

  if (st.winner && !scSfx.over) {
    scSfx.over = true;
    sfx.play("gameWin");
  } else if (!st.winner) {
    scSfx.over = false;
  }
}

function renderTimer() {
  if (!state || !el.timerOverlay) return;
  const t = state.current.timer;
  const rem = remainingMs(t, transport.serverOffset);
  if (t.running && rem > 0) {
    el.timerOverlay.classList.add("show");
    el.timerNum.textContent = Math.ceil(rem / 1000);

    const secs = Math.ceil(rem / 1000);
    if (secs !== scSfx.sec) {
      scSfx.sec = secs;
      if (secs > 0) sfx.play(secs <= 3 ? "tickUrgent" : "tick");
      renderBuzz(); // يُبقي العدّاد الحيّ على لافتة الأجراس محدَّثاً كل ثانية
    }

    // بلا أسماء فرق: الدور يُعرَّف بلون الفريق المختار من لوحة الحكم
    const turn = state.current.turn;
    const teamAColor = state.teams.a?.color || "#6965ae";
    const teamBColor = state.teams.b?.color || "#4b9cbf";
    const color = turn === "a" ? teamAColor : turn === "b" ? teamBColor : null;
    const accent = color || "#fcb017";

    if (el.timerDot) {
      el.timerDot.style.background =
        color || `linear-gradient(90deg, ${teamAColor}, ${teamBColor})`;
      el.timerDot.style.boxShadow = `0 0 12px ${accent}`;
    }
    if (el.timerBadge) el.timerBadge.style.setProperty("--team-color", accent);
    el.timerTurn.textContent = turn === "open" ? "الفرصة للجميع" : "الدور";
  } else {
    el.timerOverlay.classList.remove("show");
    scSfx.sec = -1;
  }
}

setInterval(renderTimer, 100);

/* ---------------- شاشة الفوز ---------------- */
function showWinner(name, color) {
  if (!el.winnerOverlay) return;
  el.winnerName.textContent = name;
  el.winnerName.style.color = color;
  el.winnerOverlay.classList.add("show");
  launchConfetti(color);
}

/* ---------------- القصاصات ---------------- */
const ctx = el.confetti?.getContext("2d");
let particles = [];
let rafId = null;

function resizeCanvas() {
  if (!el.confetti) return;
  el.confetti.width = window.innerWidth;
  el.confetti.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

function launchConfetti(mainColor) {
  if (!ctx) return;
  const colors = [mainColor, "#ffd93d", "#ffffff", "#fcb017", "#6965ae", "#4b9cbf"];
  for (let i = 0; i < 220; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: -30 - Math.random() * window.innerHeight * 0.6,
      w: 6 + Math.random() * 9,
      h: 9 + Math.random() * 14,
      vy: 2 + Math.random() * 4.2,
      vx: -1.4 + Math.random() * 2.8,
      rot: Math.random() * Math.PI,
      vr: -0.14 + Math.random() * 0.28,
      color: colors[(Math.random() * colors.length) | 0],
    });
  }
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function tick() {
  if (!ctx) return;
  ctx.clearRect(0, 0, el.confetti.width, el.confetti.height);
  particles = particles.filter((p) => p.y < el.confetti.height + 40);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  if (particles.length) rafId = requestAnimationFrame(tick);
  else {
    rafId = null;
    ctx.clearRect(0, 0, el.confetti.width, el.confetti.height);
  }
}
