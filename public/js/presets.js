/**
 * صفحة مجموعات الأسئلة (Presets)
 * --------------------------------
 * - تسرد المجموعات داخل مجلد presets/ على جهاز الخادم.
 * - تسمح بإنشاء/نسخ/حذف/تصدير/استيراد.
 * - تحرير الأسئلة مع استنتاج الحرف تلقائياً (أو تخصيصه يدوياً).
 * - لصق صفوف مباشرة من Google Sheets / Excel.
 */

import { BASE_LETTERS, letterOfAnswer } from "/shared/letters.js";
import { sfx } from "/js/sfx.js";

const $ = (id) => document.getElementById(id);

const el = {
  presetSelect: $("presetSelect"),
  newBtn: $("newBtn"),
  dupBtn: $("dupBtn"),
  exportBtn: $("exportBtn"),
  importBtn: $("importBtn"),
  delBtn: $("delBtn"),
  stats: $("stats"),
  warnings: $("warnings"),

  search: $("search"),
  showExtra: $("showExtra"),
  pasteBtn: $("pasteBtn"),
  addBtn: $("addBtn"),
  saveBtn: $("saveBtn"),
  letterFilter: $("letterFilter"),
  tbody: $("tbody"),
  emptyMsg: $("emptyMsg"),
  moreBtn: $("moreBtn"),

  preview: $("preview"),
  previewLetter: $("previewLetter"),
  previewQ: $("previewQ"),
  previewA: $("previewA"),
  previewAText: $("previewAText"),
  closePreview: $("closePreview"),

  pasteModal: $("pasteModal"),
  pasteTitle: $("pasteTitle"),
  pasteText: $("pasteText"),
  pasteInfo: $("pasteInfo"),
  pasteCancel: $("pasteCancel"),
  pasteCheck: $("pasteCheck"),
  pasteApply: $("pasteApply"),

  toast: $("toast"),
  toastText: $("toastText"),
};

const PAGE = 200;

const state = {
  presets: [],
  active: [],
  letters: [],
  id: null,
  rows: [],
  warnings: [],
  search: "",
  letterFilter: "",
  showExtra: false,
  shown: PAGE,
  dirty: false,
  parsed: null,
  mode: "paste",
};

/* ------------------------------------------------------------------ */
/*  أدوات                                                             */
/* ------------------------------------------------------------------ */

async function api(url, body) {
  const opts = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined;
  const res = await fetch(url, opts);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `فشل الطلب (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(msg, kind = "") {
  el.toastText.textContent = msg;
  el.toast.className = "pst-toast pst-show" + (kind ? " pst-toast-" + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.className = "pst-toast";
  }, 2600);
}

function markDirty(value = true) {
  state.dirty = value;
  el.saveBtn.textContent = value ? "💾 حفظ •" : "💾 حفظ";
  el.saveBtn.disabled = false;
}

function autoLetter(row) {
  return letterOfAnswer(row.answer || "");
}

function letterCounts(rows) {
  const map = {};
  for (const l of BASE_LETTERS) map[l] = 0;
  for (const r of rows) {
    const l = r.manual ? r.letter : autoLetter(r);
    if (l && map[l] !== undefined) map[l] += 1;
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  تحميل المجموعات                                                   */
/* ------------------------------------------------------------------ */

async function loadList(preferId) {
  const data = await api("/api/presets");
  state.presets = data.presets || [];
  state.active = data.active || [];
  state.letters = data.letters || [];
  renderSelect();
  el.delBtn.disabled = !state.presets.length;
  const next =
    preferId && state.presets.some((p) => p.id === preferId)
      ? preferId
      : state.id && state.presets.some((p) => p.id === state.id)
        ? state.id
        : state.presets[0]?.id || null;
  if (next) await openPreset(next);
  else renderAll();
}

function renderSelect() {
  const sel = el.presetSelect;
  sel.textContent = "";
  if (!state.presets.length) {
    const o = document.createElement("option");
    o.textContent = "لا توجد مجموعات بعد";
    o.value = "";
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const p of state.presets) {
    const o = document.createElement("option");
    o.value = p.id;
    const warn = p.warnings ? ` ⚠${p.warnings}` : "";
    const act = state.active.length === 0 || state.active.includes(p.id) ? "" : " (غير مفعّلة)";
    o.textContent = `${p.name} — ${p.total} سؤال${warn}${act}`;
    sel.appendChild(o);
  }
  if (state.id) sel.value = state.id;
}

async function openPreset(id) {
  const data = await api(`/api/presets/get?id=${encodeURIComponent(id)}`);
  state.id = data.id;
  state.rows = (data.rows || []).map((r) => ({
    text: r.text || "",
    answer: r.answer || "",
    letter: r.letter || "",
    manual: (r.letter || "") !== letterOfAnswer(r.answer || ""),
    points: r.points ?? "",
    seconds: r.seconds ?? "",
    hint: r.hint || "",
    category: r.category || "",
  }));
  state.warnings = data.warnings || [];
  state.shown = PAGE;
  state.previewIndex = -1;
  el.preview.classList.remove("pst-open");
  el.presetSelect.value = data.id;
  markDirty(false);
  renderAll();
}

/* ------------------------------------------------------------------ */
/*  العرض                                                             */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderStats();
  renderWarnings();
  renderLetterFilter();
  renderTable();
}

function chip(text, cls = "") {
  const s = document.createElement("span");
  s.className = "pst-chip" + (cls ? " " + cls : "");
  s.textContent = text;
  return s;
}

function renderStats() {
  el.stats.textContent = "";
  if (!state.id) return;
  const counts = letterCounts(state.rows);
  const covered = BASE_LETTERS.filter((l) => counts[l] > 0).length;
  const overrides = state.rows.filter((r) => r.manual).length;
  const bad = state.warnings.filter((w) => w.type !== "override").length;
  const totalLabel = state.active.length ? `${state.active.length} مفعّلة` : "كل المجموعات مفعّلة";

  el.stats.appendChild(chip(`📄 ${state.rows.length} سؤال`));
  el.stats.appendChild(chip(`🔤 ${covered} / 28 حرفاً`, covered >= 20 ? "pst-ok" : "pst-warn"));
  el.stats.appendChild(chip(`📚 ${totalLabel}`));
  if (overrides) el.stats.appendChild(chip(`✍️ ${overrides} حرف مخصّص`));
  el.stats.appendChild(bad ? chip(`⚠ ${bad} تنبيه`, "pst-bad") : chip("✅ لا مشاكل", "pst-ok"));
  const empty = BASE_LETTERS.filter((l) => counts[l] === 0);
  if (empty.length) el.stats.appendChild(chip(`حروف بلا أسئلة: ${empty.join(" ")}`, "pst-warn"));
}

function renderWarnings() {
  const list = state.warnings || [];
  el.warnings.textContent = "";
  if (!list.length) {
    el.warnings.hidden = true;
    return;
  }
  el.warnings.hidden = false;
  for (const w of list.slice(0, 60)) {
    const d = document.createElement("div");
    d.className = "pst-warning pst-warning-" + (w.type || "missing");
    d.textContent = (w.row ? `صف ${w.row}: ` : "") + w.msg;
    el.warnings.appendChild(d);
  }
  if (list.length > 60) {
    const d = document.createElement("div");
    d.className = "pst-warning";
    d.textContent = `… و${list.length - 60} تنبيهاً آخر`;
    el.warnings.appendChild(d);
  }
}

function renderLetterFilter() {
  const counts = letterCounts(state.rows);
  el.letterFilter.textContent = "";
  const all = document.createElement("button");
  all.type = "button";
  all.className = "pst-letter" + (state.letterFilter ? "" : " pst-letter-on");
  all.innerHTML = `الكل<small>${state.rows.length}</small>`;
  all.addEventListener("click", () => {
    state.letterFilter = "";
    state.shown = PAGE;
    renderLetterFilter();
    renderTable();
  });
  el.letterFilter.appendChild(all);

  for (const l of BASE_LETTERS) {
    const b = document.createElement("button");
    b.type = "button";
    const n = counts[l] || 0;
    b.className =
      "pst-letter" +
      (state.letterFilter === l ? " pst-letter-on" : "") +
      (n ? "" : " pst-letter-empty");
    b.innerHTML = `${l}<small>${n}</small>`;
    b.addEventListener("click", () => {
      state.letterFilter = state.letterFilter === l ? "" : l;
      state.shown = PAGE;
      renderLetterFilter();
      renderTable();
    });
    el.letterFilter.appendChild(b);
  }
}

function rowLetter(row) {
  return row.manual ? row.letter : autoLetter(row);
}

function filteredIndexes() {
  const q = state.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < state.rows.length; i++) {
    const r = state.rows[i];
    if (state.letterFilter && rowLetter(r) !== state.letterFilter) continue;
    if (q) {
      const hay = (r.text + " " + r.answer + " " + (r.hint || "") + " " + (r.category || "")).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(i);
  }
  return out;
}

function renderTable() {
  const idx = filteredIndexes();
  const shown = idx.slice(0, state.shown);
  el.tbody.textContent = "";
  el.emptyMsg.hidden = idx.length > 0;

  for (const i of shown) {
    el.tbody.appendChild(buildRow(state.rows[i], i));
  }

  el.moreBtn.hidden = idx.length <= state.shown;
  el.moreBtn.textContent = `عرض المزيد… (${idx.length - state.shown} متبقٍ)`;
  el.showExtra.checked = state.showExtra;
  document.querySelectorAll(".pst-extra").forEach((n) => {
    n.hidden = !state.showExtra;
  });
}

function buildRow(row, i) {
  const tr = document.createElement("tr");
  tr.dataset.i = String(i);

  const num = document.createElement("td");
  num.className = "pst-num";
  num.textContent = String(i + 1);
  tr.appendChild(num);

  tr.appendChild(cellArea("text", row.text, "اكتب السؤال…", "pst-q"));
  tr.appendChild(cellInput("answer", row.answer, "الجواب", "pst-a"));

  /* الحرف */
  const tdL = document.createElement("td");
  const sel = document.createElement("select");
  sel.className = "pst-letter-select";
  const optAuto = document.createElement("option");
  optAuto.value = "";
  optAuto.textContent = "تلقائي";
  sel.appendChild(optAuto);
  for (const l of BASE_LETTERS) {
    const o = document.createElement("option");
    o.value = l;
    o.textContent = l;
    sel.appendChild(o);
  }
  sel.value = row.manual ? row.letter : "";
  sel.addEventListener("change", () => {
    if (!sel.value) {
      row.manual = false;
      row.letter = autoLetter(row);
    } else {
      row.manual = true;
      row.letter = sel.value;
    }
    paintLetter(tr, row);
    markDirty();
    renderStats();
    renderLetterFilter();
  });
  tdL.appendChild(sel);
  tr.appendChild(tdL);

  /* أعمدة إضافية */
  tr.appendChild(cellInput("points", row.points ?? "", "—", "pst-extra", true));
  tr.appendChild(cellInput("seconds", row.seconds ?? "", "—", "pst-extra", true));
  tr.appendChild(cellInput("hint", row.hint || "", "تلميح", "pst-extra", true));
  tr.appendChild(cellInput("category", row.category || "", "فئة", "pst-extra", true));

  /* أدوات الصف */
  const tdT = document.createElement("td");
  const box = document.createElement("div");
  box.className = "pst-row-tools";

  const eye = document.createElement("button");
  eye.type = "button";
  eye.className = "pst-icon-btn";
  eye.textContent = "👁";
  eye.title = "معاينة";
  eye.addEventListener("click", () => showPreview(row));
  box.appendChild(eye);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "pst-icon-btn";
  del.textContent = "🗑";
  del.title = "حذف السؤال";
  del.addEventListener("click", () => {
    state.rows.splice(i, 1);
    markDirty();
    renderAll();
  });
  box.appendChild(del);

  tdT.appendChild(box);
  tr.appendChild(tdT);

  paintLetter(tr, row);
  return tr;
}

function cellInput(field, value, ph, cls, extra) {
  const td = document.createElement("td");
  if (extra) td.className = "pst-extra";
  const input = document.createElement("input");
  input.className = "pst-cell-input";
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = ph || "";
  input.dataset.f = field;
  if (cls && !extra) td.className = td.className ? td.className + " " + cls : cls;
  td.appendChild(input);
  return td;
}

function cellArea(field, value, ph, cls) {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  const ta = document.createElement("textarea");
  ta.className = "pst-cell-area";
  ta.rows = 2;
  ta.value = value ?? "";
  ta.placeholder = ph || "";
  ta.dataset.f = field;
  td.appendChild(ta);
  return td;
}

function paintLetter(tr, row) {
  const sel = tr.querySelector(".pst-letter-select");
  if (!sel) return;
  const auto = autoLetter(row);
  const opt = sel.querySelector('option[value=""]');
  if (opt) opt.textContent = auto ? `تلقائي (${auto})` : "تلقائي ؟";
  sel.classList.remove("pst-letter-auto", "pst-letter-manual", "pst-letter-none");
  if (row.manual) sel.classList.add("pst-letter-manual");
  else if (auto) sel.classList.add("pst-letter-auto");
  else sel.classList.add("pst-letter-none");
}

/* الكتابة داخل الجدول — بلا إعادة رسم كاملة */
el.tbody.addEventListener("input", (e) => {
  const t = e.target;
  const field = t.dataset && t.dataset.f;
  if (!field) return;
  const tr = t.closest("tr");
  if (!tr) return;
  const row = state.rows[Number(tr.dataset.i)];
  if (!row) return;

  row[field] = t.value;
  if (field === "answer" && !row.manual) {
    row.letter = autoLetter(row);
    paintLetter(tr, row);
  }
  markDirty();
});

el.tbody.addEventListener("change", () => {
  renderStats();
  renderLetterFilter();
});

/* ------------------------------------------------------------------ */
/*  المعاينة                                                          */
/* ------------------------------------------------------------------ */

function showPreview(row) {
  const letter = rowLetter(row);
  el.previewLetter.textContent = letter || "؟";
  el.previewQ.textContent = row.text || "(بلا نص)";
  el.previewAText.textContent = row.answer || "";
  el.previewA.hidden = !row.answer;
  el.preview.classList.add("pst-open");
  el.preview.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    sfx.play("reveal");
  } catch {}
}

el.closePreview.addEventListener("click", () => el.preview.classList.remove("pst-open"));

/* ------------------------------------------------------------------ */
/*  الحفظ                                                             */
/* ------------------------------------------------------------------ */

async function save() {
  if (!state.id) return;
  el.saveBtn.disabled = true;
  try {
    const data = await api("/api/presets/save", { id: state.id, rows: state.rows });
    toast(`تم الحفظ — ${data.total} سؤال`, "ok");
    try {
      sfx.play("correct");
    } catch {}
    await loadList(state.id);
  } catch (err) {
    toast(String(err.message || err), "bad");
  } finally {
    el.saveBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/*  أدوات المجموعة                                                    */
/* ------------------------------------------------------------------ */

el.presetSelect.addEventListener("change", async () => {
  const next = el.presetSelect.value;
  if (!next || next === state.id) return;
  if (state.dirty && !confirm("لديك تعديلات غير محفوظة. هل تريد تجاهلها؟")) {
    el.presetSelect.value = state.id;
    return;
  }
  await openPreset(next);
});

el.search.addEventListener("input", () => {
  state.search = el.search.value;
  state.shown = PAGE;
  renderTable();
});

el.showExtra.addEventListener("change", () => {
  state.showExtra = el.showExtra.checked;
  renderTable();
});

el.moreBtn.addEventListener("click", () => {
  state.shown += PAGE;
  renderTable();
});

el.addBtn.addEventListener("click", () => {
  if (!state.id) return;
  state.rows.unshift({ text: "", answer: "", letter: "", manual: false, points: "", seconds: "", hint: "", category: "" });
  state.search = "";
  state.letterFilter = "";
  el.search.value = "";
  state.shown = PAGE;
  markDirty();
  renderAll();
});

el.saveBtn.addEventListener("click", save);

el.newBtn.addEventListener("click", async () => {
  const name = prompt("اسم المجموعة الجديدة:", "");
  if (!name) return;
  try {
    const data = await api("/api/presets/create", { name });
    toast(`تم إنشاء «${data.id}»`, "ok");
    state.dirty = false;
    await loadList(data.id);
  } catch (err) {
    toast(String(err.message || err), "bad");
  }
});

el.dupBtn.addEventListener("click", async () => {
  if (!state.id) return;
  const name = prompt("اسم النسخة:", `${state.id} - نسخة`);
  if (!name) return;
  try {
    const data = await api("/api/presets/duplicate", { id: state.id, name });
    toast(`تم إنشاء «${data.id}»`, "ok");
    state.dirty = false;
    await loadList(data.id);
  } catch (err) {
    toast(String(err.message || err), "bad");
  }
});

el.delBtn.addEventListener("click", async () => {
  if (!state.id) return;
  if (!confirm(`حذف المجموعة «${state.id}» نهائياً؟ لا يمكن التراجع.`)) return;
  try {
    await api("/api/presets/delete", { id: state.id });
    toast("تم الحذف", "ok");
    state.id = null;
    state.dirty = false;
    await loadList(null);
  } catch (err) {
    toast(String(err.message || err), "bad");
  }
});

el.exportBtn.addEventListener("click", () => {
  if (!state.id) return;
  if (state.dirty && !confirm("لديك تعديلات غير محفوظة. تصدير النسخة المحفوظة فقط؟")) return;
  window.location.href = `/api/presets/export?id=${encodeURIComponent(state.id)}`;
});

/* ------------------------------------------------------------------ */
/*  اللصق / الاستيراد                                                 */
/* ------------------------------------------------------------------ */

function openModal(mode) {
  state.mode = mode;
  state.parsed = null;
  el.pasteText.value = "";
  el.pasteInfo.textContent = "";
  el.pasteApply.disabled = true;
  el.pasteTitle.textContent = mode === "import" ? "⬆ استيراد مجموعة" : "📋 لصق من جدول";
  el.pasteModal.classList.add("pst-open");
  setTimeout(() => el.pasteText.focus(), 50);
}

function closeModal() {
  el.pasteModal.classList.remove("pst-open");
}

el.pasteBtn.addEventListener("click", () => openModal("paste"));
el.importBtn.addEventListener("click", () => openModal("import"));
el.pasteCancel.addEventListener("click", closeModal);
el.pasteModal.addEventListener("click", (e) => {
  if (e.target === el.pasteModal) closeModal();
});

el.pasteCheck.addEventListener("click", async () => {
  const text = el.pasteText.value;
  if (!text.trim()) {
    el.pasteInfo.textContent = "الصق البيانات أولاً.";
    return;
  }
  try {
    const data = await api("/api/presets/parse", { text });
    state.parsed = data;
    const warn = data.warnings.filter((w) => w.type !== "override");
    el.pasteInfo.textContent =
      `✅ ${data.total} صف صالح` +
      (warn.length ? ` — ⚠ ${warn.length} تنبيه` : "") +
      (data.warnings.length ? `. أول تنبيه: ${data.warnings[0].msg}` : "");
    el.pasteApply.disabled = data.total === 0;
  } catch (err) {
    el.pasteInfo.textContent = String(err.message || err);
    el.pasteApply.disabled = true;
  }
});

el.pasteApply.addEventListener("click", async () => {
  if (!state.parsed || !state.parsed.total) return;
  if (state.mode === "import") {
    const name = prompt("اسم المجموعة المستوردة:", "مجموعة مستوردة");
    if (!name) return;
    try {
      const data = await api("/api/presets/import", { name, text: el.pasteText.value });
      toast(`تم استيراد «${data.id}» — ${data.total} سؤال`, "ok");
      closeModal();
      state.dirty = false;
      await loadList(data.id);
    } catch (err) {
      toast(String(err.message || err), "bad");
    }
    return;
  }

  /* لصق داخل المجموعة الحالية */
  const mapped = state.parsed.rows.map((r) => ({
    text: r.text,
    answer: r.answer,
    letter: r.letter,
    manual: r.letter !== letterOfAnswer(r.answer),
    points: r.points ?? "",
    seconds: r.seconds ?? "",
    hint: r.hint || "",
    category: r.category || "",
  }));
  if (state.rows.length && !confirm(`إضافة ${mapped.length} سؤال إلى المجموعة؟ (لن تُحذف الأسئلة الحالية)`)) return;
  state.rows = mapped.concat(state.rows);
  state.shown = PAGE;
  markDirty();
  renderAll();
  closeModal();
  toast(`أُضيف ${mapped.length} سؤال — لم تُحفظ بعد`, "ok");
});

/* ------------------------------------------------------------------ */
/*  الحماية من فقدان التعديلات                                         */
/* ------------------------------------------------------------------ */

window.addEventListener("beforeunload", (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

/* ------------------------------------------------------------------ */
/*  البدء                                                             */
/* ------------------------------------------------------------------ */

(async function init() {
  const wanted = new URLSearchParams(location.search).get("id") || "";
  try {
    await loadList(wanted);
  } catch (err) {
    toast("تعذّر تحميل المجموعات: " + String(err.message || err), "bad");
  }
})();