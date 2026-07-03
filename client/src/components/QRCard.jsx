import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { SERVER_URL, toast } from '../config.js';

// The QR encodes the backend's /join URL, which redirects to the frontend —
// guests scan it and land straight in guest mode.
const JOIN_URL = `${SERVER_URL}/join`;

export default function QRCard() {
  const [dataUrl, setDataUrl] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(JOIN_URL, {
      width: 640,
      margin: 2,
      color: { dark: '#0d0d14', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(JOIN_URL);
      toast('Link copied!');
    } catch {
      toast(JOIN_URL);
    }
  };

  if (fullscreen && dataUrl) {
    return (
      <div className="qr-fullscreen" onClick={() => setFullscreen(false)}>
        <div className="logo">🎉 PartyQueue</div>
        <img src={dataUrl} alt="Scan to join PartyQueue" />
        <div className="qr-link">{JOIN_URL}</div>
        <div className="qr-hint">Scan to join · tap anywhere to close</div>
      </div>
    );
  }

  return (
    <div className="card qr-card">
      <h3>Invite guests</h3>
      {dataUrl && <img className="qr-img" src={dataUrl} alt="Scan to join PartyQueue" />}
      <div className="qr-link">{JOIN_URL}</div>
      <div className="qr-actions">
        <button className="btn btn-small" onClick={copyLink}>
          Copy link
        </button>
        <button className="btn btn-small" onClick={() => setFullscreen(true)}>
          ⛶ Fullscreen
        </button>
      </div>
    </div>
  );
}
