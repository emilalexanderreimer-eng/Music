import { formatDuration } from '../config.js';

export default function NowPlaying({ nowPlaying, progress }) {
  if (!nowPlaying) {
    return (
      <div className="card now-playing empty">
        <div className="np-placeholder">🎵</div>
        <div>
          <div className="np-title">Nothing playing yet</div>
          <div className="np-sub">Add some songs to get started!</div>
        </div>
      </div>
    );
  }

  const { track, addedByName, paused } = nowPlaying;
  const pct =
    progress && progress.duration > 0
      ? Math.min(100, (progress.position / progress.duration) * 100)
      : 0;

  return (
    <div className="card now-playing">
      <div className={`np-art-wrap ${paused ? '' : 'pulsing'}`}>
        {track.image ? (
          <img className="np-art" src={track.image} alt={track.album} />
        ) : (
          <div className="np-art np-placeholder">🎵</div>
        )}
      </div>
      <div className="np-info">
        <div className="np-label">{paused ? '⏸ Paused' : '🔊 Now playing'}</div>
        <div className="np-title">{track.name}</div>
        <div className="np-sub">{track.artists}</div>
        {addedByName && <div className="np-added">added by {addedByName}</div>}
        <div className="progress">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="np-times">
          <span>{formatDuration(progress?.position || 0)}</span>
          <span>{formatDuration(progress?.duration || track.durationMs)}</span>
        </div>
      </div>
    </div>
  );
}
