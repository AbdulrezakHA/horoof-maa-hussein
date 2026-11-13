/* ==================================================================
   رسم شبكة الخلية (hex grid) — مشترك بين الشاشة والحكم
   ================================================================== */

import { cellCenter, hexMetrics, neighborsOf, cellId } from "/shared/engine.js";

/**
 * ينشئ شبكة الخلايا داخل عنصر.
 * @param {HTMLElement} root العنصر الحاوي
 * @param {object} board إعدادات اللوحة
 * @param {object} opts
 * @param {number} opts.width عرض الخلية المنطقي بالبكسل
 * @param {boolean} opts.interactive，允许 التفاعل بالنقر
 * @param {(id:string)=>void} [opts.onSelect]
 * @returns {{update:(state:object)=>void, destroy:()=>void, logicalSize:{w:number,h:number}}}
 */
export function createBoard(root, board, opts = {}) {
  const width = opts.width || 120;
  const { w, h, rowStep } = hexMetrics(width);
  const cols = board.cols || 5;
  const rows = board.rows || 5;

  const logicalW = (cols + 0.5) * w;
  const logicalH = (rows - 1) * rowStep + h;

  root.classList.add("board-root");
  root.style.setProperty("--cell-w", `${w}px`);
  root.style.setProperty("--cell-h", `${h}px`);

  const layer = document.createElement("div");
  layer.className = "board-layer";
  layer.style.width = `${logicalW}px`;
  layer.style.height = `${logicalH}px`;
  root.appendChild(layer);

  // زخرفة الخلفية: شبه منحرف علوي وسفلي للفريق أ (ربط أعلى بأسفل)، وجوانب للفريق ب (يمين بيسار)
  const deco = document.createElement("div");
  deco.className = "board-deco";
  deco.innerHTML = `
    <div class="deco-trapezoid deco-top"></div>
    <div class="deco-trapezoid deco-bottom"></div>
    <div class="deco-label deco-lbl-top">أعلى</div>
    <div class="deco-label deco-lbl-bottom">أسفل</div>
    <div class="deco-label deco-lbl-left">يمين</div>
    <div class="deco-label deco-lbl-right">يسار</div>
  `;
  layer.appendChild(deco);

  const cells = new Map();

  for (const cell of board.cells) {
    const { x, y } = cellCenter(cell.r, cell.c, width);

    const halo = document.createElement("div");
    halo.className = "hex-halo";
    halo.style.left = `${x}px`;
    // cellCenter يعيد مركز الخلية عمودياً، بينما العنصر يتموضع من أعلاه.
    halo.style.top = `${y - h / 2}px`;
    halo.style.width = `${w}px`;
    halo.style.height = `${h}px`;
    layer.appendChild(halo);

    const hex = document.createElement(opts.interactive ? "button" : "div");
    hex.className = "hex";
    hex.dataset.id = cell.id;
    hex.type = "button";
    hex.style.left = `${x}px`;
    hex.style.top = `${y - h / 2}px`;
    hex.style.width = `${w}px`;
    hex.style.height = `${h}px`;

    const fill = document.createElement("span");
    fill.className = "hex-fill";

    const shine = document.createElement("span");
    shine.className = "hex-shine";
    fill.appendChild(shine);

    const letter = document.createElement("span");
    letter.className = "hex-letter";
    letter.textContent = cell.letter;
    fill.appendChild(letter);

    hex.appendChild(fill);
    layer.appendChild(hex);

    if (opts.interactive && opts.onSelect) {
      hex.addEventListener("click", () => opts.onSelect(cell.id));
    }

    cells.set(cell.id, { hex, halo, fill, letter });
  }

  let lastState = null;

  /* ---------------- ضبط الحجم تلقائياً ---------------- */
  // نعتمد على ResizeObserver ونداءات مباشرة بدل requestAnimationFrame،
  // لأن rAF لا يعمل في التبويبات المخفية (شاشة العرض قد تكون على جهاز آخر).
  const logical = { w: logicalW, h: logicalH };
  const padding = opts.padding ?? 14;
  const maxScale = opts.maxScale ?? 2.2;
  const fit = () => fitBoard(root, layer, logical, padding, maxScale);

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => fit());
    ro.observe(root);
  }
  window.addEventListener("resize", fit);
  fit();
  setTimeout(fit, 80);
  setTimeout(fit, 400);

  function update(state) {
    lastState = state;
    // ألوان الفريقين والثيم تُدار من لوحة الحكم وتُحدّث فوراً
    root.style.setProperty("--team-a-color", state.teams.a.color);
    root.style.setProperty("--team-b-color", state.teams.b.color);

    if (state.theme) {
      root.style.setProperty("--bg-color", state.theme.bgColor || "#73c4ee");
      root.style.setProperty("--cell-color", state.theme.cellColor || "#ede5bb");
      root.style.setProperty("--cell-text-color", state.theme.cellTextColor || "#635e48");
      root.style.setProperty("--selected-color", state.theme.selectedColor || "#fcb017");
      root.style.setProperty("--selected-text-color", state.theme.selectedTextColor || "#ffffff");
      document.documentElement.style.setProperty("--bg-color", state.theme.bgColor || "#73c4ee");
    }

    for (const [id, els] of cells) {
      const cell = state.cells[id];
      if (!cell) continue;

      const owner = cell.owner;
      const isSelected = state.current.cellId === id;

      els.hex.classList.toggle("owner-a", owner === "a");
      els.hex.classList.toggle("owner-b", owner === "b");
      els.hex.classList.toggle("is-selected", isSelected);
      els.halo.classList.toggle("is-selected", isSelected);
      els.halo.classList.toggle("owner-a", owner === "a");
      els.halo.classList.toggle("owner-b", owner === "b");

      if (els.letter.textContent !== cell.letter) {
        els.letter.textContent = cell.letter;
        els.letter.classList.remove("anim-pop");
        void els.letter.offsetWidth;
        els.letter.classList.add("anim-pop");
        clearTimeout(els.letter._animTimer);
        els.letter._animTimer = setTimeout(() => els.letter.classList.remove("anim-pop"), 500);
      }

      if (isSelected) {
        els.halo.style.background =
          owner === "a" ? state.teams.a.color :
          owner === "b" ? state.teams.b.color :
          "rgba(255, 217, 61, .8)";
      } else {
        // نمسح لون الهالة السابق عند الانتقال إلى خلية أخرى.
        els.halo.style.background = "";
      }
    }
  }

  /** تشغيل حركة التقاط الخلية. */
  function animateClaim(id) {
    const els = cells.get(id);
    if (!els) return;
    els.hex.classList.remove("just-claimed");
    void els.hex.offsetWidth;
    els.hex.classList.add("just-claimed");
    clearTimeout(els.hex._animTimer);
    els.hex._animTimer = setTimeout(() => els.hex.classList.remove("just-claimed"), 700);
  }

  function destroy() {
    layer.remove();
  }

  return { update, animateClaim, destroy, fit, logicalSize: logical, cells, maxScale };
}

/**
 * يضبط تكبير اللوحة لملاءمة الحاوية مع الحفاظ على النسب.
 * نضع الطبقة بإحداثيات بكسل صريحة بدل الاعتماد على translate + scale معاً،
 * لأن تفاعلهما مع transform-origin يسبّب إزاحة غير متوقّعة.
 */
export function fitBoard(root, layer, logical, padding = 16, maxScale = 2.2) {
  if (!root || !layer) return;
  const rect = root.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scale = Math.min(
    (rect.width - padding * 2) / logical.w,
    (rect.height - padding * 2) / logical.h
  );
  const k = Math.max(0.15, Math.min(scale, maxScale));

  layer.style.transformOrigin = "top left";
  layer.style.transform = `scale(${k})`;
  layer.style.left = `${Math.max(0, (rect.width - logical.w * k) / 2)}px`;
  layer.style.top = `${Math.max(0, (rect.height - logical.h * k) / 2)}px`;
  return k;
}

/** يُرجع المعرّفات المجاورة لخلية (مفيد لعرض Karate-chords). */
export function neighborIds(r, c) {
  return neighborsOf(r, c).map(([rr, cc]) => cellId(rr, cc));
}
