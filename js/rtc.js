/* Beam — WebRTC mesh over PeerJS.
 *
 * Topology: everyone keeps a data channel for presence, chat and reactions.
 * Screen video travels on its own one-way media connection per direction, so
 * there is never a renegotiation step to get wrong: if A shares, A calls B.
 *
 *   A  ──data──►  B          (chat, presence, roster)
 *   A  ──media──► B          (A's screen)
 *   B  ──media──► A          (B's screen, only while B is sharing)
 */
(function (global) {
  "use strict";

  var STUN = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["stun:global.stun.twilio.com:3478"] }
  ];

  var DIAL_ATTEMPTS = 3;
  var DIAL_TIMEOUT = 9000;

  var PREFIX_HOST = "beamk";
  var PREFIX_GUEST = "beamg";

  function normalizeTurn(turn) {
    if (!turn) return null;
    if (typeof turn === "string") turn = { urls: turn };
    var urls = turn.urls;
    if (typeof urls === "string") urls = urls.split(/[\s,]+/);
    if (!Array.isArray(urls)) return null;
    urls = urls.map(function (u) { return String(u || "").trim(); }).filter(function (u) {
      return /^turns?:/i.test(u);
    });
    if (!urls.length) return null;
    return {
      urls: urls,
      username: String(turn.username || ""),
      credential: String(turn.credential || "")
    };
  }

  function iceConfig(turn) {
    var servers = STUN.slice();
    var custom = normalizeTurn(turn);
    if (custom) servers.push(custom);
    return { iceServers: servers };
  }

  function Emitter() {
    this._events = {};
  }
  Emitter.prototype.on = function (evt, fn) {
    (this._events[evt] || (this._events[evt] = [])).push(fn);
    return this;
  };
  Emitter.prototype.off = function (evt, fn) {
    var list = this._events[evt];
    if (!list) return this;
    this._events[evt] = list.filter(function (f) { return f !== fn; });
    return this;
  };
  Emitter.prototype.emit = function (evt) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = this._events[evt];
    if (list) {
      list.slice().forEach(function (fn) {
        try { fn.apply(null, args); } catch (e) { console.error("[beam] listener error:", e); }
      });
    }
    var any = this._events["*"];
    if (any) {
      any.slice().forEach(function (fn) {
        try { fn.apply(null, [evt].concat(args)); } catch (e) { console.error("[beam] listener error:", e); }
      });
    }
    return this;
  };

  function slug(name) {
    return String(name || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function Mesh(opts) {
    Emitter.call(this);
    opts = opts || {};

    this.role = opts.role === "guest" ? "guest" : "host";
    this.me = opts.me || { name: "Someone", hue: 0, avatar: null };
    this.hostName = opts.hostName || "";
    this.signal = opts.signal || null;
    this.turn = opts.turn || null;
    this.hostId = this.role === "guest" ? PREFIX_HOST + slug(this.hostName) : null;

    this.peers = new Map();
    this.peer = null;
    this.localStream = null;
    this.quality = "1080";
    this.startedAt = 0;
    this.destroyed = false;
    this.status = "idle";

    this._hostTimer = null;
    this._dialTimer = null;
    this._dialAttempts = 0;
    this._sawUnavailable = 0;
    this._relayOnly = false;
    this._retuneTimer = null;
  }
  Mesh.prototype = Object.create(Emitter.prototype);
  Mesh.prototype.constructor = Mesh;

  Mesh.PREFIX = { host: PREFIX_HOST, guest: PREFIX_GUEST };
  Mesh.slug = slug;
  Mesh.iceConfig = iceConfig;

  Mesh.hostIdFor = function (name) {
    var s = slug(name);
    return s ? PREFIX_HOST + s : null;
  };

  Mesh.guestIdFor = function (name) {
    var s = slug(name) || "guest";
    return PREFIX_GUEST + s.slice(0, 14) + Math.random().toString(36).slice(2, 6);
  };

  /* ── lifecycle ───────────────────────────────────────── */

  Mesh.prototype.start = function () {
    var self = this;

    if (typeof global.Peer !== "function") {
      this.emit("fatal", { code: "no-library", message: "The connection library didn't load. Check your internet connection and reload." });
      return;
    }

    var myId = this.role === "host"
      ? Mesh.hostIdFor(this.me.name)
      : Mesh.guestIdFor(this.me.name);

    if (!myId) {
      this.emit("fatal", { code: "bad-name", message: "Use at least two letters or numbers in your name." });
      return;
    }

    this.id = myId;
    this.setStatus("connecting");

    var ice = iceConfig(this.turn);
    if (this._relayOnly) ice.iceTransportPolicy = "relay";
    var options = {
      debug: 1,
      config: ice,
      pingInterval: 5000
    };
    if (this.signal && this.signal.host) {
      options.host = this.signal.host;
      options.secure = this.signal.secure !== false;
      if (this.signal.port) options.port = Number(this.signal.port);
      if (this.signal.path) options.path = this.signal.path;
      if (this.signal.key) options.key = this.signal.key;
    }

    var peer;
    try {
      peer = new global.Peer(myId, options);
    } catch (e) {
      this.emit("fatal", { code: "no-library", message: "Could not start the connection." });
      return;
    }
    this.peer = peer;

    peer.on("open", function (id) {
      if (self.destroyed) return;
      self.id = id;
      self.startedAt = Date.now();
      self.emit("open", id);
      self._idRetries = 0;
      if (self.role === "host") self.setStatus("live");
      if (self.role === "guest") {
        self._dialAttempts = 0;
        self._sawUnavailable = 0;
        self.dialHost();
        // Absolute backstop in case every dial path silently stalls.
        self._hostTimer = setTimeout(function () {
          if (self.destroyed || self.status === "live") return;
          self.failHost();
        }, DIAL_ATTEMPTS * DIAL_TIMEOUT + 6000);
      }
    });

    peer.on("connection", function (conn) { self.acceptConn(conn); });
    peer.on("call", function (call) { self.acceptCall(call); });

    peer.on("error", function (err) { self.handleError(err); });

    peer.on("disconnected", function () {
      if (self.destroyed) return;
      self.setStatus("reconnecting");
      setTimeout(function () {
        if (self.destroyed || !self.peer || self.peer.destroyed) return;
        try { self.peer.reconnect(); } catch (e) { /* ignore */ }
      }, 1200);
    });

    peer.on("close", function () {
      if (self.destroyed) return;
      self.setStatus("offline");
      self.emit("closed");
    });
  };

  Mesh.prototype.setStatus = function (status) {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  };

  Mesh.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this._hostTimer);
    clearTimeout(this._dialTimer);
    clearTimeout(this._retuneTimer);

    if (this.localStream) {
      this.localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      this.localStream = null;
    }

    var self = this;
    Array.from(this.peers.values()).forEach(function (link) { self.dropLink(link); });
    this.peers.clear();

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) { /* ignore */ }
      this.peer = null;
    }
  };

  /** Recreate the signalling socket without losing our identity. */
  Mesh.prototype.reopen = function () {
    if (this.destroyed) return;
    var self = this;
    Array.from(this.peers.values()).forEach(function (link) { self.dropLink(link); });
    this.peers.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    this.start();
  };

  /* ── host dialing ────────────────────────────────────── */

  /** Dial the host, retrying with a brand-new data connection each time.
   *  A single stalled ICE attempt can otherwise leave the guest "knocking"
   *  forever; a fresh RTCPeerConnection often picks a working path. */
  Mesh.prototype.dialHost = function () {
    if (this.destroyed || this.role !== "guest" || !this.hostId) return;
    if (this.status === "live") return;

    var self = this;
    clearTimeout(this._dialTimer);
    this._dialAttempts += 1;

    // If direct/STUN routes have failed twice and a relay is configured, make
    // the last attempt relay-only. A working TURN path then becomes
    // deterministic even when direct ICE never settles.
    if (this._dialAttempts >= DIAL_ATTEMPTS && !this._sawUnavailable &&
        !this._relayOnly && normalizeTurn(this.turn)) {
      this._relayOnly = true;
      if (this.peer && this.peer.options && this.peer.options.config) {
        this.peer.options.config.iceTransportPolicy = "relay";
      }
    }

    var existing = this.peers.get(this.hostId);
    if (existing && existing.open) return;
    if (existing) {
      // Abandon the half-open attempt. Mark it stale so late events from its
      // connection can't open it or tear down a newer link.
      existing.stale = true;
      this.dropLink(existing);
    }

    this.emit("dialing", {
      attempt: this._dialAttempts,
      max: DIAL_ATTEMPTS,
      relay: this._relayOnly
    });

    var link = this.connect(this.hostId);
    if (!link) {
      if (this._dialAttempts < DIAL_ATTEMPTS) {
        this._dialTimer = setTimeout(function () { self.dialHost(); }, 800);
      } else {
        this.failHost();
      }
      return;
    }

    this._dialTimer = setTimeout(function () {
      if (self.destroyed || self.status === "live") return;
      var current = self.peers.get(self.hostId);
      if (current && current.open) return;
      if (self._dialAttempts < DIAL_ATTEMPTS) {
        self.dialHost();
      } else {
        self.failHost();
      }
    }, DIAL_TIMEOUT);
  };

  Mesh.prototype.failHost = function () {
    if (this.destroyed) return;
    clearTimeout(this._hostTimer);
    clearTimeout(this._dialTimer);

    if (this._sawUnavailable) {
      this.emit("fatal", {
        code: "not-found",
        message: "No live session under @" + slug(this.hostName) + " right now. Check the name, or ask them to open Beam and start a session."
      });
      return;
    }

    var relay = normalizeTurn(this.turn);
    this.emit("fatal", {
      code: "unreachable",
      message: relay
        ? "Couldn't reach @" + slug(this.hostName) + ". Check the relay in Settings → Relay (TURN) with Test relay, and keep both tabs open."
        : "Couldn't reach @" + slug(this.hostName) + ". This network needs a relay: add one in Settings → Relay (TURN). Only the host needs it."
    });
  };

  /* ── data channels ───────────────────────────────────── */


  Mesh.prototype.connect = function (peerId) {
    if (this.destroyed || !this.peer || !peerId || peerId === this.id) return null;

    var existing = this.peers.get(peerId);
    if (existing && existing.conn && !existing.conn.closed) return existing;

    var link = this.ensureLink(peerId);
    var conn;
    try {
      conn = this.peer.connect(peerId, {
        metadata: { profile: this.me },
        reliable: true,
        serialization: "json"
      });
    } catch (e) {
      this.emit("error", e);
      return null;
    }
    if (!conn) return null;

    link.conn = conn;
    this.wireConn(link, conn);
    return link;
  };

  Mesh.prototype.acceptConn = function (conn) {
    if (this.destroyed || !conn) return;

    var existing = this.peers.get(conn.peer);
    if (existing && existing.conn && !existing.conn.closed) {
      var pc = existing.conn.peerConnection;
      var pcState = pc && pc.connectionState;
      var dead = pcState === "failed" || pcState === "closed" || pcState === "disconnected";
      if (existing.open && !dead) {
        // Duplicate handshake (both sides opened at once) — keep the live one.
        try { conn.close(); } catch (e) {}
        return;
      }
      // A fresh arrival beats a pending or dying attempt: the old one may be
      // stuck behind a dead NAT path. Swapping it lets the retry succeed
      // instead of being rejected as a duplicate.
      try { existing.conn.close(); } catch (e) {}
      existing.conn = null;
    }

    var profile = conn.metadata && conn.metadata.profile ? conn.metadata.profile : null;
    var link = this.ensureLink(conn.peer, profile);
    link.conn = conn;
    this.wireConn(link, conn);
  };

  Mesh.prototype.ensureLink = function (peerId, profile) {
    var link = this.peers.get(peerId);
    if (link) {
      if (profile && profile.name) link.profile = Object.assign({}, link.profile, profile);
      return link;
    }
    link = {
      id: peerId,
      profile: profile && profile.name ? Object.assign({ name: "Guest", hue: 0, avatar: null }, profile) : { name: "Guest", hue: 0, avatar: null },
      conn: null,
      open: false,
      inCall: null,
      outCall: null,
      stream: null,
      rtt: null,
      pingTimer: null
    };
    this.peers.set(peerId, link);
    this.emit("peer-add", link);
    return link;
  };

  Mesh.prototype.wireConn = function (link, conn) {
    if (!conn || conn.__beamWired) return;
    conn.__beamWired = true;
    var self = this;

    function current() {
      return !self.destroyed && !link.stale &&
        self.peers.get(link.id) === link && link.conn === conn;
    }

    conn.on("open", function () {
      if (!current()) { try { conn.close(); } catch (e) {} return; }
      link.open = true;
      clearTimeout(self._hostTimer);
      clearTimeout(self._dialTimer);
      self._dialAttempts = 0;
      self._sawUnavailable = 0;

      self.send(link, { t: "profile", profile: self.me });

      if (self.role === "host") self.sendRoster();
      if (self.localStream) self.callPeer(link);

      self.emit("peer-ready", link);

      if (self.role === "guest" && link.id === self.hostId) {
        self.setStatus("live");
      }

      clearInterval(link.pingTimer);
      link.pingTimer = setInterval(function () {
        if (self.destroyed || !link.open) return;
        self.send(link, { t: "ping", at: Date.now() });
      }, 6000);
      self.send(link, { t: "ping", at: Date.now() });
    });

    conn.on("data", function (data) {
      if (!current()) return;
      self.onMessage(link, data);
    });

    conn.on("close", function () {
      if (!current()) return;
      var wasOpen = link.open;
      self.dropLink(link);

      if (wasOpen && self.role === "guest" && link.id === self.hostId) {
        self.emit("host-lost");
        return;
      }

      // A failed attempt that never opened: retry straight away instead of
      // waiting out the watchdog. PeerJS closes the PC as soon as ICE fails.
      if (!wasOpen && self.role === "guest" && link.id === self.hostId && self.status !== "live") {
        clearTimeout(self._dialTimer);
        if (self._dialAttempts < DIAL_ATTEMPTS) {
          self._dialTimer = setTimeout(function () {
            if (!self.destroyed && self.status !== "live") self.dialHost();
          }, 500);
        } else {
          self.failHost();
        }
      }
    });

    conn.on("error", function (err) {
      console.warn("[beam] data error", err && err.type);
    });
  };

  Mesh.prototype.onMessage = function (link, msg) {
    if (!msg || typeof msg !== "object") return;

    switch (msg.t) {
      case "profile":
        if (msg.profile && msg.profile.name) {
          link.profile = Object.assign({}, link.profile, msg.profile);
          this.emit("peer-update", link);
        }
        break;

      case "chat":
        if (typeof msg.text === "string" && msg.text.trim()) {
          this.emit("chat", {
            id: link.id,
            profile: link.profile,
            text: String(msg.text).slice(0, 2000),
            at: msg.at || Date.now(),
            mine: false
          });
        }
        break;

      case "reaction":
        if (typeof msg.emoji === "string") {
          this.emit("reaction", { id: link.id, profile: link.profile, emoji: msg.emoji.slice(0, 8) });
        }
        break;

      case "roster":
        this.onRoster(msg.peers);
        break;

      case "ping":
        this.send(link, { t: "pong", at: msg.at });
        break;

      case "pong":
        link.rtt = Math.max(0, Date.now() - Number(msg.at || Date.now()));
        this.emit("peer-update", link);
        break;

      case "bye":
        this.dropLink(link);
        break;
    }
  };

  Mesh.prototype.send = function (link, msg) {
    if (!link || !link.conn) return false;
    try {
      if (!link.conn.open) return false;
      link.conn.send(msg);
      return true;
    } catch (e) {
      return false;
    }
  };

  Mesh.prototype.broadcast = function (msg, exceptId) {
    var self = this;
    this.peers.forEach(function (link) {
      if (exceptId && link.id === exceptId) return;
      self.send(link, msg);
    });
  };

  /* ── roster / mesh-building ──────────────────────────── */

  Mesh.prototype.sendRoster = function () {
    if (this.role !== "host" || this.destroyed) return;
    var self = this;
    var list = [{ id: this.id, profile: this.me, host: true }];
    this.peers.forEach(function (link) {
      if (link.open) list.push({ id: link.id, profile: link.profile, host: false });
    });
    var payload = { t: "roster", peers: list };
    this.peers.forEach(function (link) {
      if (link.open) self.send(link, payload);
    });
  };

  Mesh.prototype.onRoster = function (peers) {
    if (!Array.isArray(peers) || this.destroyed) return;
    var self = this;

    peers.forEach(function (entry) {
      if (!entry || !entry.id || entry.id === self.id) return;
      var existing = self.peers.get(entry.id);
      if (existing) {
        if (entry.profile && entry.profile.name) {
          existing.profile = Object.assign({}, existing.profile, entry.profile);
          self.emit("peer-update", existing);
        }
        return;
      }
      if (self.role === "host") return; // the host never dials out
      // Deterministic: only the peer with the smaller id dials, so a pair
      // can never open two data channels at each other.
      if (self.id < entry.id) {
        self.connect(entry.id);
      }
    });
  };

  /* ── media ───────────────────────────────────────────── */

  // Bitrate ceilings by resolution. The browser still adapts below these, but
  // an explicit cap stops the encoder from overshooting a home uplink — that
  // overshoot is what builds a queue and makes a screen share feel seconds
  // behind. Screen content also needs far less bitrate than camera video.
  var SCREEN_BITRATE = { "720": 3000000, "1080": 5500000, "1440": 8500000, "native": 14000000 };

  function screenBitrate(track, quality, viewers) {
    var s = {};
    try { if (track && track.getSettings) s = track.getSettings(); } catch (e) {}
    var h = s.height || 0;
    // Trust the captured size over the requested preset (Retina and 4K
    // displays often ignore an exact height constraint).
    var base;
    if (h >= 1900) base = 14000000;
    else if (h >= 1300) base = 8500000;
    else if (h >= 900) base = 5500000;
    else if (h >= 700) base = 3200000;
    else if (h) base = 2000000;
    else base = SCREEN_BITRATE[quality] || SCREEN_BITRATE["1080"];
    // Mesh: every viewer is a separate upload, so split the uplink budget.
    var n = Math.max(1, viewers || 1);
    if (n > 1) base = Math.max(Math.round(base / n), 1200000);
    return Math.round(base);
  }

  function setSenderBitrate(sender, bitrate, attempt) {
    if (!sender || !sender.track || sender.track.readyState !== "live") return;
    var rate = typeof bitrate === "function" ? bitrate() : bitrate;
    var params;
    try { params = sender.getParameters(); } catch (e) { return; }
    if (!params.encodings || !params.encodings.length) {
      // Encodings only exist after the first offer/answer settles.
      if ((attempt || 0) < 8) {
        setTimeout(function () { setSenderBitrate(sender, bitrate, (attempt || 0) + 1); }, 350);
      }
      return;
    }
    params.encodings.forEach(function (enc) {
      enc.maxBitrate = rate;
      enc.maxFramerate = 30;
    });
    // Keep text legible when bandwidth dips: drop frames, not resolution.
    try { params.degradationPreference = "maintain-resolution"; } catch (e) {}
    sender.setParameters(params).catch(function () {
      // Older engines reject maxFramerate/degradationPreference.
      var minimal;
      try { minimal = sender.getParameters(); } catch (e) { return; }
      if (!minimal.encodings || !minimal.encodings.length) return;
      minimal.encodings.forEach(function (enc) { enc.maxBitrate = rate; });
      try { minimal.degradationPreference = "balanced"; } catch (e) {}
      sender.setParameters(minimal).catch(function () {});
    });
  }

  function tuneReceiver(receiver) {
    if (!receiver || !receiver.track || receiver.track.kind !== "video") return;
    // ~100 ms of jitter buffer: enough to hide network jitter without the
    // chunk of latency browsers otherwise leave on the table.
    try { receiver.jitterBufferTarget = 100; } catch (e) {}
    try { receiver.playoutDelayHint = 0.1; } catch (e) {}
  }

  Mesh.prototype.startShare = function (opts) {
    var self = this;
    opts = opts || {};

    if (this.localStream) return Promise.resolve(this.localStream);
    if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getDisplayMedia) {
      var err = new Error("Screen sharing isn't supported in this browser.");
      err.code = "unsupported";
      return Promise.reject(err);
    }

    var quality = opts.quality;
    self.quality = quality || self.quality || "1080";
    // 30 fps is the sweet spot for screens: smoother motion costs bitrate and
    // CPU but doesn't make text any clearer.
    var video = { frameRate: { ideal: 30, max: 30 }, cursor: "motion" };
    if (quality && quality !== "native") {
      var h = Number(quality) || 1080;
      video.height = { ideal: h };
      video.width = { ideal: Math.round((h * 16) / 9) };
    }
    var constraints = {
      video: video,
      audio: opts.audio
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : false,
      // Chromium picker hints. These are ignored by browsers that don't know
      // them, and they keep the dialog at parity with Discord: every screen,
      // app window and tab is offered, plus system/tab audio and "share this
      // tab instead" switching.
      monitorTypeSurfaces: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: opts.audio ? "include" : "exclude",
      preferCurrentTab: false
    };

    return navigator.mediaDevices.getDisplayMedia(constraints).catch(function (e) {
      // Some platforms reject the audio constraint instead of ignoring it.
      if (constraints.audio && (e && (e.name === "NotSupportedError" || e.name === "TypeError"))) {
        return navigator.mediaDevices.getDisplayMedia(
          Object.assign({}, constraints, { audio: false, systemAudio: "exclude" })
        );
      }
      throw e;
    }).then(function (stream) {
      if (self.destroyed) {
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        return null;
      }
      self.localStream = stream;

      var videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        // "detail" tells the encoder to protect sharp edges and text rather
        // than smearing frames together for motion.
        try { videoTrack.contentHint = "detail"; } catch (e) {}
        videoTrack.addEventListener("ended", function () {
          if (self.localStream === stream) self.stopShare();
        });
      }

      self.peers.forEach(function (link) { self.callPeer(link); });
      self.emit("share-start", stream);
      return stream;
    });
  };

  Mesh.prototype.callPeer = function (link) {
    if (!this.localStream || !this.peer || this.destroyed) return;
    if (!link || !link.open) return;
    if (link.outCall) return;

    var call;
    try {
      call = this.peer.call(link.id, this.localStream, { metadata: { profile: this.me } });
    } catch (e) {
      return;
    }
    if (!call) return;

    link.outCall = call;
    var self = this;

    call.on("close", function () {
      if (link.outCall === call) link.outCall = null;
    });
    call.on("error", function (err) {
      if (link.outCall === call) link.outCall = null;
      console.warn("[beam] media error", err && err.type);
    });

    this.watchConnection(call, link);
    var mesh = this;
    var track = this.localStream.getVideoTracks()[0];
    this.tuneConnection(call, function () {
      return screenBitrate(track, mesh.quality, mesh.peers.size);
    });
    this.retuneOutgoing();
  };

  /** Apply screen-share encodings to one peer connection. */
  Mesh.prototype.tuneConnection = function (call, bitrate) {
    var self = this;
    var pc = call && call.peerConnection;
    if (!pc) return;

    function apply() {
      if (self.destroyed) return;
      try {
        if (pc.connectionState === "closed" || pc.signalingState === "closed") return;
      } catch (e) {}

      var track = self.localStream && self.localStream.getVideoTracks()[0];
      if (track) {
        try { track.contentHint = "detail"; } catch (e) {}
      }
      var rate = typeof bitrate === "function" ? bitrate() : bitrate;
      (pc.getSenders ? pc.getSenders() : []).forEach(function (sender) {
        if (rate > 0 && sender.track && sender.track.kind === "video") setSenderBitrate(sender, bitrate);
      });
      (pc.getReceivers ? pc.getReceivers() : []).forEach(tuneReceiver);
    }

    apply();
    // Sender encodings can appear a beat after the offer/answer settles.
    [600, 1600, 3200].forEach(function (ms) { setTimeout(apply, ms); });
  };

  /** Re-split the uplink budget when the number of viewers changes. */
  Mesh.prototype.retuneOutgoing = function () {
    if (!this.localStream) return;
    var self = this;
    clearTimeout(this._retuneTimer);
    this._retuneTimer = setTimeout(function () {
      if (self.destroyed || !self.localStream) return;
      var track = self.localStream.getVideoTracks()[0];
      var rate = function () { return screenBitrate(track, self.quality, self.peers.size); };
      self.peers.forEach(function (link) {
        if (link.outCall) self.tuneConnection(link.outCall, rate);
      });
    }, 400);
  };

  Mesh.prototype.acceptCall = function (call) {
    if (this.destroyed || !call) return;

    var profile = call.metadata && call.metadata.profile ? call.metadata.profile : null;
    var link = this.ensureLink(call.peer, profile);
    var self = this;

    if (link.inCall && link.inCall !== call) {
      try { link.inCall.close(); } catch (e) {}
    }
    link.inCall = call;

    // Receive-only: our own screen travels on separate outbound calls.
    try { call.answer(); } catch (e) { console.warn("[beam] answer failed", e); }

    call.on("stream", function (stream) {
      link.stream = stream;
      self.emit("stream", link);
    });

    call.on("close", function () {
      if (link.inCall !== call) return;
      link.inCall = null;
      link.stream = null;
      self.emit("stream-end", link);
    });

    call.on("error", function (err) {
      console.warn("[beam] incoming media error", err && err.type);
      if (link.inCall === call) {
        link.inCall = null;
        link.stream = null;
        self.emit("stream-end", link);
      }
    });

    this.watchConnection(call, link);
    this.tuneConnection(call, 0);
  };

  Mesh.prototype.watchConnection = function (call, link) {
    var pc = call.peerConnection;
    if (!pc) return;
    var self = this;
    var warned = false;
    var discTimer = null;
    pc.addEventListener("iceconnectionstatechange", function () {
      if (self.destroyed) return;
      var state = pc.iceConnectionState;
      if (state === "failed") {
        try { pc.restartIce(); } catch (e) {}
        if (!warned) {
          warned = true;
          self.emit("unstable", link);
        }
      } else if (state === "disconnected") {
        // "disconnected" often heals itself within a few seconds (wifi blip,
        // route change). Give it a moment before forcing an ICE restart.
        clearTimeout(discTimer);
        discTimer = setTimeout(function () {
          if (pc.iceConnectionState !== "disconnected") return;
          try { pc.restartIce(); } catch (e) {}
          if (!warned) {
            warned = true;
            self.emit("unstable", link);
          }
        }, 3000);
      } else if (state === "connected" || state === "completed") {
        clearTimeout(discTimer);
        discTimer = null;
        warned = false;
      }
    });
  };

  Mesh.prototype.stopShare = function () {
    var stream = this.localStream;
    this.localStream = null;
    clearTimeout(this._retuneTimer);

    if (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    }

    this.peers.forEach(function (link) {
      if (link.outCall) {
        try { link.outCall.close(); } catch (e) {}
        link.outCall = null;
      }
    });

    this.emit("share-end");
  };

  Mesh.prototype.isSharing = function () {
    return !!this.localStream;
  };

  /* ── chat / reactions ────────────────────────────────── */

  Mesh.prototype.sendChat = function (text) {
    var clean = String(text || "").trim();
    if (!clean) return false;
    return this.broadcast({ t: "chat", text: clean.slice(0, 2000), at: Date.now() });
  };

  Mesh.prototype.sendReaction = function (emoji) {
    if (!emoji) return false;
    var ok = this.broadcast({ t: "reaction", emoji: String(emoji).slice(0, 8), at: Date.now() });
    this.emit("reaction", { id: this.id, profile: this.me, emoji: emoji, mine: true });
    return ok;
  };

  Mesh.prototype.leave = function () {
    this.broadcast({ t: "bye" });
  };

  /* ── teardown ────────────────────────────────────────── */

  Mesh.prototype.dropLink = function (link) {
    if (!link || this.peers.get(link.id) !== link) return;
    this.peers.delete(link.id);
    link.stale = true;

    clearInterval(link.pingTimer);
    link.pingTimer = null;

    if (link.conn) { try { link.conn.close(); } catch (e) {} }
    if (link.inCall) { try { link.inCall.close(); } catch (e) {} }
    if (link.outCall) { try { link.outCall.close(); } catch (e) {} }
    link.stream = null;

    this.emit("peer-remove", link);
    this.retuneOutgoing();
  };

  /* ── errors ──────────────────────────────────────────── */

  Mesh.prototype.handleError = function (err) {
    var type = err && err.type;
    var msg = String((err && err.message) || "");

    if (type === "peer-unavailable") {
      if (this.role === "guest" && this.hostId && msg.indexOf(this.hostId) !== -1) {
        if (this.status === "live") return;
        this._sawUnavailable += 1;
        clearTimeout(this._dialTimer);

        if (this._dialAttempts < DIAL_ATTEMPTS) {
          // The host may still be registering, or their socket may be
          // reconnecting. Give it a moment and try a fresh connection.
          var self = this;
          this._dialTimer = setTimeout(function () {
            if (!self.destroyed && self.status !== "live") self.dialHost();
          }, 700 * this._dialAttempts);
          return;
        }

        this.failHost();
      }
      return;
    }

    if (type === "unavailable-id") {
      // The old socket for this id may still be closing (a reload, for
      // example). Retry a couple of times before giving up.
      if (this._idRetries < 2) {
        this._idRetries = (this._idRetries || 0) + 1;
        this.setStatus("connecting");
        var self = this;
        setTimeout(function () { if (!self.destroyed) self.reopen(); }, 1700);
        return;
      }
      this.emit("fatal", {
        code: "name-taken",
        message: "“" + this.me.name + "” is already live in another tab or device. Pick a different name."
      });
      return;
    }

    if (type === "browser-incompatible") {
      this.emit("fatal", {
        code: "unsupported",
        message: "This browser can't do WebRTC screen sharing. Try Chrome, Edge, Firefox or Safari."
      });
      return;
    }

    if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
      this.setStatus("reconnecting");
      return;
    }

    if (type === "invalid-id" || type === "invalid-key") {
      this.emit("fatal", {
        code: "signal-config",
        message: "The signalling server rejected this session. Reset the server settings and try again."
      });
      return;
    }

    console.warn("[beam] peer error", type, msg);
    this.emit("error", { type: type, message: msg });
  };

  global.Mesh = Mesh;
})(window);
