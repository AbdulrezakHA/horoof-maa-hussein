/* ==================================================================
   اللوحة المصغّرة عند الحكم — خلايا مكتبة نظام التصميم (ds-hex) داخل ds-board
   الهندسة من محرّك اللعبة (cellCenter): الصفوف الزوجية مزيحة نصف خلية، والخلايا متلاصقة.
   ================================================================== */
import { replay } from "/js/ds.js";

/**
 * ينشئ شبكة الخلايا داخل عنصر.
 * @param {HTMLElement} root العنصر الحاوي (يصبح ds-board)
 * @param {object} board إعدادات اللوحة
 * @param {object} opts
 * @param {boolean} opts.interactive الخلايا أزرار قابلة للنقر
 * @param {(id:string)=>void} [opts.onSelect]
 * @returns {{update:(state:object)=>void, animateClaim:(id:string)=>void, destroy:()=>void, fit:()=>void, cells:Map}}
 */
export function createBoard(root, board, opts = {}) {
  const cols = board.cols || 5;
  const rows = board.rows || 5;
  const maxHw = opts.maxWidth || 74; // أكبر عرض للخلية بالبكسل

  root.classList.add("ds-board");
  const grid = document.createElement("div");
  grid.className = "ds-board-grid";
  root.appendChild(grid);

  const cells = new Map();
  for (const cell of board.cells) {
    const hex = document.createElement(opts.interactive ? "button" : "div");
    hex.className = "ds-hex";
    if (opts.interactive) hex.type = "button";
    hex.dataset.id = cell.id;
    hex.innerHTML = `<div class="ds-hex-in"><div class="ds-hex-face"><span class="ds-hex-letter"></span></div></div>`;
    const letter = hex.querySelector(".ds-hex-letter");
    letter.textContent = cell.letter;
    if (opts.interactive && opts.onSelect) hex.addEventListener("click", () => opts.onSelect(cell.id));
    grid.appendChild(hex);
    cells.set(cell.id, { hex, letter, r: cell.r, c: cell.c });
  }

  /** يحسب عرض الخلية من عرض الحاوية ثم يضع الخلايا ملتصقة (تداخل بسماكة الحدّ). */
  function fit() {
    const host = root.parentElement || root;
    const avail = host.clientWidth;
    if (!avail) return;
    // عرض اللوحة الكلي ≈ 6.51 × عرض الخلية (٥ أعمدة ونصف + حشوة جانبية) + حدّان
    const hw = Math.max(34, Math.min(maxHw, Math.floor((avail - 12) / ((cols + 0.5) * 0.965 + 1.2))));
    root.style.setProperty("--hw", `${hw}px`);
    const hh = hw * 1.1547;
    const g = -hw * 0.035;
    const step = hh * 0.75 + g;
    grid.style.width = `${(cols + 0.5) * (hw + g)}px`;
    grid.style.height = `${(rows - 1) * step + hh}px`;
    for (const c of cells.values()) {
      c.hex.style.left = `${c.c * (hw + g) + (c.r % 2 === 0 ? (hw + g) / 2 : 0)}px`;
      c.hex.style.top = `${c.r * step}px`;
    }
  }

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => fit()).observe(root.parentElement || root);
  window.addEventListener("resize", fit);
  fit();
  setTimeout(fit, 80);
  setTimeout(fit, 400);

  let owners = null;

  function update(state) {
    for (const [id, els] of cells) {
      const cell = state.cells[id];
      if (!cell) continue;
      const owner = cell.owner;
      const isSelected = state.current.cellId === id;

      els.hex.classList.toggle("is-a", owner === "a");
      els.hex.classList.toggle("is-b", owner === "b");
      els.hex.classList.toggle("is-selected", isSelected);

      if (els.letter.textContent !== cell.letter) {
        els.letter.textContent = cell.letter;
        replay(els.letter, "ds-pop-in");
      }
      if (owners && owner && owners[id] !== owner) animateClaim(id);
    }
    owners = Object.fromEntries(Object.entries(state.cells).map(([id, c]) => [id, c.owner]));
  }

  /** حركة التقاط الخلية. */
  function animateClaim(id) {
    const els = cells.get(id);
    if (els) replay(els.hex, "is-claim");
  }

  function destroy() {
    grid.remove();
  }

  return { update, animateClaim, destroy, fit, cells };
}
