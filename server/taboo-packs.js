/**
 * مواضيع «الكلمة الممنوعة»
 * ------------------------
 * كل موضوع = ملف TSV داخل `presets/الكلمة_الممنوعة/` واسم الملف هو اسم الموضوع.
 *
 *   السطر الأول (اختياري):  # أيقونة: 🍽️
 *   كل سطر بعده:           الكلمة <TAB> ممنوع١ <TAB> ممنوع٢ <TAB> ... (عدد الممنوعة حرّ: ٣ إلى ٨)
 *   الأسطر الفارغة وما يبدأ بـ # تُتجاهل.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR, safeId } from "./presets.js";

export const TABOO_DIR = path.join(ROOT_DIR, "presets", "الكلمة_الممنوعة");
const EXT = ".tsv";
const MAX_FORBIDDEN = 8;

function ensureDir() {
  if (!fs.existsSync(TABOO_DIR)) fs.mkdirSync(TABOO_DIR, { recursive: true });
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** يحلّل نص موضوع إلى { icon, cards: [{ word, forbidden }] , warnings }. */
export function parseTaboo(text) {
  let icon = "";
  const cards = [];
  const warnings = [];
  const seen = new Set();
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#")) {
      const m = line.match(/^#\s*أيقونة\s*[:：]\s*(.+)$/);
      if (m) icon = m[1].trim().slice(0, 8);
      return;
    }
    const cells = raw.split("\t").map(clean).filter(Boolean);
    const word = cells[0];
    const forbidden = [...new Set(cells.slice(1))].slice(0, MAX_FORBIDDEN);
    if (!word) return;
    if (/^(الكلمة|كلمة|word)$/i.test(word)) return; // سطر عناوين
    if (forbidden.length < 2) warnings.push(`السطر ${i + 1}: «${word}» بلا كلمات ممنوعة كافية`);
    if (seen.has(word)) {
      warnings.push(`السطر ${i + 1}: «${word}» مكرّرة`);
      return;
    }
    seen.add(word);
    cards.push({ word, forbidden });
  });
  return { icon, cards, warnings };
}

export function serializeTaboo({ icon, cards }) {
  const out = [];
  if (icon) out.push(`# أيقونة: ${icon}`);
  out.push("# الكلمة\tممنوع١\tممنوع٢\tممنوع٣\t...");
  for (const c of cards || []) {
    const word = clean(c.word);
    if (!word) continue;
    out.push([word, ...(c.forbidden || []).map(clean).filter(Boolean)].join("\t"));
  }
  return out.join("\n") + "\n";
}

const fileOf = (id) => path.join(TABOO_DIR, safeId(id) + EXT);

export function listTabooPacks() {
  ensureDir();
  return fs
    .readdirSync(TABOO_DIR)
    .filter((f) => f.toLowerCase().endsWith(EXT))
    .map((f) => {
      const id = f.slice(0, -EXT.length);
      const { icon, cards, warnings } = loadTaboo(id);
      return { id, name: id, icon: icon || "🃏", total: cards.length, warnings: warnings.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export function loadTaboo(id) {
  try {
    return { id, ...parseTaboo(fs.readFileSync(fileOf(id), "utf8")) };
  } catch {
    return { id, icon: "", cards: [], warnings: [] };
  }
}

export function saveTaboo(id, data) {
  ensureDir();
  fs.writeFileSync(fileOf(id), serializeTaboo(data), "utf8");
  return loadTaboo(id);
}

export function deleteTaboo(id) {
  const f = fileOf(id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

/** كل بطاقات المواضيع المفعّلة (فارغة = كل المواضيع). */
export function buildTabooDeck(activeIds = []) {
  const ids = activeIds.length ? activeIds : listTabooPacks().map((p) => p.id);
  const deck = [];
  for (const id of ids) {
    const { icon, cards } = loadTaboo(id);
    cards.forEach((c, i) => deck.push({ id: `${id}#${i}`, word: c.word, forbidden: c.forbidden, topic: id, icon: icon || "🃏" }));
  }
  return deck;
}
