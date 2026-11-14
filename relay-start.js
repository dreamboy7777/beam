#!/usr/bin/env node
/* One-command launcher for Beam Relay.
 * Starts the local relay server, opens a public Cloudflare quick tunnel, and
 * opens the host page. The host link stays on localhost; viewers use the tunnel.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

const PORT = Number(process.env.PORT) || 8790;
const NO_OPEN = process.argv.indexOf("--no-open") !== -1;
const isWin = process.platform === "win32";
const CF_NAME = isWin ? "cloudflared.exe" : "cloudflared";
const CF_PATH = path.join(__dirname, CF_NAME);
const CF_WIN_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

let cf = null;
let srv = null;
let publicUrl = "http://localhost:" + PORT;
let shuttingDown = false;

function log(msg) {
  console.log(msg);
}

function downloadCloudflared() {
  if (fs.existsSync(CF_PATH)) return Promise.resolve(true);
  if (!isWin) {
    log("cloudflared is not installed. Install it with your package manager, then rerun this script.");
    return Promise.resolve(false);
  }
  log("Downloading cloudflared (first run only)…");
  return fetch(CF_WIN_URL).then(function (res) {
    if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
    const tmp = CF_PATH + ".part";
    const out = fs.createWriteStream(tmp);
    return new Promise(function (resolve, reject) {
      const reader = res.body.getReader();
      function pump() {
        reader.read().then(function (r) {
          if (r.done) {
            out.end(function () {
              fs.renameSync(tmp, CF_PATH);
              resolve(true);
            });
            return;
          }
          if (!out.write(Buffer.from(r.value))) {
            out.once("drain", pump);
          } else {
            pump();
          }
        }).catch(reject);
      }
      pump();
    });
  }).catch(function (err) {
    log("Could not download cloudflared: " + err.message);
    log("Download it manually from: " + CF_WIN_URL);
    return false;
  });
}

function startTunnel() {
  return new Promise(function (resolve) {
    log("Opening a public tunnel…");
    cf = spawn(CF_PATH, ["tunnel", "--url", "http://localhost:" + PORT, "--no-autoupdate"], {
      windowsHide: true
    });

    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      log("No public tunnel URL yet. Starting locally only — viewers on your network can use your LAN IP.");
      resolve(publicUrl);
    }, 30000);

    function scan(text) {
      if (settled) return;
      const m = String(text).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        settled = true;
        clearTimeout(timer);
        publicUrl = m[0];
        log("Public viewer base: " + publicUrl);
        resolve(publicUrl);
      }
    }

    cf.stdout.on("data", function (d) { scan(d.toString()); });
    cf.stderr.on("data", function (d) { scan(d.toString()); });
    cf.on("exit", function (code) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        log("cloudflared exited (" + code + "). Starting locally only.");
        resolve(publicUrl);
      }
    });
    cf.on("error", function (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        log("cloudflared failed: " + err.message);
        resolve(publicUrl);
      }
    });
  });
}

function waitForServer() {
  return new Promise(function (resolve, reject) {
    let tries = 0;
    function check() {
      tries += 1;
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/health", timeout: 1000 }, function (res) {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("timeout", function () { req.destroy(); });
      req.on("error", retry);
      function retry() {
        if (tries > 80) reject(new Error("relay server did not start"));
        else setTimeout(check, 250);
      }
    }
    check();
  });
}

function isAlreadyRunning() {
  return new Promise(function (resolve) {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/health", timeout: 800 }, function (res) {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", function () { req.destroy(); resolve(false); });
    req.on("error", function () { resolve(false); });
  });
}

function startServer() {
  log("Starting Beam Relay on http://localhost:" + PORT + " …");
  srv = spawn(process.execPath, [path.join(__dirname, "relay-server.js")], {
    env: Object.assign({}, process.env, { PORT: String(PORT), BEAM_PUBLIC_URL: publicUrl }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  srv.stdout.on("data", function (d) { process.stdout.write("[relay] " + d.toString()); });
  srv.stderr.on("data", function (d) { process.stderr.write("[relay] " + d.toString()); });
  srv.on("exit", function (code) {
    if (!shuttingDown) log("Relay server exited (" + code + ").");
    shutdown();
  });
}

function openBrowser(url) {
  try {
    if (isWin) spawn("cmd", ["/c", "start", "", url], { windowsHide: true, detached: true }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true }).unref();
    else spawn("xdg-open", [url], { detached: true }).unref();
  } catch (e) {}
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (cf) { try { cf.kill(); } catch (e) {} }
  if (srv) { try { srv.kill(); } catch (e) {} }
  setTimeout(function () { process.exit(0); }, 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

(async function main() {
  log("");
  log("  Beam Relay — Entire screen + system audio");
  log("  ----------------------------------------");
  if (await isAlreadyRunning()) {
    log("  Beam Relay is already running on http://localhost:" + PORT);
    log("  Open that page and click Share Entire screen.");
    return;
  }
  const ok = await downloadCloudflared();
  if (ok) await startTunnel();
  startServer();
  try {
    await waitForServer();
  } catch (e) {
    log("Server failed to start: " + e.message);
    shutdown();
    return;
  }

  log("");
  log("  HOST PAGE:   http://localhost:" + PORT);
  log("  VIEWER BASE: " + publicUrl);
  log("");
  log("  On the host page: Share Entire screen → tick Share system audio → Copy link.");
  log("  Keep this window open while sharing. Press Ctrl+C to stop.");
  log("");
  if (!NO_OPEN) openBrowser("http://localhost:" + PORT);
})();
