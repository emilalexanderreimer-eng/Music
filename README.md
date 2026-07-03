# 🎉 PartyQueue

A party music voting web app. Guests scan a QR code, search Spotify, add songs
and upvote — the highest-voted song plays next on the host's speakers via
Spotify. Real-time sync over websockets, dark party UI, installable as a PWA.

- **`/server`** — Node.js + Express + Socket.io backend (Spotify OAuth, search
  proxy, voting logic — all state in memory, no database)
- **`/client`** — React PWA frontend (mobile-first, works great in Android Chrome)
- **`.github/workflows/deploy.yml`** — auto-deploys the frontend to GitHub Pages on push

**Requirements:** the host needs a **Spotify Premium** account (the Web
Playback SDK requires it). Guests don't need Spotify at all.

---

## How it works

```
Guests (phones)                    Backend (Render)              Host (laptop + speakers)
  search / add / vote  ──socket──►  in-memory queue  ──socket──►  browser tab runs the
  see live queue       ◄──socket──  picks the winner ──Spotify──► Spotify Web Playback SDK
                                    (pinned > most votes)          and actually plays audio
```

- The **backend** proxies Spotify search (credentials stay server-side),
  handles the host's Spotify OAuth, and owns the queue: when a song ends, the
  pinned song plays next, otherwise the highest-voted one.
- The **host** opens the app on a laptop/PC connected to speakers, enters the
  host PIN, connects Spotify, and keeps the tab open — that tab is the playback
  device.
- **Guests** scan the QR code (or open the shared link), enter a name, and
  start adding and voting. Max 3 songs per guest in the queue at once, one vote
  per song per guest, and recently played songs (last 10) can't be re-added.

---

## 1. Create a Spotify Developer app

1. Go to <https://developer.spotify.com/dashboard> and log in with the host's
   Spotify account.
2. Click **Create app**. Name it e.g. `PartyQueue`, any description.
3. Under **Redirect URIs** add (you'll know the exact backend URL after step 2 —
   you can come back and add it then):
   ```
   https://YOUR-BACKEND.onrender.com/auth/callback
   ```
   For local development also add:
   ```
   http://localhost:3001/auth/callback
   ```
4. Under **Which API/SDKs are you planning to use?** select **Web API** and
   **Web Playback SDK**.
5. Save, then open the app's **Settings** and copy the **Client ID** and
   **Client Secret**. These go into the backend's environment variables —
   they are never exposed to the browser.

---

## 2. Deploy the backend to Render.com (free tier)

1. Fork/push this repo to your GitHub account.
2. Go to <https://render.com>, sign up (free), and click **New → Web Service**.
3. Connect your GitHub account and pick this repository.
4. Configure the service:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** Free
5. Add the **environment variables** (Environment tab):

   | Key | Value |
   |---|---|
   | `SPOTIFY_CLIENT_ID` | from the Spotify dashboard |
   | `SPOTIFY_CLIENT_SECRET` | from the Spotify dashboard |
   | `HOST_PIN` | your secret host PIN (default `1234` if unset) |
   | `FRONTEND_URL` | `https://YOUR-USERNAME.github.io/YOUR-REPO` (no trailing slash) |

6. Click **Create Web Service**. Render gives you a URL like
   `https://partyqueue-server.onrender.com` — HTTPS out of the box, which
   Spotify requires.
7. Go back to the Spotify dashboard and make sure
   `https://partyqueue-server.onrender.com/auth/callback` is in the Redirect
   URIs — it must match exactly.

Render auto-deploys the backend on every push to the connected branch, so the
GitHub Actions workflow only needs to handle the frontend. (Alternatively, use
the included `render.yaml` with **New → Blueprint**.)

> **Railway.app** works too: create a project from the repo, set the root
> directory to `server`, add the same environment variables, and generate a
> public domain. Use that domain everywhere this guide says "Render URL".

### ⚠️ Free tier spin-down

Render's free tier spins the service down after ~15 minutes without traffic
(losing the in-memory queue) and cold-starts in ~30–60s. PartyQueue mitigates
this two ways:

- The frontend pings `GET /ping` every 10 minutes while anyone has the app
  open, keeping the server awake during the party.
- Clients reconnect and re-join automatically, so even after a restart the
  party recovers — guests keep their names, they just may need to re-add songs.

For a more reliable always-on setup, add an UptimeRobot monitor (see below).

---

## 3. Deploy the frontend to GitHub Pages

1. In your repo on GitHub, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
2. Go to **Settings → Secrets and variables → Actions → Variables** and add a
   **repository variable**:
   - Name: `SERVER_URL`
   - Value: your backend URL, e.g. `https://partyqueue-server.onrender.com`
     (no trailing slash)
3. Push to `main` (or run the **Deploy frontend to GitHub Pages** workflow
   manually from the Actions tab).
4. The app is now live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.
5. Make sure the backend's `FRONTEND_URL` env var on Render matches this URL
   exactly, then redeploy the backend if you changed it.

---

## 4. Host: start a party session

1. On the laptop/PC connected to the speakers, open
   `https://YOUR-USERNAME.github.io/YOUR-REPO/#/host`.
2. Enter the **host PIN** (`HOST_PIN`, default `1234`).
3. Click **Connect Spotify** and log in with the **Premium** account. You'll be
   redirected back to the app.
4. Wait for the player status to show **ready on this device** — this browser
   tab is now the Spotify playback device. **Keep it open** and the volume up.
5. Show the QR code — the **⛶ Fullscreen** button is made for pointing a TV or
   monitor at the room.

Host powers: pin a song to play next (👑 crown, overrides votes), skip the
current song, remove songs, see who added what, and see the live guest count.

## 5. Guests: join the party

1. Scan the QR code (or open the shared link — the QR encodes the backend's
   `/join` URL, which redirects to the app in guest mode).
2. Enter a display name (saved on the device for next time).
3. Search, add up to 3 songs at a time, and upvote whatever should play next.
   The queue re-sorts live, and the currently playing song shows album art and
   a progress bar.

Tip: Android Chrome offers **Add to Home screen** — PartyQueue installs as a
proper app.

---

## 6. Keep-alive with UptimeRobot (recommended)

The in-app ping only runs while someone has the app open. A free
[UptimeRobot](https://uptimerobot.com) monitor keeps the backend warm around
the clock:

1. Sign up at <https://uptimerobot.com> (free plan: 50 monitors).
2. Click **New monitor**.
3. **Monitor type:** HTTP(s)
4. **URL:** `https://YOUR-BACKEND.onrender.com/health`
5. **Interval:** 5 minutes.
6. Create the monitor.

`GET /health` returns UptimeRobot-compatible JSON:

```json
{ "status": "ok", "uptime": 1234, "guestCount": 7 }
```

There's also a bare `GET /ping` → `200 OK` if you prefer a minimal endpoint.

---

## Local development

```bash
# Terminal 1 — backend
cd server
npm install
cp ../.env.example .env   # fill in SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
npm run dev               # http://localhost:3001

# Terminal 2 — frontend
cd client
npm install
npm run dev               # http://localhost:5173 (talks to http://localhost:3001 by default)
```

Add `http://localhost:3001/auth/callback` to your Spotify app's Redirect URIs
and set `FRONTEND_URL=http://localhost:5173` in `server/.env`.
Note: Spotify allows `http` redirect URIs only for `localhost`; everywhere else
must be HTTPS.

## Environment variables

See [`.env.example`](.env.example). Backend: `SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`, `HOST_PIN`, `FRONTEND_URL`, `PORT`. Frontend
(build-time): `VITE_SERVER_URL` (set via the `SERVER_URL` repository variable
in CI).

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /ping` | instant `200 OK` (keep-alive) |
| `GET /health` | `{ status, uptime, guestCount }` (UptimeRobot) |
| `GET /join` | redirects to the frontend (this is what the QR encodes) |
| `GET /auth/login?pin=…` | starts Spotify OAuth (host only) |
| `GET /auth/callback` | OAuth redirect URI |
| `GET /auth/token` | access token for the Web Playback SDK (host only) |
| `GET /api/search?q=…` | Spotify search proxy for guests |

Everything else happens over Socket.io (`join`, `addSong`, `toggleVote`,
`host:*` events).
