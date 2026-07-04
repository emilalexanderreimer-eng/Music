import 'dotenv/config';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import * as spotify from './spotify.js';

const PORT = process.env.PORT || 3001;
const HOST_PIN = process.env.HOST_PIN || '1234';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

// Derived from the PIN so it stays valid across server restarts (Render free
// tier spins down) without persisting anything.
const HOST_TOKEN = crypto.createHash('sha256').update(`partyqueue:${HOST_PIN}`).digest('hex');

const isHostToken = (token) =>
  typeof token === 'string' &&
  token.length === HOST_TOKEN.length &&
  crypto.timingSafeEqual(Buffer.from(token), Buffer.from(HOST_TOKEN));

// ── In-memory party state ────────────────────────────────────────────────────

const state = {
  // { id, track, addedBy, addedByName, addedAt, votes: Set<guestId>, pinned }
  pool: [],
  // { track, addedByName, startedAt, positionMs, durationMs, paused, updatedAt }
  nowPlaying: null,
  // [{ track, addedByName, playedAt }] — newest first, max 10
  recentlyPlayed: [],
  // guestId -> { name, sockets: Set<socketId> }
  guests: new Map(),
  hostDeviceId: null,
};

const MAX_SONGS_PER_GUEST = 3;
const RECENTLY_PLAYED_LIMIT = 10;

const guestCount = () =>
  [...state.guests.values()].filter((g) => g.sockets.size > 0).length;

function sortedPool() {
  return [...state.pool].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.votes.size !== a.votes.size) return b.votes.size - a.votes.size;
    return a.addedAt - b.addedAt;
  });
}

function serialize() {
  return {
    pool: sortedPool().map((s) => ({
      id: s.id,
      track: s.track,
      addedBy: s.addedBy,
      addedByName: s.addedByName,
      pinned: s.pinned,
      votes: s.votes.size,
      votedBy: [...s.votes],
    })),
    nowPlaying: state.nowPlaying && {
      track: state.nowPlaying.track,
      addedByName: state.nowPlaying.addedByName,
      paused: state.nowPlaying.paused,
    },
    recentlyPlayed: state.recentlyPlayed,
    guestCount: guestCount(),
    spotifyAuthenticated: spotify.isAuthenticated(),
    spotifyProfile: spotify.getProfile(),
    playerReady: Boolean(state.hostDeviceId),
  };
}

const broadcast = () => io.emit('state', serialize());
const hostToast = (message) => io.to('hosts').emit('toast', message);

function currentProgress() {
  const np = state.nowPlaying;
  if (!np) return null;
  const elapsed = np.paused ? 0 : Date.now() - np.updatedAt;
  return {
    position: Math.min(np.positionMs + elapsed, np.durationMs),
    duration: np.durationMs,
    paused: np.paused,
  };
}

function trackIsBlocked(trackId) {
  if (state.nowPlaying?.track.id === trackId) return 'That song is playing right now';
  if (state.pool.some((s) => s.track.id === trackId)) return 'That song is already in the queue';
  if (state.recentlyPlayed.some((r) => r.track.id === trackId)) {
    return 'That song was just played — try again later';
  }
  return null;
}

function pickNext() {
  if (state.pool.length === 0) return null;
  return sortedPool()[0];
}

function finishCurrent() {
  if (!state.nowPlaying) return;
  state.recentlyPlayed.unshift({
    track: state.nowPlaying.track,
    addedByName: state.nowPlaying.addedByName,
    playedAt: Date.now(),
  });
  state.recentlyPlayed = state.recentlyPlayed.slice(0, RECENTLY_PLAYED_LIMIT);
  state.nowPlaying = null;
}

let advancing = false;

async function playNext() {
  if (advancing) return;
  advancing = true;
  try {
    finishCurrent();
    const next = pickNext();
    if (!next) {
      broadcast();
      if (spotify.isAuthenticated() && state.hostDeviceId) {
        await spotify.pause(state.hostDeviceId).catch(() => {});
      }
      return;
    }
    if (!spotify.isAuthenticated() || !state.hostDeviceId) {
      hostToast('Connect Spotify on the host device to start playback');
      broadcast();
      return;
    }
    state.pool = state.pool.filter((s) => s.id !== next.id);
    try {
      await spotify.play(state.hostDeviceId, [next.track.uri]);
      state.nowPlaying = {
        track: next.track,
        addedByName: next.addedByName,
        startedAt: Date.now(),
        positionMs: 0,
        durationMs: next.track.durationMs,
        paused: false,
        updatedAt: Date.now(),
      };
    } catch (err) {
      console.error('Playback failed:', err.message);
      state.pool.unshift(next); // put it back, don't lose the song
      hostToast(`Playback failed: ${err.message}`);
    }
    broadcast();
  } finally {
    advancing = false;
  }
}

// Broadcast progress once a second and auto-advance if the host tab missed
// the track-end event (e.g. it was briefly backgrounded).
setInterval(() => {
  const progress = currentProgress();
  if (!progress) return;
  io.emit('progress', progress);
  if (!progress.paused && progress.position >= progress.duration && state.nowPlaying) {
    const overshoot = Date.now() - state.nowPlaying.updatedAt - (state.nowPlaying.durationMs - state.nowPlaying.positionMs);
    if (overshoot > 5000) playNext();
  }
}, 1000);

// ── HTTP endpoints ───────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [new URL(FRONTEND_URL).origin, 'http://localhost:5173'];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Opening the backend URL directly just takes you to the app.
app.get('/', (req, res) => res.redirect(FRONTEND_URL));

app.get('/ping', (req, res) => res.status(200).send('OK'));

app.get('/health', (req, res) =>
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), guestCount: guestCount() })
);

// The QR code encodes this URL — it redirects guests to the frontend.
app.get('/join', (req, res) => res.redirect(FRONTEND_URL));

const serverUrl = (req) => `${req.protocol}://${req.get('host')}`;
const pendingOAuthStates = new Set();

app.get('/auth/login', (req, res) => {
  const { pin, token } = req.query;
  if (pin !== HOST_PIN && !isHostToken(token)) {
    return res.status(403).send('Invalid host PIN');
  }
  const oauthState = crypto.randomBytes(16).toString('hex');
  pendingOAuthStates.add(oauthState);
  setTimeout(() => pendingOAuthStates.delete(oauthState), 10 * 60 * 1000).unref();
  try {
    res.redirect(spotify.getLoginUrl(`${serverUrl(req)}/auth/callback`, oauthState));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/auth/callback', async (req, res) => {
  const { code, state: oauthState, error } = req.query;
  if (error) return res.redirect(`${FRONTEND_URL}/#/host?auth=error`);
  if (!code || !pendingOAuthStates.has(oauthState)) {
    return res.status(400).send('Invalid OAuth state — please start the login again from the app.');
  }
  pendingOAuthStates.delete(oauthState);
  try {
    await spotify.exchangeCode(code, `${serverUrl(req)}/auth/callback`);
    broadcast();
    res.redirect(`${FRONTEND_URL}/#/host?auth=ok`);
  } catch (err) {
    console.error('OAuth exchange failed:', err.message);
    res.redirect(`${FRONTEND_URL}/#/host?auth=error`);
  }
});

app.get('/auth/status', (req, res) =>
  res.json({ authenticated: spotify.isAuthenticated(), profile: spotify.getProfile() })
);

// The Web Playback SDK on the host's browser fetches its OAuth token here.
app.get('/auth/token', async (req, res) => {
  if (!isHostToken(req.get('x-host-token'))) return res.status(403).json({ error: 'Forbidden' });
  try {
    const token = await spotify.getUserToken();
    if (!token) return res.status(401).json({ error: 'Spotify not connected' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search proxy — credentials never reach the client.
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ tracks: [] });
  try {
    res.json({ tracks: await spotify.searchTracks(q) });
  } catch (err) {
    console.error('Search failed:', err.message);
    res.status(502).json({ error: 'Spotify search failed' });
  }
});

// ── Socket.io ────────────────────────────────────────────────────────────────

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: allowedOrigins } });

io.on('connection', (socket) => {
  socket.emit('state', serialize());
  const progress = currentProgress();
  if (progress) socket.emit('progress', progress);

  socket.on('join', ({ guestId, name } = {}, ack) => {
    if (!guestId || !name) return ack?.({ error: 'Missing name' });
    let guest = state.guests.get(guestId);
    if (!guest) {
      guest = { name: String(name).slice(0, 24), sockets: new Set() };
      state.guests.set(guestId, guest);
    }
    guest.name = String(name).slice(0, 24);
    guest.sockets.add(socket.id);
    socket.data.guestId = guestId;
    ack?.({ ok: true });
    broadcast();
  });

  socket.on('addSong', ({ track } = {}, ack) => {
    const guestId = socket.data.guestId;
    const guest = guestId && state.guests.get(guestId);
    if (!guest) return ack?.({ error: 'Join the party first' });
    if (!track?.id || !track?.uri) return ack?.({ error: 'Invalid track' });
    const blocked = trackIsBlocked(track.id);
    if (blocked) return ack?.({ error: blocked });
    const mine = state.pool.filter((s) => s.addedBy === guestId).length;
    if (mine >= MAX_SONGS_PER_GUEST) {
      return ack?.({ error: `You can only have ${MAX_SONGS_PER_GUEST} songs in the queue at once` });
    }
    state.pool.push({
      id: crypto.randomUUID(),
      track: {
        id: track.id,
        uri: track.uri,
        name: String(track.name || '').slice(0, 200),
        artists: String(track.artists || '').slice(0, 200),
        album: String(track.album || '').slice(0, 200),
        image: typeof track.image === 'string' ? track.image : null,
        durationMs: Number(track.durationMs) || 0,
      },
      addedBy: guestId,
      addedByName: guest.name,
      addedAt: Date.now(),
      votes: new Set([guestId]), // adding counts as your vote
      pinned: false,
    });
    ack?.({ ok: true });
    broadcast();
    // Kick off playback if nothing is playing yet.
    if (!state.nowPlaying) playNext();
  });

  socket.on('toggleVote', ({ songId } = {}, ack) => {
    const guestId = socket.data.guestId;
    if (!guestId || !state.guests.has(guestId)) return ack?.({ error: 'Join the party first' });
    const song = state.pool.find((s) => s.id === songId);
    if (!song) return ack?.({ error: 'Song not found' });
    if (song.votes.has(guestId)) song.votes.delete(guestId);
    else song.votes.add(guestId);
    ack?.({ ok: true });
    broadcast();
  });

  // ── Host events ──
  socket.on('host:login', ({ pin, token } = {}, ack) => {
    if (pin === HOST_PIN || isHostToken(token)) {
      socket.data.isHost = true;
      socket.join('hosts');
      return ack?.({ ok: true, token: HOST_TOKEN });
    }
    ack?.({ error: 'Wrong PIN' });
  });

  const requireHost = (payload, ack) => {
    if (socket.data.isHost || isHostToken(payload?.token)) return true;
    ack?.({ error: 'Not authorized' });
    return false;
  };

  socket.on('host:pin', (payload = {}, ack) => {
    if (!requireHost(payload, ack)) return;
    const song = state.pool.find((s) => s.id === payload.songId);
    if (!song) return ack?.({ error: 'Song not found' });
    const wasPinned = song.pinned;
    state.pool.forEach((s) => (s.pinned = false));
    song.pinned = !wasPinned;
    ack?.({ ok: true });
    broadcast();
  });

  socket.on('host:remove', (payload = {}, ack) => {
    if (!requireHost(payload, ack)) return;
    state.pool = state.pool.filter((s) => s.id !== payload.songId);
    ack?.({ ok: true });
    broadcast();
  });

  socket.on('host:skip', (payload = {}, ack) => {
    if (!requireHost(payload, ack)) return;
    ack?.({ ok: true });
    playNext();
  });

  socket.on('host:deviceReady', (payload = {}, ack) => {
    if (!requireHost(payload, ack)) return;
    state.hostDeviceId = payload.deviceId || null;
    ack?.({ ok: true });
    broadcast();
    // Resume the party automatically if songs queued up while the player was offline.
    if (!state.nowPlaying && state.pool.length > 0) playNext();
  });

  socket.on('host:progress', (payload = {}) => {
    if (!socket.data.isHost && !isHostToken(payload.token)) return;
    if (!state.nowPlaying) return;
    state.nowPlaying.positionMs = Number(payload.position) || 0;
    state.nowPlaying.durationMs = Number(payload.duration) || state.nowPlaying.durationMs;
    state.nowPlaying.paused = Boolean(payload.paused);
    state.nowPlaying.updatedAt = Date.now();
  });

  socket.on('host:trackEnded', (payload = {}) => {
    if (!socket.data.isHost && !isHostToken(payload.token)) return;
    if (!state.nowPlaying) return;
    playNext();
  });

  socket.on('disconnect', () => {
    const guest = socket.data.guestId && state.guests.get(socket.data.guestId);
    if (guest) {
      guest.sockets.delete(socket.id);
      broadcast();
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`PartyQueue server listening on port ${PORT}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
});
