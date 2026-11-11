#!/usr/bin/env node
/* Beam — zero-dependency static server.
 *
 *   node server.js            → http://localhost:8080
 *   node server.js --open     → also opens your browser
 *   PORT=3000 node server.js
 *
 * There is no backend: the page is plain HTML/CSS/JS and the video goes
 * peer-to-peer. This server only hands the files to browsers.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const ROOT = __dirname;
const START_PORT = Number(process.env.PORT) || 8080;
const MAX_PORT_TRIES = 12;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

function safeResolve(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch (e) {
    return null;
  }
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const filePath = path.resolve(ROOT, "." + pathname);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (filePath !== ROOT && !filePath.startsWith(rootWithSep)) return null;
  return filePath;
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  }, headers || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  const filePath = safeResolve(req.url || "/");
  if (!filePath) {
    send(res, 400, "Bad request");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      send(res, 404, "Not found — " + path.basename(filePath));
      return;
    }

    if (stat.isDirectory()) {
      const index = path.join(filePath, "index.html");
      fs.stat(index, (err2, stat2) => {
        if (err2 || !stat2.isFile()) {
          send(res, 404, "Not found");
          return;
        }
        streamFile(index, stat2, res);
      });
      return;
    }

    streamFile(filePath, stat, res);
  });
});

function streamFile(filePath, stat, res) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Content-Length": stat.size,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": ext === ".html" ? "no-store" : "no-cache"
  };

  res.writeHead(200, headers);
  if (res.req && res.req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    try { res.destroy(); } catch (e) {}
  });
  stream.pipe(res);
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((net) => {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    });
  });
  return out;
}

function listen(port, attempt) {
  if (attempt > MAX_PORT_TRIES) {
    console.error("\n  Could not find a free port. Try: PORT=9000 node server.js\n");
    process.exit(1);
  }

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      listen(port + 1, attempt + 1);
    } else {
      console.error("\n  Server error:", err.message, "\n");
      process.exit(1);
    }
  });

  server.listen(port, "0.0.0.0", () => {
    const local = `http://localhost:${port}`;
    const lan = lanAddresses();
    console.log("");
    console.log("  \x1b[38;5;141m\x1b[1mBeam\x1b[0m  \x1b[2m— screen sharing, peer to peer\x1b[0m");
    console.log("");
    console.log("  Local     \x1b[1m" + local + "\x1b[0m");
    lan.forEach((ip) => {
      console.log("  Network   \x1b[1mhttp://" + ip + ":" + port + "\x1b[0m  \x1b[2m(same wifi — viewing only, capture needs https)\x1b[0m");
    });
    console.log("");
    console.log("  \x1b[2mTo share over the internet, put this folder on a static host");
    console.log("  (Netlify Drop, Vercel, GitHub Pages) or run a tunnel such as");
    console.log("  \x1b[0m\x1b[2m`npx localtunnel --port " + port + "`\x1b[0m\x1b[2m. See README.md.\x1b[0m");
    console.log("");

    if (process.argv.includes("--open")) {
      const cmd = process.platform === "win32" ? `start "" "${local}"`
        : process.platform === "darwin" ? `open "${local}"`
        : `xdg-open "${local}"`;
      exec(cmd, () => {});
    }
  });
}

listen(START_PORT, 0);
