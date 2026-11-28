/* ==================================================================
   منطق الشاشة الكبيرة — اللوحة مأخوذة من حروف مع حسين layout.svg بمقاس 1920x1080
   كل العناصر من مكتبة نظام التصميم (ds-*) والألوان تأتي من applyGameColors().
   ================================================================== */
import { Transport, remainingMs } from "/js/transport.js";
import { drawQR, getRoutes } from "/js/qr.js";
import { sfx } from "/js/sfx.js";
import { applyGameColors } from "/shared/ds-theme.js";
import { icon, replay, bump, confetti, ring, fitScale } from "/js/ds.js";
import { initTabooScreen, renderTabooScreen } from "/js/screen-taboo.js";

const params = new URLSearchParams(location.search);
const room = params.get("room") || "main";
const $ = (id) => document.getElementById(id);

const el = {
  stage: $("tvStage"),
  huroof: $("huroofLayer"),
  hub: $("hubScreen"),
  taboo: $("tabooScreen"),
  selHex: $("selectedHexGroup"),
  selHexText: $("selectedHexText"),
  qPanel: $("qPanel"),
  qText: $("qText"),
  qAnswerBox: $("qAnswerBox"),
  qAnswerLabel: $("qAnswerLabel"),
  qAnswerValue: $("qAnswerValue"),
  scoreGroupA: $("scoreGroupA"),
  scoreGroupB: $("scoreGroupB"),
  scoreNameA: $("scoreNameA"),
  scoreNameB: $("scoreNameB"),
  scoreTextA: $("scoreTextA"),
  scoreTextB: $("scoreTextB"),
  timerOverlay: $("timerOverlay"),
  timerBadge: $("timerBadge"),
  timerNum: $("timerNum"),
  timerTurn: $("timerTurn"),
  winnerOverlay: $("winnerOverlay"),
  winnerName: $("winnerName"),
  winnerCaption: $("winnerCaption"),
  winnerStats: $("winnerStats"),
  lobby: $("lobby"),
  lobbyStatus: $("lobbyStatus"),
  lobbyStatusIcon: $("lobbyStatusIcon"),
  lobbyStatusText: $("lobbyStatusText"),
  lobbyPairCode: $("lobbyPairCode"),
  lobbyTeamNameA: $("lobbyTeamNameA"),
  lobbyTeamNameB: $("lobbyTeamNameB"),
  lobbyPlayersA: $("lobbyPlayersA"),
  lobbyPlayersB: $("lobbyPlayersB"),
  connBadge: $("connBadge"),
  connBadgeDot: $("connBadgeDot"),
  connBadgeText: $("connBadgeText"),
  buzzSteps: $("buzzSteps"),
  buzzBanner: $("buzzBanner"),
  buzzBannerIcon: $("buzzBannerIcon"),
  buzzBannerText: $("buzzBannerText"),
  buzzBannerSub: $("buzzBannerSub"),
  buzzBannerTimer: $("buzzBannerTimer"),
};

// المسرح يتناسب مع أي شاشة: كل مقاسات المكتبة تتبع عرضه
fitScale(el.stage, 1920, 1.45);

/** يغيّر رمز <svg><use/></svg> إلى رمز آخر من /icons.svg. */
function setIcon(svg, name) {
  svg?.querySelector("use")?.setAttribute("href", `/icons.svg#${name}`);
}

let state = null;
let lastWinner = null;
let refereeConnected = false;
const cellEls = new Map();
const buzzRing = ring(el.buzzBannerTimer);
let buzzRingOn = false;

// ---------------- ضبط حجم النص تلقائياً ----------------
// يقلّص حجم الخط تدريجياً حتى يتّسع السؤال داخل لوحته (والجواب داخل عرض الشاشة)،
// لمنع اقتطاع النص الطويل على شاشة التلفاز.
function fitReadableText() {
  const box = el.qText;
  const panel = el.qPanel;
  if (box && panel) {
    box.style.fontSize = "";
    if ((box.textContent || "").trim()) {
      const base = parseFloat(getComputedStyle(box).fontSize) || 0;
      let size = base;
      let guard = 0;
      while (base && guard < 90 && size > 26 && panel.scrollHeight > panel.clientHeight + 1) {
        size = Math.max(26, size - 2);
        box.style.fontSize = `${size}px`;
        guard += 1;
      }
    }
  }
  const card = el.qAnswerBox;
  const val = el.qAnswerValue;
  if (card && val) {
    val.style.fontSize = "";
    if (!card.parentElement || card.hidden) return;
    const maxW = card.parentElement.clientWidth;
    const base = parseFloat(getComputedStyle(val).fontSize) || 0;
    let size = base;
    let guard = 0;
    while (base && guard < 90 && size > 18 && card.offsetWidth > maxW - 8) {
      size = Math.max(18, size - 2);
      val.style.fontSize = `${size}px`;
      guard += 1;
    }
  }
}

// أعد الضبط بعد تحميل الخطوط لأن مقاييس النص تتغيّر عندها
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    try {
      fitReadableText();
    } catch {
      /* تجاهل */
    }
  });
}

/* ---------------- الحركات ---------------- */
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const anim = { owners: null, letters: null, selLetter: "" };

/** يعيد تشغيل حركة CSS على عنصر SVG (replay() من ds.js لا يعمل مع SVG لأنه يعتمد على offsetWidth). */
function replaySvg(node, cls) {
  if (!node) return;
  node.classList.remove(cls);
  void node.getBoundingClientRect();
  node.classList.add(cls);
  node.addEventListener("animationend", () => node.classList.remove(cls), { once: true });
}

/** موجة ظهور متتابعة للخلايا عند بداية جولة جديدة (حروف جديدة). */
function staggerCells() {
  if (reduceMotion) return;
  let i = 0;
  for (const [, els] of cellEls) {
    els.g.style.animationDelay = `${(i++ % 25) * 28}ms`;
    replaySvg(els.g, "is-in");
  }
}

/** التقاط خلية: نبضة خفيفة + موجة بلون الفريق تنتشر من مركزها. */
function claimCell(els, team) {
  if (reduceMotion) return;
  els.g.style.animationDelay = "";
  replaySvg(els.g, "is-claim");
  const ripple = els.path.cloneNode(false);
  ripple.removeAttribute("id");
  ripple.setAttribute("class", `ds-tvcell-ripple ds-team-${team}`);
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
      replaySvg(els.g, "is-win");
    }, i * 90);
  });
}

/** يحدّث رقم النقاط مع «نبضة» عند تغيّره. */
function setScore(scoreEl, value) {
  if (!scoreEl) return;
  const v = String(value);
  if (scoreEl.textContent === v) return;
  const first = scoreEl.dataset.ready !== "1";
  const delta = Number(v) - Number(scoreEl.textContent || 0);
  scoreEl.textContent = v;
  scoreEl.dataset.ready = "1";
  if (!first) bump(scoreEl, delta > 0 ? `+${delta}` : "");
}

// ربط جميع خلايا اللوحة السداسية الـ 25 داخل SVG
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const id = `r${r}c${c}`;
    const g = $(`cell-${id}`);
    if (g) cellEls.set(id, { g, path: g.querySelector(".ds-tvcell-path"), text: g.querySelector(".ds-tvcell-text") });
  }
}

const transport = new Transport("screen", room);

transport.onStatus = (s) => {
  // بعد كل اتصال (أو إعادة اتصال) نُبلغ الخادم بحالة ملء الشاشة
  if (s === "online") setTimeout(() => reportFullscreen(true), 300);
  setIcon(el.connBadgeDot, s === "online" ? "wifi" : "warning");
  if (s !== "online") {
    // انقطع الاتصال بالخادم: لا نعرض «الحكم متصل» وهمياً، ونُعيد الحساب عند أول حالة جديدة
    refereeConnected = null;
    el.connBadge.classList.remove("ds-pill--mint", "ds-pill--dark");
    el.connBadge.classList.add("ds-pill--coral");
    el.connBadgeText.textContent = "انقطع الاتصال — إعادة المحاولة…";
  } else {
    el.connBadge.classList.remove("ds-pill--coral");
    el.connBadge.classList.add("ds-pill--dark");
  }
};

transport.onState = (msg) => {
  state = msg.state;

  if (msg.pairing?.code) {
    if (el.lobbyPairCode) el.lobbyPairCode.textContent = msg.pairing.code;
  }

  onlinePlayers = new Set(msg.peers?.players || []);
  applyGameColors(state);
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
    el.connBadge.classList.toggle("ds-pill--mint", connected);
    el.connBadge.classList.toggle("ds-pill--dark", !connected);
    el.connBadgeText.textContent = connected ? "الحكم متصل" : "بانتظار الحكم";
  }

  if (el.lobbyStatus) {
    el.lobbyStatus.classList.toggle("ds-banner--success", connected);
    el.lobbyStatus.classList.toggle("ds-banner--info", !connected);
    setIcon(el.lobbyStatusIcon, connected ? "check" : "timer");
    el.lobbyStatusText.textContent = connected
      ? "تم اتصال الحكم — اضغط «ابدأ اللعب» من جوال الحكم"
      : "بانتظار مسح الرمز من جوال الحكم…";
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
  if (el.lobby) el.lobby.hidden = !showLobby;
  applyRouteVisibility();
  sfx.setMuted(scr.sound === false, { persist: false });

  renderLobbyPlayers();
}

/** قائمة اللاعبين المنضمّين لكل فريق (تتحدّث لحظياً أثناء المسح). */
let onlinePlayers = new Set();
function renderLobbyPlayers() {
  if (!state) return;
  for (const t of ["a", "b"]) {
    const nameEl = t === "a" ? el.lobbyTeamNameA : el.lobbyTeamNameB;
    const listEl = t === "a" ? el.lobbyPlayersA : el.lobbyPlayersB;
    if (!nameEl || !listEl) continue;
    const team = state.teams[t];
    const players = Object.values(state.players || {}).filter((pl) => !pl.pseudo && pl.team === t);
    nameEl.textContent = `${team.name} (${players.length})`;
    listEl.replaceChildren();
    if (!players.length) {
      const empty = document.createElement("span");
      empty.className = "ds-text ds-text--dim";
      empty.textContent = "بانتظار اللاعبين…";
      listEl.appendChild(empty);
    }
    for (const pl of players) {
      const chip = document.createElement("span");
      chip.className = `ds-player ds-team-${t}`;
      chip.classList.toggle("is-offline", !onlinePlayers.has(pl.id));
      const av = document.createElement("span");
      av.className = "ds-avatar";
      av.textContent = [...(pl.name || "؟")][0];
      chip.append(av, document.createTextNode(pl.name));
      listEl.appendChild(chip);
    }
  }
}

/**
 * رموز الدخول — طريقان دائماً:
 *   الإنترنت (Cloudflare): أي جوال فيه إنترنت من أي شبكة
 *   الشبكة المحلية: الجوالات على نفس الواي فاي، بدون إنترنت
 * إن فشل أحدهما يبقى الآخر. يُعاد الرسم كلما تغيّر رابط الإنترنت (رسالة net من الخادم).
 */
const NET_WAIT = {
  starting: "جارٍ تجهيز رابط الإنترنت…",
  downloading: "تجهيز رابط الإنترنت لأول مرة…",
  error: "رابط الإنترنت غير متاح الآن — جارٍ المحاولة",
  off: "رابط الإنترنت مُطفأ",
};

async function initLobby() {
  for (const [path, prefix] of [["referee", "Ref"], ["play", "Play"]]) {
    let r;
    try {
      r = await getRoutes(room, path);
    } catch {
      continue;
    }
    for (const kind of ["net", "lan"]) {
      const id = `qr${prefix}${kind === "net" ? "Net" : "Lan"}`;
      const canvas = $(id);
      const wait = $(`${id}Wait`);
      const box = canvas?.closest("[data-route]");
      if (!canvas || !box) continue;
      const target = r[kind];
      box.classList.toggle("is-pending", !target);
      if (target) {
        drawQR(target.url, canvas);
        box.title = target.url;
        if (wait) wait.textContent = "";
      } else if (wait) {
        wait.textContent = kind === "net" ? NET_WAIT[r.netStatus] || NET_WAIT.starting : "لا توجد شبكة محلية";
      }
    }
  }
  applyRouteVisibility();
}

/** الحكم يستطيع إخفاء أحد الطريقين؛ بدون حكم متصل يظهر الاثنان دائماً. */
function applyRouteVisibility() {
  const want = refereeConnected ? state?.screen?.qr || "both" : "both";
  for (const box of document.querySelectorAll("[data-route]")) {
    const kind = box.dataset.route;
    box.hidden = want !== "both" && want !== kind;
  }
  $("qrCardRef")?.classList.toggle("is-compact", refereeConnected);
}

transport.onMessage = (msg) => {
  if (msg.t === "net") initLobby();
};

initLobby();

/** قصاصات احتفال بلون الفريق مع ألوان النظام. */
function launchConfetti(mainColor) {
  const css = getComputedStyle(document.documentElement);
  const rest = ["--sun", "--mint", "--bubble", "--sky", "--paper"].map((v) => css.getPropertyValue(v).trim());
  confetti(mainColor ? [mainColor, ...rest] : rest, 140);
}

initTabooScreen({
  sfx,
  getState: () => state,
  remainingMs: (t) => remainingMs(t, transport.serverOffset),
  confetti: (color) => launchConfetti(color),
});

/* ---------------- العرض والتحديث ---------------- */
/** شاشة قائمة الألعاب: نقاط السهرة للفريقين. */
function renderHubScreen() {
  const box = $("hubNight");
  if (!box || !state) return;
  box.replaceChildren();
  for (const k of ["a", "b"]) {
    const pill = document.createElement("span");
    pill.className = `ds-pill ds-pill--lg ds-pill--team ds-team-${k}`;
    pill.append(icon("trophy"), document.createTextNode(`${state.teams[k].name} ${state.night?.[k] || 0}`));
    box.appendChild(pill);
  }
}

function render() {
  if (!state) return;

  // اللعبة الحالية: حروف (اللوحة) / الكلمة الممنوعة / قائمة الألعاب
  const game = state.game || "none";
  if (document.body.dataset.game !== game) {
    document.body.dataset.game = game;
    const layer = game === "huroof" ? el.huroof : game === "taboo" ? el.taboo : el.hub;
    el.huroof.hidden = game !== "huroof";
    el.taboo.hidden = game !== "taboo";
    el.hub.hidden = game !== "none";
    replay(layer, "ds-pop-in");
  }
  if (game === "none") renderHubScreen();
  if (game === "taboo") renderTabooScreen(state);
  if (game !== "huroof") return;

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
    if (prevOwners && owner && prevOwners[id] !== owner) claimCell(els, owner);

    els.g.classList.toggle("is-selected", isSelected);
    els.g.classList.toggle("is-a", owner === "a");
    els.g.classList.toggle("is-b", owner === "b");
  }

  // جولة جديدة (تغيّرت حروف كثيرة دفعة واحدة) → موجة ظهور ناعمة
  if (prevLetters && changedLetters >= 5) staggerCells();

  // الحرف المختار (بعد منح النقطة تُلغى الخلية المحددة، فنُظهر الحرف المُحتسب من verdict)
  const activeCellId =
    state.current.cellId || state.current.verdict?.cellId || state.current.missed?.cellId || null;
  const activeCell = activeCellId ? state.cells[activeCellId] : null;

  if (!activeCell) {
    el.selHexText.textContent = "؟";
    anim.selLetter = "";
    el.selHex.classList.remove("is-selected", "is-a", "is-b");
  } else {
    el.selHexText.textContent = activeCell.letter;
    if (anim.selLetter !== activeCell.letter) {
      anim.selLetter = activeCell.letter;
      replay(el.selHex, "is-claim");
    }
    el.selHex.classList.toggle("is-a", activeCell.owner === "a");
    el.selHex.classList.toggle("is-b", activeCell.owner === "b");
    el.selHex.classList.toggle("is-selected", !activeCell.owner);
  }

  renderQuestion(activeCell);

  // النقاط وأسماء الفريقين، والدور
  el.scoreNameA.textContent = state.teams.a?.name || "";
  el.scoreNameB.textContent = state.teams.b?.name || "";
  setScore(el.scoreTextA, state.teams.a?.score || 0);
  setScore(el.scoreTextB, state.teams.b?.score || 0);
  const turn = state.current.turn;
  for (const k of ["a", "b"]) {
    const box = k === "a" ? el.scoreGroupA : el.scoreGroupB;
    box.classList.toggle("is-turn", turn === k);
    box.classList.toggle("is-waiting", (turn === "a" || turn === "b") && turn !== k);
  }

  // لافتة الأجراس: «اضغط الآن» أو إعلان الفريق الأسرع
  renderBuzz();

  // فحص الفائز
  if (state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    // موجة على مسار الفائز أولاً، ثم شاشة التهنئة
    const w = state.winner;
    winWave(w);
    setTimeout(() => {
      if (state?.winner === w) showWinner(w);
    }, reduceMotion ? 0 : 1300);
  } else if (!state.winner && lastWinner) {
    lastWinner = null;
    if (el.winnerOverlay) el.winnerOverlay.hidden = true;
  }
}

/** السؤال في لوحته، والجواب (أو التلميح أو الفئة) تحته. */
function renderQuestion(activeCell) {
  const q = state.current.question;
  const showAnswer = (cls, team, label, text, iconName) => {
    const box = el.qAnswerBox;
    box.className = `ds-answer ${cls}${team ? ` ds-team-${team}` : ""}`;
    box.querySelector(".ds-icon use")?.setAttribute("href", `/icons.svg#${iconName}`);
    el.qAnswerLabel.textContent = label;
    if (box.hidden || el.qAnswerValue.textContent !== text) {
      box.hidden = false;
      el.qAnswerValue.textContent = text;
      replay(box, "ds-flip-in");
    }
  };

  if (!activeCell || !state.current.revealed) {
    el.qText.textContent = "";
    el.qAnswerBox.hidden = true;
  } else {
    const newText = q?.text || "";
    if (el.qText.textContent !== newText) {
      el.qText.textContent = newText;
      replay(el.qText, "ds-rise-in");
    }
    if (state.current.answerRevealed && q?.answer) {
      // بطاقة الجواب بلون الفريق الذي أخذ النقطة (أو محايدة إن لم يُجب أحد)
      const vTeam = state.current.verdict?.team;
      if (vTeam) showAnswer("ds-answer--team", vTeam, "الجواب الصحيح", q.answer, "check");
      else if (state.current.missed) showAnswer("ds-answer--dark", null, "الجواب الصحيح", q.answer, "check");
      else showAnswer("", null, "الجواب الصحيح", q.answer, "check");
    } else if (state.current.hintRevealed && q?.hint) {
      showAnswer("ds-answer--sun", null, "تلميح", q.hint, "sparkle");
    } else if (q?.category) {
      showAnswer("ds-answer--sky", null, "الفئة", q.category, "info");
    } else {
      el.qAnswerBox.hidden = true;
    }
  }

  // ضبط حجم السؤال والجواب تلقائياً حتى لا يُقتطع النص الطويل
  fitReadableText();
}

/* ---------------- أجراس الجوال ---------------- */
/**
 * لافتة الأجراس تعرض «الوضع الحالي» دائماً:
 *  - «اضغط الجرس!» عندما يفتح الحكم باب الإجابة
 *  - «فلان يجيب!» + العدّاد الحيّ للاعب الذي ضغط أولاً
 *  - «دور الفريق الآخر» + العدّاد الحيّ عند بدء مؤقّت الفريق الثاني
 *  - «نقطة محسوبة!» بعد حسم الحكم
 */
function setBanner({ tone = "", team = null, iconName, text, sub = "", timer = null, stage = 0 }) {
  const b = el.buzzBanner;
  b.hidden = false;
  b.className = `ds-banner${tone ? ` ds-banner--${tone}` : ""}${team ? ` ds-banner--team ds-team-${team}` : ""}`;
  setIcon(el.buzzBannerIcon, iconName);
  el.buzzBannerText.textContent = text;
  el.buzzBannerSub.textContent = sub;
  el.buzzBannerSub.hidden = !sub;
  buzzRingOn = timer != null;
  el.buzzBannerTimer.hidden = timer == null;
  if (timer != null) {
    const t = state.current.timer || {};
    buzzRing.set(Math.max(0, remainingMs(t, transport.serverOffset) / 1000), Math.max(1, t.total || timer));
  }
  // مراحل الجرس الثلاث
  el.buzzSteps.hidden = !stage;
  if (stage) {
    for (const s of el.buzzSteps.querySelectorAll(".ds-step")) {
      const n = Number(s.dataset.stage);
      s.classList.toggle("is-on", n === stage);
      s.classList.toggle("is-done", n < stage);
    }
  }
}

function hideBanner() {
  el.buzzBanner.hidden = true;
  el.buzzSteps.hidden = true;
  buzzRingOn = false;
}

function renderBuzz() {
  const b = state?.current?.buzz;
  if (!el.buzzBanner) return;

  if (!b || !b.enabled) return hideBanner();

  const c = state.current || {};
  const t = c.timer || {};
  const rem = t.running ? remainingMs(t, transport.serverOffset) : 0;
  const secs = t.running && rem > 0 ? Math.ceil(rem / 1000) : null;
  const nameOf = (pl) => (!pl ? "—" : pl.id?.startsWith("team:") ? state.teams[pl.team]?.name : pl.name);

  // نقطة محسوبة: اسم اللاعب الذي أجاب + فريقه
  const verdict = c.verdict;
  if (verdict) {
    const pl = verdict.playerId ? state.players?.[verdict.playerId] : null;
    return setBanner({
      tone: "success",
      team: verdict.team,
      iconName: "check",
      text: pl && !pl.pseudo ? `${pl.name} أجاب صح!` : "نقطة محسوبة!",
      sub: state.teams[verdict.team]?.name || "",
    });
  }

  // لاعب يجيب الآن: اسمه بلون فريقه + العدّاد
  if (b.phase === "answer" && b.player) {
    return setBanner({
      team: b.player.team,
      iconName: "bolt",
      text: `${nameOf(b.player)} يجيب!`,
      sub: state.teams[b.player.team]?.name || "",
      timer: secs,
      stage: 1,
    });
  }

  // الجولة ١: الأجراس مفتوحة للجميع (بلا حدّ زمني للتفكير)
  if (b.phase === "open" && b.open) {
    return setBanner({ iconName: "bell", text: "اضغط الجرس!", sub: "أول ضغطة تفوز", stage: 1 });
  }

  // الجولة ٢: دور الفريق الآخر — يجيبون بصوت عالٍ مع العدّاد
  if (b.phase === "team") {
    return setBanner({
      team: b.allowed,
      iconName: "users",
      text: `دور ${state.teams[b.allowed]?.name}`,
      sub: "جاوبوا بصوت عالٍ",
      timer: secs,
      stage: 2,
    });
  }

  // الجولة ٣: مفتوح للجميع بلا وقت
  if (b.phase === "all") {
    return setBanner({ tone: "success", iconName: "megaphone", text: "مفتوح للجميع!", sub: "من يعرف الجواب؟", stage: 3 });
  }

  hideBanner();
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
    el.timerOverlay.hidden = false;
    el.timerNum.textContent = Math.ceil(rem / 1000);
    if (buzzRingOn) buzzRing.set(rem / 1000, Math.max(1, t.total || 1));

    const secs = Math.ceil(rem / 1000);
    if (secs !== scSfx.sec) {
      scSfx.sec = secs;
      if (secs > 0) sfx.play(secs <= 3 ? "tickUrgent" : "tick");
      renderBuzz(); // يُبقي العدّاد الحيّ على لافتة الأجراس محدَّثاً كل ثانية
    }

    // بلا أسماء فرق: الدور يُعرَّف بلون الفريق المختار من لوحة الحكم
    const turn = state.current.turn;
    const badge = el.timerBadge;
    badge.classList.toggle("ds-pill--team", turn === "a" || turn === "b");
    badge.classList.toggle("ds-team-a", turn === "a");
    badge.classList.toggle("ds-team-b", turn === "b");
    badge.classList.toggle("ds-pill--sun", turn !== "a" && turn !== "b");
    badge.classList.remove("ds-pill--dark");
    el.timerTurn.textContent = turn === "open" ? "الفرصة للجميع" : "الدور";
  } else {
    el.timerOverlay.hidden = true;
    scSfx.sec = -1;
  }
}

setInterval(renderTimer, 100);

/* ---------------- شاشة الفوز ---------------- */
function showWinner(team) {
  if (!el.winnerOverlay) return;
  const info = state.teams[team];
  el.winnerName.textContent = info.name;
  el.winnerCaption.className = `ds-pill ds-pill--lg ds-pill--team ds-team-${team}`;
  // إحصاءات ممتعة: أفضل لاعب + أسرع ضغطة
  if (el.winnerStats) {
    const players = Object.values(state?.players || {}).filter((pl) => !pl.pseudo);
    const best = [...players].sort((x, y) => y.score - x.score || (x.fastest ?? 1e9) - (y.fastest ?? 1e9))[0];
    const fast = [...players].filter((pl) => pl.fastest != null).sort((x, y) => x.fastest - y.fastest)[0];
    el.winnerStats.replaceChildren();
    const pill = (iconName, text) => {
      const p = document.createElement("span");
      p.className = "ds-pill ds-pill--lg";
      p.append(icon(iconName), document.createTextNode(text));
      el.winnerStats.appendChild(p);
    };
    if (best && best.score > 0) pill("star", `أفضل لاعب: ${best.name} (${best.score} ${best.score === 1 ? "نقطة" : "نقاط"})`);
    if (fast) pill("bolt", `أسرع ضغطة: ${fast.name} (${(fast.fastest / 1000).toFixed(2)} ث)`);
  }
  el.winnerOverlay.hidden = false;
  replay(el.winnerName, "ds-pop-in");
  launchConfetti(getComputedStyle(document.documentElement).getPropertyValue(`--team-${team}`).trim());
}
