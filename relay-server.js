/* Beam Relay — a tiny self-hosted screen relay.
 *
 * The host captures Entire screen + system audio in the browser, encodes it
 * with MediaRecorder (WebM/VP8 + Opus), and streams the chunks over WebSocket.
 * Viewers receive the same chunks and play them through MediaSource. No TURN,
 * no accounts, no third-party media service. The server only relays bytes and
 * can be exposed with any HTTPS tunnel.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8790;
let PUBLIC_URL = process.env.BEAM_PUBLIC_URL || `http://localhost:${PORT}`;

const ROOT = __dirname;
const RELAY_DIR = path.join(ROOT, "relay");
const rooms = new Map();

function roomFor(id) {
  let room = rooms.get(id);
  if (!room) {
    room = {
      id: id,
      host: null,
      viewers: new Set(),
      mime: "",
      hasAudio: false,
      initChunk: null,
      startedAt: 0
    };
    rooms.set(id, room);
  }
  return room;
}

function sendJson(ws, msg) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(msg)); } catch (e) {}
}

function broadcast(room, payload) {
  room.viewers.forEach(function (viewer) {
    if (viewer.readyState === viewer.OPEN) {
      try { viewer.send(payload); } catch (e) {}
    }
  });
}

function sendStatus(room, viewer) {
  sendJson(viewer, {
    type: "status",
    live: !!room.host,
    started: !!room.mime,
    mime: room.mime,
    hasAudio: room.hasAudio,
    viewers: room.viewers.size
  });
}

function notifyHost(room) {
  if (!room.host || room.host.readyState !== room.host.OPEN) return;
  sendJson(room.host, { type: "viewers", count: room.viewers.size });
}

function cleanRoom(room) {
  if (room.host || room.viewers.size) return;
  rooms.delete(room.id);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendFile(res, file) {
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function validRoom(id) {
  return /^[a-z0-9-]{4,40}$/.test(id || "");
}

const server = http.createServer(function (req, res) {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch (e) { res.writeHead(400); res.end(); return; }
  const pathname = url.pathname;

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end("ok");
    return;
  }

  if (pathname === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ publicUrl: PUBLIC_URL, port: PORT }));
    return;
  }

  if (pathname === "/" || pathname === "/host") {
    sendFile(res, path.join(RELAY_DIR, "host.html"));
    return;
  }

  if (pathname.indexOf("/watch/") === 0) {
    const room = pathname.slice("/watch/".length).replace(/\/$/, "");
    if (!validRoom(room)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid room");
      return;
    }
    sendFile(res, path.join(RELAY_DIR, "viewer.html"));
    return;
  }

  if (pathname.indexOf("/relay/") === 0) {
    const file = path.join(RELAY_DIR, path.basename(pathname));
    sendFile(res, file);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocketServer({
  server: server,
  path: "/ws",
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024
});

wss.on("connection", function (ws, req) {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch (e) { ws.close(); return; }
  const roomId = (url.searchParams.get("room") || "").toLowerCase();
  const role = url.searchParams.get("role");
  if (!validRoom(roomId) || (role !== "host" && role !== "viewer")) {
    ws.close();
    return;
  }

  const room = roomFor(roomId);
  ws.isAlive = true;

  if (role === "host") {
    if (room.host && room.host !== ws) {
      try { room.host.close(4001, "Replaced by a new host"); } catch (e) {}
    }
    room.host = ws;
    room.mime = "";
    room.hasAudio = false;
    room.initChunk = null;
    room.startedAt = 0;
    sendJson(ws, { type: "ready", room: roomId, publicUrl: PUBLIC_URL });
    room.viewers.forEach(function (viewer) { sendStatus(room, viewer); });
    notifyHost(room);

    ws.on("message", function (data, isBinary) {
      if (isBinary) {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (!room.initChunk) room.initChunk = Buffer.from(chunk);
        broadcast(room, chunk);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg.type === "start") {
        room.mime = String(msg.mime || "");
        room.hasAudio = !!msg.hasAudio;
        room.startedAt = Date.now();
        room.initChunk = null;
        broadcast(room, JSON.stringify({
          type: "start",
          mime: room.mime,
          hasAudio: room.hasAudio
        }));
      } else if (msg.type === "stop") {
        room.mime = "";
        room.hasAudio = false;
        room.initChunk = null;
        room.startedAt = 0;
        broadcast(room, JSON.stringify({ type: "stop" }));
        room.viewers.forEach(function (viewer) { sendStatus(room, viewer); });
      } else if (msg.type === "ping") {
        sendJson(ws, { type: "pong" });
      }
    });

    ws.on("close", function () {
      if (room.host === ws) {
        room.host = null;
        room.mime = "";
        room.hasAudio = false;
        room.initChunk = null;
        room.startedAt = 0;
        broadcast(room, JSON.stringify({ type: "stop" }));
        room.viewers.forEach(function (viewer) { sendStatus(room, viewer); });
        cleanRoom(room);
      }
    });
  } else {
    room.viewers.add(ws);
    sendStatus(room, ws);
    // Ask the host to restart its recorder so this viewer gets a fresh,
    // live init segment instead of catching up from the start.
    if (room.host && room.host.readyState === room.host.OPEN) {
      sendJson(room.host, { type: "viewer-joined" });
    }
    if (room.mime) {
      sendJson(ws, { type: "start", mime: room.mime, hasAudio: room.hasAudio });
      // A late viewer can usually start from the cached init segment.
      if (room.initChunk) {
        try { ws.send(room.initChunk); } catch (e) {}
      }
    }
    notifyHost(room);

    ws.on("message", function (data, isBinary) {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg.type === "ping") sendJson(ws, { type: "pong" });
    });

    ws.on("close", function () {
      room.viewers.delete(ws);
      notifyHost(room);
      cleanRoom(room);
    });
  }

  ws.on("pong", function () { ws.isAlive = true; });
  ws.on("error", function () {});
});

const heartbeat = setInterval(function () {
  wss.clients.forEach(function (ws) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch (e) {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

server.listen(PORT, "0.0.0.0", function () {
  console.log("Beam Relay listening on http://localhost:" + PORT);
  console.log("Public viewer base: " + PUBLIC_URL);
});

module.exports = { server, wss, setPublicUrl: function (url) { PUBLIC_URL = url; }, heartbeat };
