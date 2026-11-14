# Beam

Peer-to-peer screen sharing in one link. You start a room, send the link, your friend
types your username (or just clicks the link), and you're looking at each other's screens.
No accounts, no installs, no server holding your video, nothing recorded.

**Live:** <https://dreamboy7777.github.io/beam/> · **Source:** <https://github.com/dreamboy7777/beam>

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

The app is already deployed at **<https://dreamboy7777.github.io/beam/>** — that's the link
to send. A friend can join from any computer or phone with a modern browser.

### Updating the live site

This folder is a git repo whose `main` branch publishes to GitHub Pages. After editing:

```bash
git add -A
git commit -m "Describe the change"
git push
```

GitHub rebuilds <https://dreamboy7777.github.io/beam/> in about a minute.
(No build step — Pages serves these files as-is; `.nojekyll` keeps Jekyll out of the way.)

If you changed CSS or JS, also bump the `?v=2` query on the asset links in `index.html`
(use `v=3`, `v=4`, …). Pages caches assets for 10 minutes; bumping the version makes
returning visitors pick up your change immediately.

### Deploying somewhere else

The app is 100% static files — no backend, no build step.

- **Netlify:** go to <https://app.netlify.com/drop> and drag the `beam` folder onto the page.
  You get an `https://something.netlify.app` link instantly. That's the link you send.
- **Cloudflare Pages / Vercel:** same idea, drag-and-drop or connect a repo.
- **GitHub Pages:** push the folder to a repo and enable Pages.

HTTPS is important: browsers only allow screen capture on secure pages.

### Quick tunnel (no account)

While `npm start` is running, in another terminal:

```bash
npx localtunnel --port 8080
```

Send the `https://…loca.lt` URL it prints. Keep both terminals open while you're sharing.
(If your friend sees a "tunnel password" page, it's your public IP — the page tells you.)

### Same wifi

The server prints a `http://192.168.x.x:8080` address. Your friend can *watch* from there,
but browsers block screen capture on plain http, so **whoever shares** needs https or
localhost. Use the deployed link or a tunnel for real sharing.

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

## Keeping it smooth

Screen share is tuned for interactive use rather than "looks great in a recording":

- Captured at **30 fps**, with the encoder told to protect text (`contentHint = "detail"`).
- Bitrate is capped by the captured resolution (≈3 Mbps at 720p, 5.5 at 1080p,
  8.5 at 1440p, 14 at 4K) so the encoder can't overshoot a home uplink and build a
  laggy queue. Congestion control still adapts underneath that ceiling.
- When bandwidth dips, frames are dropped before resolution
  (`degradationPreference = "maintain-resolution"`), so text stays readable.
- The receiver uses a ~100 ms jitter buffer, not the browser's larger default.
- With 3+ viewers the uplink budget is split across peers automatically.
- Blur effects behind the live video are flattened in-call to keep compositing cheap.
- A dropped connection is given 3 s to heal, then ICE is restarted automatically.

Pick **Settings → Video quality → 720p** on a slow uplink; it is the single biggest lever.

## Why it doesn't need a server

- **Signalling** — just the initial "hello, here's my address" handshake — goes through the
  public PeerJS cloud (`0.peerjs.com`). Only tiny JSON messages pass through it.
- **Video and audio** go directly peer-to-peer over WebRTC, which is encrypted in transit
  (DTLS-SRTP) and never touches a server of ours.

You can point Beam at your own signalling server in **Settings → Signalling server**
(host, port, path, key), for example a self-hosted
[PeerJS server](https://github.com/peers/peerjs-server).

Screen sharing needs a direct or relayed UDP path between the two browsers. Beam
uses STUN by default for fast direct connections. If the two networks can't meet
directly, add a TURN relay in **Settings → Relay (TURN)**. Only the host needs it:
the guest joins through the host's relay candidate.

The old free public relay (`staticauth.openrelay.metered.ca`) is offline — it no
longer responds from any region — so it has been removed to avoid slow joins.

### Setting up a free relay (about a minute)

Only **one person** (the host) needs to do this. The guest connects through the
host's relay candidate.

1. Open [Metered/Open Relay signup](https://dashboard.metered.ca/signup?tool=turnserver)
   and create a free account (no card).
2. In the dashboard, open **TURN Server & SFU → Credentials** and create a
   credential.
3. Copy its **TURN URLs**, **username** and **credential/password**.
4. In Beam, open **Settings → Relay (TURN)**, paste the URLs (comma-separated),
   username and password, then press **Test relay**.
5. Start the room and share the link.

A custom TURN credential works with any provider, not just Metered. The relay is
only used when a direct connection can't be established, so normal calls stay
peer-to-peer and fast.

### No-setup worldwide mode

If you don't want to create a relay account, use **No-setup worldwide mode** on
the landing page. It creates a private Talky room and shows a sound guide. In the
Talky tab click **Join Call**, then **Share screen**.

- To share **everything** (whole desktop, games, apps) with sound: choose
  **Entire screen** and turn on **Share system audio**. This is supported by
  Chrome/Edge on Windows.
- To share a video or music: choose that **browser tab** and turn on **Share tab
  audio**.
- Sharing a **Window** has no sound.
- On macOS, Chrome usually can't capture system audio from Entire screen. Use a
  tab with tab audio, or install a virtual audio device.
- Use the **sound test tab** in the guide to verify: play the tone, share Entire
  screen with system audio (or the test tab with tab audio), and check your friend
  hears it. Then share the real screen.
- On the viewer side, if the host tile shows **Mute**, click it to unmute, and
  raise Talky's speaker volume.

Talky is a third-party hosted service with its own relays, so this path works
across networks without any TURN setup. It opens in its own tab because Talky
does not allow embedding.

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "No live session under @name" | The friend hasn't pressed **Start a session**, or the name is spelled differently. Names ignore spaces and symbols: `Alex R.` → `@alexr`. Beam retries for a few seconds in case their socket is still registering. |
| "Share cancelled — nothing was shared" | You closed the browser's picker, or the page isn't allowed to capture. Click **Share my screen** again and choose a surface. If no picker appears, allow screen recording for your browser (macOS: System Settings → Privacy & Security → Screen Recording). |
| "…is already live in another tab" | That username is in use. Close the other tab or pick a different name. Beam retries for ~4s first, so a fresh reload usually just works. |
| "Screen capture needs a secure (https) page" | You're on `http://` with a LAN IP. Use localhost, a tunnel, or a deployed https link. |
| Stuck on "Knocking on their door" | Beam retries three times with a fresh route and then explains what to do. On strict networks add a TURN relay in **Settings → Relay (TURN)**, press **Test relay**, then start again. Only the host needs the relay. |
| No video, but names/chat work | The two networks can't find a direct path. Add your own TURN relay in **Settings → Relay (TURN)** (free at [metered.ca](https://dashboard.metered.ca/signup?tool=turnserver)) or try a different network. |
| Viewer can see the screen but hears nothing | The host shared without audio. Stop sharing, click **Share my screen**, choose a **browser tab** (not a window/entire screen), and tick **Share tab audio**. The host's own tile says `sound on` or `no sound`, so you can check before sending the link. The viewer may also need to click **Click to hear the screen** once, because browsers block unmuted autoplay. |
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
