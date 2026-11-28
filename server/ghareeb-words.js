/**
 * مجالات «في بينا غريب»
 * ---------------------
 * كل مجال = ملف TSV داخل `presets/في_بينا_غريب/` واسم الملف هو اسم المجال.
 *
 *   السطر الأول (اختياري):  # أيقونة: food
 *   كل سطر بعده:           الكلمة الأساسية <TAB> الكلمة القريبة
 *   الأسطر الفارغة وما يبدأ بـ # تُتجاهل.
 *
 * الكلمة الأساسية هي ما يستلمه كل اللاعبين، والكلمة القريبة هي ما يستلمها «الغريب».
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR, safeId } from "./presets.js";

export const GHAREEB_DIR = path.join(ROOT_DIR, "presets", "في_بينا_غريب");
const EXT = ".tsv";
const DEFAULT_ICON = "shapes";

/** معرّفات الرموز المتاحة في /icons.svg (أيقونة المجال يجب أن تكون واحداً منها). */
let iconIdsCache = null;
export function iconIds() {
  if (!iconIdsCache) {
    try {
      const svg = fs.readFileSync(path.join(ROOT_DIR, "public", "icons.svg"), "utf8");
      iconIdsCache = new Set([...svg.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
    } catch {
      iconIdsCache = new Set([DEFAULT_ICON]);
    }
  }
  return iconIdsCache;
}
export const validIcon = (v) => (iconIds().has(String(v || "").trim()) ? String(v).trim() : DEFAULT_ICON);

function ensureDir() {
  if (!fs.existsSync(GHAREEB_DIR)) fs.mkdirSync(GHAREEB_DIR, { recursive: true });
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** يحلّل نص مجال إلى { icon, pairs: [{ base, stranger }], warnings }. */
export function parseGhareeb(text) {
  let icon = "";
  const pairs = [];
  const warnings = [];
  const seen = new Set();
  let headerSeen = false;
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#")) {
      const m = line.match(/^#\s*أيقونة\s*[::]\s*(.+)$/);
      if (m) icon = validIcon(m[1]);
      return;
    }
    const cells = raw.split("\t").map(clean);
    const base = cells[0];
    const stranger = cells.slice(1).find(Boolean) || "";
    if (!base) return;
    // سطر العناوين: فقط إن كان أول سطر بيانات ويطابق صيغة العناوين بالضبط
    if (pairs.length === 0 && !headerSeen && /^(الأساسية|الكلمة|كلمة|word)$/i.test(base) && /^(القريبة|قريبة|stranger|undercover)$/i.test(stranger)) {
      headerSeen = true;
      return;
    }
    if (!stranger) {
      warnings.push(`السطر ${i + 1}: «${base}» بلا كلمة قريبة`);
      return;
    }
    if (base === stranger) {
      warnings.push(`السطر ${i + 1}: «${base}» مطابقة لكلمتها القريبة`);
      return;
    }
    if (seen.has(base)) {
      warnings.push(`السطر ${i + 1}: «${base}» مكرّرة`);
      return;
    }
    seen.add(base);
    pairs.push({ base, stranger });
  });
  return { icon, pairs, warnings };
}

export function serializeGhareeb({ icon, pairs }) {
  const out = [];
  if (icon) out.push(`# أيقونة: ${validIcon(icon)}`);
  out.push("# الأساسية\tالقريبة");
  for (const p of pairs || []) {
    const base = clean(p.base);
    const stranger = clean(p.stranger);
    if (!base || !stranger) continue;
    out.push([base, stranger].join("\t"));
  }
  return out.join("\n") + "\n";
}

const fileOf = (id) => path.join(GHAREEB_DIR, safeId(id) + EXT);

export function listGhareebFields() {
  ensureDir();
  return fs
    .readdirSync(GHAREEB_DIR)
    .filter((f) => f.toLowerCase().endsWith(EXT))
    .map((f) => {
      const id = f.slice(0, -EXT.length);
      const { icon, pairs, warnings } = loadGhareeb(id);
      return { id, name: id, icon: icon || DEFAULT_ICON, total: pairs.length, warnings: warnings.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export function loadGhareeb(id) {
  try {
    return { id, ...parseGhareeb(fs.readFileSync(fileOf(id), "utf8")) };
  } catch {
    return { id, icon: "", pairs: [], warnings: [] };
  }
}

export function saveGhareeb(id, data) {
  ensureDir();
  fs.writeFileSync(fileOf(id), serializeGhareeb(data), "utf8");
  return loadGhareeb(id);
}

export function deleteGhareeb(id) {
  const f = fileOf(id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

/** كل أزواج المجالات المفعّلة (فارغة = كل المجالات). */
export function buildGhareebPairs(activeIds = []) {
  const ids = activeIds.length ? activeIds : listGhareebFields().map((p) => p.id);
  const all = [];
  for (const id of ids) {
    const { icon, pairs } = loadGhareeb(id);
    pairs.forEach((p, i) =>
      all.push({ id: `${id}#${i}`, base: p.base, stranger: p.stranger, field: id, icon: icon || DEFAULT_ICON }),
    );
  }
  return all;
}