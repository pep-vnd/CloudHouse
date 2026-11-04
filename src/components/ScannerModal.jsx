import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import Modal from './Modal.jsx';
import { isValidBarcode } from '../lib/domain.js';
import { createCameraSession } from '../lib/cameraSession.js';

export default function ScannerModal({ onClose, onDetected, busy }) {
  const host = useRef(null);
  const scanner = useRef(null);
  const startLock = useRef(false);
  const attempt = useRef(0);
  const alive = useRef(true);
  const locked = useRef(false);
  const handler = useRef(onDetected);
  handler.current = onDetected;
  const [camera, setCamera] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  function stop() {
    attempt.current++;
    scanner.current?.stop();
    scanner.current = null;
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop(); }; }, []);
  async function detect(raw) {
    if (!alive.current || locked.current) return;
    const barcode = raw.trim();
    if (!isValidBarcode(barcode)) { setError('El código debe ser un EAN-8 o EAN-13 válido.'); return; }
    locked.current = true;
    setError('');
    await stop();
    if (!alive.current) return;
    setCamera(false);
    try {
      const ok = await handler.current(barcode);
      if (ok && alive.current) onClose();
    } finally { locked.current = false; }
  }
  async function start() {
    if (startLock.current || camera) return;
    startLock.current = true;
    const currentAttempt = ++attempt.current;
    setError(''); setStartingCamera(true);
    let root;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('La cámara necesita HTTPS. Puedes escribir el código abajo.');
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!alive.current || currentAttempt !== attempt.current) return;
      root = document.createElement('div');
      root.id = `scanner-${crypto.randomUUID()}`;
      root.className = 'camera-reader';
      host.current.append(root);
      const reader = new Html5Qrcode(root.id, { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8], verbose: false });
      const session = createCameraSession({ reader, root, config: {
        fps: 10, qrbox: (width, height) => ({ width: Math.max(50, Math.min(280, width - 24)), height: Math.max(50, Math.min(140, height - 24)) }),
      }, onDetected: raw => { void detect(raw); } });
      scanner.current = session;
      await session.ready;
      if (alive.current && currentAttempt === attempt.current) setCamera(true);
    } catch (err) {
      stop(); root?.remove();
      if (alive.current && err?.name !== 'AbortError') setError(err?.message || 'No se ha podido abrir la cámara. Revisa el permiso o escribe el código.');
    } finally { startLock.current = false; if (alive.current) setStartingCamera(false); }
  }
  return <Modal title="Escanear un producto" onClose={onClose} busy={busy}>
    <p className="muted">Apunta al código de barras. Si ya está en casa, sumaremos una unidad.</p>
    <div className="camera-box"><div ref={host} className="camera-host" />{!camera && !startingCamera && <ScanBarcode size={70} strokeWidth={1} />}</div>
    {!camera && <button className="button primary full" onClick={start} disabled={startingCamera || busy}><Camera size={19} />{startingCamera ? 'Abriendo cámara…' : 'Activar cámara'}</button>}
    {(camera || startingCamera) && <button className="button secondary full" disabled={busy} onClick={() => { stop(); setCamera(false); }}>Apagar cámara</button>}
    <form className="form-stack scanner-form" onSubmit={e => { e.preventDefault(); void detect(code); }}>
      <label>También puedes escribir el código<input inputMode="numeric" autoComplete="off" maxLength={13} placeholder="EAN-8 o EAN-13" value={code} onChange={e => setCode(e.target.value)} required /></label>
      <button className="button secondary full" disabled={busy || startingCamera || !code}>{busy ? 'Buscando producto…' : 'Buscar producto'}</button>
    </form>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <p className="small muted attribution">Datos de <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> · ODbL · Imágenes CC BY-SA</p>
  </Modal>;
}
