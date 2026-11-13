/**
 * تشخيص: هل تختفي قائمة البداية بدون حضور حكم؟
 *   node scripts/diag-lobby.mjs [port]
 */
const PORT = process.argv[2] || 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(role, room = "main") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
    ws.msgs = [];
    ws.onmessage = (e) => ws.msgs.push(JSON.parse(e.data));
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", role, room }));
      resolve(ws);
    };
    ws.onerror = reject;
    setTimeout(() => reject(new Error("timeout")), 4000);
  });
}

async function main() {
  console.log("\n▸ تشخيص قائمة البداية\n");

  const screen = await connect("screen");
  await sleep(500);

  console.log("  بعد اتصال شاشة فقط (لمدة 20 ثانية):");
  let sawReferee = false;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    await sleep(1000);
    const last = screen.msgs[screen.msgs.length - 1];
    if (!last || last.t !== "state") continue;
    const p = last.peers;
    if (p.referee > 0) {
      sawReferee = true;
      console.log(`  ⚠️  peers: screen=${p.screen} referee=${p.referee}`);
      break;
    }
  }
  const last = screen.msgs[screen.msgs.length - 1];
  console.log(
    `  ✓  آخر peers: ${JSON.stringify(last.peers)} | عدد الرسائل: ${screen.msgs.length}`
  );

  if (sawReferee) {
    console.log(
      "  ⚠️  يوجد اتصال حكم من مصدر آخر (تبويب مفتوح من جلسة سابقة؟)\n" +
        "     تأكد من إغلاق كل التبويبات القديمة قبل الاختبار.\n"
    );
  } else {
    console.log("  ✓  لا يوجد أي حكم متصل — القائمة يجب أن تبقى ظاهرة\n");
  }

  // الاتصال بحكم
  const ref = await connect("referee");
  await sleep(800);
  const after = screen.msgs[screen.msgs.length - 1];
  console.log(`  بعد اتصال الحكم: peers=${JSON.stringify(after.peers)}`);
  console.log(
    "  → السلوك الجديد: القائمة لا تختفي تلقائياً، يبقى القرار للمستخدم.\n"
  );

  // إغلاق الحكم — يجب أن ترجع حالة الشارة إلى "لم يتصل"
  ref.close();
  await sleep(1200);
  const afterClose = screen.msgs[screen.msgs.length - 1];
  console.log(`  بعد إغلاق الحكم: peers=${JSON.stringify(afterClose.peers)}`);
  console.log(
    afterClose.peers.referee === 0
      ? "  ✓  العدّاد رجع صفر — الشارة ستعرض «لم يتصل الحكم»\n"
      : "  ✗  العدّاد لم يرجع — تسريب اتصالات!\n"
  );

  screen.close();
  await sleep(300);
}

main().catch((e) => {
  console.error("خطأ:", e);
  process.exit(1);
});
