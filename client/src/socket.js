import { io } from 'socket.io-client';
import { SERVER_URL } from './config.js';

export const socket = io(SERVER_URL, {
  // Render free tier spins down; retry forever so the party recovers on its own.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelayMax: 10000,
});

export const guestId = (() => {
  let id = localStorage.getItem('pq_guestId');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}-${Math.random()}`;
    localStorage.setItem('pq_guestId', id);
  }
  return id;
})();

export function joinParty(name) {
  localStorage.setItem('pq_name', name);
  socket.emit('join', { guestId, name });
}

// Re-join automatically on every (re)connect so a server restart or a phone
// waking from sleep puts the guest right back in the party.
socket.on('connect', () => {
  const name = localStorage.getItem('pq_name');
  if (name) socket.emit('join', { guestId, name });
  const hostToken = localStorage.getItem('pq_hostToken');
  if (hostToken) socket.emit('host:login', { token: hostToken }, () => {});
});
