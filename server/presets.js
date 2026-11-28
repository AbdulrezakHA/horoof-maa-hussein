/**
 * مجموعات الأسئلة (Presets)
 * -------------------------
 * كل مجموعة = ملف TSV واحد داخل مجلد `presets/` باسم المجموعة.
 * الأعمدة: سؤال | جواب | حرف | نقاط | ثواني | تلميح | فئة
 *
 * العمود «حرف» اختياري: إن تُرك فارغاً يُستنتج من أول حرف في الجواب.
 * الأعمدة الإضافية (نقاط/ثواني/تلميح/فئة) تُحفظ وتُنقل كما هي،
 * لكن اللعبة لا تستخدمها بعد — جاهزة لتحديث قادم.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_LETTERS, letterOfAnswer, dedupKey, toBaseLetter, cleanText } from "../shared/letters.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(HERE, "..");
export const PRESETS_DIR = path.join(ROOT_DIR, "presets");
export const LEGACY_FILE = path.join(ROOT_DIR, "data", "questions.json");
export const DEFAULT_PRESET_NAME = "الأساسي";
export const SHEET_EXT = ".tsv";

const HEADER_CELLS = ["سؤال", "السؤال", "question", "q", "جواب", "الجواب", "answer"];
const COLUMNS = ["سؤال", "جواب", "حرف", "نقاط", "ثواني", "تلميح", "فئة"];

/* ------------------------------------------------------------------ */
/*  أدوات عامة                                                         */
/* ------------------------------------------------------------------ */

function ensureDir() {
  if (!fs.existsSync(PRESETS_DIR)) fs.mkdirSync(PRESETS_DIR, { recursive: true });
}

/** التحقق من صلاحية اسم/معرّف المجموعة (يُستخدم كاسم ملف). */
export function safeId(id) {
  const s = String(id ?? "").trim().replace(/[\t\r\n]+/g, " ");
  if (!s) throw new Error("اسم المجموعة مطلوب");
  if (s === "." || s === "..") throw new Error("اسم غير صالح");
  if (s.length > 60) throw new Error("الاسم طويل جداً (٦٠ حرفاً كحد أقصى)");
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001F]/.test(s)) throw new Error("الاسم يحتوي رموزاً غير مسموحة: \\ / : * ? \" < > |");
  if (s.toLowerCase().endsWith(SHEET_EXT)) return s.slice(0, -SHEET_EXT.length);
  return s;
}

function fileOf(id) {
  return path.join(PRESETS_DIR, safeId(id) + SHEET_EXT);
}

function clip(s, n) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function toInt(v) {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ------------------------------------------------------------------ */
/*  تحليل الجداول                                                     */
/* ------------------------------------------------------------------ */

function detectDelimiter(text) {
  const first = text.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) || "";
  if ((first.match(/\t/g) || []).length) return "\t";
  const semis = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  if (semis > commas) return ";";
  if (commas) return ",";
  return "\t";
}

/** تقسيم سطر واحد مع دعم علامات التنصيص في CSV. */
function splitLine(line, delim) {
  if (delim === "\t") return line.split("\t");
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      inQuotes = true;
      cur = "";
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function isHeaderRow(cells) {
  if (!cells || cells.length < 2) return false;
  // نعتبره صف عناوين فقط إذا كان العمودان الأولان عناوين فعلاً،
  // حتى لا يُحذف سؤال جوابه كلمة مثل "جواب" أو نصّه "سؤال".
  const a = String(cells[0] ?? "").trim().toLowerCase();
  const b = String(cells[1] ?? "").trim().toLowerCase();
  if (HEADER_CELLS.includes(a) && HEADER_CELLS.includes(b)) return true;
  // صف ترقيم + عنوان:  # | سؤال | جواب
  if ((a === "#" || a === "no" || a === "id" || a === "رقم") && HEADER_CELLS.includes(b)) return true;
  return false;
}

/**
 * تحليل نص جدول (TSV أو CSV) إلى صفوف + تحذيرات.
 * @param {string} text
 * @returns {{rows: Array, warnings: Array}}
 */
export function parseSheet(text) {
  const warnings = [];
  const src = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (!lines.length) {
    return { rows: [], warnings: [{ row: 0, type: "empty", msg: "لا يوجد أي صف في الجدول" }] };
  }

  const delim = detectDelimiter(src);
  const table = lines.map((l) => splitLine(l, delim));
  let start = 0;
  if (isHeaderRow(table[0])) start = 1;

  const rows = [];
  const seen = new Set();

  for (let i = start; i < table.length; i++) {
    const cells = table[i];
    const rowNo = i + 1;
    const qText = String(cells[0] ?? "").trim();
    const answer = String(cells[1] ?? "").trim();

    if (!qText && !answer) continue;
    if (!qText) {
      warnings.push({ row: rowNo, type: "missing", msg: "سؤال فارغ — تم تجاهل الصف" });
      continue;
    }
    if (!answer) {
      warnings.push({ row: rowNo, type: "missing", msg: "جواب فارغ — تم تجاهل الصف" });
      continue;
    }

    const key = dedupKey(qText);
    if (seen.has(key)) {
      warnings.push({ row: rowNo, type: "duplicate", msg: `سؤال مكرّر «${clip(qText, 40)}» — تم تجاهل التكرار` });
      continue;
    }
    seen.add(key);

    const auto = letterOfAnswer(answer);
    let letter = "";
    const manual = String(cells[2] ?? "").trim();
    if (manual) {
      const cleaned = cleanText(manual);
      const mapped = resolveLetterCell(cleaned);
      if (mapped) letter = mapped;
      else warnings.push({ row: rowNo, type: "letter", msg: `حرف غير معروف «${clip(manual, 12)}» — سيُستنتج تلقائياً` });
    }
    if (!letter) letter = auto;
    if (!letter) {
      warnings.push({ row: rowNo, type: "unmapped", msg: `تعذّر استنتاج الحرف من الجواب «${clip(answer, 30)}»` });
      continue;
    }
    if (auto && letter !== auto) {
      warnings.push({ row: rowNo, type: "override", msg: `حرف مخصّص: «${clip(answer, 26)}» إلى الحرف ${letter} (تلقائياً: ${auto})` });
    }

    const row = { line: rowNo, text: qText, answer, letter };
    const points = toInt(cells[3]);
    if (points) row.points = points;
    const seconds = toInt(cells[4]);
    if (seconds) row.seconds = seconds;
    const hint = String(cells[5] ?? "").trim();
    if (hint) row.hint = hint;
    const category = String(cells[6] ?? "").trim();
    if (category) row.category = category;

    rows.push(row);
  }

  return { rows, warnings };
}

function resolveLetterCell(v) {
  if (!v) return "";
  const first = toBaseLetter(v[0]);
  if (first) return first;
  const auto = letterOfAnswer(v);
  return auto || "";
}

/* ------------------------------------------------------------------ */
/*  كتابة الجداول                                                     */
/* ------------------------------------------------------------------ */

function cleanCell(v) {
  return String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/** إنتاج نص TSV من الصفوف (بـ BOM كي يفتحه Excel بالعربية بشكل صحيح). */
export function serializeSheet(rows) {
  const out = [COLUMNS.join("\t")];
  for (const r of rows || []) {
    const auto = letterOfAnswer(r.answer);
    // نكتب الحرف صراحةً فقط عندما يختلف عن المستنتج تلقائياً،
    // وبذلك يبقى الملف نظيفاً ويظل "التلقائي" تلقائياً بعد أي تعديل.
    const letterCell = r.letter && r.letter !== auto ? r.letter : "";
    out.push(
      [
        cleanCell(r.text),
        cleanCell(r.answer),
        letterCell,
        r.points ?? "",
        r.seconds ?? "",
        cleanCell(r.hint),
        cleanCell(r.category),
      ].join("\t")
    );
  }
  return "\uFEFF" + out.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */
/*  إدارة الملفات                                                     */
/* ------------------------------------------------------------------ */

export function listPresetIds() {
  ensureDir();
  return fs
    .readdirSync(PRESETS_DIR)
    .filter((f) => f.toLowerCase().endsWith(SHEET_EXT))
    .map((f) => f.slice(0, -SHEET_EXT.length))
    .sort((a, b) => a.localeCompare(b, "ar"));
}

export function countsFor(rows) {
  const letters = {};
  for (const l of BASE_LETTERS) letters[l] = 0;
  for (const r of rows) if (letters[r.letter] !== undefined) letters[r.letter] += 1;
  return { total: rows.length, letters };
}

export function loadPreset(id) {
  const name = safeId(id);
  const file = fileOf(name);
  if (!fs.existsSync(file)) throw new Error("المجموعة غير موجودة: " + name);
  const text = fs.readFileSync(file, "utf8");
  const { rows, warnings } = parseSheet(text);
  return { id: name, name, rows, warnings, ...countsFor(rows) };
}

export function listPresets() {
  return listPresetIds().map((id) => {
    try {
      const p = loadPreset(id);
      return {
        id,
        name: id,
        total: p.total,
        letters: p.letters,
        warnings: p.warnings.filter((w) => w.type !== "override").length,
      };
    } catch (err) {
      return { id, name: id, total: 0, letters: {}, warnings: 1, error: String(err.message || err) };
    }
  });
}

export function savePreset(id, rows) {
  const name = safeId(id);
  ensureDir();
  const file = fileOf(name);
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, serializeSheet(rows), "utf8");
  fs.renameSync(tmp, file);
  return loadPreset(name);
}

export function createPreset(name) {
  const id = safeId(name);
  if (fs.existsSync(fileOf(id))) throw new Error("توجد مجموعة بهذا الاسم بالفعل");
  ensureDir();
  fs.writeFileSync(fileOf(id), serializeSheet([]), "utf8");
  return loadPreset(id);
}

export function duplicatePreset(id, newName) {
  const src = loadPreset(id);
  const target = safeId(newName || src.name + " - نسخة");
  if (fs.existsSync(fileOf(target))) throw new Error("توجد مجموعة بهذا الاسم بالفعل");
  ensureDir();
  fs.writeFileSync(fileOf(target), serializeSheet(src.rows), "utf8");
  return loadPreset(target);
}

export function deletePreset(id) {
  const name = safeId(id);
  const file = fileOf(name);
  if (!fs.existsSync(file)) throw new Error("المجموعة غير موجودة: " + name);
  fs.unlinkSync(file);
  return { ok: true, id: name };
}

export function presetExists(id) {
  try {
    return fs.existsSync(fileOf(id));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  بناء بنك الأسئلة                                                  */
/* ------------------------------------------------------------------ */

/**
 * يبني بنك الأسئلة من المجموعات المختارة.
 * `ids` فارغة = كل المجموعات.
 * منع التكرار يتم على مستوى النص عبر كل المجموعات.
 */
export function buildBankFromPresets(ids) {
  const all = listPresetIds();
  const wanted = Array.isArray(ids) && ids.length ? ids.filter((i) => all.includes(i)) : all;
  const bank = {};
  const seen = new Set();

  for (const id of wanted) {
    let preset;
    try {
      preset = loadPreset(id);
    } catch {
      continue;
    }
    for (const row of preset.rows) {
      const key = dedupKey(row.text);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = (bank[row.letter] ||= []);
      const item = { text: row.text, answer: row.answer, preset: id };
      if (row.points) item.points = row.points;
      if (row.seconds) item.seconds = row.seconds;
      if (row.hint) item.hint = row.hint;
      if (row.category) item.category = row.category;
      bucket.push(item);
    }
  }
  return bank;
}

/** إحصاء الأسئلة لكل حرف من البنك (للواجهة). */
export function countsFromBank(bank) {
  return BASE_LETTERS.map((letter) => ({ letter, count: (bank[letter] || []).length }));
}

/* ------------------------------------------------------------------ */
/*  الترحيل من الملف القديم                                           */
/* ------------------------------------------------------------------ */

/**
 * إن لم توجد أي مجموعة بعد، نحوّل `data/questions.json` القديم
 * إلى مجموعة «الأساسي» حتى لا يضيع أي محتوى.
 */
export function migrateLegacy() {
  ensureDir();
  if (listPresetIds().length) return { migrated: false, reason: "existing" };
  if (!fs.existsSync(LEGACY_FILE)) return { migrated: false, reason: "no-legacy" };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { migrated: false, reason: "bad-json" };
  }

  const rows = [];
  for (const [letter, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    for (const q of list) {
      if (!q || typeof q.text !== "string" || typeof q.answer !== "string") continue;
      rows.push({ text: q.text.trim(), answer: q.answer.trim(), letter });
    }
  }
  if (!rows.length) return { migrated: false, reason: "empty" };

  const preset = savePreset(DEFAULT_PRESET_NAME, rows);
  return { migrated: true, id: preset.id, total: preset.total };
}