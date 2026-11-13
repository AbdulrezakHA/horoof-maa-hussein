/**
 * يحوّل ملفات الأسئلة (Markdown) إلى ملف JSON موحّد تستخدمه اللعبة.
 *
 *   node scripts/build-questions.mjs
 *
 * صيغة الملف المصدر:
 *   ### **[ أ ]**
 *   1. **أموكسيسيلين:** مضاد حيوي ... يبدأ بـ (أ)؟
 *
 * الناتج:  data/questions.json
 *   { "canonicalLetter": [ { answer, text }, ... ] }
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_FILE = join(ROOT, "data", "questions.json");

/** يوحّد شكل الحرف حتى يمكن مطابقته مع خلايا اللوحة. */
export function canonLetter(letter) {
  let s = String(letter || "").trim();
  s = s.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u0640]/g, ""); // تشكيل + تطويل
  if (s === "هـ" || s === "ه" || s === "ة") return s === "ة" ? "ت" : "ه";
  if (s === "أ" || s === "ا" || s === "إ" || s === "آ") return "ا";
  if (s === "ى" || s === "ي" || s === "ئ") return s === "ئ" ? "ي" : "ي";
  if (s === "ؤ" || s === "و") return "و";
  return s;
}

/** ترتيب الحروف العربية. */
const AR_ORDER = "ابتثجحخدذرزسشصضطظعغفقكلمنهوى".split("");

function stripTrailingPrompt(text) {
  return text
    // "، يبدأ بـ (أ)؟" / "تبدأ بـ (ت)؟"
    .replace(/[،,]\s*(?:يبدأ|تبدأ|يبدا|تبدا)\s+بـ\s*\([^)]*\)\s*[؟?]?\s*$/u, "")
    .replace(/\s*(?:يبدأ|تبدأ|يبدا|تبدا)\s+بـ\s*\([^)]*\)\s*[؟?]?\s*$/u, "")
    .replace(/[،,]\s*$/u, "")
    .trim();
}

function parseMarkdown(md) {
  const out = [];
  let letter = null;
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();

    const head = line.match(/^#{2,4}\s*\**\s*\[?\s*([^\]\s])\s*\]?\s*\**/u);
    if (head && /\[/.test(line)) {
      letter = canonLetter(head[1]);
      continue;
    }

    if (!letter) continue;
    const m = line.match(/^\s*\d+\s*[.)]\s*\*\*(.+?)\*\*\s*(.*)$/u);
    if (!m) continue;

    let answer = m[1].replace(/[:：]\s*$/u, "").trim();
    const text = stripTrailingPrompt(m[2].replace(/^[:：]\s*/, "").trim());
    if (!answer) continue;
    out.push({ letter, answer, text: text || answer });
  }
  return out;
}

function main() {
  const files = readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith(".md"));
  if (!files.length) {
    console.error("لم يتم العثور على أي ملف .md في مجلد المشروع");
    process.exit(1);
  }

  const all = [];
  for (const f of files) {
    const md = readFileSync(join(ROOT, f), "utf8");
    const items = parseMarkdown(md);
    console.log(`  ${f} -> ${items.length} سؤال`);
    all.push(...items);
  }

  // تجميع + إزالة التكرار
  const grouped = new Map();
  for (const item of all) {
    if (!grouped.has(item.letter)) grouped.set(item.letter, []);
    const list = grouped.get(item.letter);
    const key = item.answer.replace(/\s+/g, " ");
    if (!list.some((q) => q.answer.replace(/\s+/g, " ") === key)) {
      list.push({ answer: item.answer, text: item.text });
    }
  }

  const ordered = {};
  for (const l of AR_ORDER) {
    if (grouped.has(l)) ordered[l] = grouped.get(l);
  }
  for (const [l, v] of grouped) if (!ordered[l]) ordered[l] = v;

  if (!existsSync(join(ROOT, "data"))) mkdirSync(join(ROOT, "data"), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(ordered, null, 2), "utf8");

  const total = Object.values(ordered).reduce((s, v) => s + v.length, 0);
  console.log(`\nتم إنشاء ${OUT_FILE}`);
  console.log(`عدد الحروف: ${Object.keys(ordered).length} | إجمالي الأسئلة: ${total}`);
  console.log(
    Object.entries(ordered)
      .map(([l, v]) => `${l}:${v.length}`)
      .join("  ")
  );
}

main();
