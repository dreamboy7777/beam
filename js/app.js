/* Beam — UI + session orchestration. */
(function () {
  "use strict";

  var $ = U.$;

  var state = {
    me: { name: "", hue: 0, avatar: null },
    settings: { audio: true, quality: "1080", motion: true, signal: null, turn: null },
    mesh: null,
    role: null,
    hostName: "",
    worldwideUrl: "",
    tiles: new Map(),      // peerId | "self" -> ui handle
    messages: 0,
    unread: 0,
    chatOpen: false,
    live: false,
    leaving: false
  };

  var els = {};

  function cacheEls() {
    [
      "landing", "app", "setupForm", "nameInput", "joinInput", "startBtn", "joinBtn",
      "nameHint", "myAva", "avatarBtn", "avatarFile", "shuffleBtn", "year",
      "grid", "stageEmpty", "emptyTitle", "emptyBody", "emptyPeople",
      "shareBtn", "shareLabel", "chatToggle", "chatBadge", "reactBtn", "reactBar", "fsBtn",
      "reactions", "chatPanel", "chatClose", "chatLog", "chatForm", "chatInput", "chatSub",
      "peopleStrip", "roomName", "copyLinkBtn", "settingsBtn", "statusPill", "statusText",
      "leaveBtn", "settingsSheet", "loadingOverlay", "loadingTitle", "loadingSub", "loadingCancel",
      "optQuality", "optMotion", "optSigHost", "optSigPort", "optSigPath", "optSigKey",
      "optSigReset", "optTurnUrls", "optTurnUser", "optTurnPass", "optTurnReset",
      "optTurnTest", "optTurnTestResult",
      "worldwideBtn", "worldwidePanel", "worldwideLink", "worldwideCopy", "worldwideOpen",
      "soundGuide", "guideOpen", "guideTest", "guideCancel",
      "resetAppBtn", "toasts", "landingSettingsBtn"
    ].forEach(function (id) { els[id] = document.getElementById(id); });
  }

  /* ══════════════════ boot ══════════════════ */

  function boot() {
    cacheEls();
    window.__beam = state; // debug handle (harmless)
    els.year.textContent = String(new Date().getFullYear());

    var saved = U.store.get("profile", null);
    if (saved && saved.name) {
      state.me.name = saved.name;
      state.me.hue = typeof saved.hue === "number" ? saved.hue : U.hash(saved.name) % 8;
      state.me.avatar = saved.avatar || null;
    } else {
      state.me.hue = Math.floor(Math.random() * 8);
    }

    var settings = U.store.get("settings", null);
    if (settings && typeof settings === "object") {
      state.settings = Object.assign(state.settings, settings);
      if (typeof state.settings.audio !== "boolean") state.settings.audio = true;
      if (typeof state.settings.motion !== "boolean") state.settings.motion = true;
    }
    applyMotion();

    els.nameInput.value = state.me.name || "";
    paintMe();
    updateNameHint();

    var params = new URLSearchParams(location.search);
    var joinParam = params.get("join");
    if (joinParam) {
      els.joinInput.value = joinParam.slice(0, 24);
      var savedName = state.me.name && U.slug(state.me.name).length >= 2;
      if (!savedName) {
        // A guest should never have to type anything: opening the link is
        // enough. Give them a friendly throwaway name and join immediately.
        state.me.name = "Guest" + Math.floor(Math.random() * 9000 + 1000);
        state.me.hue = U.hash(state.me.name) % 8;
        els.nameInput.value = state.me.name;
        saveProfile();
      }
      setTimeout(function () { if (!state.live) startSession("guest"); }, 450);
    }

    wireLanding();
    wireApp();
    wireSettings();
    syncSettingsUI();
    showEnvironmentNotice();

    window.addEventListener("beforeunload", function () {
      if (!state.mesh) return;
      try { state.mesh.leave(); state.mesh.destroy(); } catch (e) {}
    });
    window.addEventListener("pagehide", function () {
      if (!state.mesh) return;
      try { state.mesh.leave(); } catch (e) {}
    });

    // Last-resort logging: never let a stray error take the UI down silently.
    window.addEventListener("error", function (e) {
      console.error("[beam] uncaught:", e.message, e.filename, e.lineno);
    });
    window.addEventListener("unhandledrejection", function (e) {
      console.error("[beam] unhandled rejection:", e.reason);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (state.chatOpen) toggleChat(false);
        if (!els.reactBar.hidden) toggleReactions(false);
        if (!els.settingsSheet.hidden) closeSettings();
      }
    });
  }

  /* ══════════════════ landing ══════════════════ */

  function wireLanding() {
    els.nameInput.addEventListener("input", function () {
      state.me.name = els.nameInput.value.trim();
      updateNameHint();
      paintMe();
    });

    els.nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); startSession("host"); }
    });

    els.joinInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); startSession("guest"); }
    });

    els.setupForm.addEventListener("submit", function (e) {
      e.preventDefault();
      startSession("host");
    });

    els.joinBtn.addEventListener("click", function (e) {
      e.preventDefault();
      startSession("guest");
    });

    els.avatarBtn.addEventListener("click", function () { els.avatarFile.click(); });

    els.avatarFile.addEventListener("change", function () {
      var file = els.avatarFile.files && els.avatarFile.files[0];
      els.avatarFile.value = "";
      if (!file) return;
      U.fileToAvatar(file).then(function (dataUrl) {
        state.me.avatar = dataUrl;
        paintMe();
        saveProfile();
      }).catch(function (err) {
        U.toast(err.message || "Could not use that image.", "err");
      });
    });

    els.shuffleBtn.addEventListener("click", function () {
      state.me.hue = (state.me.hue + 3) % U.PALETTES.length;
      paintMe();
      saveProfile();
    });

    els.worldwideBtn.addEventListener("click", startWorldwide);

    els.worldwideCopy.addEventListener("click", function () {
      U.copy(els.worldwideLink.value).then(function () {
        U.toast("Worldwide link copied.", "ok");
      }).catch(function () {
        U.toast("Select the link and copy it manually.", "warn");
      });
    });

    els.worldwideOpen.addEventListener("click", function (e) {
      e.preventDefault();
      openWorldwideRoom();
    });

    els.guideOpen.addEventListener("click", openWorldwideRoom);
    els.guideTest.addEventListener("click", function () {
      var win = window.open("sound-test.html", "_blank");
      if (win) win.opener = null;
      else U.toast("Allow popups to open the sound test.", "warn");
    });
    els.guideCancel.addEventListener("click", function () {
      els.soundGuide.hidden = true;
    });
  }

  function startWorldwide() {
    // A zero-setup fallback for networks where peer-to-peer cannot connect.
    // Talky runs the call through its own hosted relay, so no TURN account is
    // needed. It can't be embedded, so it opens in its own tab.
    var room = "beam" + Math.random().toString(36).slice(2, 10);
    var url = "https://talky.io/" + room;
    state.worldwideUrl = url;
    els.worldwidePanel.hidden = false;
    els.worldwideLink.value = url;
    els.worldwideOpen.href = url;
    // Make the sound steps impossible to miss before the share happens.
    els.soundGuide.hidden = false;
  }

  function openWorldwideRoom() {
    var url = state.worldwideUrl;
    if (!url) return;
    els.soundGuide.hidden = true;

    U.copy(url).then(function () {
      U.toast("Worldwide link copied. Join, then Share screen — pick a tab and turn on Share tab audio.", "ok", null, 9000);
    }).catch(function () {
      U.toast("Copy the worldwide link below.", "warn");
    });

    var win = window.open(url, "_blank");
    if (win) win.opener = null;
    else U.toast("Allow popups, or open the link below.", "warn");
  }

  function updateNameHint() {
    var raw = els.nameInput.value.trim();
    var s = U.slug(raw);
    els.nameHint.classList.remove("error", "ok");
    if (!raw) {
      els.nameHint.textContent = "Letters and numbers become your room code.";
      return;
    }
    if (s.length < 2) {
      els.nameHint.textContent = "Add at least two letters or numbers.";
      els.nameHint.classList.add("error");
      return;
    }
    els.nameHint.textContent = "Your room: @" + s;
    els.nameHint.classList.add("ok");
  }

  function paintMe() {
    var profile = { name: state.me.name || "You", hue: state.me.hue, avatar: state.me.avatar };
    U.paintAvatar(els.myAva, profile);
  }

  function saveProfile() {
    U.store.set("profile", {
      name: state.me.name,
      hue: state.me.hue,
      avatar: state.me.avatar
    });
  }

  function applyMotion() {
    document.body.classList.toggle("no-motion", !state.settings.motion);
  }

  /** Warn early when the page can't be shared from (file://, plain http on a LAN IP). */
  function showEnvironmentNotice() {
    var host = location.hostname;
    var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(host);
    var message = null;

    if (location.protocol === "file:") {
      message = "You opened this as a file. Screen capture and linking usually work best from “npm start” (http://localhost:8080) or an https link.";
    } else if (!U.isSecure() && !isLocal) {
      message = "This page isn't secure, so browsers block screen capture here. Open it through https (a deployed link or a tunnel) to share.";
    }

    if (!message) return;
    var landing = document.querySelector(".landing");
    var hero = document.querySelector(".hero");
    if (!landing || !hero) return;
    var note = U.el("div", { class: "notice" },
      U.el("span", { class: "notice-dot" }),
      U.el("span", { text: message })
    );
    landing.insertBefore(note, hero);
  }

  /* ══════════════════ session start ══════════════════ */

  function startSession(role) {
    if (state.live || state.mesh) return;

    var name = els.nameInput.value.trim();
    if (!name) {
      name = (role === "guest" ? "Guest" : "Host") + Math.floor(Math.random() * 9000 + 1000);
      els.nameInput.value = name;
    }
    var mySlug = U.slug(name);

    if (mySlug.length < 2) {
      els.nameHint.textContent = "Add at least two letters or numbers.";
      els.nameHint.classList.add("error");
      els.nameInput.focus();
      U.toast("Pick a name with at least two letters or numbers.", "warn");
      return;
    }

    var hostName = "";
    if (role === "guest") {
      hostName = els.joinInput.value.trim();
      // Be forgiving when someone pastes the whole invite link instead of
      // just the username.
      var joinMatch = hostName.match(/[?&]join=([^&#\s]+)/i);
      if (joinMatch) {
        try { hostName = decodeURIComponent(joinMatch[1]); } catch (e) { hostName = joinMatch[1]; }
      }
      hostName = hostName.replace(/^@/, "").trim();
      if (/^https?:\/\//i.test(hostName) || hostName.indexOf("/") !== -1) {
        els.joinInput.focus();
        U.toast("That link has no room code. Paste the full invite link or just their username.", "warn");
        return;
      }
      if (U.slug(hostName).length < 2) {
        els.joinInput.focus();
        U.toast("Type the username of the friend you want to join.", "warn");
        return;
      }
    }

    if (!U.canShareScreen()) {
      U.toast(
        U.isSecure()
          ? "This browser can't capture your screen. Chrome, Edge, Firefox and Safari all work."
          : "Screen capture needs a secure (https) page. Deploy the folder or use a tunnel — see the README.",
        "err",
        "Heads up."
      );
    }

    state.role = role;
    state.me.name = name;
    state.hostName = hostName;
    state.opened = false;
    saveProfile();

    showLoading(
      role === "host" ? "Opening @".concat(U.slug(name)) : "Joining @" + U.slug(hostName),
      role === "host" ? "Registering your room" : "Knocking on their door"
    );

    var mesh = new Mesh({
      role: role,
      me: { name: name, hue: state.me.hue, avatar: state.me.avatar },
      hostName: hostName,
      signal: state.settings.signal || null,
      turn: state.settings.turn || null
    });
    state.mesh = mesh;
    bindMesh(mesh);
    mesh.start();

    setTimeout(function () {
      if (state.mesh === mesh && !state.live) els.loadingCancel.hidden = false;
    }, 5000);

    // Safety net: if the signalling server never answers, don't hang forever.
    setTimeout(function () {
      if (state.mesh !== mesh || state.live || state.opened) return;
      fail("Couldn't reach the signalling server. Check your internet connection, then try again.");
    }, 25000);
  }

  function bindMesh(mesh) {
    mesh.on("open", function () {
      state.opened = true;
      if (state.role === "host") goLive();
    });

    mesh.on("dialing", function (info) {
      if (state.live) return;
      if (info && info.relay) {
        els.loadingSub.textContent = "Trying the relay route…";
        return;
      }
      var attempt = Number(info && info.attempt) || 1;
      if (attempt <= 1) {
        els.loadingSub.textContent = "Knocking on their door…";
      } else {
        els.loadingSub.textContent = "Still connecting — trying another route…";
      }
    });

    mesh.on("peer-add", function (link) {
      ensureTile(link.id, link.profile);
      updatePeople();
      updateEmpty();
    });

    mesh.on("peer-ready", function (link) {
      var isHostLink = state.role === "guest" && link.id === mesh.hostId;
      if (isHostLink) goLive();
      ensureTile(link.id, link.profile);
      updateTileMeta(link.id, link.profile);
      updatePeople();
      updateEmpty();
      if (!state.live) return;

      if (isHostLink) {
        pushSystem("Connected to @" + U.slug(state.hostName));
        U.toast("You're in. Say hi to " + displayName(state.hostName) + ".", "ok");
        return;
      }

      // Wait a beat so the other side's profile name arrives before we announce it.
      setTimeout(function () {
        if (!state.live || !state.mesh || !state.mesh.peers.has(link.id)) return;
        var who = displayName(link.profile && link.profile.name);
        pushSystem(who + " joined the room");
        U.toast(who + " joined.", "ok");
      }, 400);
    });

    mesh.on("peer-update", function (link) {
      updateTileMeta(link.id, link.profile);
      updatePeople();
    });

    mesh.on("peer-remove", function (link) {
      if (state.live) pushSystem(displayName(link.profile.name) + " left");
      removeTile(link.id);
      updatePeople();
      updateEmpty();
    });

    mesh.on("stream", function (link) {
      showStream(link.id, link.stream);
    });

    mesh.on("stream-end", function (link) {
      clearStream(link.id);
    });

    mesh.on("share-start", function (stream) {
      showStream("self", stream);
      setSharingUI(true);
      var hasAudio = false;
      try { hasAudio = stream.getAudioTracks().length > 0; } catch (e) {}
      if (state.live) {
        U.toast(
          hasAudio ? "You're live. They can see and hear your screen." : "You're live. They can see your screen.",
          "ok"
        );
      }
    });

    mesh.on("share-no-audio", function () {
      U.toast(
        "Your screen is sharing without sound. Stop sharing, pick a browser tab, and tick “Share tab audio”.",
        "warn",
        "No audio captured.",
        12000
      );
    });

    mesh.on("share-end", function () {
      clearStream("self");
      setSharingUI(false);
    });

    mesh.on("chat", function (msg) {
      pushMessage(msg);
      if (!state.chatOpen) {
        state.unread += 1;
        renderBadge();
        if (state.live) U.toast(displayName(msg.profile && msg.profile.name) + ": " + truncate(msg.text, 60), "", null, 3200);
      }
    });

    mesh.on("reaction", function (r) {
      floatReaction(r.emoji);
    });

    mesh.on("status", function (status) {
      setStatus(status);
    });

    mesh.on("host-lost", function () {
      setStatus("offline");
      U.toast("The host closed the session.", "warn");
      setTimeout(function () { endSession(true); }, 2600);
    });

    mesh.on("unstable", function (link) {
      U.toast("The video link to " + displayName(link.profile.name) + " is struggling. Trying to recover…", "warn");
    });

    mesh.on("error", function (err) {
      console.warn("[beam]", err);
    });

    mesh.on("fatal", function (fatal) {
      fail(fatal.message);
    });

    mesh.on("closed", function () {
      if (state.leaving) return;
      setStatus("offline");
    });
  }

  function fail(message) {
    hideLoading();
    if (state.mesh) {
      try { state.mesh.destroy(); } catch (e) {}
      state.mesh = null;
    }
    state.live = false;
    state.role = null;
    state.tiles.clear();
    els.grid.textContent = "";
    updateGridCount();
    document.body.classList.remove("live");
    els.app.hidden = true;
    els.landing.hidden = false;
    els.landing.classList.remove("gone");
    U.toast(message, "err", "Couldn't connect.", 12000);
  }

  function goLive() {
    if (state.live) return;
    state.live = true;
    hideLoading();

    els.landing.classList.add("gone");
    setTimeout(function () { if (state.live) els.landing.hidden = true; }, 360);

    els.app.hidden = false;
    document.body.classList.add("live");

    ensureTile("self", { name: state.me.name, hue: state.me.hue, avatar: state.me.avatar });
    updateTileMeta("self", { name: state.me.name, hue: state.me.hue, avatar: state.me.avatar });
    updatePeople();
    updateEmpty();

    var label = state.role === "host" ? "@" + U.slug(state.me.name) : "@" + U.slug(state.hostName);
    els.roomName.textContent = label;
    els.roomName.title = state.role === "host"
      ? "This is your room code"
      : "You joined this room";
    document.title = "Beam · " + label;

    setStatus(state.mesh ? state.mesh.status : "live");
    if (state.role === "guest") pushSystem("You joined @" + U.slug(state.hostName) + "'s room");
    else pushSystem("Room @" + U.slug(state.me.name) + " is open");

    if (state.role === "host") {
      U.toast("Your room is live. Send the link to your friend.", "ok", null, 5200);
    }
  }

  function endSession(quiet) {
    if (state.leaving) return;
    state.leaving = true;
    if (state.mesh) {
      try { state.mesh.leave(); } catch (e) {}
      try { state.mesh.destroy(); } catch (e) {}
    }
    state.mesh = null;
    state.live = false;
    state.tiles.clear();
    els.grid.textContent = "";
    els.chatLog.textContent = "";
    state.unread = 0;
    renderBadge();
    if (quiet === true) {
      // stay on the page, just reset
      document.body.classList.remove("live");
      els.app.hidden = true;
      els.landing.hidden = false;
      els.landing.classList.remove("gone");
      state.leaving = false;
      state.role = null;
      return;
    }
    var clean = location.href.split("#")[0].split("?")[0];
    window.location.replace(clean);
  }

  /* ══════════════════ sharing ══════════════════ */

  function toggleShare() {
    var mesh = state.mesh;
    if (!mesh) return;

    if (mesh.isSharing()) {
      mesh.stopShare();
      return;
    }

    els.shareBtn.disabled = true;
    els.shareLabel.textContent = "Opening picker…";

    mesh.startShare({
      // Always ask for the shared tab/screen's audio. The browser picker still
      // lets the host opt out by unchecking "Share tab audio".
      audio: true,
      quality: state.settings.quality
    }).then(function () {
      // handled by the share-start event
    }).catch(function (err) {
      setSharingUI(false);
      var name = err && err.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        if (!U.isSecure()) {
          U.toast("Browsers only allow screen capture on https pages or localhost. Deploy the folder or use a tunnel.", "err", "Secure page needed.", 7000);
        } else {
          U.toast("Pick Entire screen, Window or Tab when you're ready. If no dialog appeared, your browser may need screen-recording permission.", "", "Share cancelled — nothing was shared.", 5200);
        }
      } else if (name === "NotFoundError") {
        U.toast("No screen was available to share.", "err");
      } else if (name === "NotReadableError") {
        U.toast("Your screen is busy — another app may be capturing it.", "err");
      } else {
        U.toast((err && err.message) || "Could not start screen sharing.", "err");
      }
    });
  }

  function setSharingUI(active) {
    els.shareBtn.disabled = false;
    els.shareBtn.classList.toggle("stopping", !!active);
    els.shareBtn.title = active
      ? "Stop sharing your screen"
      : "Pick a browser tab and turn on “Share tab audio” so they can hear it";
    els.shareLabel.textContent = active ? "Stop sharing" : "Share my screen";
    var selfUi = state.tiles.get("self");
    if (selfUi) {
      selfUi.sub.textContent = active ? "Sharing your screen" : "Not sharing";
      selfUi.tile.classList.toggle("sharing", !!active);
    }
    updateEmpty();
  }

  /* ══════════════════ tiles ══════════════════ */

  function ensureTile(id, profile) {
    var ui = state.tiles.get(id);
    if (ui) {
      if (profile) updateTileMeta(id, profile);
      return ui;
    }

    var isSelf = id === "self";
    var prof = profile || { name: isSelf ? state.me.name : "Guest", hue: 0, avatar: null };

    var video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isSelf;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    var avaNode = document.createElement("span");
    avaNode.className = "ava";

    var nameSpan = document.createElement("span");
    nameSpan.className = "np-name";

    var youSpan = document.createElement("span");
    youSpan.className = "you";
    youSpan.textContent = isSelf ? "you" : "";
    if (!isSelf) youSpan.style.display = "none";

    var namePill = U.el("div", { class: "name-pill" }, nameSpan, youSpan);
    var audioBadge = U.el("span", { class: "audio-badge", title: "This screen is sending audio" },
      U.el("span", { html: U.svg(U.ICONS.volume, 2) }),
      "AUDIO"
    );
    audioBadge.hidden = true;

    var top = U.el("div", { class: "tile-top" }, namePill, audioBadge);

    var actions = U.el("div", { class: "tile-actions" });
    if (!isSelf) {
      actions.appendChild(tileButton("mute", U.ICONS.volume, "Mute their audio"));
    }
    actions.appendChild(tileButton("pip", U.ICONS.pip, "Picture in picture"));
    actions.appendChild(tileButton("full", U.ICONS.expand, "Fullscreen"));

    var fbName = U.el("div", { class: "fb-name", text: isSelf ? "You" : displayName(prof.name) });
    var fbSub = U.el("div", { class: "fb-sub", text: isSelf ? "Not sharing" : "Not sharing" });
    var fallback = U.el("div", { class: "tile-fallback" }, avaNode, fbName, fbSub);

    var tile = U.el("article", { class: "tile", "data-id": id }, video, fallback, top, actions);

    tile.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      e.stopPropagation();
      var act = btn.getAttribute("data-act");
      if (act === "full") toggleFullscreen(tile);
      else if (act === "pip") togglePip(video, tile);
      else if (act === "mute") {
        video.muted = !video.muted;
        ui.userMuted = video.muted;
        btn.innerHTML = U.svg(video.muted ? U.ICONS.mute : U.ICONS.volume, 1.8);
        tile.classList.toggle("tile-sound-off", video.muted);
        U.toast(video.muted ? "Their audio is muted." : "Their audio is on.", "", null, 1800);
      }
    });

    // Keep "you" pinned last so newcomers appear to the left of your tile.
    var selfUi = state.tiles.get("self");
    if (!isSelf && selfUi && selfUi.tile.parentNode === els.grid) {
      els.grid.insertBefore(tile, selfUi.tile);
    } else {
      els.grid.appendChild(tile);
    }

    ui = {
      id: id,
      tile: tile,
      video: video,
      fallback: fallback,
      avaNode: avaNode,
      nameSpan: nameSpan,
      sub: fbSub,
      audioBadge: audioBadge,
      hasStream: false,
      userMuted: false,
      profile: prof,
      tapLayer: null
    };
    state.tiles.set(id, ui);

    updateTileMeta(id, prof);
    updateGridCount();
    return ui;
  }

  function tileButton(act, icon, title) {
    var b = document.createElement("button");
    b.className = "icon-btn";
    b.type = "button";
    b.setAttribute("data-act", act);
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = U.svg(icon, 1.8);
    return b;
  }

  function updateTileMeta(id, profile) {
    var ui = state.tiles.get(id);
    if (!ui) return;
    ui.profile = Object.assign({}, ui.profile, profile || {});
    var isSelf = id === "self";
    var nm = displayName(ui.profile.name);
    ui.nameSpan.textContent = nm;
    U.paintAvatar(ui.avaNode, ui.profile);
    ui.fallback.querySelector(".fb-name").textContent = isSelf ? "You" : nm;
    if (ui.hasStream) {
      ui.sub.textContent = isSelf ? "Sharing your screen" : "Sharing their screen";
    } else {
      ui.sub.textContent = "Not sharing";
    }
    if (isSelf) {
      var av = state.me.avatar;
      var hue = state.me.hue;
      ui.profile.avatar = av;
      ui.profile.hue = hue;
      U.paintAvatar(ui.avaNode, ui.profile);
    }
  }

  function showStream(id, stream) {
    var ui = ensureTile(id);
    ui.video.srcObject = stream;
    ui.hasStream = true;
    ui.tile.classList.add("has-stream");

    var hasAudio = false;
    try {
      hasAudio = stream.getAudioTracks().some(function (t) { return t.readyState === "live"; });
    } catch (e) { hasAudio = false; }

    var isSelf = id === "self";
    ui.sub.textContent = isSelf
      ? (hasAudio ? "Sharing your screen · sound on" : "Sharing your screen · no sound")
      : (hasAudio ? "Sharing their screen · sound on" : "Sharing their screen · no sound");
    ui.audioBadge.hidden = !hasAudio;
    ui.video.muted = isSelf || !!ui.userMuted;
    if (!isSelf) {
      ui.video.volume = 1;
    }
    ui.tile.classList.toggle("tile-sound-off", !isSelf && (!hasAudio || ui.video.muted));

    var attempt = ui.video.play();
    var needsTap = false;
    if (!isSelf && hasAudio && !ui.userMuted) {
      // Auto-joined guests may not have interacted with this page yet, so the
      // browser can allow the silent video but keep the audio blocked.
      try { needsTap = !!(navigator.userActivation && !navigator.userActivation.hasBeenActive); } catch (e) {}
    }
    if (attempt && attempt.catch) {
      attempt.catch(function () { showTapToPlay(ui, hasAudio); });
    }
    if (needsTap) showTapToPlay(ui, true);
    updateGridCount();
    updateEmpty();
  }

  function clearStream(id) {
    var ui = state.tiles.get(id);
    if (!ui) return;
    try { ui.video.srcObject = null; } catch (e) {}
    ui.hasStream = false;
    ui.tile.classList.remove("has-stream");
    ui.audioBadge.hidden = true;
    ui.sub.textContent = "Not sharing";
    if (ui.tapLayer) { ui.tapLayer.remove(); ui.tapLayer = null; }
    updateGridCount();
    updateEmpty();
  }

  function showTapToPlay(ui, hasAudio) {
    if (ui.tapLayer) return;
    var layer = U.el("button", { class: "tap-to-play", type: "button" },
      U.el("span", { class: "tpp", html: U.svg(U.ICONS.play, 1.6) }),
      hasAudio ? "Click to hear the screen" : "Click to play"
    );
    layer.addEventListener("click", function () {
      ui.userMuted = false;
      ui.video.muted = false;
      ui.video.volume = 1;
      ui.video.play().catch(function () {});
      layer.remove();
      ui.tapLayer = null;
    });
    ui.tile.appendChild(layer);
    ui.tapLayer = layer;
  }

  function removeTile(id) {
    var ui = state.tiles.get(id);
    if (!ui) return;
    try { ui.video.srcObject = null; } catch (e) {}
    if (ui.tile.parentNode) ui.tile.parentNode.removeChild(ui.tile);
    state.tiles.delete(id);
    updateGridCount();
    updateEmpty();
  }

  /** Show only tiles that carry a stream (plus "you" while you're sharing). */
  function updateGridCount() {
    var n = 0;
    state.tiles.forEach(function (ui, id) {
      var visible = id !== "self" || ui.hasStream;
      ui.tile.hidden = !visible;
      if (visible) n += 1;
    });
    els.grid.setAttribute("data-count", String(Math.max(1, n)));
  }

  function updateEmpty() {
    var anyVideo = false;
    state.tiles.forEach(function (ui) { if (ui.hasStream) anyVideo = true; });

    var others = 0;
    state.tiles.forEach(function (ui, id) { if (id !== "self") others += 1; });

    var solo = others === 0;
    var sharing = !!(state.mesh && state.mesh.isSharing && state.mesh.isSharing());

    if (anyVideo) {
      els.stageEmpty.classList.add("hide");
      els.grid.hidden = false;
      renderEmptyPeople();
      return;
    }

    els.stageEmpty.classList.remove("hide");
    els.grid.hidden = true;

    if (sharing) {
      els.emptyTitle.textContent = "Starting your share";
      els.emptyBody.textContent = "Your screen is warming up — it'll appear here in a moment.";
    } else if (solo) {
      els.emptyTitle.textContent = "Waiting for someone to show up";
      els.emptyBody.textContent = "";
      els.emptyBody.appendChild(document.createTextNode("Send your link — it fills in your name for them. Or hit "));
      els.emptyBody.appendChild(U.el("b", { text: "Share my screen" }));
      els.emptyBody.appendChild(document.createTextNode(" to test it — the browser will ask what to share."));
    } else {
      els.emptyTitle.textContent = "Nobody's sharing yet";
      els.emptyBody.textContent = "Hit Share my screen, then pick Entire screen, Window or Tab.";
    }

    renderEmptyPeople();
  }

  function renderEmptyPeople() {
    els.emptyPeople.textContent = "";
    var meAva = U.makeAvatar({ name: state.me.name, hue: state.me.hue, avatar: state.me.avatar });
    meAva.title = state.me.name + " (you)";
    els.emptyPeople.appendChild(meAva);
    state.tiles.forEach(function (ui, id) {
      if (id === "self") return;
      var a = U.makeAvatar(ui.profile);
      a.title = displayName(ui.profile.name);
      if (ui.hasStream) a.style.boxShadow = "0 0 0 2px rgba(53,224,161,.8)";
      els.emptyPeople.appendChild(a);
    });
  }

  function updatePeople() {
    els.peopleStrip.textContent = "";
    var selfAva = U.makeAvatar({ name: state.me.name, hue: state.me.hue, avatar: state.me.avatar }, "self");
    selfAva.title = state.me.name + " (you)";
    els.peopleStrip.appendChild(selfAva);

    var count = 1;
    state.tiles.forEach(function (ui, id) {
      if (id === "self") return;
      var a = U.makeAvatar(ui.profile);
      var tip = displayName(ui.profile.name);
      if (state.mesh && id === state.mesh.hostId) tip += " · host";
      a.title = tip;
      if (ui.hasStream) a.style.boxShadow = "0 0 0 2px rgba(53,224,161,.85)";
      els.peopleStrip.appendChild(a);
      count += 1;
    });

    els.peopleStrip.title = count + (count === 1 ? " person" : " people") + " here";
    if (!state.chatOpen) els.chatSub.textContent = count === 1 ? "Just you so far" : count + " people here";
  }

  function setStatus(status) {
    if (!els.statusPill) return;
    els.statusPill.classList.remove("reconnecting", "offline");
    if (status === "reconnecting") {
      els.statusPill.classList.add("reconnecting");
      els.statusText.textContent = "Reconnecting";
    } else if (status === "offline") {
      els.statusPill.classList.add("offline");
      els.statusText.textContent = "Offline";
    } else if (status === "connecting") {
      els.statusText.textContent = "Connecting";
    } else {
      els.statusText.textContent = "Live";
    }
  }

  /* ══════════════════ chat ══════════════════ */

  function displayName(name) {
    var n = String(name || "").trim();
    if (!n) return "Someone";
    return n.length > 18 ? n.slice(0, 17) + "…" : n;
  }

  function truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function pushSystem(text) {
    var empty = els.chatLog.querySelector(".chat-empty");
    if (empty) empty.remove();
    var node = U.el("div", { class: "sys", text: text });
    els.chatLog.appendChild(node);
    scrollChat();
  }

  function pushMessage(msg) {
    var isMe = !!msg.mine;
    var ava = U.makeAvatar(msg.profile || { name: "Guest" });
    ava.setAttribute("aria-hidden", "true");
    var meta = U.el("div", { class: "msg-meta" },
      U.el("b", { text: isMe ? "You" : displayName(msg.profile && msg.profile.name) }),
      U.el("span", { text: U.fmtTime(msg.at) })
    );
    var bubble = U.el("div", { class: "bubble", text: msg.text });
    var body = U.el("div", { class: "msg-body" }, meta, bubble);
    var row = U.el("div", { class: "msg" + (isMe ? " me" : "") }, ava, body);
    els.chatLog.appendChild(row);
    state.messages += 1;

    var empty = els.chatLog.querySelector(".chat-empty");
    if (empty) empty.remove();
    scrollChat();
  }

  function scrollChat() {
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function renderBadge() {
    if (state.unread > 0) {
      els.chatBadge.hidden = false;
      els.chatBadge.textContent = state.unread > 9 ? "9+" : String(state.unread);
    } else {
      els.chatBadge.hidden = true;
    }
  }

  function toggleChat(force) {
    var open = typeof force === "boolean" ? force : !state.chatOpen;
    state.chatOpen = open;
    els.chatPanel.classList.toggle("open", open);
    els.chatToggle.classList.toggle("active", open);
    els.chatToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      state.unread = 0;
      renderBadge();
      updatePeople();
      if (!els.chatLog.children.length) {
        els.chatLog.appendChild(U.el("div", { class: "chat-empty", text: "No messages yet. Say hi — it's just you and whoever's in the room." }));
      }
      setTimeout(function () { els.chatInput.focus(); }, 260);
    }
  }

  function sendChat() {
    var text = els.chatInput.value.trim();
    if (!text) return;
    els.chatInput.value = "";
    pushMessage({ mine: true, profile: { name: state.me.name, hue: state.me.hue, avatar: state.me.avatar }, text: text, at: Date.now() });
    if (state.mesh) state.mesh.sendChat(text);
  }

  /* ══════════════════ reactions ══════════════════ */

  function toggleReactions(force) {
    var open = typeof force === "boolean" ? force : els.reactBar.hidden;
    els.reactBar.hidden = !open;
    els.reactBtn.classList.toggle("active", open);
  }

  function floatReaction(emoji) {
    if (!emoji) return;
    var node = document.createElement("span");
    node.className = "reaction";
    node.textContent = emoji;
    node.style.left = (14 + Math.random() * 72) + "%";
    node.style.fontSize = (32 + Math.random() * 18) + "px";
    els.reactions.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 3100);
  }

  /* ══════════════════ copy link ══════════════════ */

  function copyInvite() {
    // Hosts invite to their own room; guests invite to the room they joined.
    var name = U.slug(state.role === "guest" && state.hostName ? state.hostName : state.me.name);
    if (!name) return;
    var url;
    try {
      url = new URL(location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("join", name);
    } catch (e) {
      url = null;
    }
    var text = url ? url.toString() : "@" + name;
    U.copy(text).then(function () {
      var isLocal = !url || url.protocol === "file:" || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(url.hostname);
      if (isLocal) {
        U.toast("Copied. Heads up: this link only works on this computer — deploy the folder or open a tunnel so your friend can reach it.", "warn", "Link copied.", 9000);
      } else {
        U.toast("Send it to your friend. They just click and join.", "ok", "Link copied.");
      }
      var original = els.copyLinkBtn.innerHTML;
      els.copyLinkBtn.innerHTML = U.svg('<path d="m4.5 12.5 5 5 10-11"/>', 2.2);
      els.copyLinkBtn.appendChild(document.createTextNode(" Copied"));
      setTimeout(function () {
        els.copyLinkBtn.innerHTML = original;
      }, 1800);
    }).catch(function () {
      // Clipboard blocked (insecure page, permissions, or no user gesture).
      // Show the link so it can still be copied by hand.
      U.toast("Your browser blocked the clipboard. Copy the link from the box on screen.", "warn", "Copy it manually.", 7000);
      try {
        window.prompt("Copy this link and send it to your friend:", text);
      } catch (e) {}
    });
  }

  /* ══════════════════ misc UI ══════════════════ */

  function toggleFullscreen(node) {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (node.requestFullscreen) {
        node.requestFullscreen().catch(function () {
          U.toast("Fullscreen isn't available here.", "warn");
        });
      }
    } catch (e) {
      U.toast("Fullscreen isn't available here.", "warn");
    }
  }

  function togglePip(video, tile) {
    try {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      } else if (video.requestPictureInPicture && video.srcObject) {
        video.requestPictureInPicture().catch(function () {
          U.toast("Picture-in-picture isn't available for this video.", "warn");
        });
      } else {
        U.toast("Start sharing something first.", "warn");
      }
    } catch (e) {
      U.toast("Picture-in-picture isn't available here.", "warn");
    }
  }

  function showLoading(title, sub) {
    els.loadingTitle.textContent = title || "Connecting…";
    els.loadingSub.textContent = sub || "";
    els.loadingCancel.hidden = true;
    els.loadingOverlay.hidden = false;
  }

  function hideLoading() {
    els.loadingOverlay.hidden = true;
  }

  /* ══════════════════ app wiring ══════════════════ */

  function wireApp() {
    els.shareBtn.addEventListener("click", toggleShare);

    els.chatToggle.addEventListener("click", function () { toggleChat(); });
    els.chatClose.addEventListener("click", function () { toggleChat(false); });

    els.chatForm.addEventListener("submit", function (e) {
      e.preventDefault();
      sendChat();
    });

    els.reactBtn.addEventListener("click", function () { toggleReactions(); });
    els.reactBar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-emoji]");
      if (!btn) return;
      var emoji = btn.getAttribute("data-emoji");
      if (state.mesh) state.mesh.sendReaction(emoji);
      floatReaction(emoji);
      toggleReactions(false);
    });

    els.fsBtn.addEventListener("click", function () { toggleFullscreen(els.app); });

    els.copyLinkBtn.addEventListener("click", copyInvite);

    els.leaveBtn.addEventListener("click", function () {
      if (state.mesh) {
        try { state.mesh.leave(); } catch (e) {}
      }
      endSession();
    });

    els.settingsBtn.addEventListener("click", openSettings);
    if (els.landingSettingsBtn) els.landingSettingsBtn.addEventListener("click", openSettings);

    els.loadingCancel.addEventListener("click", function () {
      hideLoading();
      if (state.mesh) { try { state.mesh.destroy(); } catch (e) {} state.mesh = null; }
      state.role = null;
      U.toast("Cancelled.", "", null, 2000);
    });

    // click outside chat to close on small screens
    els.grid.addEventListener("pointerdown", function () {
      if (state.chatOpen && window.innerWidth < 900) toggleChat(false);
      if (!els.reactBar.hidden) toggleReactions(false);
    });

    // keep tiles sized sensibly when the chat panel opens
    updateGridCount();
  }

  /* ══════════════════ settings ══════════════════ */

  function syncSettingsUI() {
    els.optQuality.value = state.settings.quality || "1080";
    els.optMotion.checked = !!state.settings.motion;
    var sig = state.settings.signal || {};
    els.optSigHost.value = sig.host || "";
    els.optSigPort.value = sig.port || "";
    els.optSigPath.value = sig.path || "";
    els.optSigKey.value = sig.key || "";
    var turn = state.settings.turn || {};
    els.optTurnUrls.value = Array.isArray(turn.urls) ? turn.urls.join(", ") : (turn.urls || "");
    els.optTurnUser.value = turn.username || "";
    els.optTurnPass.value = turn.credential || "";
  }

  function collectSettings() {
    var settings = {
      audio: true,
      quality: els.optQuality.value,
      motion: els.optMotion.checked,
      signal: null,
      turn: null
    };
    var host = els.optSigHost.value.trim();
    if (host) {
      settings.signal = {
        host: host,
        port: els.optSigPort.value.trim() || "443",
        path: els.optSigPath.value.trim() || "/",
        key: els.optSigKey.value.trim() || "peerjs",
        secure: (els.optSigPort.value.trim() || "443") !== "80"
      };
    }
    var turnUrls = els.optTurnUrls.value.trim();
    if (turnUrls) {
      settings.turn = {
        urls: turnUrls.split(/[\s,]+/).filter(Boolean),
        username: els.optTurnUser.value.trim(),
        credential: els.optTurnPass.value
      };
    }
    return settings;
  }

  var relayTestRun = 0;

  function testRelay() {
    var result = els.optTurnTestResult;
    var button = els.optTurnTest;

    if (typeof RTCPeerConnection !== "function") {
      result.textContent = "This browser can't test WebRTC relays.";
      result.className = "micro err";
      return;
    }

    state.settings = collectSettings();
    U.store.set("settings", state.settings);

    if (!state.settings.turn) {
      result.textContent = "No relay configured. Paste your TURN details below, then test again.";
      result.className = "micro err";
      return;
    }

    var run = ++relayTestRun;
    var config = Mesh.iceConfig(state.settings.turn);
    config.iceTransportPolicy = "relay";

    var pc;
    try {
      pc = new RTCPeerConnection(config);
    } catch (e) {
      result.textContent = "Couldn't start the relay test. Check the relay URL format.";
      result.className = "micro err";
      return;
    }

    var relayCandidates = [];
    var errors = [];
    var finished = false;
    var timer = null;

    button.disabled = true;
    result.textContent = "Testing relay…";
    result.className = "micro";

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { pc.close(); } catch (e) {}
      if (run !== relayTestRun) return;
      button.disabled = false;

      if (relayCandidates.length) {
        result.textContent = "Relay works — " + relayCandidates.length +
          " route" + (relayCandidates.length === 1 ? "" : "s") + " ready.";
        result.className = "micro ok";
        U.toast("Relay works. You're ready for strict networks.", "ok");
        return;
      }

      var rejected = errors.some(function (e) { return e.code === 401; });
      result.textContent = rejected
        ? "The relay rejected the username or password."
        : "No relay route found. Check the relay details, or try a different network.";
      result.className = "micro err";
      U.toast(result.textContent, "warn");
    }

    pc.onicecandidate = function (e) {
      var cand = e.candidate;
      if (!cand) return;
      if (cand.type === "relay" || (cand.candidate && cand.candidate.indexOf(" typ relay") !== -1)) {
        relayCandidates.push(cand);
        if (relayCandidates.length === 1) setTimeout(finish, 600);
      }
    };
    pc.onicecandidateerror = function (e) {
      errors.push({ url: e.url, code: e.errorCode, text: e.errorText });
    };

    try {
      pc.createDataChannel("relay-test");
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).catch(function () { finish(); });
    } catch (e) {
      finish();
      return;
    }

    timer = setTimeout(finish, 9000);
  }

  function wireSettings() {
    function save() {
      state.settings = collectSettings();
      U.store.set("settings", state.settings);
      applyMotion();
    }

    els.optQuality.addEventListener("change", save);
    els.optMotion.addEventListener("change", function () {
      save();
      U.toast(state.settings.motion ? "Motion on." : "Motion off.", "", null, 1600);
    });

    [els.optSigHost, els.optSigPort, els.optSigPath, els.optSigKey].forEach(function (input) {
      input.addEventListener("change", function () {
        save();
        U.toast("Signalling settings saved. They apply next time you start a session.", "", null, 3200);
      });
    });

    els.optSigReset.addEventListener("click", function () {
      els.optSigHost.value = "";
      els.optSigPort.value = "";
      els.optSigPath.value = "";
      els.optSigKey.value = "";
      state.settings.signal = null;
      U.store.set("settings", state.settings);
      U.toast("Using the public signalling server.", "ok");
    });

    [els.optTurnUrls, els.optTurnUser, els.optTurnPass].forEach(function (input) {
      input.addEventListener("change", function () {
        save();
        els.optTurnTestResult.textContent = "";
        els.optTurnTestResult.className = "micro";
        U.toast("Relay settings saved. They apply next time you start a session.", "", null, 3200);
      });
    });

    els.optTurnTest.addEventListener("click", testRelay);

    els.optTurnReset.addEventListener("click", function () {
      els.optTurnUrls.value = "";
      els.optTurnUser.value = "";
      els.optTurnPass.value = "";
      state.settings.turn = null;
      U.store.set("settings", state.settings);
      els.optTurnTestResult.textContent = "";
      els.optTurnTestResult.className = "micro";
      U.toast("Relay cleared. Add one if this network needs it.", "ok");
    });

    els.resetAppBtn.addEventListener("click", function () {
      ["profile", "settings"].forEach(function (k) { U.store.remove(k); });
      U.toast("Everything reset. Reloading…", "ok");
      setTimeout(function () { location.href = location.pathname; }, 600);
    });

    els.settingsSheet.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) closeSettings();
    });
  }

  function openSettings() {
    syncSettingsUI();
    els.settingsSheet.hidden = false;
  }

  function closeSettings() {
    els.settingsSheet.hidden = true;
  }

  /* ══════════════════ go ══════════════════ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
