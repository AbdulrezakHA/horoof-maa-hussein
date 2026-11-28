/* ==================================================================
   نظام التصميم — دوال الحركة المشتركة (تُستعمل في كل الألعاب)
   import { toast, bump, replay, confetti, ring } from "/js/ds.js";
   ================================================================== */

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** يعيد تشغيل حركة CSS (صنف ds-*) على عنصر. */
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // إعادة ضبط الحركة
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

/** نتيجة تقفز + «+1» يطير فوقها. */
export function bump(scoreEl, label = "+1") {
  if (!scoreEl) return;
  replay(scoreEl, "is-bump");
  if (reduced() || !label) return;
  const r = scoreEl.getBoundingClientRect();
  const f = document.createElement("div");
  f.className = "ds-float-up";
  f.textContent = label;
  f.style.left = `${r.left + r.width / 2 - 20 + window.scrollX}px`;
  f.style.top = `${r.top - 10 + window.scrollY}px`;
  document.body.appendChild(f);
  f.addEventListener("animationend", () => f.remove(), { once: true });
}

/** رسالة قصيرة أسفل الشاشة. */
export function toast(text, ms = 2200) {
  let host = document.querySelector(".ds-toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "ds-toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "ds-toast";
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add("is-leaving");
    t.addEventListener("animationend", () => t.remove(), { once: true });
  }, ms);
}

/** قصاصات احتفال بألوان معيّنة (افتراضياً ألوان النظام). */
export function confetti(colors, count = 70) {
  if (reduced()) return;
  const css = getComputedStyle(document.documentElement);
  const palette = colors?.length
    ? colors
    : ["--sun", "--mint", "--coral", "--sky", "--bubble", "--grape"].map((v) => css.getPropertyValue(v).trim());
  for (let i = 0; i < count; i++) {
    const c = document.createElement("div");
    c.className = "ds-confetti";
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = palette[i % palette.length];
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 240}px`);
    c.style.setProperty("--rot", `${(Math.random() - 0.5) * 1440}deg`);
    c.style.setProperty("--fall", `${1400 + Math.random() * 1400}ms`);
    c.style.animationDelay = `${Math.random() * 400}ms`;
    document.body.appendChild(c);
    c.addEventListener("animationend", () => c.remove(), { once: true });
  }
}

/**
 * حلقة العدّاد: ring(el).start(seconds) / stop() / set(remaining, total)
 * el = .ds-ring فيها .ds-ring-fg و .ds-ring-num
 */
export function ring(el) {
  const fg = el.querySelector(".ds-ring-fg");
  const num = el.querySelector(".ds-ring-num");
  const LEN = 289; // 2π × 46
  let timer = null;
  const set = (remaining, total) => {
    const frac = Math.max(0, Math.min(1, remaining / total));
    if (fg) fg.style.strokeDashoffset = String(LEN * (1 - frac));
    const secs = Math.max(0, Math.ceil(remaining));
    if (num) num.textContent = String(secs);
    el.classList.toggle("is-urgent", secs <= 5 && secs > 0);
  };
  return {
    set,
    start(total, onEnd) {
      clearInterval(timer);
      const end = performance.now() + total * 1000;
      set(total, total);
      timer = setInterval(() => {
        const left = (end - performance.now()) / 1000;
        set(left, total);
        if (left <= 0) {
          clearInterval(timer);
          el.classList.remove("is-urgent");
          onEnd?.();
        }
      }, 100);
    },
    stop() {
      clearInterval(timer);
    },
  };
}

/** أزرار مقسّمة: يضبط aria-pressed ويستدعي onChange(value). */
export function segmented(root, onChange) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (!b) return;
    for (const x of root.querySelectorAll("button[data-value]")) x.setAttribute("aria-pressed", String(x === b));
    onChange?.(b.dataset.value);
  });
}
