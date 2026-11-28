// فحص قواعد نظام التصميم (DESIGN.md) — يفشل إن خالف ملف لعبة القواعد الصارمة.
//   node scripts/check-ds.mjs
//
// القواعد على كل ملفات الواجهة (public/**/*.js|html|css) ما عدا المكتبة نفسها:
//   1) لا إيموجي أبداً — الرموز من /icons.svg فقط.
//   2) لا ألوان مكتوبة (#hex, rgb(), hsl()) — الألوان من متغيّرات ds.css / محرّك الثيم فقط.
//   3) لا font-family — الخطوط من متغيّرات ds.css فقط.
//   4) لا تعريف لمكوّنات المكتبة (.ds-…) خارج ds.css — أي عنصر جديد يُضاف للمكتبة أولاً.
//
// الشاشات القديمة (قبل نظام التصميم) في قائمة LEGACY: تظهر مخالفاتها كتحذير حتى تُنقل،
// وكل شاشة تُنقل تُحذف من القائمة فتصبح القواعد عليها صارمة. لا تُضاف ملفات جديدة للقائمة أبداً.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

/** مكتبة نظام التصميم: المصدر الوحيد للألوان والخطوط والمكوّنات. */
const LIBRARY = new Set([
  "public/css/ds.css",
  "public/js/ds.js",
  "public/icons.svg",
]);
const SKIP_DIRS = ["public/js/vendor", "public/sounds"];

/** شاشات قديمة تنتظر النقل لنظام التصميم (تُحذف واحدة واحدة عند نقلها). */
const LEGACY = new Set([
  "public/_mobile-preview.html",
  "public/buzzer.html",
  "public/index.html",
  "public/presets.html",
  "public/referee.html",
  "public/screen.html",
  "public/taboo-packs.html",
  "public/css/base.css",
  "public/css/buzzer.css",
  "public/css/presets.css",
  "public/css/referee.css",
  "public/css/screen.css",
  "public/js/board.js",
  "public/js/buzzer.js",
  "public/js/diag.js",
  "public/js/phone-taboo.js",
  "public/js/presets.js",
  "public/js/qr.js",
  "public/js/referee-taboo.js",
  "public/js/referee.js",
  "public/js/screen-taboo.js",
  "public/js/screen.js",
  "public/js/sfx.js",
  "public/js/transport.js",
]);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FA}\u{231A}\u{231B}\u{2190}-\u{21FF}\u{FE0F}]/u;
const COLOR = /(?<![\w&-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(/;
const FONT = /font-family\s*:(?!\s*var\(--font-)/;
// سطر محدِّد CSS (ينتهي بـ { أو ,) يذكر مكوّناً من المكتبة — يلتقط المحدِّدات الممتدة على عدة أسطر
const DS_DEF = /^\s*[^{};:]*\.ds-[a-z0-9-]+[^{};]*[{,]\s*$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.includes(rel(p))) walk(p, out);
    } else if (/\.(js|html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** يحذف التعليقات (لا نفحص الشرح المكتوب داخلها). */
function stripComments(text, ext) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  if (ext === ".html") t = t.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  if (ext !== ".css") t = t.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));
  return t;
}

function check(file) {
  const ext = path.extname(file);
  const lines = stripComments(fs.readFileSync(file, "utf8"), ext).split("\n");
  const found = [];
  // سياق CSS: ملف .css كامل، أو ما بين <style> و </style> في HTML
  let inStyle = ext === ".css";
  lines.forEach((line, i) => {
    if (ext === ".html" && /<style[\s>]/.test(line)) inStyle = true;
    const at = `${rel(file)}:${i + 1}`;
    if (EMOJI.test(line)) found.push([at, "إيموجي — استعمل رمزاً من /icons.svg", line]);
    if (COLOR.test(line)) found.push([at, "لون مكتوب — استعمل متغيّراً من ds.css", line]);
    if (FONT.test(line)) found.push([at, "font-family — استعمل --font-display / --font-body", line]);
    if (inStyle && DS_DEF.test(line)) found.push([at, "تعريف/تعديل مكوّن .ds-… خارج ds.css — أضفه للمكتبة أولاً", line]);
    if (ext === ".html" && /<\/style>/.test(line)) inStyle = false;
  });
  return found;
}

const files = walk(path.join(ROOT, "public")).filter((f) => !LIBRARY.has(rel(f)));
let errors = 0;
let legacyCount = 0;
const legacyFiles = new Set();
for (const f of files) {
  const found = check(f);
  if (!found.length) continue;
  if (LEGACY.has(rel(f))) {
    legacyCount += found.length;
    legacyFiles.add(rel(f));
    continue;
  }
  for (const [at, msg, line] of found) {
    errors += 1;
    console.log(`\x1b[31m✗ ${at}\x1b[0m ${msg}\n    ${line.trim().slice(0, 140)}`);
  }
}
for (const l of LEGACY) {
  if (!fs.existsSync(path.join(ROOT, l))) console.log(`\x1b[33m! ${l} في LEGACY لكنه غير موجود — احذفه من القائمة\x1b[0m`);
}
const pending = [...LEGACY].filter((l) => fs.existsSync(path.join(ROOT, l)));
console.log(
  `\nنظام التصميم: ${files.length - pending.length} ملف على القواعد الصارمة · ` +
    `${pending.length} شاشة قديمة تنتظر النقل (${legacyCount} مخالفة فيها)`
);
if (errors) {
  console.log(`\x1b[31m✗ ${errors} مخالفة لقواعد DESIGN.md\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32m✓ لا مخالفات في الملفات الجديدة\x1b[0m");
