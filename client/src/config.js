// Backend URL, baked in at build time (VITE_SERVER_URL). Falls back to the
// local dev server so `npm run dev` in /client + /server just works.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function toast(message) {
  window.dispatchEvent(new CustomEvent('pq-toast', { detail: message }));
}
