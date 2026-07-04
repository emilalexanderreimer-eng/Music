// Spotify API helpers: app token (search proxy), user OAuth tokens (playback)
// and thin wrappers around the Web API endpoints PartyQueue needs.

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

function creds() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set');
  }
  return { id, basic: Buffer.from(`${id}:${secret}`).toString('base64') };
}

// Client-credentials token used for the guest search proxy (no user login needed).
let appToken = { value: null, expiresAt: 0 };

// The host's user tokens — in memory only, refreshed automatically.
const user = { accessToken: null, refreshToken: null, expiresAt: 0, profile: null };

async function tokenRequest(params) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds().basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function getAppToken() {
  if (appToken.value && Date.now() < appToken.expiresAt - 60_000) return appToken.value;
  const data = await tokenRequest({ grant_type: 'client_credentials' });
  appToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return appToken.value;
}

export function getLoginUrl(redirectUri, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds().id,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'true',
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

export async function exchangeCode(code, redirectUri) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  user.accessToken = data.access_token;
  user.refreshToken = data.refresh_token;
  user.expiresAt = Date.now() + data.expires_in * 1000;
  try {
    const res = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    if (res.ok) {
      const me = await res.json();
      user.profile = { name: me.display_name, product: me.product };
    }
  } catch {
    user.profile = null;
  }
  return user.profile;
}

export async function getUserToken() {
  if (!user.accessToken && !user.refreshToken) return null;
  if (user.accessToken && Date.now() < user.expiresAt - 60_000) return user.accessToken;
  if (!user.refreshToken) return null;
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: user.refreshToken,
  });
  user.accessToken = data.access_token;
  if (data.refresh_token) user.refreshToken = data.refresh_token;
  user.expiresAt = Date.now() + data.expires_in * 1000;
  return user.accessToken;
}

export function isAuthenticated() {
  return Boolean(user.accessToken || user.refreshToken);
}

export function getProfile() {
  return user.profile;
}

async function userApi(method, path, body) {
  const token = await getUserToken();
  if (!token) throw new Error('Spotify is not connected — host must log in first');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify API ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
}

export async function play(deviceId, uris) {
  await userApi('PUT', `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { uris });
}

export async function pause(deviceId) {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await userApi('PUT', `/me/player/pause${query}`);
}

export async function searchTracks(query) {
  // Prefer the host's user token once Spotify is connected — some apps get
  // their client-credentials tokens rejected for /search, and the user token
  // is known-good (the host just logged in with it). Fall back to the
  // client-credentials app token so search also works before the host logs in.
  let token = null;
  try {
    token = await getUserToken();
  } catch {
    token = null;
  }
  if (!token) token = await getAppToken();
  const params = new URLSearchParams({ q: query, type: 'track', limit: '20' });
  const res = await fetch(`${API}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify search failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.tracks?.items || []).map((item) => ({
    id: item.id,
    uri: item.uri,
    name: item.name,
    artists: item.artists.map((a) => a.name).join(', '),
    album: item.album.name,
    image: (item.album.images[1] || item.album.images[0] || {}).url || null,
    durationMs: item.duration_ms,
  }));
}
