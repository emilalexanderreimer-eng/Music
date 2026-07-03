import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import { SERVER_URL, toast } from '../config.js';
import NowPlaying from './NowPlaying.jsx';
import SongList from './SongList.jsx';
import QRCard from './QRCard.jsx';

export default function HostView({ state, progress, connected }) {
  const [hostToken, setHostToken] = useState(localStorage.getItem('pq_hostToken') || null);
  const [pinInput, setPinInput] = useState('');
  const [checking, setChecking] = useState(Boolean(hostToken));
  const [playerStatus, setPlayerStatus] = useState('idle'); // idle | loading | ready | error
  const playerRef = useRef(null);
  const tokenRef = useRef(hostToken);
  tokenRef.current = hostToken;

  // Validate a stored token (it survives restarts server-side, but the PIN
  // may have been changed in .env).
  useEffect(() => {
    if (!hostToken || !connected) return;
    socket.emit('host:login', { token: hostToken }, (res) => {
      setChecking(false);
      if (res?.error) {
        localStorage.removeItem('pq_hostToken');
        setHostToken(null);
      }
    });
  }, [hostToken, connected]);

  const loginWithPin = (e) => {
    e.preventDefault();
    socket.emit('host:login', { pin: pinInput }, (res) => {
      if (res?.error) return toast(res.error);
      localStorage.setItem('pq_hostToken', res.token);
      setHostToken(res.token);
      setChecking(false);
    });
  };

  // ── Spotify Web Playback SDK ──
  const spotifyReady = state?.spotifyAuthenticated;

  useEffect(() => {
    if (!hostToken || !spotifyReady || playerRef.current) return;
    setPlayerStatus('loading');

    const initPlayer = () => {
      const player = new window.Spotify.Player({
        name: 'PartyQueue Host',
        volume: 1,
        getOAuthToken: (cb) => {
          fetch(`${SERVER_URL}/auth/token`, {
            headers: { 'X-Host-Token': tokenRef.current },
          })
            .then((r) => r.json())
            .then((d) => d.token && cb(d.token))
            .catch(() => {});
        },
      });

      player.addListener('ready', ({ device_id }) => {
        setPlayerStatus('ready');
        socket.emit('host:deviceReady', { token: tokenRef.current, deviceId: device_id }, () => {});
      });
      player.addListener('not_ready', () => setPlayerStatus('loading'));

      // Report progress to the server (it relays to guests) and detect the
      // end of a track: playback pauses and rewinds to position 0.
      let prev = null;
      let endedFor = null;
      player.addListener('player_state_changed', (s) => {
        if (!s) return;
        const trackUri = s.track_window?.current_track?.uri;
        socket.emit('host:progress', {
          token: tokenRef.current,
          position: s.position,
          duration: s.duration,
          paused: s.paused,
        });
        if (
          prev &&
          !prev.paused &&
          s.paused &&
          s.position === 0 &&
          trackUri &&
          endedFor !== trackUri
        ) {
          endedFor = trackUri;
          socket.emit('host:trackEnded', { token: tokenRef.current });
        }
        if (!s.paused) endedFor = null;
        prev = { paused: s.paused, position: s.position };
      });

      ['initialization_error', 'authentication_error', 'account_error'].forEach((event) =>
        player.addListener(event, ({ message }) => {
          setPlayerStatus('error');
          toast(`Spotify player: ${message}`);
        })
      );

      player.connect();
      playerRef.current = player;
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
      if (!document.getElementById('spotify-sdk')) {
        const script = document.createElement('script');
        script.id = 'spotify-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }
    }
  }, [hostToken, spotifyReady]);

  useEffect(
    () => () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
    },
    []
  );

  // ── Render ──

  if (!hostToken || checking) {
    return (
      <div className="center-screen">
        <div className="logo-block">
          <div className="logo">🎉 PartyQueue</div>
          <p className="tagline">Host mode</p>
        </div>
        {checking ? (
          <div className="loading">Checking host session…</div>
        ) : (
          <form className="card name-form" onSubmit={loginWithPin}>
            <label htmlFor="pin">Host PIN</label>
            <input
              id="pin"
              autoFocus
              type="password"
              inputMode="numeric"
              placeholder="••••"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!pinInput}>
              Unlock host mode
            </button>
            <a className="link-btn" href="#/">
              I'm a guest →
            </a>
          </form>
        )}
      </div>
    );
  }

  if (!state) {
    return <div className="center-screen loading">Loading the party…</div>;
  }

  const hostAction = (event, payload = {}) =>
    socket.emit(event, { token: hostToken, ...payload }, (res) => {
      if (res?.error) toast(res.error);
    });

  return (
    <div className="page host-page">
      <header className="header">
        <div className="logo small">🎉 PartyQueue</div>
        <div className="header-right">
          <span className="chip">HOST</span>
          <span className="chip">{state.guestCount} 🕺</span>
        </div>
      </header>

      {!state.spotifyAuthenticated ? (
        <div className="card setup-card">
          <h3>Step 1 · Connect Spotify</h3>
          <p>
            Log in with the Spotify <strong>Premium</strong> account that will play the music on
            this device.
          </p>
          <a
            className="btn btn-spotify"
            href={`${SERVER_URL}/auth/login?token=${encodeURIComponent(hostToken)}`}
          >
            Connect Spotify
          </a>
        </div>
      ) : (
        <div className="card status-card">
          <div>
            <strong>Spotify:</strong> {state.spotifyProfile?.name || 'connected'}{' '}
            {state.spotifyProfile && state.spotifyProfile.product !== 'premium' && (
              <span className="warn">⚠ not Premium — playback won't work</span>
            )}
          </div>
          <div>
            <strong>Player:</strong>{' '}
            {playerStatus === 'ready'
              ? '✅ ready on this device'
              : playerStatus === 'error'
                ? '❌ error'
                : '⏳ starting… keep this tab open'}
          </div>
        </div>
      )}

      <NowPlaying nowPlaying={state.nowPlaying} progress={progress} />

      <div className="host-controls">
        <button
          className="btn"
          onClick={() => hostAction('host:skip')}
          disabled={!state.nowPlaying && state.pool.length === 0}
        >
          {state.nowPlaying ? '⏭ Skip song' : '▶ Start queue'}
        </button>
      </div>

      <div className="section-header">
        <h2>Queue</h2>
        <span className="chip">{state.pool.length} songs</span>
      </div>

      <SongList
        pool={state.pool}
        hostMode
        onPin={(songId) => hostAction('host:pin', { songId })}
        onRemove={(songId) => hostAction('host:remove', { songId })}
      />

      <QRCard />
    </div>
  );
}
