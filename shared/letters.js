/*!
 * تطبيع الحروف العربية — مشترك بين الخادم والمتصفّح.
 *
 * الهدف: كل جواب يُنسب تلقائياً إلى أحد الحروف الـ28 الأساسية،
 * فيكفي أن يكتب المستخدم السؤال والجواب ويترك الباقي للعبة.
 *
 * مثال:
 *   letterOfAnswer("الكرة")        -> "ك"   (نُزع "ال" التعريف)
 *   letterOfAnswer("أموكسيسيلين")  -> "ا"   (أ -> ا)
 *   letterOfAnswer("مُحَمَّد")      -> "م"   (التشكيل يُنزع)
 *   letterOfAnswer("لؤلؤة")        -> "ل"
 */

/** الحروف الأساسية الـ28 بالترتيب المعتمد في اللعبة. */
export const BASE_LETTERS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ",
  "د", "ذ", "ر", "ز", "س", "ش",
  "ص", "ض", "ط", "ظ", "ع", "غ",
  "ف", "ق", "ك", "ل", "م", "ن",
  "ه", "و", "ي",
];

const BASE_SET = new Set(BASE_LETTERS);

/* التشكيل والتطويل والعلامات الصفرية */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** إعادة كل أشكال الحرف الواحد إلى حرفه الأساسي. */
const CHAR_MAP = {
  /* ألف بهمزة أو بدونها أو بألف ممدودة */
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ٲ": "ا", "ٳ": "ا", "ٵ": "ا",
  /* همزة مفردة */
  "ء": "ا", "ٴ": "ا",
  /* واو بهمزة */
  "ؤ": "و", "ٶ": "و", "ۄ": "و", "ۆ": "و", "ۇ": "و", "ۈ": "و", "ۉ": "و", "ۋ": "و",
  /* ياء بأشكالها */
  "ى": "ي", "ئ": "ي", "ی": "ي", "ێ": "ي", "ې": "ي", "ۑ": "ي", "ے": "ي", "ىٰ": "ي",
  /* تاء مربوطة وهاء */
  "ة": "ه", "ہ": "ه", "ھ": "ه", "ۂ": "ه", "ۃ": "ه",
  /* كاف */
  "ک": "ك", "ڪ": "ك", "ڬ": "ك", "ڭ": "ك",
  /* حروف فارسية/أوردية شائعة في الأسماء */
  "گ": "ك", "پ": "ب", "چ": "ج", "ژ": "ز", "ڤ": "ف", "ڨ": "ق", "ڕ": "ر", "ڵ": "ل", "ڼ": "ن", "ښ": "ش",
};

/** بادئات "أل" التعريف المشكّلة أو المسبوقة بحرف جرّ. */
const PREFIXES = ["وبال", "وكال", "وفال", "ولل", "وال", "بال", "كال", "فال", "لال", "لل", "ال"];

const LEADING_JUNK = /^[^\u0621-\u064A\u0660-\u0669\u06F0-\u06F9A-Za-z]+/;

/** تنظيف عام: بلا تشكيل ولا تطويل ولا محارف صفرية. */
export function cleanText(s) {
  if (typeof s !== "string") return "";
  return s.replace(ZERO_WIDTH, "").replace(DIACRITICS, "").replace(TATWEEL, "").trim();
}

/** هل المحرف (بعد التطبيع) حرف أساسي؟ */
export function toBaseLetter(ch) {
  if (!ch) return "";
  const mapped = CHAR_MAP[ch] || ch;
  return BASE_SET.has(mapped) ? mapped : "";
}

export function isBaseLetter(ch) {
  return BASE_SET.has(ch);
}

/** إزالة "ال" التعريف ولواحقها من بداية الكلمة. */
export function stripPrefixes(s) {
  let out = s;
  for (let guard = 0; guard < 4; guard++) {
    let changed = false;
    for (const p of PREFIXES) {
      if (out.length > p.length + 1 && out.startsWith(p)) {
        out = out.slice(p.length);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * الحرف الذي ينتمي إليه الجواب.
 * @returns {string} حرف من BASE_LETTERS، أو "" إذا تعذّر الاستنتاج.
 */
export function letterOfAnswer(answer) {
  let s = cleanText(answer);
  if (!s) return "";
  s = s.replace(LEADING_JUNK, "").trim();
  if (!s) return "";

  /* 1) نزع "ال" التعريف — قبل التطبيع حتى لا يلتبس أ/ا */
  const stripped = stripPrefixes(s);
  const first = toBaseLetter(stripped[0]);
  if (first) return first;

  /* 2) كما هو، بلا نزع بادئة */
  const raw = toBaseLetter(s[0]);
  if (raw) return raw;

  /* 3) أول حرف أساسي في الكلمة (يتجاوز أرقاماً أو لاتينياً في البداية) */
  for (const ch of s) {
    const base = toBaseLetter(ch);
    if (base) return base;
  }
  return "";
}

/** مفتاح مقارنة لمنع تكرار الأسئلة بين المجموعات. */
export function dedupKey(text) {
  return cleanText(text)
    .replace(/\s+/g, " ")
    .replace(/[«»"'`،,.:؛;!?؟()[\]{}]/g, "")
    .toLowerCase();
}

/** أشكال الحرف المقبولة على اللوحة وتقابلها في البنك. */
export const BOARD_ALIASES = {
  "أ": "ا", "إ": "ا", "آ": "ا", "ء": "ا",
  "ؤ": "و", "ئ": "ي", "ى": "ي", "ة": "ه",
};

export default {
  BASE_LETTERS,
  cleanText,
  toBaseLetter,
  isBaseLetter,
  stripPrefixes,
  letterOfAnswer,
  dedupKey,
  BOARD_ALIASES,
};