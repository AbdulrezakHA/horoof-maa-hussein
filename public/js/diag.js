/* ==================================================================
   تشخيص الأجهزة — سكربت عادي مكتوب بجافاسكربت قديمة (ES5) عمداً
   كي يعمل حتى على المتصفحات القديمة التي لا تفهم بقية اللعبة.

   1) يرسل للخادم «هذا الجهاز فتح الصفحة» مع نوع الجهاز والمتصفح،
      فيظهر في نافذة اللعبة على اللابتوب.
   2) يلتقط أي خطأ في السكربتات ويرسله للخادم.
   3) إن لم تبدأ اللعبة خلال ٨ ثوانٍ يعرض على الجوال نفسه رسالة فيها السبب.
   (الصفحة الرئيسية تضع window.__appStarted = true عند بدء التشغيل)
   ================================================================== */
(function () {
  var errors = [];
  var page = location.pathname;

  function send(kind, msg) {
    try {
      var x = new XMLHttpRequest();
      x.open("POST", "/api/client-log", true);
      x.setRequestHeader("Content-Type", "text/plain");
      x.send(JSON.stringify({ kind: kind, page: page, msg: String(msg || "").slice(0, 600), ua: navigator.userAgent }));
    } catch (e) {}
  }

  window.addEventListener(
    "error",
    function (ev) {
      var t = ev && ev.target;
      var m;
      if (t && t !== window && (t.src || t.href)) m = "تعذّر تحميل ملف: " + (t.src || t.href);
      else m = (ev.message || "خطأ") + (ev.filename ? " @ " + ev.filename.replace(location.origin, "") + ":" + ev.lineno : "");
      errors.push(m);
      send("error", m);
    },
    true
  );
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason;
    var m = "Promise: " + ((r && (r.message || r)) || "?");
    errors.push(m);
    send("error", m);
  });

  send("open", "");

  function show() {
    if (window.__appStarted) return;
    var box = document.createElement("div");
    box.setAttribute("dir", "rtl");
    box.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#2a0f14;color:#fff;" +
      "font:15px/1.6 sans-serif;padding:16px;border-top:4px solid #ff5a6b;max-height:70%;overflow:auto";
    var html =
      "<b style='font-size:17px'>⚠️ اللعبة لم تعمل على هذا الجهاز</b><br>" +
      "أرسِل صورة لهذه الرسالة لمن يطوّر اللعبة.<br><br>" +
      "<b>المتصفح:</b> <span style='direction:ltr;unicode-bidi:embed;font-size:12px'>" +
      navigator.userAgent.replace(/</g, "&lt;") +
      "</span><br>";
    if (errors.length) {
      html += "<b>الأخطاء:</b><br><span style='direction:ltr;unicode-bidi:embed;font-size:12px'>";
      for (var i = 0; i < errors.length && i < 6; i++) html += String(errors[i]).replace(/</g, "&lt;") + "<br>";
      html += "</span>";
    } else {
      html += "لا يوجد خطأ ظاهر — غالباً المتصفح قديم. جرّب تحديث الجهاز أو استعمال Chrome.";
    }
    box.innerHTML = html;
    (document.body || document.documentElement).appendChild(box);
    send("stuck", errors.join(" | ") || "لم تبدأ اللعبة خلال ٨ ثوانٍ");
  }
  setTimeout(show, 8000);
})();
