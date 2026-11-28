/**
 * رابط الإنترنت (Cloudflare Quick Tunnel) — الطريق الثاني لدخول الجوالات.
 *
 * اللعبة تعمل دائماً بطريقين معاً:
 *   📶 الشبكة المحلية: http://192.168.x.x:3000  (بدون إنترنت، لكن قد يمنعها الراوتر)
 *   🌐 الإنترنت:       https://xxxx.trycloudflare.com  (أي جوال فيه إنترنت، من أي شبكة)
 *
 * هذا الملف:
 *   - يجد cloudflared (runtime\cloudflared.exe أو المثبّت على الجهاز)، أو يحمّله مرة واحدة من
 *     إصدارات Cloudflare الرسمية على GitHub إن لم يوجد.
 *   - يشغّله ويقرأ الرابط من مخرجاته.
 *   - يراقبه: إن توقّف أو لم يعد الرابط يستجيب، يعيد تشغيله ويصنع رابطاً جديداً.
 *   - يبلّغ عن كل تغيير عبر onChange({ status, url, error }).
 *
 * لا يمنع أبداً تشغيل اللعبة: أي فشل هنا يُبقي الشبكة المحلية تعمل كالمعتاد.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";

const RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download/";
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function assetName() {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "386" : "amd64";
  if (process.platform === "win32") return `cloudflared-windows-${arch === "arm64" ? "amd64" : arch}.exe`;
  if (process.platform === "linux") return `cloudflared-linux-${arch}`;
  return null; // macOS يأتي مضغوطاً — نعتمد على النسخة المثبّتة فقط
}

function findInstalled() {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(cmd, ["cloudflared"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString();
    const first = out.split(/\r?\n/).find((l) => l.trim());
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

/** تحميل ملف مع اتباع التحويلات (GitHub يحوّل إلى خادم الملفات). */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "horoof-game" }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const tmp = dest + ".part";
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on("finish", () => out.close(() => {
        try {
          fs.renameSync(tmp, dest);
          if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
          resolve(dest);
        } catch (e) {
          reject(e);
        }
      }));
      out.on("error", reject);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("انتهت مهلة التحميل")));
    req.on("error", reject);
  });
}

/**
 * هل الرابط متصل؟ نسأل cloudflared نفسه محلياً (/ready = اتصال واحد على الأقل بشبكة Cloudflare).
 * (لا نفحص الرابط من الإنترنت: ويندوز يحفظ «غير موجود» للرابط الجديد دقائق فيعطي نتيجة خاطئة.)
 */
function ready(metricsPort) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: metricsPort, path: "/ready", timeout: 4000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/** منفذ محلي فارغ لمقاييس cloudflared. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** نسخة cloudflared بقيت من تشغيل سابق أُغلق بالقوة: نوقفها كي لا تتراكم. */
function killOrphan(pidFile) {
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    if (pid > 0) {
      if (process.platform === "win32") {
        const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { windowsHide: true }).toString();
        if (/cloudflared/i.test(out)) process.kill(pid);
      } else {
        process.kill(pid);
      }
    }
  } catch {}
  try {
    fs.unlinkSync(pidFile);
  } catch {}
}

/**
 * يبدأ الطريق الثاني ويراقبه.
 * @param {{ port: number, rootDir: string, onChange: (s: {status: string, url: string|null, error: string|null}) => void, log?: (m: string) => void }} opts
 */
export function startTunnel({ port, rootDir, onChange, log = console.log }) {
  const state = { status: "starting", url: null, error: null };
  let child = null;
  let stopped = false;
  let failures = 0;
  let restartTimer = null;
  let healthTimer = null;
  let metricsPort = 0;
  const pidFile = path.join(rootDir, "data", "cloudflared.pid");
  killOrphan(pidFile);

  const set = (patch) => {
    const before = JSON.stringify(state);
    Object.assign(state, patch);
    if (JSON.stringify(state) !== before) onChange({ ...state });
  };

  async function binary() {
    const local = path.join(rootDir, "runtime", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
    if (fs.existsSync(local) && fs.statSync(local).size > 1_000_000) return local;
    const installed = findInstalled();
    if (installed) return installed;
    const asset = assetName();
    if (!asset) throw new Error("cloudflared غير مثبّت على هذا الجهاز");
    set({ status: "downloading", error: null });
    log("  🌐 تحميل برنامج رابط الإنترنت (مرة واحدة فقط)…");
    fs.mkdirSync(path.dirname(local), { recursive: true });
    await download(RELEASES + asset, local);
    return local;
  }

  function scheduleRestart(reason) {
    if (stopped || restartTimer) return;
    failures += 1;
    const wait = Math.min(60000, 3000 * 2 ** Math.min(failures - 1, 4)); // 3s, 6s, 12s… حتى دقيقة
    set({ status: "error", url: null, error: reason });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      run();
    }, wait);
  }

  async function run() {
    if (stopped) return;
    let exe;
    try {
      exe = await binary();
    } catch (e) {
      log(`  ⚠️  رابط الإنترنت غير متاح: ${e.message} — اللعبة تعمل على الشبكة المحلية.`);
      return scheduleRestart(e.message);
    }
    if (stopped) return;
    set({ status: "starting", url: null, error: null });
    try {
      metricsPort = await freePort();
    } catch {
      metricsPort = 0;
    }
    const argv = ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`];
    if (metricsPort) argv.push("--metrics", `127.0.0.1:${metricsPort}`);
    child = spawn(exe, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try {
      fs.mkdirSync(path.dirname(pidFile), { recursive: true });
      fs.writeFileSync(pidFile, String(child.pid));
    } catch {}
    const onData = (buf) => {
      const m = String(buf).match(URL_RE);
      if (m && state.url !== m[0]) {
        // الرابط يُطبع قبل أن يصبح جاهزاً بلحظات: ننتظر أول استجابة ناجحة
        waitReady(m[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => scheduleRestart(e.message));
    child.on("exit", (code) => {
      child = null;
      if (!stopped) scheduleRestart(`توقّف برنامج الرابط (${code})`);
    });
  }

  async function waitReady(url) {
    for (let i = 0; i < 40 && !stopped; i++) {
      if (metricsPort ? await ready(metricsPort) : i >= 4) {
        failures = 0;
        set({ status: "ok", url, error: null });
        log(`  🌐 رابط الإنترنت جاهز: \x1b[32m${url}\x1b[0m`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!stopped) restart("الرابط لم يستجب");
  }

  function restart(reason) {
    log(`  ⚠️  رابط الإنترنت: ${reason} — جارٍ صنع رابط جديد…`);
    if (child) {
      const c = child;
      child = null;
      c.removeAllListeners("exit");
      try {
        c.kill();
      } catch {}
    }
    scheduleRestart(reason);
  }

  // مراقبة كل ٢٠ ثانية: ثلاث محاولات فاشلة متتالية (دقيقة) = رابط جديد
  let misses = 0;
  healthTimer = setInterval(async () => {
    if (stopped || state.status !== "ok" || !state.url || !metricsPort) return;
    if (await ready(metricsPort)) misses = 0;
    else if (++misses >= 3) {
      misses = 0;
      restart("الرابط لم يعد يستجيب");
    }
  }, 20000);
  healthTimer.unref?.();

  const stop = () => {
    stopped = true;
    try {
      fs.unlinkSync(pidFile);
    } catch {}
    clearTimeout(restartTimer);
    clearInterval(healthTimer);
    if (child) {
      try {
        child.kill();
      } catch {}
    }
  };
  // الخادم يعالج SIGINT ثم يخرج (فيُستدعى exit). إغلاق نافذة ويندوز يرسل SIGHUP.
  process.on("exit", stop);
  for (const sig of ["SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      stop();
      process.exit(0);
    });
  }

  run();
  return { get: () => ({ ...state }), stop };
}
