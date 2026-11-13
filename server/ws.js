/**
 * خادم WebSocket مصغّر بلا أي اعتمادات خارجية (Zero-dependency).
 * يدعم: النص، الثنائي (غير مستخدم)، ping/pong، fragmentation، وإغلاق نظيف.
 *
 * مبني على مواصفة RFC 6455.
 */
import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export class WsConnection {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.meta = {}; // بيانات إضافية (الدور، الغرفة...)

    socket.setNoDelay(true);
    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("close", () => this._cleanup());
    socket.on("error", () => this._cleanup());
    socket.on("end", () => this._cleanup());
  }

  _cleanup() {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.destroy();
    } catch {}
    if (this.onclose) this.onclose();
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // حماية من الرسائل الضخمة/المُلفقة
    if (this.buffer.length > 4 * 1024 * 1024) return this.close(1009, "message too big");

    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < offset + 2) return;
        len = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this.buffer.length < offset + 8) return;
        const big = this.buffer.readBigUInt64BE(offset);
        if (big > 8n * 1024n * 1024n) return this.close(1009, "message too big");
        len = Number(big);
        offset += 8;
      }

      let maskKey = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + len) return; // incomplete frame

      const payload = Buffer.from(this.buffer.subarray(offset, offset + len));
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
      }
      this.buffer = this.buffer.subarray(offset + len);
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP_PING:
        this._sendFrame(OP_PONG, payload);
        return;
      case OP_PONG:
        return;
      case OP_CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        this.close(code === 1005 ? 1000 : code, "");
        return;
      }
      case OP_CONT: {
        if (this.fragmentOpcode === null) return this.close(1002, "unexpected continuation");
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments);
          const op = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = null;
          this._deliver(op, full);
        }
        return;
      }
      case OP_TEXT:
      case OP_BIN: {
        if (!fin) {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
          return;
        }
        this._deliver(opcode, payload);
        return;
      }
      default:
        this.close(1002, "unknown opcode");
    }
  }

  _deliver(opcode, payload) {
    if (opcode === OP_TEXT) {
      const text = payload.toString("utf8");
      if (this.onmessage) {
        try {
          this.onmessage(text);
        } catch (err) {
          console.error("[ws] onmessage error:", err);
        }
      }
    }
  }

  _sendFrame(opcode, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this._cleanup();
    }
  }

  send(data) {
    const payload = Buffer.from(
      typeof data === "string" ? data : JSON.stringify(data),
      "utf8"
    );
    this._sendFrame(OP_TEXT, payload);
  }

  ping() {
    this._sendFrame(OP_PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = "") {
    if (!this.open) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this._sendFrame(OP_CLOSE, payload);
    this.open = false;
    try {
      this.socket.end();
    } catch {}
    setTimeout(() => this._cleanup(), 50);
    if (this.onclose) {
      const cb = this.onclose;
      this.onclose = null;
      cb();
    }
  }
}

export class WsServer {
  /**
   * @param {import('node:http').Server} server
   * @param {{ path?: string }} [opts]
   */
  constructor(server, opts = {}) {
    this.path = opts.path || "/ws";
    this.clients = new Set();

    server.on("upgrade", (req, socket, head) => {
      let pathname;
      try {
        pathname = new URL(req.url, "http://localhost").pathname;
      } catch {
        return socket.destroy();
      }
      if (pathname !== this.path) return socket.destroy();

      const key = req.headers["sec-websocket-key"];
      if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        return socket.destroy();
      }

      const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );

      const conn = new WsConnection(socket, req);
      this.clients.add(conn);
      conn.onclose = () => this.clients.delete(conn);
      // نحفظ المعالج الأصلي ليمكن استدعاؤه من جانب التطبيق
      conn._wsCleanup = conn.onclose;
      if (head && head.length) conn._onData(head);
      if (this.onconnection) this.onconnection(conn);
    });

    // نبضة دورية للحفاظ على الاتصال حياً عبر الشبكات المحلية
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (c.open) c.ping();
      }
    }, 30000);
    this.heartbeat.unref?.();
  }

  broadcast(data) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    for (const c of this.clients) {
      if (c.open) c.send(text);
    }
  }

  close() {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.close(1001, "server shutdown");
  }
}
