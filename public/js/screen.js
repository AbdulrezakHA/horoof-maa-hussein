/* ==================================================================
   منطق الشاشة الكبيرة — مطابق لملف حروف مع حسين layout.svg بمقاس 1920x1080
   ================================================================== */
import { Transport, remainingMs } from "/js/transport.js";
import { drawQR, getRoutes } from "/js/qr.js";
import { sfx } from "/js/sfx.js";
import { inkFor, isLight, mix } from "/shared/colors.js";
import { initTabooScreen, renderTabooScreen } from "/js/screen-taboo.js";

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
  qrCanvasPlay: document.getElementById("qrCanvasPlay"),
  lobbyTeamNameA: document.getElementById("lobbyTeamNameA"),
  lobbyTeamNameB: document.getElementById("lobbyTeamNameB"),
  lobbyPlayersA: document.getElementById("lobbyPlayersA"),
  lobbyPlayersB: document.getElementById("lobbyPlayersB"),
  winnerStats: document.getElementById("winnerStats"),
};

let state = null;
let boardCfg = null;
let lastWinner = null;
let refereeConnected = false;
let cellEls = new Map();

// ---------------- ضبط حجم النص تلقائياً ----------------
// يقلّص حجم الخط تدريجياً حتى يتّسع النص بالكامل داخل إطاره،
// لمنع اقتطاع السؤال (أو الجواب) الطويل على شاشة التلفاز.

function fitTextToBox(box, { maxWidth = 0, maxHeight = 0, minSize = 20, step = 2 } = {}) {
  if (!box) return;
  box.style.fontSize = "";
  if (!(box.textContent || "").trim()) return;
  const base = parseFloat(getComputedStyle(box).fontSize) || 0;
  if (!base) return;
  let size = base;
  box.style.fontSize = `${size}px`;
  let guard = 0;
  while (guard < 90) {
    const tooTall = maxHeight > 0 && box.scrollHeight > maxHeight + 1;
    const tooWide = maxWidth > 0 && box.scrollWidth > maxWidth + 1;
    if ((!tooTall && !tooWide) || size <= minSize) break;
    size = Math.max(minSize, size - step);
    box.style.fontSize = `${size}px`;
    guard += 1;
  }
}

// يضبط السؤال وبطاقة الجواب معاً
function fitReadableText() {
  const qbox = el.qText;
  if (qbox && qbox.parentElement) {
    fitTextToBox(qbox, {
      maxWidth: qbox.parentElement.clientWidth,
      maxHeight: qbox.parentElement.clientHeight,
      minSize: 26,
    });
  }

  const card = el.qAnswerBox;
  const val = el.qAnswerValue;
  if (card && val) {
    val.style.fontSize = "";
    if (!card.parentElement || card.style.display === "none") return;
    const maxW = card.parentElement.clientWidth;
    const maxH = card.parentElement.clientHeight;
    const base = parseFloat(getComputedStyle(val).fontSize) || 0;
    if (base) {
      let size = base;
      val.style.fontSize = `${size}px`;
      let guard = 0;
      while (guard < 90) {
        const tooWide = maxW > 0 && card.offsetWidth > maxW - 8;
        const tooTall = maxH > 0 && card.offsetHeight > maxH - 8;
        if ((!tooWide && !tooTall) || size <= 18) break;
        size = Math.max(18, size - 2);
        val.style.fontSize = `${size}px`;
        guard += 1;
      }
    }
  }
}

// أعد الضبط بعد تحميل الخطوط لأن مقاييس النص تتغيّر عندها
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    try { fitReadableText(); } catch (e) { /* تجاهل */ }
  });
}

/* ---------------- الحركات (ناعمة وخفيفة مثل ألعاب الجوال) ---------------- */
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const anim = { owners: null, letters: null, qText: "", selLetter: "", winWave: false };

/** موجة ظهور متتابعة للخلايا عند بداية جولة جديدة (حروف جديدة). */
function staggerCells() {
  if (reduceMotion) return;
  let i = 0;
  for (const [, els] of cellEls) {
    els.g.style.animationDelay = `${(i++ % 25) * 28}ms`;
    replayAnimation(els.g, "cell-in");
  }
}

/** التقاط خلية: نبضة خفيفة + موجة بلون الفريق تنتشر من مركزها. */
function claimCell(els, color) {
  if (reduceMotion) return;
  els.g.style.animationDelay = "";
  replayAnimation(els.g, "claim");
  const ripple = els.path.cloneNode(false);
  ripple.removeAttribute("id");
  ripple.setAttribute("class", "cell-ripple");
  ripple.setAttribute("fill", "none");
  ripple.setAttribute("stroke", color);
  ripple.setAttribute("stroke-width", "10");
  els.g.appendChild(ripple);
  setTimeout(() => ripple.remove(), 800);
}

/** عند الفوز: خلايا الفريق الفائز تومض بالتتابع كموجة. */
function winWave(team) {
  if (reduceMotion || !state) return;
  const ids = [...cellEls.keys()]
    .filter((id) => state.cells[id]?.owner === team)
    .sort((x, y) => {
      const a = state.cells[x];
      const b = state.cells[y];
      return team === "a" ? a.r - b.r || a.c - b.c : a.c - b.c || a.r - b.r;
    });
  ids.forEach((id, i) => {
    const els = cellEls.get(id);
    setTimeout(() => {
      els.g.style.animationDelay = "";
      replayAnimation(els.g, "win-glow");
    }, i * 90);
  });
}

/** يعيد تشغيل حركة CSS على عنصر (بإزالة الصنف ثم إعادته). */
function replayAnimation(node, cls) {
  if (!node) return;
  node.classList.remove(cls);
  void node.getBoundingClientRect();
  node.classList.add(cls);
}

/** يحدّث رقم النقاط مع «نبضة» خفيفة عند تغيّره. */
function setScore(textEl, value, fill) {
  if (!textEl) return;
  textEl.style.fill = fill;
  const v = String(value);
  if (textEl.textContent === v) return;
  const first = textEl.dataset.ready !== "1";
  textEl.textContent = v;
  textEl.dataset.ready = "1";
  if (!first) replayAnimation(textEl.closest(".score-group"), "bump");
}

// ربط جميع خلايا اللوحة السداسية الـ 25 داخل SVG
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const id = `r${r}c${c}`;
    const g = document.getElementById(`cell-${id}`);
    if (g) {
      const path = g.querySelector(".cell-path");
      const text = g.querySelector(".cell-text");
      cellEls.set(id, { g, path, text });
    }
  }
}

const transport = new Transport("screen", room);

transport.onStatus = (s) => {
  // بعد كل اتصال (أو إعادة اتصال) نُبلغ الخادم بحالة ملء الشاشة
  if (s === "online") setTimeout(() => reportFullscreen(true), 300);
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

  onlinePlayers = new Set(msg.peers?.players || []);
  updateLobby(msg.peers);
  applyScreenControls();
  render();
  renderTimer();
  screenSfx(state);
};

transport.connect();

/* ---------------- ملء الشاشة (يتحكّم به الحكم من جواله) ---------------- */
// رقم المنفذ في عنوان النافذة: به يجد الخادم نافذة هذه اللعبة بالضبط ليضغط عليها F11
document.title = `${document.title} [${location.port || "80"}]`;

// الصفحة لا تستطيع دخول ملء الشاشة وحدها بلا نقرة، فالخادم يضغط F11 على هذه النافذة.
// هنا فقط نُبلغ الخادم بالحالة الحالية ليعرض الحكم الزر الصحيح.
let lastFullscreen = null;
function reportFullscreen(force = false) {
  const full =
    !!document.fullscreenElement ||
    (window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2);
  if (!force && full === lastFullscreen) return;
  lastFullscreen = full;
  transport.sendRaw({ t: "screenInfo", fullscreen: full });
}
window.addEventListener("resize", () => reportFullscreen());
document.addEventListener("fullscreenchange", () => reportFullscreen());

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
        ? "تم اتصال الحكم ✅ — اضغط «ابدأ اللعب» من جوال الحكم"
        : "بانتظار مسح الرمز من جوال الحكم…";
    }
  }
  applyScreenControls();
}

/**
 * الشاشة الكبيرة للعرض فقط — كل التحكم من جوال الحكم:
 *  - قائمة البداية (رموز QR) تظهر دائماً ما دام الحكم غير متصل (يحتاج رمز التحقق منها)،
 *    وبعد اتصاله يُظهرها أو يخفيها من جواله.
 *  - صوت الشاشة يُشغَّل ويُكتم من جوال الحكم.
 */
function applyScreenControls() {
  const scr = state?.screen || {};
  const showLobby = !refereeConnected || scr.lobby !== false;
  if (el.lobby) el.lobby.classList.toggle("lobby-off", !showLobby);
  applyRouteVisibility();
  sfx.setMuted(scr.sound === false, { persist: false });

  renderLobbyPlayers();
}

/** قائمة اللاعبين المنضمّين لكل فريق (تتحدّث لحظياً أثناء المسح). */
let onlinePlayers = new Set();
function renderLobbyPlayers() {
  if (!state) return;
  // على البطاقة البيضاء: الألوان الفاتحة (كالأصفر) تُغمَّق قليلاً لتبقى مقروءة
  const onWhite = (c) => (isLight(c) ? mix(c, "#000000", 0.45) : c);
  for (const t of ["a", "b"]) {
    const nameEl = t === "a" ? el.lobbyTeamNameA : el.lobbyTeamNameB;
    const listEl = t === "a" ? el.lobbyPlayersA : el.lobbyPlayersB;
    if (!nameEl || !listEl) continue;
    const team = state.teams[t];
    const players = Object.values(state.players || {}).filter((pl) => !pl.pseudo && pl.team === t);
    nameEl.textContent = `${team.name} (${players.length})`;
    nameEl.style.color = onWhite(team.color);
    listEl.replaceChildren();
    if (!players.length) {
      const empty = document.createElement("span");
      empty.className = "lobby-player empty";
      empty.textContent = "بانتظار اللاعبين…";
      listEl.appendChild(empty);
    }
    for (const pl of players) {
      const chip = document.createElement("span");
      chip.className = "lobby-player";
      chip.classList.toggle("offline", !onlinePlayers.has(pl.id));
      chip.style.background = team.color;
      chip.style.color = inkFor(team.color);
      chip.textContent = pl.name;
      listEl.appendChild(chip);
    }
  }
}

/**
 * رموز الدخول — طريقان دائماً:
 *   🌐 الإنترنت (Cloudflare): أي جوال فيه إنترنت من أي شبكة
 *   📶 الشبكة المحلية: الجوالات على نفس الواي فاي، بدون إنترنت
 * إن فشل أحدهما يبقى الآخر. يُعاد الرسم كلما تغيّر رابط الإنترنت (رسالة net من الخادم).
 */
const NET_WAIT = {
  starting: "⏳ جارٍ تجهيز رابط الإنترنت…",
  downloading: "⏳ تجهيز رابط الإنترنت لأول مرة…",
  error: "⚠️ رابط الإنترنت غير متاح الآن — جارٍ المحاولة",
  off: "رابط الإنترنت مُطفأ",
};
let routes = { net: null, lan: null, netStatus: "starting" };

async function initLobby() {
  for (const [path, prefix] of [["referee", "Ref"], ["play", "Play"]]) {
    let r;
    try {
      r = await getRoutes(room, path);
    } catch {
      continue;
    }
    if (path === "play") routes = r;
    for (const kind of ["net", "lan"]) {
      const id = `qr${prefix}${kind === "net" ? "Net" : "Lan"}`;
      const canvas = document.getElementById(id);
      const wait = document.getElementById(`${id}Wait`);
      const box = canvas?.closest(".qr-route");
      if (!canvas || !box) continue;
      const target = r[kind];
      box.classList.toggle("qr-pending", !target);
      if (target) {
        drawQR(target.url, canvas);
        box.title = target.url;
        if (wait) wait.textContent = "";
      } else if (wait) {
        wait.textContent = kind === "net" ? NET_WAIT[r.netStatus] || NET_WAIT.starting : "⚠️ لا توجد شبكة محلية";
      }
    }
  }
  applyRouteVisibility();
}

/** الحكم يستطيع إخفاء أحد الطريقين؛ بدون حكم متصل يظهر الاثنان دائماً. */
function applyRouteVisibility() {
  const want = refereeConnected ? state?.screen?.qr || "both" : "both";
  for (const box of document.querySelectorAll(".qr-route")) {
    const kind = box.dataset.route;
    box.hidden = want !== "both" && want !== kind;
  }
  document.getElementById("qrCardRef")?.classList.toggle("qr-card-done", refereeConnected);
}

transport.onMessage = (msg) => {
  if (msg.t === "net") initLobby();
};


initLobby();

initTabooScreen({
  sfx,
  inkFor,
  getState: () => state,
  remainingMs: (t) => remainingMs(t, transport.serverOffset),
  confetti: (color) => launchConfetti(color),
});

/* ---------------- العرض والتحديث ---------------- */
/** شاشة قائمة الألعاب: نقاط السهرة للفريقين. */
function renderHubScreen() {
  const box = document.getElementById("hubNight");
  if (!box || !state) return;
  box.replaceChildren();
  const title = document.createElement("div");
  title.className = "hub-night-title";
  title.textContent = "🏆 نقاط السهرة";
  box.appendChild(title);
  const row = document.createElement("div");
  row.className = "hub-night-row";
  for (const k of ["a", "b"]) {
    const team = state.teams[k];
    const chip = document.createElement("div");
    chip.className = "hub-night-chip";
    chip.style.background = team.color;
    chip.style.color = inkFor(team.color);
    const name = document.createElement("span");
    name.textContent = team.name;
    const n = document.createElement("b");
    n.textContent = String(state.night?.[k] || 0);
    chip.append(name, n);
    row.appendChild(chip);
  }
  box.appendChild(row);
}

function render() {
  if (!state) return;

  // اللعبة الحالية: حروف (اللوحة) / الكلمة الممنوعة / قائمة الألعاب
  const game = state.game || "none";
  if (document.body.dataset.game !== game) {
    document.body.dataset.game = game;
    replayAnimation(document.body, "game-switch");
  }
  if (game === "none") renderHubScreen();
  if (game === "taboo") renderTabooScreen(state);

  const teamAColor = state.teams.a?.color || "#6965ae";
  const teamBColor = state.teams.b?.color || "#4b9cbf";
  // bgColor = خلفية لوحة السؤال (يمين الشاشة). مناطق اللوحة نفسها تأخذ ألوان الفريقين.
  const bgColor = state.theme?.bgColor || "#2f6f9e";
  const cellColor = state.theme?.cellColor || "#ede5bb";
  const selectedColor = state.theme?.selectedColor || "#fcb017";

  // ألوان الكتابة تُختار تلقائياً لتبقى واضحة فوق أي لون يختاره الحكم
  const ink = {
    a: inkFor(teamAColor),
    b: inkFor(teamBColor),
    cell: inkFor(cellColor),
    selected: inkFor(selectedColor),
    panel: inkFor(bgColor),
  };

  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--bg-color", bgColor);
  rootStyle.setProperty("--panel-ink", ink.panel);
  rootStyle.setProperty("--panel-shadow", ink.panel === "#ffffff" ? "rgba(0,0,0,.45)" : "rgba(255,255,255,.35)");
  rootStyle.setProperty("--cell-text-color", ink.cell);
  rootStyle.setProperty("--selected-color", selectedColor);
  rootStyle.setProperty("--team-a-color", teamAColor);
  rootStyle.setProperty("--team-b-color", teamBColor);
  rootStyle.setProperty("--team-a-ink", ink.a);
  rootStyle.setProperty("--team-b-ink", ink.b);

  // تدرّج خفيف جداً (لمعة في الأعلى فقط) — اللون الأساسي هو لون الفريق نفسه بالضبط
  const setStops = (id1, id2, color, lift = 0.1) => {
    const s1 = document.getElementById(id1);
    const s2 = document.getElementById(id2);
    if (s1) s1.setAttribute("stop-color", mix(color, "#ffffff", lift));
    if (s2) s2.setAttribute("stop-color", color);
  };
  setStops("stopTeamA1", "stopTeamA2", teamAColor);
  setStops("stopTeamB1", "stopTeamB2", teamBColor);
  setStops("stopCell1", "stopCell2", cellColor, 0.08);
  setStops("stopSel1", "stopSel2", selectedColor, 0.12);

  // منطقة الفريق الثاني (يمين ويسار اللوحة) بلون الفريق الثاني،
  // ومنطقة الفريق الأول (أعلى وأسفل) بلون الفريق الأول عبر تدرّجه.
  if (el.bgLeft) el.bgLeft.setAttribute("fill", "url(#grad-team-b)");
  const r1 = document.getElementById("stopBgRight1");
  const r2 = document.getElementById("stopBgRight2");
  if (r1) r1.setAttribute("stop-color", mix(bgColor, "#ffffff", 0.08));
  if (r2) r2.setAttribute("stop-color", mix(bgColor, "#000000", 0.12));

  // تحديث خلايا اللوحة الـ 25 (مع اكتشاف ما تغيّر لتشغيل الحركات المناسبة)
  const prevOwners = anim.owners;
  const prevLetters = anim.letters;
  anim.owners = {};
  anim.letters = {};
  let changedLetters = 0;
  for (const [id, els] of cellEls) {
    const cell = state.cells[id];
    if (!cell) continue;

    if (els.text.textContent !== cell.letter) els.text.textContent = cell.letter;
    const isSelected = state.current.cellId === id;
    const owner = cell.owner;
    anim.owners[id] = owner;
    anim.letters[id] = cell.letter;
    if (prevLetters && prevLetters[id] !== cell.letter) changedLetters++;
    if (prevOwners && owner && prevOwners[id] !== owner) {
      claimCell(els, owner === "a" ? teamAColor : teamBColor);
    }

    els.g.classList.toggle("is-selected", isSelected);
    els.g.classList.toggle("owner-a", owner === "a");
    els.g.classList.toggle("owner-b", owner === "b");

    if (isSelected) {
      els.path.setAttribute("fill", "url(#grad-cell-selected)");
      els.text.style.fill = ink.selected;
    } else if (owner === "a") {
      els.path.setAttribute("fill", "url(#grad-team-a)");
      els.text.style.fill = ink.a;
    } else if (owner === "b") {
      els.path.setAttribute("fill", "url(#grad-team-b)");
      els.text.style.fill = ink.b;
    } else {
      els.path.setAttribute("fill", "url(#grad-cell-unselected)");
      els.text.style.fill = ink.cell;
    }
  }

  // جولة جديدة (تغيّرت حروف كثيرة دفعة واحدة) → موجة ظهور ناعمة
  if (prevLetters && changedLetters >= 5) staggerCells();

  // تحديث الحرف المختار في أعلى اليمين
  // (بعد منح النقطة تُلغى الخلية المحددة، فنُظهر الحرف المُحتسب من verdict)
  const activeCellId =
    state.current.cellId || state.current.verdict?.cellId || state.current.missed?.cellId || null;
  const activeCell = activeCellId ? state.cells[activeCellId] : null;

  if (!activeCell) {
    el.selectedHexText.textContent = "؟";
    anim.selLetter = "";
    el.selectedHexPath.setAttribute("fill", "url(#grad-cell-unselected)");
    el.selectedHexText.style.fill = ink.cell;
  } else {
    el.selectedHexText.textContent = activeCell.letter;
    if (anim.selLetter !== activeCell.letter) {
      anim.selLetter = activeCell.letter;
      replayAnimation(el.selectedHexGroup, "pop");
    }
    if (activeCell.owner === "a") {
      el.selectedHexPath.setAttribute("fill", "url(#grad-team-a)");
      el.selectedHexText.style.fill = ink.a;
    } else if (activeCell.owner === "b") {
      el.selectedHexPath.setAttribute("fill", "url(#grad-team-b)");
      el.selectedHexText.style.fill = ink.b;
    } else {
      el.selectedHexPath.setAttribute("fill", "url(#grad-cell-selected)");
      el.selectedHexText.style.fill = ink.selected;
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
    const newText = q?.text || "";
    if (el.qText.textContent !== newText) {
      el.qText.textContent = newText;
      replayAnimation(el.qText, "enter");
    }
    if (state.current.answerRevealed && q?.answer) {
      if (el.qAnswerBox) {
        // بطاقة الجواب بلون الفريق الذي أخذ النقطة (أو محايدة إن لم يُجب أحد)
        const vTeam = state.current.verdict?.team;
        const cardColor = vTeam ? state.teams[vTeam]?.color : state.current.missed ? "#4b5563" : "#10b981";
        el.qAnswerBox.style.setProperty("--answer-bg", cardColor);
        el.qAnswerBox.style.setProperty("--answer-ink", inkFor(cardColor));
        const badge = el.qAnswerBox.querySelector(".q-answer-badge");
        if (badge) badge.textContent = "الجواب الصحيح";
        if (el.qAnswerBox.style.display === "none" || el.qAnswerValue.textContent !== q.answer) {
          el.qAnswerBox.style.display = "inline-flex";
          el.qAnswerValue.textContent = q.answer;
          replayAnimation(el.qAnswerBox, "enter");
        }
      }
    } else if (el.qAnswerBox) {
      // بدل الجواب: التلميح (إن كشفه الحكم) أو فئة السؤال
      const extra = state.current.hintRevealed && q?.hint
        ? { label: "💡 تلميح", text: q.hint, color: "#f59e0b" }
        : q?.category
          ? { label: "📂 الفئة", text: q.category, color: "#475569" }
          : null;
      if (extra) {
        el.qAnswerBox.style.setProperty("--answer-bg", extra.color);
        el.qAnswerBox.style.setProperty("--answer-ink", inkFor(extra.color));
        const badge = el.qAnswerBox.querySelector(".q-answer-badge");
        if (badge) badge.textContent = extra.label;
        if (el.qAnswerBox.style.display === "none" || el.qAnswerValue.textContent !== extra.text) {
          el.qAnswerBox.style.display = "inline-flex";
          el.qAnswerValue.textContent = extra.text;
          replayAnimation(el.qAnswerBox, "enter");
        }
      } else {
        el.qAnswerBox.style.display = "none";
      }
    }
  }

  // ضبط حجم السؤال والجواب تلقائياً حتى لا يُقتطع النص الطويل
  fitReadableText();

  // تحديث النقاط في أسفل اليمين
  setScore(el.scoreTextA, state.teams.a?.score || 0, ink.a);
  setScore(el.scoreTextB, state.teams.b?.score || 0, ink.b);

  // لافتة الأجراس: «اضغط الآن» أو إعلان الفريق الأسرع
  renderBuzz();

  // فحص الفائز
  if (state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    // موجة على مسار الفائز أولاً، ثم شاشة التهنئة
    const w = state.winner;
    winWave(w);
    setTimeout(() => {
      if (state?.winner === w) showWinner(state.teams[w].name, state.teams[w].color);
    }, reduceMotion ? 0 : 1300);
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
/** يلوّن لافتة الأجراس بلون الفريق مع كتابة مقروءة تلقائياً. */
function setBannerColor(color) {
  el.buzzBanner.style.setProperty("--team-color", color);
  el.buzzBanner.style.setProperty("--team-ink", inkFor(color));
}

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

  const c = state.current || {};
  const t = c.timer || {};
  const rem = t.running ? remainingMs(t, transport.serverOffset) : 0;
  const secs = t.running && rem > 0 ? Math.ceil(rem / 1000) : null;
  const nameOf = (pl) => (!pl ? "—" : pl.id?.startsWith("team:") ? state.teams[pl.team]?.name : pl.name);

  // نقطة محسوبة: اسم اللاعب الذي أجاب + فريقه
  const verdict = c.verdict;
  if (verdict) {
    const pl = verdict.playerId ? state.players?.[verdict.playerId] : null;
    setBannerColor(state.teams[verdict.team]?.color || "#070808");
    el.buzzBanner.dataset.mode = "point";
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "✅";
    if (el.buzzBannerText) el.buzzBannerText.textContent = pl && !pl.pseudo ? `${pl.name} أجاب صح!` : "نقطة محسوبة!";
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = state.teams[verdict.team]?.name || "";
    showTimer(null);
    return;
  }

  // لاعب يجيب الآن: اسمه بلون فريقه + العدّاد
  if (b.phase === "answer" && b.player) {
    setBannerColor(state.teams[b.player.team]?.color || "#070808");
    el.buzzBanner.dataset.mode = "turn";
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "⚡";
    if (el.buzzBannerText) el.buzzBannerText.textContent = `${nameOf(b.player)} يجيب!`;
    if (el.buzzBannerSub) {
      el.buzzBannerSub.textContent = state.teams[b.player.team]?.name || "";
    }
    showTimer(secs);
    return;
  }

  // الجولة ١: الأجراس مفتوحة للجميع (بلا حدّ زمني للتفكير)
  if (b.phase === "open" && b.open) {
    el.buzzBanner.dataset.mode = "open";
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "🔔";
    if (el.buzzBannerText) el.buzzBannerText.textContent = "اضغط الجرس!";
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = "أول ضغطة تفوز";
    showTimer(null);
    return;
  }

  // الجولة ٢: دور الفريق الآخر — يجيبون بصوت عالٍ مع العدّاد
  if (b.phase === "team") {
    setBannerColor(state.teams[b.allowed]?.color || "#070808");
    el.buzzBanner.dataset.mode = "turn";
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "⏱️";
    if (el.buzzBannerText) el.buzzBannerText.textContent = `دور ${state.teams[b.allowed]?.name}`;
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = "جاوبوا بصوت عالٍ";
    showTimer(secs);
    return;
  }

  // الجولة ٣: مفتوح للجميع بلا وقت
  if (b.phase === "all") {
    el.buzzBanner.dataset.mode = "open";
    if (el.buzzBannerIcon) el.buzzBannerIcon.textContent = "🗣️";
    if (el.buzzBannerText) el.buzzBannerText.textContent = "مفتوح للجميع!";
    if (el.buzzBannerSub) el.buzzBannerSub.textContent = "من يعرف الجواب؟";
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

  // صوت عند كل ضغطة جديدة (في أي جولة)
  const who = b.phase === "answer" ? `${b.player?.id}:${b.stage}` : null;
  if (who && who !== scSfx.winner) {
    scSfx.winner = who;
    sfx.play("buzz");
  } else if (!who) {
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
  // إحصاءات ممتعة: أفضل لاعب + أسرع ضغطة
  if (el.winnerStats) {
    const players = Object.values(state?.players || {}).filter((pl) => !pl.pseudo);
    const best = [...players].sort((x, y) => y.score - x.score || (x.fastest ?? 1e9) - (y.fastest ?? 1e9))[0];
    const fast = [...players].filter((pl) => pl.fastest != null).sort((x, y) => x.fastest - y.fastest)[0];
    const lines = [];
    if (best && best.score > 0) lines.push(`🏅 أفضل لاعب: ${best.name} (${best.score} ${best.score === 1 ? "نقطة" : "نقاط"})`);
    if (fast) lines.push(`⚡ أسرع ضغطة: ${fast.name} (${(fast.fastest / 1000).toFixed(2)} ث)`);
    el.winnerStats.replaceChildren(...lines.map((t) => Object.assign(document.createElement("div"), { textContent: t })));
  }
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
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: -30 - Math.random() * window.innerHeight * 0.6,
      w: 6 + Math.random() * 9,
      h: 9 + Math.random() * 14,
      vy: 1.3 + Math.random() * 2.4,
      vx: -0.9 + Math.random() * 1.8,
      sway: Math.random() * Math.PI * 2,
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
    p.sway += 0.045;
    p.x += p.vx + Math.sin(p.sway) * 0.8; // تمايل خفيف كالورق المتساقط
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
