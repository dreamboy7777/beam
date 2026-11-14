(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var testMode = params.get("test") === "1";
  var room = params.get("room") || sessionStorage.getItem("beam-relay-room");
  if (!room || !/^[a-z0-9-]{4,40}$/.test(room)) {
    room = "beam-" + Math.random().toString(36).slice(2, 10);
  }
  sessionStorage.setItem("beam-relay-room", room);
  try { history.replaceState(null, "", "/?room=" + room + (testMode ? "&test=1" : "")); } catch (e) {}

  var els = {
    netDot: document.getElementById("netDot"),
    netText: document.getElementById("netText"),
    preview: document.getElementById("preview"),
    stageEmpty: document.getElementById("stageEmpty"),
    shareBtn: document.getElementById("shareBtn"),
    stopBtn: document.getElementById("stopBtn"),
    soundBadge: document.getElementById("soundBadge"),
    viewerBadge: document.getElementById("viewerBadge"),
    soundWarn: document.getElementById("soundWarn"),
    viewerLink: document.getElementById("viewerLink"),
    copyBtn: document.getElementById("copyBtn"),
    publicHint: document.getElementById("publicHint"),
    soundModal: document.getElementById("soundModal"),
    soundReason: document.getElementById("soundReason"),
    soundRetry: document.getElementById("soundRetry"),
    soundCancel: document.getElementById("soundCancel")
  };

  var ws = null;
  var wsReady = false;
  var reconnectTimer = null;
  var stream = null;
  var recorder = null;
  var sendChain = Promise.resolve();
  var sharing = false;
  var shareGen = 0;
  var viewerRestartTimer = null;

  function setNet(state, text) {
    els.netDot.className = "dot " + (state || "");
    els.netText.textContent = text;
  }

  function setViewerLink(publicUrl) {
    var base = (publicUrl || location.origin).replace(/\/$/, "");
    els.viewerLink.value = base + "/watch/" + room;
    els.publicHint.textContent = "Viewer base: " + base;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    setNet("", "Connecting…");
    try {
      ws = new WebSocket(proto + "//" + location.host + "/ws?role=host&room=" + encodeURIComponent(room));
    } catch (e) {
      setNet("off", "Offline");
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      wsReady = true;
      setNet("live", "Relay connected");
      // If the relay socket blipped while we were sharing, restart the recorder
      // with a fresh init segment instead of dropping the screen share.
      if (sharing && stream) restartRecorder();
    };

    ws.onmessage = function (event) {
      if (typeof event.data !== "string") return;
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "ready" && msg.publicUrl) setViewerLink(msg.publicUrl);
      if (msg.type === "viewer-joined" && sharing && stream) {
        clearTimeout(viewerRestartTimer);
        viewerRestartTimer = setTimeout(function () {
          if (sharing && stream) restartRecorder();
        }, 350);
      }
      if (msg.type === "viewers") {
        els.viewerBadge.textContent = "Viewers: " + (msg.count || 0);
        if (msg.count > 0 && sharing) els.viewerBadge.classList.add("ok");
        else els.viewerBadge.classList.remove("ok");
      }
    };

    ws.onclose = function () {
      wsReady = false;
      setNet("off", sharing ? "Relay reconnecting — still capturing" : "Relay disconnected");
      scheduleReconnect();
    };

    ws.onerror = function () {
      setNet("off", "Relay error");
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }

  function sendJson(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (e) {}
    }
  }

  function pickMime() {
    var types = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm"
    ];
    for (var i = 0; i < types.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  function setSound(hasAudio) {
    els.soundBadge.textContent = hasAudio ? "Sound: ON" : "Sound: OFF";
    els.soundBadge.className = "badge " + (hasAudio ? "ok" : "bad");
    els.soundWarn.classList.toggle("on", !hasAudio);
  }

  function makeTestStream() {
    var canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    var ctx = canvas.getContext("2d");
    var n = 0;
    setInterval(function () {
      ctx.fillStyle = "#101320";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#4cc9f0";
      ctx.font = "700 64px sans-serif";
      ctx.fillText("BEAM RELAY TEST", 60, 150);
      ctx.fillStyle = "#b9a5ff";
      ctx.font = "600 42px sans-serif";
      ctx.fillText("Screen + sound is flowing", 60, 230);
      ctx.fillStyle = "#35e0a1";
      ctx.beginPath();
      ctx.arc(100 + (n % 1000), 500, 60, 0, Math.PI * 2);
      ctx.fill();
      n += 14;
    }, 100);
    var video = canvas.captureStream(30);

    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    var audio = new AudioCtx();
    var osc = audio.createOscillator();
    var gain = audio.createGain();
    var dest = audio.createMediaStreamDestination();
    osc.type = "sine";
    osc.frequency.value = 520;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    var combined = new MediaStream();
    video.getVideoTracks().forEach(function (t) { combined.addTrack(t); });
    dest.stream.getAudioTracks().forEach(function (t) { combined.addTrack(t); });
    return combined;
  }

  function showSoundModal(surface) {
    var reason;
    if (surface === "window") {
      reason = "You shared a Window. Window sharing cannot capture system audio. Share Entire screen instead.";
    } else if (surface === "browser") {
      reason = "You shared a tab without tab audio. Turn on Share tab audio, or share Entire screen with system audio.";
    } else {
      reason = "Entire screen was selected, but Share system audio was off. Tick it at the bottom of the picker.";
    }
    els.soundReason.textContent = reason;
    els.soundModal.hidden = false;
  }

  function restartRecorder() {
    if (!stream) return;
    var old = recorder;
    recorder = null;
    if (old && old.state !== "inactive") {
      old._restarting = true;
      try { old.stop(); } catch (e) {}
    }
    // Drop any chunks queued from the old generation.
    shareGen += 1;
    sendChain = Promise.resolve();
    startRecorder(stream, true);
  }

  function startRecorder(media, restarting) {
    var mime = pickMime();
    if (!mime) {
      alert("This browser can't record WebM. Use Chrome or Edge.");
      return;
    }
    var myGen = shareGen + 1;
    shareGen = myGen;
    var options = { mimeType: mime, videoBitsPerSecond: 3000000, audioBitsPerSecond: 96000 };
    var rec;
    try {
      rec = new MediaRecorder(media, options);
    } catch (e) {
      try { rec = new MediaRecorder(media, { mimeType: mime }); }
      catch (err) { alert("Could not start the screen recorder: " + (err.message || err)); return; }
    }
    recorder = rec;

    var hasAudio = media.getAudioTracks().length > 0;
    setSound(hasAudio);
    sharing = true;
    els.shareBtn.hidden = true;
    els.stopBtn.hidden = false;
    els.stageEmpty.hidden = true;
    if (!restarting) {
      els.viewerBadge.textContent = "Viewers: 0";
      els.viewerBadge.classList.remove("ok");
    }

    sendJson({ type: "start", mime: mime, hasAudio: hasAudio });

    rec.ondataavailable = function (event) {
      if (!event.data || !event.data.size) return;
      if (myGen !== shareGen) return;
      sendChain = sendChain.then(function () {
        return event.data.arrayBuffer().then(function (buf) {
          if (myGen !== shareGen) return;
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(buf); } catch (e) {}
          }
        });
      }).catch(function () {});
    };

    rec.onstop = function () {
      if (rec._restarting) return;
      if (myGen !== shareGen) return;
      sendChain = sendChain.then(function () {
        sendJson({ type: "stop" });
      });
      if (media) {
        media.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      }
      if (stream === media) stream = null;
      sharing = false;
      recorder = null;
      els.shareBtn.hidden = false;
      els.stopBtn.hidden = true;
      els.stageEmpty.hidden = false;
      els.stageEmpty.innerHTML = "<strong>Share stopped.</strong><br />Click <b>Share Entire screen</b> to start again.";
      els.preview.srcObject = null;
      setSound(false);
      els.soundWarn.classList.remove("on");
    };

    rec.start(250);
  }

  function share() {
    if (sharing) return;
    els.shareBtn.disabled = true;
    els.shareBtn.textContent = "Opening picker…";
    els.soundWarn.classList.remove("on");

    var mediaPromise;
    if (testMode) {
      mediaPromise = Promise.resolve(makeTestStream());
    } else {
      var constraints = {
        video: {
          frameRate: { ideal: 30, max: 30 },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          cursor: "motion"
        },
        audio: true,
        systemAudio: "include",
        monitorTypeSurfaces: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        preferCurrentTab: false
      };
      mediaPromise = navigator.mediaDevices.getDisplayMedia(constraints);
    }

    mediaPromise.then(function (media) {
      var videoTrack = media.getVideoTracks()[0];
      var surface = "";
      try { surface = videoTrack && videoTrack.getSettings ? videoTrack.getSettings().displaySurface : ""; } catch (e) {}
      if (videoTrack) {
        // Keep text legible when bandwidth dips.
        try { videoTrack.contentHint = "detail"; } catch (e) {}
      }

      if (!testMode && media.getAudioTracks().length === 0) {
        // Refuse a silent share instead of letting them talk into the void.
        media.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        els.preview.srcObject = null;
        showSoundModal(surface);
        return;
      }

      stream = media;
      els.preview.srcObject = media;
      els.preview.muted = true;
      els.preview.play().catch(function () {});

      if (videoTrack) {
        videoTrack.addEventListener("ended", function () {
          if (sharing) stopShare();
        });
      }
      startRecorder(media, false);
    }).catch(function (err) {
      var name = err && err.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        // User cancelled the picker.
      } else {
        alert("Could not capture the screen: " + ((err && err.message) || name || err));
      }
    }).then(function () {
      els.shareBtn.disabled = false;
      els.shareBtn.textContent = "Share Entire screen";
    });
  }

  function stopShare() {
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (e) {}
    } else if (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      stream = null;
      sharing = false;
      els.shareBtn.hidden = false;
      els.stopBtn.hidden = true;
      els.preview.srcObject = null;
      sendJson({ type: "stop" });
    }
  }

  function copyLink() {
    var text = els.viewerLink.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        els.copyBtn.textContent = "Copied";
        setTimeout(function () { els.copyBtn.textContent = "Copy"; }, 1500);
      }).catch(function () {
        els.viewerLink.select();
      });
    } else {
      els.viewerLink.select();
      document.execCommand("copy");
    }
  }

  els.shareBtn.addEventListener("click", share);
  els.stopBtn.addEventListener("click", stopShare);
  els.copyBtn.addEventListener("click", copyLink);
  els.viewerLink.addEventListener("focus", function () { els.viewerLink.select(); });
  els.soundRetry.addEventListener("click", function () {
    els.soundModal.hidden = true;
    share();
  });
  els.soundCancel.addEventListener("click", function () {
    els.soundModal.hidden = true;
  });

  window.addEventListener("beforeunload", function () {
    sendJson({ type: "stop" });
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (e) {}
    }
    if (ws) { try { ws.close(); } catch (e) {} }
  });

  fetch("/api/config").then(function (r) { return r.json(); }).then(function (cfg) {
    if (cfg && cfg.publicUrl) setViewerLink(cfg.publicUrl);
  }).catch(function () {});

  setViewerLink("");
  connect();
})();
