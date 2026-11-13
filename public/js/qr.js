/* ==================================================================
   مولّد رموز QR محلي (بدون إنترنت)
   يعتمد على qrcode.js (MIT) المضمّن في المشروع.
   ================================================================== */

/**
 * يرسم رمز QR داخل عنصر <canvas> أو يُرجع كـ SVG string.
 * @param {string} text النص المراد تشفيره (رابط)
 * @param {HTMLCanvasElement} canvas
 * @param {{ dark?: string, light?: string, margin?: number }} [opts]
 */
export function drawQR(text, canvas, opts = {}) {
  const dark = opts.dark || "#1a0930";
  const light = opts.light || "#ffffff";
  const margin = opts.margin ?? 4;

  const qr = window.qrcode(0, "M"); // 0 = اختيار حجم تلقائي
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const size = count + margin * 2;
  const dpr = Math.min(3, window.devicePixelRatio || 1);

  const px = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 240));
  canvas.width = px * dpr;
  canvas.height = px * dpr;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;

  const cell = px / size;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(
          Math.round((c + margin) * cell),
          Math.round((r + margin) * cell),
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }
  }
  return qr;
}

/**
 * يجهّز قائمة روابط صالحة لأي دور (حكم أو جرس) حسب عناوين الشبكة المتاحة.
 * @param {string} room
 * @param {string} path مسار الصفحة مثل "referee" أو "buzzer"
 * @param {Record<string,string>} [extra] معاملات إضافية مثل { team: "a" }
 * @returns {Promise<Array<{name:string,address:string,url:string}>>}
 */
async function resolveUrls(room, path, extra = {}) {
  const qs = new URLSearchParams({ room, ...extra }).toString();
  const fallback = {
    name: "هذا الجهاز",
    address: location.host,
    url: `${location.origin}/${path}?${qs}`,
  };

  try {
    const res = await fetch("/api/network");
    const info = await res.json();
    const local = ["localhost", "127.0.0.1", "::1", ""].indexOf(location.hostname) !== -1;
    // المنفذ الذي وصلت منه هذه الصفحة هو الصحيح دائماً.
    // (info.port قد يشير إلى منفذ خادم آخر إذا كان المنفذ المطلوب مشغولاً
    //  عند تشغيل الخادم — وهذا يجعل رمز QR يفتح 404 على الجوال.)
    const pagePort = location.port || String(info.port ?? "").trim();
    const mk = (base) => ({
      name: base.name || "شبكة محلية",
      address: base.address,
      url: `http://${base.address}:${pagePort}/${path}?${qs}`,
    });
    if (local && info.publicUrl) {
      return [
        {
          name: "اتصال عبر الإنترنت",
          address: new URL(info.publicUrl).host,
          url: `${info.publicUrl}/${path}?${qs}`,
        },
        ...info.addresses.map(mk),
      ];
    }
    if (local && info.addresses?.length) {
      return info.addresses.map(mk);
    }
  } catch {
    /* نستخدم الرابط الحالي إن فشل الاستعلام. */
  }

  return [fallback];
}

/**
 * روابط لوحة الحكم.
 * @param {string} [room]
 */
export async function getRefereeUrls(room = "main") {
  return resolveUrls(room, "referee");
}

/**
 * روابط جرس اللاعب لفريق معيّن.
 * @param {string} [room]
 * @param {'a'|'b'} [team]
 */
export async function getBuzzerUrls(room = "main", team = "a") {
  return resolveUrls(room, "buzzer", { team });
}

/**
 * يقرأ رابط الحكم المناسب ويجهّز رمز QR.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [room]
 * @returns {Promise<string>} الرابط المستخدَم
 */
export async function setupRefereeQR(canvas, room = "main") {
  const [first] = await getRefereeUrls(room);
  const url = first.url;

  drawQR(url, canvas);
  return url;
}
