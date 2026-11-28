// يولّد ألوان الثيم الافتراضي داخل public/css/ds.css (بين علامتي @theme:start و @theme:end)
// من المصدر الوحيد للألوان: shared/ds-theme.js
//   node scripts/gen-ds-theme.mjs            ← يكتب
//   node scripts/gen-ds-theme.mjs --check    ← يتحقق فقط (يفشل إن كان ds.css غير مطابق)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssBlock, DEFAULT_THEME } from "../shared/ds-theme.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "public", "css", "ds.css");
const src = fs.readFileSync(file, "utf8");
const START = "/* @theme:start */";
const END = "/* @theme:end */";
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a < 0 || b < 0) {
  console.error("ds.css: علامتا @theme غير موجودتين");
  process.exit(1);
}
const next = src.slice(0, a + START.length) + "\n" + cssBlock(DEFAULT_THEME) + "\n  " + src.slice(b);
if (process.argv.includes("--check")) {
  if (next !== src) {
    console.error("ds.css لا يطابق shared/ds-theme.js — شغّل: node scripts/gen-ds-theme.mjs");
    process.exit(1);
  }
  console.log("ds.css يطابق الثيم ✓");
} else {
  fs.writeFileSync(file, next);
  console.log(`كُتبت ألوان الثيم «${DEFAULT_THEME}» في ds.css`);
}
