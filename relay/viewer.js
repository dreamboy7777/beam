(function () {
  "use strict";

  var room = (location.pathname.split("/watch/")[1] || "").replace(/\/$/, "").toLowerCase();
  var video = document.getElementById("video");
  var overlay = document.getElementById("overlay");
  var watchBtn = document.getElementById("watchBtn");
  var muteBtn = document.getElementById("muteBtn");
  var reloadBtn = document.getElementById("reloadBtn");
  var netDot = document.getElementById("netDot");
  var netText = document.getElementById("netText");
  var statusBadge = document.getElementById("statusBadge");

  var ws = null;
  var mime = "";
  var ms = null;
  var sb = null;
  var queue = [];
  var pending = [];
  var started = false;
  var userStarted = false;

  function setNet(state, text) {
    netDot.className = "dot " + (state || "");
    netText.textContent = text;
  }
  function setStatus(text, kind) {
    statusBadge.textContent = text;
    statusBadge.className = "badge " + (kind || "");
  }

  function resetMse(nextMime) {
    mime = nextMime || mime;
    queue = [];
    started = false;
    if (sb) { try { sb.abort(); } catch (e) {} sb = null; }
    if (ms) {
      try { if (ms.readyState === "open") ms.endOfStream(); } catch (e) {}
      ms = null;
    }
    if (video.src) {
      try { URL.revokeObjectURL(video.src); } catch (e) {}
      video.removeAttribute("src");
      video.load();
    }
    ms = new MediaSource();
    video.src = URL.createObjectURL(ms);
    ms.addEventListener("sourceopen", function () {
      try {
        sb = ms.addSourceBuffer(mime);
        sb.mode = "segments";
        sb.addEventListener("updateend", pump);
        started = true;
        if (pending.length) {
          queue = queue.concat(pending);
          pending = [];
        }
        pump();
      } catch (e) {
        setStatus("This browser can't play the relay stream. Use Chrome or Edge.", "bad");
      }
    });
  }

  function pump() {
    if (!sb || sb.updating || !queue.length) return;
    if (ms && ms.readyState !== "open") return;
    try {
      sb.appendBuffer(queue.shift());
    } catch (e) {
      if (e && e.name === "QuotaExceededError") {
        try { sb.remove(0, Math.max(0, video.currentTime - 5)); } catch (err) {}
      } else {
        setStatus("Playback error: " + (e.message || e.name || e), "bad");
      }
    }
  }

  function addChunk(buf) {
    if (!mime) { pending.push(buf); return; }
    if (!sb) { pending.push(buf); return; }
    queue.push(buf);
    pump();
  }

  function tryPlay() {
    userStarted = true;
    overlay.classList.add("hidden");
    video.muted = false;
    video.volume = 1;
    setStatus("Watching live", "ok");
    video.play().catch(function () {
      overlay.classList.remove("hidden");
      watchBtn.textContent = "Click again to allow sound";
    });
  }

  watchBtn.addEventListener("click", tryPlay);
  muteBtn.addEventListener("click", function () {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? "Unmute" : "Mute";
  });
  reloadBtn.addEventListener("click", function () { location.reload(); });

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    setNet("", "Connecting…");
    ws = new WebSocket(proto + "//" + location.host + "/ws?role=viewer&room=" + encodeURIComponent(room));
    ws.binaryType = "arraybuffer";

    ws.onopen = function () {
      setNet("live", "Connected");
      setStatus("Waiting for host to share…");
    };
    ws.onclose = function () {
      setNet("off", "Disconnected");
      setStatus("Host disconnected. Reconnecting…", "bad");
      setTimeout(connect, 1500);
    };
    ws.onerror = function () { setNet("off", "Connection error"); };

    ws.onmessage = function (event) {
      if (typeof event.data !== "string") {
        addChunk(new Uint8Array(event.data));
        return;
      }
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "status") {
        if (!msg.live) {
          setStatus("Waiting for host to share…");
        } else if (!msg.started) {
          setStatus("Host is connected. Waiting for screen…");
        } else {
          setStatus("Host is live", "ok");
        }
        if (msg.mime && !mime) resetMse(msg.mime);
        return;
      }
      if (msg.type === "start") {
        setStatus("Host is live — click Watch with sound", "ok");
        resetMse(msg.mime || "video/webm;codecs=vp8,opus");
        overlay.classList.remove("hidden");
        return;
      }
      if (msg.type === "stop") {
        setStatus("Host stopped sharing. Waiting…");
        mime = "";
        pending = [];
        queue = [];
        if (sb) { try { sb.abort(); } catch (e) {} sb = null; }
        if (ms) { try { if (ms.readyState === "open") ms.endOfStream(); } catch (e) {} ms = null; }
        video.removeAttribute("src");
        video.load();
        overlay.classList.remove("hidden");
        watchBtn.textContent = "Watch with sound";
        userStarted = false;
        return;
      }
    };
  }

  // Keep the playback close to the live edge when the relay gets ahead.
  setInterval(function () {
    if (!video.buffered || !video.buffered.length) return;
    try {
      var end = video.buffered.end(video.buffered.length - 1);
      if (end - video.currentTime > 1.8) video.currentTime = Math.max(0, end - 0.35);
    } catch (e) {}
  }, 2000);

  if (!room) {
    setStatus("Invalid room link.", "bad");
    setNet("off", "No room");
    return;
  }

  resetMse("video/webm;codecs=vp8,opus");
  connect();
})();
