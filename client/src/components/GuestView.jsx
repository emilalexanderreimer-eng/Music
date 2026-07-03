import { useState } from 'react';
import { socket, guestId } from '../socket.js';
import { toast } from '../config.js';
import NowPlaying from './NowPlaying.jsx';
import SongList from './SongList.jsx';
import SearchModal from './SearchModal.jsx';

const MAX_SONGS = 3;

export default function GuestView({ state, progress, name }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [showRecent, setShowRecent] = useState(false);

  if (!state) {
    return <div className="center-screen loading">Loading the party…</div>;
  }

  const mine = state.pool.filter((s) => s.addedBy === guestId).length;

  const vote = (songId) => {
    socket.emit('toggleVote', { songId }, (res) => {
      if (res?.error) toast(res.error);
    });
  };

  return (
    <div className="page">
      <header className="header">
        <div className="logo small">🎉 PartyQueue</div>
        <div className="header-right">
          <span className="chip">{state.guestCount} 🕺</span>
          <span className="chip">{name}</span>
        </div>
      </header>

      <NowPlaying nowPlaying={state.nowPlaying} progress={progress} />

      <div className="section-header">
        <h2>Up next</h2>
        <span className="chip">
          your songs: {mine}/{MAX_SONGS}
        </span>
      </div>

      <SongList pool={state.pool} guestId={guestId} onVote={vote} />

      {state.recentlyPlayed.length > 0 && (
        <div className="recent">
          <button className="link-btn" onClick={() => setShowRecent(!showRecent)}>
            Recently played ({state.recentlyPlayed.length}) {showRecent ? '▲' : '▼'}
          </button>
          {showRecent && (
            <ul className="recent-list">
              {state.recentlyPlayed.map((r, i) => (
                <li key={`${r.track.id}-${i}`}>
                  {r.track.image && <img src={r.track.image} alt="" loading="lazy" />}
                  <span className="recent-title">{r.track.name}</span>
                  <span className="recent-artist">{r.track.artists}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        className="fab"
        onClick={() => {
          if (mine >= MAX_SONGS) toast(`You already have ${MAX_SONGS} songs queued`);
          else setSearchOpen(true);
        }}
      >
        ＋ Add song
      </button>

      {searchOpen && <SearchModal state={state} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
