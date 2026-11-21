/**
 * عميل الاتصال بالخادم — WebSocket مع إعادة اتصال تلقائية.
 * يعمل على نفس الجهاز أو عبر الشبكة المحلية.
 */

export class Transport {
  /**
   * @param {'screen'|'referee'|'buzzer'} role
   * @param {string} room اسم الغرفة
   * @param {string} pairCode رمز الاقتران (للحكم فقط)
   * @param {object} extra حقول إضافية تُرسل مع hello (مثل team لجرس اللاعب)
   */
  constructor(role, room = "main", pairCode = "", extra = {}) {
    this.role = role;
    this.room = room;
    this.pairCode = pairCode;
    this.extra = extra;
    this.ws = null;
    this.queue = [];
    this.retry = 0;
    this.closed = false;
    this.serverOffset = 0; // فرق الوقت بين الخادم والمتصفح
    this.onState = () => {};
    this.onStatus = () => {};
    this.onAction = () => {};
    this.onPairing = () => {};
    this.onBuzzed = () => {};
  }

  url() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws?room=${encodeURIComponent(this.room)}`;
  }

  connect() {
    if (this.closed) return;
    this.onStatus(this.retry === 0 ? "connecting" : "reconnecting");

    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.onStatus("online");
      ws.send(JSON.stringify({ t: "hello", role: this.role, room: this.room, pairCode: this.pairCode, ...this.extra }));
      while (this.queue.length) ws.send(this.queue.shift());
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === "state") {
        this.serverOffset = msg.serverTime - Date.now();
        this.onState(msg);
      } else if (msg.t === "pong") {
        this.serverOffset = msg.serverTime - Date.now();
      } else if (msg.t === "pairing") {
        this.onPairing(msg);
      } else if (msg.t === "buzzed") {
        this.onBuzzed(msg);
      } else if (this.onMessage) {
        this.onMessage(msg); // رسائل أخرى (مثل kicked للاعب)
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.onStatus("offline");
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(8000, 600 * Math.pow(1.6, this.retry++));
    setTimeout(() => this.connect(), delay);
  }

  /** يرسل إجراءً للحكم (يتجاهله الخادم إن كان الدور ليس referee). */
  send(action) {
    const payload = JSON.stringify({ t: "action", action });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.queue.push(payload);
      if (this.queue.length > 40) this.queue.shift();
    }
  }

  /** يرسل رسالة خام كما هي (يستخدمها جرس اللاعب: { t: "buzz" }). */
  sendRaw(msg) {
    const payload = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.queue.push(payload);
      if (this.queue.length > 40) this.queue.shift();
    }
  }

  /** يرسل ضغطة جرس. */
  buzz() {
    this.sendRaw({ t: "buzz" });
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch {}
  }

  setPairCode(code) {
    this.pairCode = code;
    this.retry = 0;
    try { this.ws?.close(); } catch {}
  }
}

/** الوقت المتبقي بالملي ثانية حسب ساعة الخادم. */
export function remainingMs(timer, serverOffset) {
  if (!timer || !timer.running || !timer.endsAt) return 0;
  return Math.max(0, timer.endsAt - (Date.now() + serverOffset));
}

/** يعيد الخادم لقطة حالة كاملة عند الاتصال. */
export async function fetchState(room = "main") {
  const res = await fetch(`/api/state?room=${encodeURIComponent(room)}`);
  if (!res.ok) throw new Error("تعذّر جلب الحالة");
  return res.json();
}
