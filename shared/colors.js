/**
 * نظام الألوان الذكي — منطق خالص مشترك بين الخادم والمتصفح.
 *
 *  - inkFor(bg): يختار لون الكتابة الأوضح (أبيض أو داكن) فوق أي خلفية.
 *  - colorDistance(a, b): مدى اختلاف لونين كما تراه العين (ΔE في فضاء OKLab).
 *  - findClashes(teams, theme): يكتشف الألوان المتقاربة جداً التي ستختلط على الشاشة.
 *  - fixClash(...): يقترح لوناً بديلاً قريباً من الأصل لكنه واضح التمييز.
 */

export const INK_LIGHT = "#ffffff";
export const INK_DARK = "#1b1b1f";

/* ------------------------------------------------------------------ */
/*  تحويلات أساسية                                                     */
/* ------------------------------------------------------------------ */

/** "#abc" | "#aabbcc" | "#aabbccdd" → { r, g, b } (0..255) أو null. */
export function parseHex(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

/** السطوع النسبي حسب WCAG (0 = أسود، 1 = أبيض). */
export function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** نسبة التباين بين لونين حسب WCAG (1..21). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * لون الكتابة الأوضح فوق خلفية معيّنة: أبيض أو داكن، أيّهما أعلى تباناً.
 * نميل قليلاً للأبيض (أجمل فوق الألوان المشبعة) ما دام واضحاً بما يكفي.
 */
export function inkFor(bg) {
  const white = contrastRatio(bg, INK_LIGHT);
  const dark = contrastRatio(bg, INK_DARK);
  // الحروف على الشاشة ضخمة وعريضة، فتباين 2.5 كافٍ للأبيض ويبقى أجمل فوق الألوان الزاهية
  return white >= 2.5 || white >= dark ? INK_LIGHT : INK_DARK;
}

/** هل الخلفية فاتحة (تحتاج كتابة داكنة)؟ */
export function isLight(bg) {
  return inkFor(bg) === INK_DARK;
}

/** يمزج لونين (t = 0 → a، t = 1 → b). */
export function mix(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/* ------------------------------------------------------------------ */
/*  OKLab / OKLCH — فضاء لوني يطابق إدراك العين                          */
/* ------------------------------------------------------------------ */

export function toOklab(hex) {
  const c = parseHex(hex) || { r: 0, g: 0, b: 0 };
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function fromOklab({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toHex({
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

function toOklch(hex) {
  const { L, a, b } = toOklab(hex);
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
}

function fromOklch({ L, C, h }) {
  return fromOklab({ L, a: C * Math.cos(h), b: C * Math.sin(h) });
}

/** مدى اختلاف لونين كما تراه العين (0 = متطابقان، ~0.1 = مختلفان بوضوح). */
export function colorDistance(a, b) {
  const x = toOklab(a);
  const y = toOklab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/* ------------------------------------------------------------------ */
/*  كشف التعارض                                                        */
/* ------------------------------------------------------------------ */

/**
 * الأزواج التي يجب أن تبقى مميّزة على الشاشة.
 *  - first/second: مفتاحا اللونين (team.a | team.b | cellColor | selectedColor | bgColor)
 *  - fix: أي اللونين نعدّله تلقائياً (الأقل أهمية للّاعبين)
 *  - min: أقل مسافة مقبولة (الفريقان يحتاجان أوضح فرق)
 */
export const CLASH_RULES = [
  { first: "team.a", second: "team.b", fix: "team.b", min: 0.14, msg: "لونا الفريقين متقاربان جداً — لن يُميّز اللاعبون خلايا كل فريق" },
  { first: "team.a", second: "cellColor", fix: "cellColor", min: 0.1, msg: "لون الفريق الأول قريب من لون الخلايا الحرّة" },
  { first: "team.b", second: "cellColor", fix: "cellColor", min: 0.1, msg: "لون الفريق الثاني قريب من لون الخلايا الحرّة" },
  { first: "team.a", second: "selectedColor", fix: "selectedColor", min: 0.1, msg: "لون الفريق الأول قريب من لون الحرف المختار" },
  { first: "team.b", second: "selectedColor", fix: "selectedColor", min: 0.1, msg: "لون الفريق الثاني قريب من لون الحرف المختار" },
  { first: "cellColor", second: "selectedColor", fix: "selectedColor", min: 0.1, msg: "لون الحرف المختار قريب من لون الخلايا الحرّة — لن يظهر التحديد" },
  { first: "team.a", second: "bgColor", fix: "bgColor", min: 0.06, msg: "لون خلفية لوحة السؤال قريب من لون الفريق الأول" },
  { first: "team.b", second: "bgColor", fix: "bgColor", min: 0.06, msg: "لون خلفية لوحة السؤال قريب من لون الفريق الثاني" },
];

/** يقرأ لوناً من الفرق/الثيم بمفتاح مثل "team.a" أو "cellColor". */
export function pickColor(teams, theme, key) {
  if (key === "team.a") return teams?.a?.color;
  if (key === "team.b") return teams?.b?.color;
  return theme?.[key];
}

/** أسماء مفهومة لكل لون (لرسائل الحكم). */
export const COLOR_LABELS = {
  "team.a": "لون الفريق الأول",
  "team.b": "لون الفريق الثاني",
  cellColor: "لون الخلايا الحرّة",
  selectedColor: "لون الحرف المختار",
  bgColor: "خلفية لوحة السؤال",
};

/** يعيد قائمة التعارضات الحالية (فارغة = كل شيء واضح). */
export function findClashes(teams, theme) {
  const out = [];
  for (const rule of CLASH_RULES) {
    const x = pickColor(teams, theme, rule.first);
    const y = pickColor(teams, theme, rule.second);
    if (!parseHex(x) || !parseHex(y)) continue;
    const d = colorDistance(x, y);
    if (d < rule.min) out.push({ ...rule, distance: d, colors: [x, y] });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  الإصلاح التلقائي                                                   */
/* ------------------------------------------------------------------ */

/**
 * يبحث عن أقرب لون للأصل يبتعد بما يكفي عن كل الألوان «المحمية».
 * يجرّب أولاً تغيير الإضاءة (يبقى نفس اللون تقريباً)، ثم تدوير درجة اللون.
 */
export function separateColor(color, avoid, min, { preferHue = false } = {}) {
  const base = toOklch(color);
  const ok = (hex) => avoid.every((c) => colorDistance(hex, c) >= min);
  if (ok(color)) return color;

  const candidates = [];
  // ١) تغيير الإضاءة فقط
  for (let step = 1; step <= 14; step++) {
    for (const dir of [1, -1]) {
      const L = base.L + dir * step * 0.035;
      if (L < 0.18 || L > 0.96) continue;
      candidates.push({ hex: fromOklch({ ...base, L }), cost: step });
    }
  }
  // ١ب) ألوان الخلفيات (الخلايا الحرّة/لوحة السؤال) تميل للحياد: نفس الدرجة بتشبّع أقل
  if (!preferHue) {
    for (let step = 0; step <= 14; step++) {
      for (const dir of [1, -1]) {
        const L = base.L + dir * step * 0.035;
        if (L < 0.18 || L > 0.96) continue;
        candidates.push({ hex: fromOklch({ ...base, L, C: base.C * 0.25 }), cost: step + 0.5 });
      }
    }
  }
  // ٢) تدوير درجة اللون (مع إضاءة متوسطة مريحة)
  for (let step = 1; step <= 11; step++) {
    for (const dir of [1, -1]) {
      const h = base.h + dir * step * (Math.PI / 12);
      const C = Math.max(base.C, 0.09);
      candidates.push({ hex: fromOklch({ L: base.L, C, h }), cost: (preferHue ? 0 : 6) + step });
    }
  }
  candidates.sort((p, q) => p.cost - q.cost);
  for (const c of candidates) if (ok(c.hex)) return c.hex;
  return color;
}

/**
 * يُصلح كل التعارضات دفعة واحدة ويعيد التغييرات المطلوبة:
 * { teams: { a?: color, b?: color }, theme: { key: color } }
 * الألوان المُعدّلة تحاول الابتعاد عن **كل** الألوان المرتبطة بها، لا عن لون واحد فقط.
 */
export function autoFixColors(teams, theme) {
  const t = { a: teams?.a?.color, b: teams?.b?.color };
  const th = { ...(theme || {}) };
  const get = (key) => (key === "team.a" ? t.a : key === "team.b" ? t.b : th[key]);
  const set = (key, val) => {
    if (key === "team.a") t.a = val;
    else if (key === "team.b") t.b = val;
    else th[key] = val;
  };

  const changed = new Set();
  // جولات متكررة: إصلاح لون قد يكشف تعارضاً آخر
  for (let round = 0; round < 4; round++) {
    const clashes = findClashes({ a: { color: t.a }, b: { color: t.b } }, th);
    if (!clashes.length) break;
    for (const c of clashes) {
      const key = c.fix;
      const rules = CLASH_RULES.filter((r) => r.first === key || r.second === key);
      const avoid = [];
      let min = c.min;
      for (const r of rules) {
        const other = r.first === key ? r.second : r.first;
        const col = get(other);
        if (parseHex(col)) avoid.push(col);
        min = Math.max(min, r.min);
      }
      // لون الفريق يتغيّر بدرجة اللون (أحمر ← أزرق) لا بالإضاءة فقط، ليبقى الفريقان مميّزين بوضوح
      const next = separateColor(get(key), avoid, min, { preferHue: key.startsWith("team.") });
      if (next !== get(key)) {
        set(key, next);
        changed.add(key);
      }
    }
  }

  const out = { teams: {}, theme: {} };
  for (const key of changed) {
    if (key === "team.a") out.teams.a = t.a;
    else if (key === "team.b") out.teams.b = t.b;
    else out.theme[key] = th[key];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  قوالب ألوان جاهزة (مُختبرة: بلا تعارض وبكتابة واضحة)                  */
/* ------------------------------------------------------------------ */

export const COLOR_THEMES = {
  hussein: {
    name: "حروف مع حسين (الأصلي)",
    teams: { a: "#6965ae", b: "#4b9cbf" },
    theme: { bgColor: "#2f6f9e", cellColor: "#ede5bb", selectedColor: "#fcb017" },
  },
  night: {
    name: "ليلي",
    teams: { a: "#e94560", b: "#1fb5d6" },
    theme: { bgColor: "#16213e", cellColor: "#2a3f66", selectedColor: "#f5a623" },
  },
  classic: {
    name: "كلاسيكي",
    teams: { a: "#2fa55a", b: "#f0872b" },
    theme: { bgColor: "#3b1a5e", cellColor: "#fdf8ec", selectedColor: "#ffd93d" },
  },
  ramadan: {
    name: "رمضاني",
    teams: { a: "#0f8b6c", b: "#c0392b" },
    theme: { bgColor: "#1d2a44", cellColor: "#f6e7c1", selectedColor: "#e0a526" },
  },
  candy: {
    name: "زاهي",
    teams: { a: "#ff4f8b", b: "#3b82f6" },
    theme: { bgColor: "#5b2a86", cellColor: "#fff3d6", selectedColor: "#ffb020" },
  },
};
