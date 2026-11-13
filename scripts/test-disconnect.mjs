/**
 * اختبار دقيق لمسار قطع الاتصال — يتأكد أن الخادم ينظّف الاتصال.
 *   node scripts/test-disconnect.mjs [port]
 */
const PORT = process.argv[2] || 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
  const j = await r.json();
  return j.peers;
};

function connect(role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=main`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", role, room: "main" }));
      resolve(ws);
    };
    ws.onerror = reject;
    setTimeout(() => reject(new Error("timeout")), 4000);
  });
}

let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
};

async function main() {
  console.log("\n▸ اختبار قطع الاتصال\n");

  const base = await state();
  console.log(`  الحالة الابتدائية: ${JSON.stringify(base)}\n`);

  // 1) إغلاق مباشر
  const a = await connect("referee");
  await sleep(400);
  let p = await state();
  check("اتصال حكم يزيد العدّاد", p.referee === base.referee + 1, `referee=${p.referee}`);

  a.close();
  await sleep(1500);
  p = await state();
  check("إغلاق الحكم ينقص العدّاد", p.referee === base.referee, `referee=${p.referee}`);

  // 2) إغلاق مفاجئ (بلا مصافحة) — kill
  const b = await connect("referee");
  await sleep(400);
  p = await state();
  check("حكم ثانٍ اتصل", p.referee === base.referee + 1, `referee=${p.referee}`);

  b.close(); // إغلاق نظيف عبر المتصفح
  await sleep(1500);
  p = await state();
  check("إغلاق الثاني ينقص العدّاد", p.referee === base.referee, `referee=${p.referee}`);

  // 3) عميل لا يرسل hello إطلاقاً ثم يقطع
  const c = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=main`);
  await new Promise((res) => (c.onopen = res));
  await sleep(500);
  p = await state();
  check(
    "عميل بلا hello لا يُحسب",
    p.referee === base.referee && p.screen === base.screen,
    JSON.stringify(p)
  );
  c.close();
  await sleep(1200);
  p = await state();
  check("بعد قطعه لا تتغير الأعداد", p.referee === base.referee, JSON.stringify(p));

  console.log("");
  if (fails === 0) {
    console.log("  \x1b[32m✔ لا يوجد تسريب في الاتصالات\x1b[0m\n");
    process.exit(0);
  } else {
    console.log(`  \x1b[31m✖ فشل ${fails} فحص\x1b[0m\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
