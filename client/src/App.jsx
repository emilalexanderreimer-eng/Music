import { useEffect, useState } from 'react';
import { socket, joinParty } from './socket.js';
import { SERVER_URL } from './config.js';
import NamePrompt from './components/NamePrompt.jsx';
import GuestView from './components/GuestView.jsx';
import HostView from './components/HostView.jsx';

const isHostRoute = () => window.location.hash.startsWith('#/host');

export default function App() {
  const [hostRoute, setHostRoute] = useState(isHostRoute());
  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState(null);
  const [progress, setProgress] = useState(null);
  const [name, setName] = useState(localStorage.getItem('pq_name') || '');
  const [toastMsg, setToastMsg] = useState(null);

  useEffect(() => {
    const onHash = () => setHostRoute(isHostRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onState = (s) => setState(s);
    const onProgress = (p) => setProgress(p);
    const onToast = (msg) => setToastMsg(String(msg));
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('progress', onProgress);
    socket.on('toast', onToast);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('progress', onProgress);
      socket.off('toast', onToast);
    };
  }, []);

  // Toasts (from server or local via the pq-toast event), auto-dismissed.
  useEffect(() => {
    const onLocalToast = (e) => setToastMsg(String(e.detail));
    window.addEventListener('pq-toast', onLocalToast);
    return () => window.removeEventListener('pq-toast', onLocalToast);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Keep-alive: ping the backend every 10 minutes so the Render free tier
  // doesn't spin down mid-party.
  useEffect(() => {
    const ping = () => fetch(`${SERVER_URL}/ping`).catch(() => {});
    ping();
    const interval = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleName = (newName) => {
    setName(newName);
    joinParty(newName);
  };

  let view;
  if (hostRoute) {
    view = <HostView state={state} progress={progress} connected={connected} />;
  } else if (!name) {
    view = <NamePrompt onSubmit={handleName} />;
  } else {
    view = <GuestView state={state} progress={progress} name={name} />;
  }

  return (
    <div className="app">
      {!connected && (
        <div className="banner">
          Reconnecting to the party<span className="dots" />
        </div>
      )}
      {view}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
