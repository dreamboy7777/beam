/* Beam — small helpers shared by every module. */
(function (global) {
  "use strict";

  var U = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /** Create an element: el('div', {class:'x', onClick: fn}, 'text', childNode) */
  U.el = function (tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style" && typeof v === "object") {
          for (var s in v) if (Object.prototype.hasOwnProperty.call(v, s)) node.style[s] = v[s];
        } else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  };

  U.svg = function (paths, strokeWidth) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (strokeWidth || 1.8) + '" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>";
  };

  U.ICONS = {
    expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    shrink: '<path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"/>',
    pip: '<rect x="2.5" y="4.5" width="19" height="13" rx="2.5"/><rect x="12" y="10.5" width="8" height="6" rx="1.5"/>',
    volume: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15.2 8.6a5 5 0 0 1 0 6.8"/><path d="M18 6a9 9 0 0 1 0 12"/>',
    mute: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    play: '<path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
  };

  U.rand = function (n) {
    var s = "";
    var chars = "abcdefghijkmnpqrstuvwxyz23456789";
    for (var i = 0; i < (n || 4); i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };

  /** Normalise a display name for use inside a peer id. */
  U.slug = function (name) {
    return String(name || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  };

  U.initials = function (name) {
    var s = String(name || "").trim();
    if (!s) return "?";
    var parts = s.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  };

  U.hash = function (str) {
    var h = 5381;
    var s = String(str || "");
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  };

  U.PALETTES = [
    ["#9d7bff", "#5b8cff"],
    ["#4cc9f0", "#2f7dff"],
    ["#ff4d8d", "#ff8a5c"],
    ["#35e0a1", "#18b6c9"],
    ["#ffc857", "#ff7a59"],
    ["#c084fc", "#f472b6"],
    ["#f97316", "#facc15"],
    ["#38bdf8", "#818cf8"]
  ];

  U.huePalette = function (profile) {
    if (profile && typeof profile.hue === "number") {
      return U.PALETTES[Math.abs(profile.hue) % U.PALETTES.length];
    }
    var seed = U.hash((profile && profile.name) || "beam");
    return U.PALETTES[seed % U.PALETTES.length];
  };

  U.paintAvatar = function (node, profile) {
    if (!node) return;
    var p = profile || {};
    var pal = U.huePalette(p);
    node.textContent = "";
    node.style.backgroundImage = "";
    node.style.background = "linear-gradient(140deg, " + pal[0] + " 0%, " + pal[1] + " 100%)";
    if (p.avatar && typeof p.avatar === "string" && p.avatar.indexOf("data:image/") === 0) {
      var img = document.createElement("img");
      img.src = p.avatar;
      img.alt = "";
      img.draggable = false;
      node.appendChild(img);
      node.style.background = "linear-gradient(140deg, " + pal[0] + " 0%, " + pal[1] + " 100%)";
    } else {
      node.textContent = U.initials(p.name);
      node.style.color = "rgba(8,8,14,.82)";
    }
  };

  U.makeAvatar = function (profile, cls) {
    var node = document.createElement("span");
    node.className = "ava" + (cls ? " " + cls : "");
    U.paintAvatar(node, profile);
    return node;
  };

  /* ── storage ─────────────────────────────────────────── */

  U.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem("beam." + key);
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try {
        localStorage.setItem("beam." + key, JSON.stringify(value));
        return true;
      } catch (e) { return false; }
    },
    remove: function (key) {
      try { localStorage.removeItem("beam." + key); } catch (e) {}
    }
  };

  /* ── toasts ──────────────────────────────────────────── */

  var toastHost = null;
  U.toast = function (message, kind, title, ms) {
    if (!toastHost) toastHost = U.$("#toasts");
    if (!toastHost) return;
    var node = U.el("div", { class: "toast " + (kind || "") });
    node.appendChild(U.el("i"));
    var body = U.el("div");
    if (title) body.appendChild(U.el("b", { text: title + " " }));
    body.appendChild(document.createTextNode(message));
    node.appendChild(body);
    toastHost.appendChild(node);
    var ttl = ms || (kind === "err" ? 7000 : 4200);
    var timer = setTimeout(remove, ttl);
    function remove() {
      clearTimeout(timer);
      if (!node.parentNode) return;
      node.classList.add("out");
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }
    node.addEventListener("click", remove);
    while (toastHost.children.length > 4) toastHost.removeChild(toastHost.firstChild);
  };

  /* ── misc ────────────────────────────────────────────── */

  U.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        if (!legacyCopy(text)) throw new Error("copy-failed");
      });
    }
    return legacyCopy(text) ? Promise.resolve() : Promise.reject(new Error("copy-failed"));
  };

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  U.fmtTime = function (ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) { return ""; }
  };

  U.isTypingTarget = function (node) {
    if (!node) return false;
    var t = node.tagName;
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || node.isContentEditable;
  };

  U.canShareScreen = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  };

  U.isSecure = function () {
    if (typeof window.isSecureContext === "boolean") return window.isSecureContext;
    return location.protocol === "https:" || location.hostname === "localhost" || location.protocol === "file:";
  };

  /** Resize an uploaded image down to a small square-ish avatar data URL. */
  U.fileToAvatar = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("Please choose an image file."));
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        reject(new Error("That image is a little too big — try one under 8 MB."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("That image could not be opened.")); };
        img.onload = function () {
          try {
            var size = 192;
            var canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext("2d");
            var scale = Math.max(size / img.width, size / img.height);
            var w = img.width * scale;
            var h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          } catch (e) { reject(new Error("Could not process that image.")); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  };

  global.U = U;
})(window);
