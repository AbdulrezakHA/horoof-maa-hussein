/**
 * محرّك ثيمات نظام التصميم — المصدر الوحيد لكل ألوان الألعاب.
 *
 * الثيم = بضعة ألوان أساسية فقط. كل الدرجات تُحسب من كل لون أساسي تلقائياً (في فضاء OKLab):
 *   hi   = لمعة الوجه (أفتح)
 *   side = جدار الزر / الظل الملوّن (أغمق، بنفس التشبّع)
 *   ink  = لون النص فوقه (حبر داكن أو ورق فاتح، الأوضح)
 *
 * الاستعمال في المتصفح:
 *   import { applyTheme, applyTeams } from "/shared/ds-theme.js";
 *   applyTheme("ramadan");                          // يغيّر كل الألعاب معاً
 *   applyTeams({ a: "#6965ae", b: "#4b9cbf" });     // ألوان الفرق التي اختارها الحكم
 *
 * القيم الافتراضية في ds.css (بين علامتي @theme) تُولَّد من هنا:
 *   node scripts/gen-ds-theme.mjs
 * فلا تُعدَّل ألوان ds.css يدوياً أبداً — يُعدَّل هذا الملف ثم يُعاد التوليد.
 */
import { toOklab, fromOklab, contrastRatio } from "./colors.js";

/** ألوان ثابتة في كل الثيمات (حبر الحدود والورق). */
export const INK = "#1d1235";
export const PAPER = "#fff8ea";

/** الألوان الأساسية لكل ثيم. المفاتيح نفسها في COLOR_THEMES (shared/colors.js). */
export const DS_THEMES = {
  hussein: {
    name: "سهرة الألعاب",
    stage: "#241a3f",
    sun: "#ffd23f",
    mint: "#2fd49f",
    coral: "#ff6b57",
    sky: "#4cc9f0",
    grape: "#a86cf0",
    bubble: "#ff8fc8",
    cream: "#cfc694",
    teams: { a: "#6965ae", b: "#4b9cbf" },
  },
  night: {
    name: "ليلي",
    stage: "#101a33",
    sun: "#f5a623",
    mint: "#33d6a4",
    coral: "#ff5c74",
    sky: "#3fc4ea",
    grape: "#9a7cf2",
    bubble: "#ff86c0",
    cream: "#2c4370",
    teams: { a: "#e94560", b: "#1fb5d6" },
  },
  classic: {
    name: "كلاسيكي",
    stage: "#3b1a5e",
    sun: "#ffd93d",
    mint: "#3ccf8e",
    coral: "#ff7058",
    sky: "#56c6f2",
    grape: "#b07cf5",
    bubble: "#ff92c9",
    cream: "#f3ead0",
    teams: { a: "#2fa55a", b: "#f0872b" },
  },
  ramadan: {
    name: "رمضاني",
    stage: "#14213b",
    sun: "#e8b031",
    mint: "#2cc39a",
    coral: "#e8604c",
    sky: "#49b8d8",
    grape: "#9b74d6",
    bubble: "#f08bb7",
    cream: "#efdcae",
    teams: { a: "#0f8b6c", b: "#c0392b" },
  },
  candy: {
    name: "زاهي",
    stage: "#4a1f73",
    sun: "#ffb020",
    mint: "#2ee0a8",
    coral: "#ff5f6d",
    sky: "#4fc3ff",
    grape: "#b26bff",
    bubble: "#ff7ab6",
    cream: "#fff0cc",
    teams: { a: "#ff4f8b", b: "#3b82f6" },
  },
};
export const DEFAULT_THEME = "hussein";

/** الألوان التي تُشتقّ لها درجات (hi / side / ink). */
export const PLAY_COLORS = ["sun", "mint", "coral", "sky", "grape", "bubble"];

const clampL = (L) => Math.min(0.98, Math.max(0.06, L));
function shift(hex, dL, chroma = 1) {
  const o = toOklab(hex);
  return fromOklab({ L: clampL(o.L + dL), a: o.a * chroma, b: o.b * chroma });
}

/** الحبر فوق لون: ورق فاتح ما دام واضحاً (أجمل فوق الألوان المشبعة)، وإلا حبر داكن — نفس قاعدة inkFor في اللعبة. */
export function inkOn(bg) {
  const paper = contrastRatio(bg, PAPER);
  return paper >= 2.5 || paper >= contrastRatio(bg, INK) ? PAPER : INK;
}

/** درجات لون أساسي: اللمعة، والجدار، والحبر فوقه. */
export function shades(base) {
  const ink = inkOn(base);
  // ظل النص: لمعة بيضاء تحت النص الداكن، وظل داكن تحت النص الفاتح
  const glow = ink === PAPER ? "rgba(29, 18, 53, 0.35)" : "rgba(255, 255, 255, 0.55)";
  return { base, hi: shift(base, 0.1, 0.75), side: shift(base, -0.17, 1.05), ink, glow };
}

/** متغيّرات CSS الكاملة لثيم (اسم أو كائن). */
export function themeVars(themeOrName = DEFAULT_THEME) {
  const t = typeof themeOrName === "string" ? DS_THEMES[themeOrName] || DS_THEMES[DEFAULT_THEME] : themeOrName;
  const v = {};
  // المسرح: الخلفية وطبقتان أفتح قليلاً
  v["--stage"] = t.stage;
  v["--stage-2"] = shift(t.stage, 0.06);
  v["--stage-3"] = shift(t.stage, 0.14);
  // ألوان اللعب
  for (const k of PLAY_COLORS) {
    const s = shades(t[k]);
    v[`--${k}`] = s.base;
    v[`--${k}-hi`] = s.hi;
    v[`--${k}-side`] = s.side;
    v[`--${k}-ink`] = s.ink;
    v[`--${k}-glow`] = s.glow;
  }
  // خلايا الحروف: فاتح في الأعلى، أغمق في الأسفل، والحرف بنفس درجة اللون (زيتوني فوق الكريمي)
  const lightCell = inkOn(t.cream) === INK;
  v["--cream"] = t.cream;
  v["--cream-hi"] = shift(t.cream, lightCell ? 0.12 : 0.08, 0.75);
  v["--cream-side"] = shift(t.cream, -0.12);
  v["--cream-ink"] = lightCell ? shift(t.cream, -0.42, 0.9) : shift(t.cream, 0.55, 0.4);
  // وجه لوحة السؤال (يحدّده الحكم؛ الافتراضي الورق)
  const ps = shades(t.panel || PAPER);
  v["--panel"] = ps.base;
  v["--panel-hi"] = ps.hi;
  v["--panel-side"] = ps.side;
  v["--panel-ink"] = ps.ink;
  v["--panel-glow"] = ps.glow;
  Object.assign(v, teamVars(t.teams));
  return v;
}

/** متغيّرات الفريقين (من ألوان يختارها الحكم أو من الثيم). */
export function teamVars(teams = DS_THEMES[DEFAULT_THEME].teams) {
  const v = {};
  for (const k of ["a", "b"]) {
    const s = shades(teams[k]);
    v[`--team-${k}`] = s.base;
    v[`--team-${k}-hi`] = s.hi;
    v[`--team-${k}-side`] = s.side;
    v[`--team-${k}-ink`] = s.ink;
    v[`--team-${k}-glow`] = s.glow;
  }
  return v;
}

/** يطبّق متغيّرات على عنصر (افتراضياً الصفحة كلها). */
export function applyVars(vars, el = globalThis.document?.documentElement) {
  if (!el) return;
  for (const [k, val] of Object.entries(vars)) el.style.setProperty(k, val);
}

/** يطبّق ثيماً كاملاً. */
export function applyTheme(nameOrTheme, el) {
  applyVars(themeVars(nameOrTheme), el);
}

/** يطبّق ألوان الفريقين فقط. */
export function applyTeams(teams, el) {
  applyVars(teamVars(teams), el);
}

/** نص كتلة :root لـ ds.css (يستعمله مولّد الثيم). */
export function cssBlock(name = DEFAULT_THEME) {
  return Object.entries(themeVars(name))
    .map(([k, val]) => `  ${k}: ${val};`)
    .join("\n");
}

/** ثيم كامل من حالة اللعبة: الثيم الأساسي + تعديلات الحكم + ألوان الفريقين. */
export function themeFromState(state) {
  const base = DS_THEMES[state?.theme?.ds] || DS_THEMES[DEFAULT_THEME];
  const t = state?.theme || {};
  return {
    ...base,
    cream: t.cellColor || base.cream, // خلايا الحروف الفارغة
    sun: t.selectedColor || base.sun, // الخلية المختارة + الإجراء الأساسي
    panel: t.bgColor || PAPER, // وجه لوحة السؤال (يعدّله الحكم)
    teams: { a: state?.teams?.a?.color || base.teams.a, b: state?.teams?.b?.color || base.teams.b },
  };
}

/** يطبّق كل ألوان الحالة (ينادى عند كل تحديث؛ رخيص). */
export function applyGameColors(state, el) {
  applyVars(themeVars(themeFromState(state)), el);
}

/** لونان عشوائيان متباعدان للفريقين (متقابلان على دائرة الألوان، بنفس السطوع). */
export function randomTeamColors(rng = Math.random) {
  const h = rng() * Math.PI * 2;
  const at = (hue) => fromOklab({ L: 0.62, a: 0.15 * Math.cos(hue), b: 0.15 * Math.sin(hue) });
  return { a: at(h), b: at(h + Math.PI * (0.8 + rng() * 0.4)) };
}
