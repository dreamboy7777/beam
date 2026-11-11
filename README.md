# Beam

Peer-to-peer screen sharing in one link. You start a room, send the link, your friend
types your username (or just clicks the link), and you're looking at each other's screens.
No accounts, no installs, no server holding your video, nothing recorded.

```
┌──────────┐        one link        ┌──────────┐
│  you     │  ───────────────────►  │  friend  │
│  @alex   │                        │  @sam    │
└────┬─────┘                        └────┬─────┘
     └──────── WebRTC (encrypted) ───────┘
              straight between you
```

## Run it

```bash
cd beam
npm start          # or: node server.js
```

Then open **http://localhost:8080** — no `npm install` needed, there are zero dependencies.

## Send it to a friend

A friend can only open a link that's reachable from their computer. Three ways, easiest first:

### 1. Drop it on a static host (recommended)

The app is 100% static files — no backend, no build step.

- **Netlify:** go to <https://app.netlify.com/drop> and drag the `beam` folder onto the page.
  You get an `https://something.netlify.app` link instantly. That's the link you send.
- **Cloudflare Pages / Vercel:** same idea, drag-and-drop or connect a repo.
- **GitHub Pages:** push the folder to a repo and enable Pages.

HTTPS is important: browsers only allow screen capture on secure pages.

### 2. Quick tunnel (no account)

While `npm start` is running, in another terminal:

```bash
npx localtunnel --port 8080
```

Send the `https://…loca.lt` URL it prints. Keep both terminals open while you're sharing.
(If your friend sees a "tunnel password" page, it's your public IP — the page tells you.)

### 3. Same wifi

The server prints a `http://192.168.x.x:8080` address. Your friend can *watch* from there,
but browsers block screen capture on plain http, so **whoever shares** needs https or
localhost. Use option 1 or 2 for real sharing.

## How you use it

1. Type a name → **Start a session**. That name is your room (`@alex`).
2. Press **Copy link** and send it. The link carries your username.
3. Your friend opens it, and Beam fills in your name for them. They type their own name and hit **Join**.
4. Either of you presses **Share my screen** → pick a screen, window or tab.
   Both people can share at the same time; each screen gets its own tile.
5. Stop from the Beam bar or the browser's own "Stop sharing" button — both work.

The picker itself is the browser's, not Beam's: browsers only reveal your screens/apps/tabs
after you choose one, so no web app can draw its own Discord-style thumbnail grid. Chrome
and Edge list **Entire screen**, **Window** and **Tab**, with a "Share audio" checkbox.

Extras: chat with unread badge, emoji reactions, mute a remote screen's audio,
picture-in-picture, fullscreen, avatars (click yours to upload a photo), and a
per-person connection status.

## Why it doesn't need a server

- **Signalling** — just the initial "hello, here's my address" handshake — goes through the
  public PeerJS cloud (`0.peerjs.com`). Only tiny JSON messages pass through it.
- **Video and audio** go directly peer-to-peer over WebRTC, which is encrypted in transit
  (DTLS-SRTP) and never touches a server of ours.

You can point Beam at your own signalling server in **Settings → Signalling server**
(host, port, path, key), for example a self-hosted
[PeerJS server](https://github.com/peers/peerjs-server).

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "No live session under @name" | The friend hasn't pressed **Start a session**, or the name is spelled differently. Names ignore spaces and symbols: `Alex R.` → `@alexr`. |
| "Share cancelled — nothing was shared" | You closed the browser's picker, or the page isn't allowed to capture. Click **Share my screen** again and choose a surface. If no picker appears, allow screen recording for your browser (macOS: System Settings → Privacy & Security → Screen Recording). |
| "…is already live in another tab" | That username is in use. Close the other tab or pick a different name. Beam retries for ~4s first, so a fresh reload usually just works. |
| "Screen capture needs a secure (https) page" | You're on `http://` with a LAN IP. Use localhost, a tunnel, or a deployed https link. |
| No video, but names/chat work | The two networks can't find a direct path. Beam already tries STUN and a public TURN relay; a corporate VPN or firewall can still block it. Try a different network. |
| "The video link is struggling" | Beam tried an ICE restart automatically. Usually resolves in a second or two. |

Browser support: Chrome, Edge, Firefox and Safari 13+. Sharing a **tab with audio** works
best in Chrome/Edge. On macOS, system audio capture depends on the OS version.

## Files

```
beam/
├─ index.html          landing + live room markup
├─ styles.css          the whole design system
├─ js/util.js          avatars, toasts, storage, clipboard, image resize
├─ js/rtc.js           Mesh: signalling, presence, chat, WebRTC calls
├─ js/app.js           UI wiring and session state
├─ vendor/peerjs.min.js
└─ server.js           zero-dependency static server
```

## Privacy

Nothing is uploaded or recorded. Avatars and settings live in your browser's
`localStorage`. Chat messages exist only in memory and disappear when you leave.
