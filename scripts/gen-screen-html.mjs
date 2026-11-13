import fs from 'node:fs';

const svg = fs.readFileSync('حروف مع حسين layout.svg', 'utf8');

const pathRegex = /<path\s+class="cls-[^"]+"\s+d="([^"]+)"\/>/g;
const paths = [];
let match;
while ((match = pathRegex.exec(svg)) !== null) {
  paths.push(match[1]);
}

const ellRegex = /<g>\s*(<ellipse[^>]+>\s*<ellipse[^>]+>)\s*<\/g>/g;
const ellipseGroups = [];
while ((match = ellRegex.exec(svg)) !== null) {
  ellipseGroups.push(match[1]);
}

// In the original SVG:
// Row 0: paths [4, 3, 2, 1, 0] (startX: 172.8, 348.39, 523.97, 699.55, 875.13)
// Row 1: paths [19, 18, 17, 16, 15] (startX: 85.01, 260.6, 436.18, 611.76, 787.34)
// Row 2: paths [14, 13, 12, 11, 10] (startX: 172.8, 348.39, 523.97, 699.55, 875.13)
// Row 3: paths [24, 23, 22, 21, 20] (startX: 85.01, 260.6, 436.18, 611.76, 787.34)
// Row 4: paths [9, 8, 7, 6, 5] (startX: 172.8, 348.39, 523.97, 699.55, 875.13)

const rows = [
  { row: 0, pIdxs: [4, 3, 2, 1, 0], eIdxs: [4, 3, 2, 1, 0] },
  { row: 1, pIdxs: [19, 18, 17, 16, 15], eIdxs: [9, 8, 7, 6, 5] },
  { row: 2, pIdxs: [14, 13, 12, 11, 10], eIdxs: [19, 18, 17, 16, 15] },
  { row: 3, pIdxs: [24, 23, 22, 21, 20], eIdxs: [14, 13, 12, 11, 10] },
  { row: 4, pIdxs: [9, 8, 7, 6, 5], eIdxs: [24, 23, 22, 21, 20] },
];

let cellsMarkup = '';
rows.forEach(({ row, pIdxs, eIdxs }) => {
  pIdxs.forEach((pIdx, col) => {
    const id = `r${row}c${col}`;
    const d = paths[pIdx];
    const ellipses = ellipseGroups[eIdxs[col]];
    const m = d.match(/^M([0-9.]+),([0-9.]+)/);
    const startX = parseFloat(m[1]);
    const startY = parseFloat(m[2]);
    // True horizontal center of hexagon (width is 175.59):
    const cx = (startX + 175.59 / 2).toFixed(2);
    // True vertical center of hexagon (vertical segment length is 78.27):
    const cy = (startY + 39.14).toFixed(2);

    cellsMarkup += `
      <g class="svg-cell" id="cell-${id}" data-id="${id}">
        <path class="cell-path" d="${d}" fill="url(#grad-cell-unselected)" stroke="#070808" stroke-width="4px" stroke-miterlimit="10"/>
        <g class="cell-shine">
          ${ellipses}
        </g>
        <text class="cell-text" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">؟</text>
      </g>`;
  });
});

// Selected Hexagon at top right: Path 25
const selectedHexD = paths[25]; // startX: 1440.07, startY: 232.52
const selectedEllipses = ellipseGroups[25];
const selCx = (1440.07 + 175.59 / 2).toFixed(2); // 1527.86
const selCy = (232.52 + 39.14).toFixed(2);      // 271.66

// Score Hexagon Team A (Purple, right score hex): Path 26
const scoreHexAD = paths[26]; // startX: 1550.36, startY: 809.77
const scoreEllipsesA = ellipseGroups[26];
const scoreCxA = (1550.36 + 175.59 / 2).toFixed(2); // 1638.15
const scoreCyA = (809.77 + 39.14).toFixed(2);      // 848.91

// Score Hexagon Team B (Cyan, left score hex): Path 27
const scoreHexBD = paths[27]; // startX: 1331.05, startY: 809.77
const scoreEllipsesB = ellipseGroups[27];
const scoreCxB = (1331.05 + 175.59 / 2).toFixed(2); // 1418.84
const scoreCyB = (809.77 + 39.14).toFixed(2);      // 848.91

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>حروف مع حسين — الشاشة</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@700;800;900&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/css/screen.css" />
    <script src="/js/vendor/qrcode.js"></script>
  </head>
  <body class="screen-body">
    <div class="screen-viewport">
      <svg
        id="gameSvg"
        class="game-svg"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        xmlns:xlink="http://www.w3.org/1999/xlink"
      >
        <defs>
          <!-- تدرجات الألوان المطابقة لملف layout.svg والمدعومة بالتخصيص الديناميكي -->
          <linearGradient id="grad-cell-unselected" x1="0" y1="0" x2="0" y2="1">
            <stop id="stopCell1" offset="0%" stop-color="#ede5bb" />
            <stop id="stopCell2" offset="100%" stop-color="#c4bd93" />
          </linearGradient>

          <linearGradient id="grad-cell-selected" x1="0" y1="0" x2="0" y2="1">
            <stop id="stopSel1" offset="0%" stop-color="#fcb017" />
            <stop id="stopSel2" offset="100%" stop-color="#e9965e" />
          </linearGradient>

          <linearGradient id="grad-team-a" x1="0" y1="0" x2="0" y2="1">
            <stop id="stopTeamA1" offset="0%" stop-color="#7c78cb" />
            <stop id="stopTeamA2" offset="100%" stop-color="#6965ae" />
          </linearGradient>

          <linearGradient id="grad-team-b" x1="0" y1="0" x2="0" y2="1">
            <stop id="stopTeamB1" offset="0%" stop-color="#5fb3d6" />
            <stop id="stopTeamB2" offset="100%" stop-color="#4b9cbf" />
          </linearGradient>

          <linearGradient id="grad-bg-right" x1="0" y1="0" x2="1" y2="0">
            <stop id="stopBgRight1" offset="0%" stop-color="#73c4ee" />
            <stop id="stopBgRight2" offset="100%" stop-color="#4b9cbf" />
          </linearGradient>

          <filter id="drop-shadow-board" x="40" y="90" width="1060" height="900" filterUnits="userSpaceOnUse">
            <feOffset dx="0" dy="4" />
            <feGaussianBlur result="blur" stdDeviation="0" />
            <feFlood flood-color="#070808" flood-opacity="0.9" />
            <feComposite in2="blur" operator="in" />
            <feComposite in="SourceGraphic" />
          </filter>
        </defs>

        <!-- خلفية الشاشة اليسرى (منطقة اللوحة السداسية) -->
        <rect id="bgLeft" fill="#73c4ee" x="-200" y="-100" width="1336" height="1280" />

        <!-- شبه المنحرف العلوي والسفلي (هدف الفريق أ: ربط أعلى بأسفل) -->
        <polygon id="polyTop" points="962.92 231.1 172.81 231.1 0 0 1135.72 0 962.92 231.1" fill="url(#grad-team-a)" />
        <polygon id="polyBottom" points="172.81 848.9 962.92 848.9 1135.72 1080 0 1080 172.81 848.9" fill="url(#grad-team-a)" />

        <!-- خلفية الشاشة اليمنى (تمتد بعرض كبير لمنع أي هامش زائد على أي دقة شاشة) -->
        <rect id="bgRight" fill="url(#grad-bg-right)" x="1135.72" y="-100" width="1800" height="1280" />

        <!-- الخلايا الـ 25 (مصغرة بنسبة 0.93 حول المركز لتعطي مساحة تنفس متناسقة ومريحة) -->
        <g filter="url(#drop-shadow-board)" id="boardCellsGroup" transform="translate(567.86, 546.13) scale(0.93) translate(-567.86, -546.13)">
          ${cellsMarkup}
        </g>

        <!-- الحرف المختار في أعلى اليمين (Zone: y=150 to 390) -->
        <g id="selectedHexGroup" class="selected-hex-group">
          <path
            id="selectedHexPath"
            d="${selectedHexD}"
            fill="url(#grad-cell-selected)"
            stroke="#070808"
            stroke-width="4px"
            stroke-miterlimit="10"
          />
          <g class="selected-shine">
            ${selectedEllipses}
          </g>
          <text
            id="selectedHexText"
            class="selected-hex-text"
            x="${selCx}"
            y="${selCy}"
            text-anchor="middle"
            dominant-baseline="central"
          >أ</text>
        </g>

        <!-- نص السؤال في منتصف اليمين (Zone: y=370 to 540) -->
        <foreignObject x="1150" y="370" width="750" height="180">
          <div xmlns="http://www.w3.org/1999/xhtml" class="q-text-wrap">
            <div id="qText" class="q-main-text">اضغط على أي حرف في اللوحة لبدء الجولة</div>
          </div>
        </foreignObject>

        <!-- بطاقة الجواب أسفل السؤال مباشرة (Zone: y=565 to 685 - فوق خليتي النقاط بمسافة مريحة تمنع أي تداخل) -->
        <foreignObject x="1150" y="565" width="750" height="120">
          <div xmlns="http://www.w3.org/1999/xhtml" class="q-answer-wrap">
            <div id="qAnswerBox" class="q-answer-card" style="display: none;">
              <span class="q-answer-badge">الجواب الصحيح</span>
              <span id="qAnswerValue" class="q-answer-content">—</span>
            </div>
          </div>
        </foreignObject>

        <!-- خليتا النقاط في أسفل اليمين (Zone: y=809 to 966) -->
        <!-- خلية الفريق الأول (البنفسجي / يمين) -->
        <g id="scoreGroupA" class="score-group">
          <path
            id="scoreHexPathA"
            d="${scoreHexAD}"
            fill="url(#grad-team-a)"
            stroke="#070808"
            stroke-width="4px"
            stroke-miterlimit="10"
          />
          <g class="score-shine">
            ${scoreEllipsesA}
          </g>
          <text
            id="scoreTextA"
            class="score-text"
            x="${scoreCxA}"
            y="${scoreCyA}"
            text-anchor="middle"
            dominant-baseline="central"
          >0</text>
        </g>

        <!-- خلية الفريق الثاني (السماوي / يسار) -->
        <g id="scoreGroupB" class="score-group">
          <path
            id="scoreHexPathB"
            d="${scoreHexBD}"
            fill="url(#grad-team-b)"
            stroke="#070808"
            stroke-width="4px"
            stroke-miterlimit="10"
          />
          <g class="score-shine">
            ${scoreEllipsesB}
          </g>
          <text
            id="scoreTextB"
            class="score-text"
            x="${scoreCxB}"
            y="${scoreCyB}"
            text-anchor="middle"
            dominant-baseline="central"
          >0</text>
        </g>
      </svg>
    </div>

    <!-- مؤقّت الدور عائم عند تشغيله -->
    <div class="timer-float" id="timerOverlay">
      <div class="timer-badge">
        <span class="timer-seconds" id="timerNum">10</span>
        <span class="timer-label" id="timerTurn">مفتوح للجميع</span>
      </div>
    </div>

    <!-- شاشة الفوز والاحتفال عند اكتمال الربط -->
    <div class="winner-modal" id="winnerOverlay">
      <div class="winner-banner">
        <div class="winner-icon">★</div>
        <div class="winner-sub">مبروك الفوز!</div>
        <div class="winner-title" id="winnerName">الفريق الأول</div>
        <div class="winner-caption">نجح في ربط طرفي اللوحة أولاً!</div>
      </div>
    </div>
    <canvas id="confetti" class="confetti-canvas"></canvas>

    <!-- شارة حالة اتصال الحكم في الزاوية العلوية -->
    <div class="conn-badge" id="connBadge">
      <span class="conn-dot" id="connBadgeDot"></span>
      <span id="connBadgeText">بانتظار الحكم</span>
    </div>

    <!-- بطاقة البداية ومسح QR لربط جوال الحكم -->
    <div class="lobby-overlay" id="lobby">
      <div class="lobby-card">
        <div class="lobby-badge">لوحة التحكم للجوال</div>
        <h2 class="lobby-title">امسح الرمز للدخول كحكم</h2>
        <div class="qr-box">
          <canvas id="qrCanvas" class="qr-canvas"></canvas>
        </div>
        <div class="lobby-url" id="lobbyUrl">جارٍ تجهيز الرابط…</div>
        <div class="pair-code-wrap">
          <span class="pair-label">رمز التحقق:</span>
          <span class="pair-code" id="lobbyPairCode">------</span>
        </div>
        <p class="lobby-status" id="lobbyStatusText">بانتظار مسح الرمز من الجوال…</p>
        <div class="lobby-actions">
          <button class="screen-btn btn-primary" id="lobbyStart">ابدأ اللعب الآن</button>
          <button class="screen-btn btn-secondary" id="lobbyHide">إخفاء</button>
        </div>
      </div>
    </div>

    <script type="module" src="/js/screen.js"></script>
  </body>
</html>`;

fs.writeFileSync('public/screen.html', html, 'utf8');
console.log('Successfully generated public/screen.html');
