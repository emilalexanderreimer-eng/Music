import { formatDuration } from '../config.js';

// Shared queue list. In guest mode rows get a vote button; in host mode they
// get pin/remove controls and always show who added the song.
export default function SongList({ pool, guestId, onVote, hostMode, onPin, onRemove }) {
  if (!pool || pool.length === 0) {
    return (
      <div className="card empty-pool">
        <div className="empty-emoji">🎶</div>
        <div className="empty-text">Add some songs!</div>
        <div className="empty-sub">The queue is empty — search for a banger.</div>
      </div>
    );
  }

  return (
    <ul className="song-list">
      {pool.map((song) => {
        const voted = guestId && song.votedBy.includes(guestId);
        return (
          <li key={song.id} className={`song-row ${song.pinned ? 'pinned' : ''}`}>
            {song.track.image ? (
              <img className="song-art" src={song.track.image} alt="" loading="lazy" />
            ) : (
              <div className="song-art song-art-placeholder">🎵</div>
            )}
            <div className="song-meta">
              <div className="song-title">
                {song.pinned && <span title="Pinned — plays next">👑 </span>}
                {song.track.name}
              </div>
              <div className="song-sub">
                {song.track.artists} · {formatDuration(song.track.durationMs)}
              </div>
              <div className="song-added">added by {song.addedByName}</div>
            </div>
            {hostMode ? (
              <div className="host-row-actions">
                <button
                  className={`icon-btn ${song.pinned ? 'active' : ''}`}
                  title={song.pinned ? 'Unpin' : 'Pin to play next'}
                  onClick={() => onPin(song.id)}
                >
                  👑
                </button>
                <button
                  className="icon-btn danger"
                  title="Remove from queue"
                  onClick={() => onRemove(song.id)}
                >
                  ✕
                </button>
                <div className="vote-count">▲ {song.votes}</div>
              </div>
            ) : (
              <button
                className={`vote-btn ${voted ? 'voted' : ''}`}
                onClick={() => onVote(song.id)}
                aria-pressed={voted}
              >
                <span className="vote-arrow">▲</span>
                <span>{song.votes}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
