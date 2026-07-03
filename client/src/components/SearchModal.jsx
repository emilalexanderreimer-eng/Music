import { useEffect, useRef, useState } from 'react';
import { SERVER_URL, formatDuration, toast } from '../config.js';
import { socket } from '../socket.js';

export default function SearchModal({ state, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);
  const abort = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      try {
        const res = await fetch(`${SERVER_URL}/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: abort.current.signal,
        });
        const data = await res.json();
        setResults(data.tracks || []);
        setLoading(false);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setLoading(false);
          toast('Search failed — check your connection');
        }
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const unavailable = (trackId) => {
    if (state?.nowPlaying?.track.id === trackId) return 'Playing';
    if (state?.pool.some((s) => s.track.id === trackId)) return 'In queue';
    if (state?.recentlyPlayed.some((r) => r.track.id === trackId)) return 'Just played';
    return null;
  };

  const add = (track) => {
    socket.emit('addSong', { track }, (res) => {
      if (res?.error) toast(res.error);
      else {
        toast(`Added "${track.name}" 🎉`);
        onClose();
      }
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <input
            autoFocus
            type="search"
            placeholder="Search Spotify…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {loading && <div className="search-hint">Searching…</div>}
          {!loading && query && results.length === 0 && (
            <div className="search-hint">No results for “{query}”</div>
          )}
          {!query && <div className="search-hint">Search by song, artist or album</div>}
          <ul className="song-list">
            {results.map((track) => {
              const reason = unavailable(track.id);
              return (
                <li key={track.id} className="song-row">
                  {track.image ? (
                    <img className="song-art" src={track.image} alt="" loading="lazy" />
                  ) : (
                    <div className="song-art song-art-placeholder">🎵</div>
                  )}
                  <div className="song-meta">
                    <div className="song-title">{track.name}</div>
                    <div className="song-sub">
                      {track.artists} · {formatDuration(track.durationMs)}
                    </div>
                  </div>
                  {reason ? (
                    <span className="song-unavailable">{reason}</span>
                  ) : (
                    <button className="btn btn-small btn-primary" onClick={() => add(track)}>
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
