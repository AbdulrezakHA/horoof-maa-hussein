# خطة نقل كل الشاشات إلى نظام التصميم

> **للمستخدم:** هذا الملف مكتوب ليُعطى لنموذج ذكاء اصطناعي آخر فينفّذ العمل كاملاً وحده.
> أعطه هذه الرسالة: «اقرأ `PLAN-design-migration.md` ونفّذه مرحلة مرحلة بالترتيب، ولا تنتقل لمرحلة قبل أن تنجح فحوص المرحلة السابقة».
> كل مرحلة تنتهي بـ commit محلي، **ولا رفع إلى GitHub إلا بموافقتك**.

---

# Instructions for the implementing model (read fully before touching anything)

You are migrating every screen of an Arabic (RTL) party-game web app onto its new design system.
The design system already exists and is **finished and approved by the user**. Your job is to make
every game screen use it, **without changing game behavior**. Work phase by phase, in order.
After each phase: run the checks in §2.3, verify in a browser, commit. Never skip the checks.

## 0. Read these first (mandatory)

1. `DESIGN.md` — the rules. They are strict and enforced by an automated check.
2. `public/css/ds.css` — the component library (all `ds-*` classes and tokens).
3. `public/design.html` — open `http://127.0.0.1:<port>/design` in a browser. **Every component
   you will use is demonstrated there with correct markup.** Copy markup patterns from this file.
4. `shared/ds-theme.js` — color engine (themes, `applyTheme`, `applyTeams`).
5. `public/js/ds.js` — helpers: `icon`, `iconHTML`, `hydrateIcons`, `toast`, `bump`, `replay`,
   `confetti`, `ring`, `segmented`, `fitScale`.
6. `public/icons.svg` — the only icon source (list ids with: `grep -o 'symbol id="[^"]*"' public/icons.svg`).

## 1. Non-negotiable rules

1. **NO EMOJI. EVER.** Not in buttons, labels, banners, toasts, logs shown in the UI, rules text,
   titles, `<title>`, or JS strings that reach the screen. Use SVG icons:
   `<svg class="ds-icon" aria-hidden="true"><use href="/icons.svg#play"/></svg>`, or in HTML
   `<span data-i="play"></span>` + `hydrateIcons()`, or `icon("play")` / `iconHTML("play")` in JS.
   If no suitable icon exists: **add a new `<symbol>` to `public/icons.svg`** (24×24 viewBox, stroke-based,
   round caps/joins, same style as the others) and show it on `/design` (the icon grid there is automatic).
   The ONLY exception: content that is itself meant to be an emoji (none exists today).
2. **Library first.** A game file never defines how a component looks. No CSS for `.ds-*` outside
   `ds.css` (not even `.my-screen .ds-btn {}`), no literal colors (`#hex`, `rgb()`, `hsl()`), no
   `font-family` other than `var(--font-display)`/`var(--font-body)`, no raw spacing numbers — use
   `--sp-*`, `--fs-*`, `--r-*` tokens. If a screen needs something the library lacks:
   (a) add it to `ds.css` with a `ds-` name built only from tokens, (b) add a demo to `public/design.html`,
   (c) list it in the «المكوّنات» table of `DESIGN.md`, (d) then use it.
   Prefer a **modifier** of an existing component (`ds-btn--huge`) over a new component.
3. **Do not change game logic.** `shared/engine.js`, `shared/taboo.js`, `server/*` stay as they are,
   except the small, explicitly listed changes in Phase 1. Element **ids**, `data-*` attributes and
   message/action names that JS or tests rely on must keep working. If you rename an id, update every
   reference (`grep -rn "theId" public shared server scripts`).
4. **Keep behavior identical**: same buttons, same flows, same keyboard shortcuts, same sounds,
   same secrecy rules (who sees the word, the forbidden words, the answer).
5. **Never add a file to `LEGACY`** in `scripts/check-ds.mjs`. You only **remove** files from it,
   when they are fully migrated. A file leaves `LEGACY` only when `npm run ds:check` passes with it removed.
6. Font: headings/buttons/numbers = Baloo Bhaijaan 2 (`--font-display`), text = Tajawal (`--font-body`).
   Use exactly the font `<link>` given in `DESIGN.md` § الخطوط.
7. Everything must work on **TV (1920×1080, `body.ds-tv`)** and **phones (≥ 360px wide)**.
   Touch targets on phones ≥ `var(--tap)` (48px). RTL everywhere (`dir="rtl"`), logical CSS properties.
8. Motion: transform/opacity only, durations `--dur-*`, easing `--ease-*`, reduced-motion respected
   (the library already does this — don't add your own animations; use `ds-pop-in`, `replay()`, etc.).
9. Do not push to GitHub. Commit locally at the end of each phase (message format in §2.4).

## 2. Environment and commands

### 2.1 The machine
- Windows 11. Project root: `D:\حروف مع حسين صديلي` (Arabic path, contains spaces — always quote it).
- Node 18+ is installed. No npm dependencies (zero-dependency project). Do not add dependencies.
- Line endings: `.bat`/`.ps1` must stay CRLF (`.gitattributes` handles it). Don't touch those files.
- **Tooling pitfall:** shell heredocs/`sed`/`python -c` in this environment can mangle backslashes and
  regex escapes. Prefer your file-edit tool for code edits. For bulk edits, write a script file
  first, then run it.

### 2.2 Running a test server
Never use the user's real save file. Always start test servers like this (pick a free port 3120–3199):
```
node server/index.js --port 3120 --no-save --no-tunnel
```
- `--no-save` = don't overwrite the user's game; `--no-tunnel` = no internet link (faster, offline).
- Pages: `/screen` (TV), `/referee` (referee phone), `/play` (player phone), `/design`, `/presets`,
  `/taboo-packs`, `/` (index).
- The referee page asks for a 6-digit pairing code: it is shown on the TV page (`/screen`), element
  `#lobbyPairCode`. Open `/screen` first, read the code, enter it on `/referee`.
- Stop the server when done (PowerShell):
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*3120*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`

### 2.3 Checks (run ALL after every phase; all must pass)
```
npm run ds:check                        # design rules + generated theme colors in sync
node scripts/test-game.mjs 3120         # full game test suite against a FRESH test server (219+ checks)
```
- `test-game.mjs` must run against a server started fresh for the run (state left over from manual
  clicking makes some default-value tests fail). Start server → run tests → stop server.
- Expected today before you start: `ds:check` passes with 23 legacy files; tests = 219 passing.
- After your phase the number of legacy files must go DOWN and tests must still all pass.

### 2.4 Browser verification (mandatory per phase)
Open the migrated pages and check, at least:
- TV: 1920×1080 viewport, also 1366×768. Phone: 390×844 and 360×740.
- No layout overflow, no clipped text, no overlapping elements, all icons render (no empty squares),
  Arabic text reads right-to-left, buttons press correctly, focus ring visible on keyboard Tab.
- Every flow listed in the phase's "Behavior checklist" works.
- Browser console has no errors.
Commit message format: `Design migration phase N: <what>` + a short body listing files.

## 3. How things fit together (orientation)

- **State** is owned by the server and pushed to every client over WebSocket (`public/js/transport.js`).
  Pages render from `state`. Relevant fields:
  - `state.game`: `"none"` (game menu/hub) | `"huroof"` | `"taboo"`.
  - `state.teams.a|b`: `{ name, color, score }` — team colors chosen by the referee.
  - `state.theme`: `{ bgColor, cellColor, selectedColor, ... }` hex values (legacy color settings).
  - `state.screen`: `{ lobby, sound, qr }` — TV controls from the referee phone.
  - `state.current` (letters question/buzzer flow), `state.taboo` (taboo game), `state.players`, `state.night`.
- **Colors today** are set by each page in JS (`screen.js` ~line 450, `referee.js` ~line 490) as ad-hoc
  CSS variables (`--team-a-color`, `--bg-color`, `--cell-color`, ...). After migration **all pages get
  colors only through `shared/ds-theme.js`** (Phase 1 adds one helper for this).
- **Smart color system** (`shared/colors.js`: `inkFor`, `findClashes`, `autoFixColors`, `COLOR_THEMES`)
  stays: it warns the referee about clashing colors. Keep using it for warnings; never for styling.
- **TV board**: `public/screen.html` contains a static SVG (`#gameSvg`, `viewBox 0 0 1920 1080`) traced
  from the user's original artwork (`حروف مع حسين layout.png`). Its cells are already rounded and touching
  — the user explicitly wants this look. **Keep its geometry (paths/positions). Only move its colors to tokens.**
  It is generated by `scripts/gen-screen-html.mjs` from `scripts/cell-defs.json` — if you change the SVG
  markup, change the generator the same way (or stop using the generator and say so in the commit).
- **Referee mini-board**: `public/js/board.js` `createBoard()` (HTML hex cells, used by `referee.js`).
  Migrate it to the library hex markup (`ds-hex` + `ds-hex-in` + `ds-hex-face` + `ds-hex-letter`,
  states `is-selected`/`is-a`/`is-b`/`is-claim`/`is-win`) — see `/design` «حروف مع حسين».
- `public/js/diag.js` is a deliberately ES5 plain script (old-phone diagnostics). Keep it ES5. It only
  needs its emoji and literal colors replaced (use `var(--coral)` etc. in its inline styles, and plain
  text instead of emoji).
- `public/js/sfx.js` (sounds), `transport.js`, `qr.js` are logic; only fix rule violations in them
  (emoji in strings, literal colors — `qr.js` draws QR codes: use `getComputedStyle` to read `--ink`
  and `--white` tokens, or pass colors in from the caller).

---

## Phase 1 — Color wiring + page shell (library work, small)

Goal: one function gives every page its colors from game state; pages can load the library.

1. In `shared/ds-theme.js` add and export:
   ```js
   /** Theme object from game state: base theme + referee overrides + team colors. */
   export function themeFromState(state) {
     const base = DS_THEMES[state?.theme?.ds] || DS_THEMES[DEFAULT_THEME];
     const t = state?.theme || {};
     return {
       ...base,
       cream: t.cellColor || base.cream,        // empty letter cells
       sun: t.selectedColor || base.sun,         // selected cell + primary action
       panel: t.bgColor || PAPER,                // question panel face (referee-editable)
       teams: { a: state?.teams?.a?.color || base.teams.a, b: state?.teams?.b?.color || base.teams.b },
     };
   }
   /** Apply all colors for this state (call on every state update; cheap). */
   export function applyGameColors(state, el) { applyVars(themeVars(themeFromState(state)), el); }
   ```
   And in `themeVars()` add a `panel` color: `--panel`, `--panel-hi`, `--panel-side`, `--panel-ink`,
   `--panel-glow` via `shades(t.panel || PAPER)` (themes don't need a `panel` key — it defaults to `PAPER`).
   Then run `npm run ds:theme` (regenerates the color block in ds.css) and `npm run ds:check`.
2. In `public/css/ds.css` make `.ds-qpanel` use `--panel` / `--panel-ink` (face + text) instead of
   `--paper` / `--ink`. Check `/design` still looks the same (default panel = paper).
3. In `shared/engine.js` `case "setTheme"`: additionally accept key `ds` when it is a key of
   `DS_THEMES` (import from `./ds-theme.js`); store as `st.theme.ds`. Default state: `theme.ds = "hussein"`.
   This is the only engine change. Add a test in `scripts/test-game.mjs`: sending
   `setTheme {ds:"ramadan"}` sets `state.theme.ds`, and `{ds:"bogus"}` is ignored.
4. Referee theme chips (`referee.js` ~line 1198, `COLOR_THEMES`): when a chip is clicked send
   `setTheme({ ds: id, cellColor: DS_THEMES[id].cream, selectedColor: DS_THEMES[id].sun, bgColor: <paper hex from PAPER> })`
   and `setTeam` a/b with `DS_THEMES[id].teams`. Build the chips from `DS_THEMES` (names + swatches).
   Keep `COLOR_THEMES` only if `colors.js` internals need it; the UI must use `DS_THEMES`.
5. Checks §2.3. Commit «Design migration phase 1: color wiring».

**Done when:** `applyGameColors(state)` exists, `/design` unchanged, tests pass (+ the new test).

---

## Phase 2 — Player phone (`/play`, `/buzzer`)

Files: `public/buzzer.html`, `public/js/buzzer.js`, `public/js/phone-taboo.js`, `public/css/buzzer.css`.
Remove from LEGACY at the end: `public/buzzer.html`, `public/js/buzzer.js`, `public/js/phone-taboo.js`,
`public/css/buzzer.css` (delete this CSS file if nothing game-specific remains — game-specific **layout**
may stay only if expressed with tokens and without touching `.ds-*`; prefer library layout classes).

Steps:
1. `<head>`: keep `/js/diag.js` first; font link from DESIGN.md; `<link rel="stylesheet" href="/css/ds.css">`.
   Remove `base.css`/`buzzer.css` links once nothing uses them.
2. `<body class="ds ds-page">`; wrap each view in `ds-phone` with `ds-stack` content.
3. Map views (they switch via `body[data-view]`, keep that mechanism):
   - Join view (`#joinView`, `#joinForm`, `#joinName`, `#joinTeams`): `ds-card` + `ds-field`/`ds-label`/
     `ds-input` + team choice as two `ds-btn ds-btn--team ds-team-a|b` (selected one gets `is-pressed`
     style via `aria-pressed="true"`; if the library lacks a "selected" look for team buttons, add
     `.ds-btn[aria-pressed="true"]` to the library).
   - Top bar: team chip → `ds-pill ds-pill--team ds-team-a|b`; connection state → `ds-pill ds-pill--dark`
     with icon `wifi` (connected) / `warning` (disconnected); sound toggle → `ds-btn ds-btn--icon ds-btn--sm`
     with `volume`/`volume-off`.
   - Letter bar (`#letterBar`) → `ds-letterbar`.
   - Buzzer (`#bzRing`/press area) → `ds-buzzer` inside `ds-team-a|b` (player's team).
     Stage 1 "you are first" → `ds-badge-icon ds-badge-icon--lg` (`bolt`) + `ds-title` + `ds-timebar`.
     Stage 2/3 messages → `ds-banner` (`--info` / `--success`), timers → `ds-timebar` or `ds-ring`.
     Answer reveal → `ds-answer`. Use `/design` «جوال اللاعب» mockups as the reference.
   - Taboo phone (`phone-taboo.js`): describer card = `ds-card` + `ds-chip` (topic, with an icon),
     word in `--fs-2xl` display font, forbidden words `ds-chip ds-chip--forbidden`, skip `ds-btn ds-btn--block`;
     teammates view = `ds-center` + `ds-badge-icon--lg` (`question`) + `ds-title`; opponents =
     forbidden chips + `ds-banner ds-banner--danger` (`megaphone`). Turn log chips: `ds-chip--right/skip/pass/foul`
     with icons `check`/`skip`/`swap`/`ban`/`timer`. Score: two `ds-pill ds-pill--team`.
     Reference: `/design` «نماذج الشاشات» phone mockups.
4. Team colors: call `applyGameColors(state)` on every state; put `ds-team-a|b` on containers instead of
   setting `--team`/`--pick` inline. Remove `teamColor()`-based inline color styles.
5. Replace every emoji in these files (search: `node scripts/check-ds.mjs` after removing them from LEGACY
   lists exact lines). Toasts/flash messages: use `toast(text, iconName)` from `ds.js` or a `ds-banner`.
6. Confetti: use `confetti()` from `ds.js` (team colors: `confetti([teamColor])`), drop the old one.

Behavior checklist (all must work exactly as before):
- Join with name + team; duplicate name gets «2» suffix; rejoin after reload keeps identity.
- Letters game: buzzer enabled only in step 1, first press wins (3 s timer shown), step 2 (other team,
  10 s, no buzzers), step 3 (open, no timer); wrong/close/correct verdict screens; answer shown after a point
  or «لم يُجب أحد»; vibration + sounds unchanged; letter bar shows current letter.
- Taboo: describer sees word + forbidden + skip (skip disabled at 0 / hidden when unlimited shows no count);
  teammates see nothing secret; opponents see forbidden only; turn end shows chips; winner view.
- Legacy team buzzer `/buzzer?team=a` still works.
- Old phone diagnostics (`diag.js`) still shows its message when the app fails to start.

---

## Phase 3 — TV screen (`/screen`)

Files: `public/screen.html`, `public/js/screen.js`, `public/js/screen-taboo.js`, `public/css/screen.css`,
`public/css/base.css` (shared with referee — only delete when Phase 4 is done), `scripts/gen-screen-html.mjs`.

**Critical — do not break:**
- `document.title` gets ` [port]` appended (screen.js ~line 241). `server/screen-fullscreen.ps1` finds the
  TV window by that `[port]` text to press F11. Keep it.
- `transport.onMessage` handles `{t:"net"}` to redraw QR codes; the lobby QR markup ids
  (`qrRefNet`, `qrRefLan`, `qrPlayNet`, `qrPlayLan`, their `…Wait` elements, `qrCardRef`, `.qr-route[data-route]`)
  are used by `initLobby()`/`applyRouteVisibility()` — keep ids and the `data-route` attribute.
- `screenInfo`/fullscreen reporting, sound unlock button, `#connBadge`.

Steps:
1. Head: font link, `ds.css`; `<body class="ds ds-tv ds-stage" data-game="none">` (keep `data-game`).
2. **Board SVG** (`#gameSvg`): keep all geometry. Replace every literal color:
   - gradient `<stop>`s → `style="stop-color: var(--cream-hi)"` / `var(--cream)` (empty cells),
     `var(--sun-hi)`/`var(--sun)` (selected), `var(--team-a-hi)`/`var(--team-a)`, `var(--team-b-hi)`/`var(--team-b)`.
   - goal polygons (`#polyTop`, `#polyBottom` = team A; side areas = team B) → `style="fill: var(--team-a)"` etc.
     The left background must show team B on the sides like the original X layout (see `/design` board).
   - outline/shadow `#070808` → `var(--ink)` (`flood-color` via `style="flood-color: var(--ink)"`).
   - cell letters color → `var(--cream-ink)` / `var(--team-a-ink)` etc. per state (screen.js sets classes or styles —
     switch it to set fills via `var(...)` strings, never hex).
   - Remove the JS that writes hex colors into stops (`screen.js` ~line 450–461); `applyGameColors(state)` replaces it.
   - Add the two white gloss ovals per cell if missing, matching `/design` (`--shine-strong`).
   - Update `scripts/gen-screen-html.mjs` to emit the same markup (or document that the SVG is now hand-maintained).
3. **Right side** (question area, letter, timer, buzz banner, answer, winner): rebuild with library parts:
   letter → `ds-hex ds-letter-badge is-selected`; question → `ds-qpanel` (+ `ds-qpanel-text`);
   answer → `ds-answer` (shown with `replay(el,"ds-flip-in")`); buzz banner (`#buzzBanner`) → `ds-banner`
   (+ `--info`/`--success`/`--team` + `ds-team-a|b`) with `ds-banner-icon` icons (`bolt` step 1, `users` step 2,
   `megaphone` step 3); timer → `ds-ring` (`ring()` helper) or `ds-timebar`; step indicator → `ds-steps`;
   scores → `ds-team` boxes (`is-turn`/`is-waiting`) with `ds-score` + `bump()` on change.
   Winner overlay (`#winnerOverlay`) → `ds-stage` overlay + `ds-trophy` + `ds-winner` + stats as `ds-pill`s +
   `confetti()`. Keep all ids used by screen.js.
4. **Game menu** (`#hubScreen`): `ds-title` + `ds-grid` of `ds-game-tile` (`--i` stagger; huroof = default sun +
   `hexagon` icon, taboo = `ds-game-tile--coral` + `hush` icon) + night points as `ds-pill ds-pill--team`.
   Matches `/design` «قائمة الألعاب على التلفاز».
5. **Lobby** (`#lobby`): `ds-card` with two route QR blocks per card using `ds-qr` + `ds-qr-frame` +
   route tag `ds-pill` (`globe` «عبر الإنترنت» on `--sun`, `wifi` «نفس الواي فاي» on `--sky` — if a colored pill
   modifier is missing, add `ds-pill--sun`/`ds-pill--sky` to the library); players list as `ds-player` + `ds-avatar`
   inside `ds-team-a|b`; pair code as large display-font text in a `ds-pill`.
6. **Taboo TV** (`screen-taboo.js`): scores = `ds-team` + skip `ds-dots`; ring = `ds-ring`; rules phase =
   **auto-advancing slides** exactly like `/design` «قوانين الكلمة الممنوعة»: `ds-rules` with 3 `ds-rule`
   per slide (icon + 2–4 words), `ds-pager`, change every ~4 s; foul reason = `ds-banner ds-banner--danger`;
   turn-end chips; winner = trophy + `ds-winner`. Short rule texts (TV): لا تقل الكلمة · لا الممنوعة · لا حروف ·
   لا أعداد · لا قافية · لا ترجمة · لا إشارات · لا أصوات · لا كتابة · لا تُرِ جوالك · المخالفة ⁦-1⁩ وينتهي الدور
   (foul card, `ds-rule--foul`) · the skips rule from `skipsRule(t)`. Full sentences stay on phones/referee.
   Icons: `hush, ban, no-letters, hash, music, translate, hand, wave, pen, phone, warning, skip`.
   **Secrecy: the TV never shows the word or forbidden words during a turn** (server already filters — don't
   render `card.word`/`card.forbidden` on the TV during `turn`/`paused`/`ready`).
7. Remove old CSS. Remove from LEGACY: `screen.html`, `screen.js`, `screen-taboo.js`, `screen.css`.

Behavior checklist: lobby (both QR routes, «جارٍ التجهيز» placeholder, referee-hide-one rule, pair code,
live player lists), hub, letters game full round (select cell → question → buzz steps → award → cell color →
win path → winner overlay), «لم يُجب أحد» shows answer, sounds, fullscreen from referee, taboo full game
(rules slides → ready → turn → foul → turn end → winner), theme change from referee recolors the TV live,
team color change recolors live. Check 1920×1080 and 1366×768.

---

## Phase 4 — Referee (`/referee`)

Files: `public/referee.html`, `public/js/referee.js`, `public/js/referee-taboo.js`, `public/js/board.js`,
`public/css/referee.css`, then `public/css/base.css` (now unused → delete), plus `presets.css` only if the
referee uses its classes (`pst-*` list) — migrate those lists to library classes or add a `ds-list` component.

Steps:
1. Head + `<body class="ds ds-page">`; content in `ds-container` (phone-first: max `--phone-max` on phones,
   can use wider grid on tablets via `ds-grid`). Pairing gate (`#pairingGate`) → `ds-modal is-open` style card
   with `ds-input` (6-digit code).
2. Cards (`hubCard`, `screenCard`, `qCard`, `buzzCard`, `playersCard`, `tabooCard`, settings, log) → `ds-card` +
   `ds-card-title` with an icon. Buttons → `ds-btn` variants: primary actions `--primary`, award to team =
   `ds-btn--team ds-team-a|b`, wrong = `--danger`, «لم يُجب أحد» = default, undo = `ds-btn--icon` (`undo`).
   Segmented choices (`#qrRouteSeg`, settings toggles) → `ds-seg` + `segmented()`; switches → `ds-switch`;
   number settings → `ds-stepper` or `ds-input` (keep ids). Theme chips → `ds-seg`-like row of buttons with 3-dot
   swatches; color warnings (`#colorWarn`) → `ds-banner ds-banner--danger`.
3. Mini board (`board.js`): render `ds-hex` cells (rounded, touching — see `/design` `layoutBoard()` for the
   touching math: overlap by `hw * 0.035`; row step `hh * 0.75 + gap`) inside `ds-board` with the X goal
   background. Keep `createBoard(root, board, opts)` API and its `update(state)` return so `referee.js` is unchanged.
   Selected = `is-selected`, owned = `is-a`/`is-b`, newly claimed = `replay(el,"is-claim")`.
   Letter picker modal (`#letterModal`, `#letterGrid`) → `ds-modal` + `ds-hexkeys`.
4. Judge panel (`#judgePanel`): `ds-steps` (1-2-3) + `ds-banner` for the current state + judge buttons
   (`ds-btn--block`), history as `ds-chip`s.
5. Taboo referee (`referee-taboo.js`): scoreboard = two `ds-team` + `ds-pill` target; ready phase preview card =
   `ds-card` (dashed border is fine via a library modifier `ds-card--preview` — add it) + topic chip + word +
   forbidden chips + `ds-btn` «كلمة أخرى» (`swap`); turn actions: `ds-btn--success` صح (`check`),
   `ds-btn--danger` مخالفة (`ban`), `ds-btn` تخطّي الفريق (`skip`), `ds-btn--info` كلمة أخرى مجاناً (`swap`),
   pause/resume (`pause`/`play`); foul reasons grid = `ds-grid` of `ds-btn--danger ds-btn--sm`; settings use
   `ds-stepper`/`ds-input`/`select` styled by the library (add `ds-select` if missing). Keep keyboard shortcuts 1–4, Space.
6. Players list: `ds-player` + `ds-avatar` in `ds-team-a|b` columns, move/kick as `ds-btn--icon ds-btn--sm`
   (`swap` / `close`).
7. Night points (`#nightBoardHub`, `#nightBoardFoot`): `ds-pill ds-pill--team`.
8. `toast()` from `ds.js` replaces `#toast` (keep the old element id only if tests reference it — check).
9. Remove from LEGACY: `referee.html`, `referee.js`, `referee-taboo.js`, `board.js`, `referee.css`, `base.css`
   (delete files that are no longer linked anywhere: `grep -rn "base.css\|referee.css" public`).

Behavior checklist: pairing, game menu, change game button, every letters-game control (select letter, random,
another question, show/hide hint, buzz step buttons, award/wrong/no point, undo, shuffle, reset, colors/themes,
presets selection, board editor), screen controls (lobby toggle, sound, fullscreen, QR route choice + status line),
players move/kick, taboo full game incl. preview/swap, free pass, skips 0–10/∞, fouls, adjust ±1, new game,
night points reset. Keyboard shortcuts. Phone 390×844 and desktop 1366×768.

---

## Phase 5 — Admin and misc pages

Files: `public/presets.html` + `public/js/presets.js` + `public/css/presets.css` (question sets editor),
`public/taboo-packs.html` (taboo topics editor), `public/index.html` (home links), `public/_mobile-preview.html`,
`public/js/diag.js`, `public/js/qr.js`, `public/js/sfx.js`.

1. presets / taboo-packs: `ds-page` + `ds-container`; lists → library list component (add `ds-list` /
   `ds-list-item` to the library if not present, demo it on `/design`); editors → `ds-input`/textarea
   (add `ds-textarea` to the library: same look as `ds-input`, min-height, monospace not allowed — use body font);
   buttons → `ds-btn`. Validation errors → `ds-hint--error` / `ds-banner--danger`.
2. index.html: `ds-page` + `ds-center` + `ds-game-tile`-style links or `ds-btn--lg` links to Screen / Referee / Play /
   Presets / Taboo topics / Design, each with an icon.
3. `_mobile-preview.html`: a dev helper. Migrate it (tokens only) or delete it if unused (`grep -rn "_mobile-preview"`).
4. `diag.js`, `qr.js`, `sfx.js`: remove emoji and literal colors (see §3).
5. Remove all of them from LEGACY. **`LEGACY` must now be empty** — then delete the LEGACY mechanism? No: keep the
   empty Set (future-proof) and change the summary line to say «كل الشاشات على نظام التصميم».

---

## Phase 6 — Finish

1. `grep -rn "base.css\|buzzer.css\|referee.css\|screen.css\|presets.css" public` → nothing. Delete unused CSS files.
2. `npm run ds:check` → 0 legacy files, 0 violations. Full tests pass on a fresh server.
3. Server console output (`server/index.js` `console.log` lines the user sees in the black window) uses emoji —
   replace them with plain text or ASCII markers (e.g. `[TV]`, `[OK]`, `[!]`). (User rule: no emoji anywhere.)
4. Update `دليل-الاستخدام.md` and `README.md`: remove emoji, mention the design system, `/design`, `DESIGN.md`,
   `npm run ds:check`. Keep the user guide simple (non-technical Arabic).
5. Final browser pass of every page at TV and phone sizes; switch each of the 5 themes from the referee and confirm
   all screens recolor together; change a team color and confirm.
6. Commit «Design migration phase 6: cleanup». Tell the user it is ready and ask before pushing to GitHub.

---

## Appendix A — Quick component map (old → new)

| Old (legacy) | New (library) |
|---|---|
| `.btn`, `.btn-lg`, `.btn-yellow`, `.btn-green`, `.btn-danger`, `.btn-sm` | `ds-btn` + `--lg` / `--primary` / `--success` / `--danger` / `--sm` |
| `.card`, `.section-title` | `ds-card`, `ds-card-title` |
| `.toast` | `toast(text, icon)` |
| `.modal` | `ds-modal` (+ `is-open`) |
| `.conn`, `.conn-badge`, chips | `ds-pill` (`--dark`, `--team`) |
| `.buzz-banner` | `ds-banner` (+ variants) |
| `.timer-readout`, timer badge | `ds-ring` / `ds-timebar` |
| `.hex`, `.hex-fill`, `.hex-letter` (board.js) | `ds-hex`, `ds-hex-in`, `ds-hex-face`, `ds-hex-letter` |
| `.mini-board` | `ds-board` |
| `.letter-grid` | `ds-hexkeys` |
| `.q-letter-big`, `.q-text`, `.answer-box` | `ds-letter-badge`, `ds-qpanel`, `ds-answer` |
| `.lobby-*`, `.qr-box` | `ds-card` + `ds-qr` / `ds-qr-frame` |
| team-colored inline styles (`--team`, `--chip`, `--pick`) | `ds-team-a` / `ds-team-b` classes |
| winner modal / trophy | `ds-trophy`, `ds-winner`, `confetti()` |
| taboo rules list on TV | `ds-rules`, `ds-rule`, `ds-pager` (slides) |
| emoji anywhere | `ds-icon` from `/icons.svg` |

## Appendix B — Emoji → icon map (use these ids)

| Meaning | Icon id |
|---|---|
| start / play / resume | `play` |
| pause | `pause` |
| correct | `check` |
| wrong / close | `close` |
| foul / forbidden | `ban` |
| swap / another word / shuffle / move player | `swap` |
| skip | `skip` |
| undo / new game | `undo` |
| random / draw | `dice` |
| sound on / off | `volume` / `volume-off` |
| fullscreen | `fullscreen` |
| TV / phone / QR | `tv` / `phone` / `qr` |
| internet / Wi-Fi | `globe` / `wifi` |
| settings | `sliders` |
| show / eye | `eye` |
| colors / theme | `palette` |
| winner / night points | `trophy` (or `crown`) |
| timer | `timer` |
| target score | `target` |
| first press / speed | `bolt` |
| buzzer | `bell` |
| games / menu | `gamepad` |
| letters game | `hexagon` |
| taboo game | `hush` |
| speak / chat | `chat` |
| announce / shout | `megaphone` |
| thinking / question | `question` |
| celebration | `party` |
| players / one player / referee | `users` / `user` / `judge` |
| warning / info | `warning` / `info` |
| rules | `scroll` |
| food topic (taboo) | `food` |
| hint / sparkle | `sparkle` |

Taboo topics need one icon each (10 topics in `presets/الكلمة_الممنوعة/*.tsv`, first line `# أيقونة: X`
holds an emoji today). Replace that mechanism: map each topic to an icon id (add missing symbols to `icons.svg`:
house, briefcase, map-pin, ball, paw, film, chip, calendar/gift, cube) and store `# أيقونة: <icon-id>` in the TSV
files; update `server/taboo-packs.js` to accept icon ids (validate against ids in `icons.svg`) and the UIs to render
`icon(id)`. The topic editor (`taboo-packs.html`) offers an icon picker (grid of icons) instead of an emoji field.
