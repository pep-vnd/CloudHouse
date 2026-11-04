import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import Modal from './Modal.jsx';
import { isValidBarcode } from '../lib/domain.js';

export default function ScannerModal({ onClose, onDetected, busy }) {
  const id = `scanner-${useId().replace(/:/g, '')}`;
  const scanner = useRef(null);
  const starting = useRef(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const handler = useRef(onDetected);
  handler.current = onDetected;
  const [camera, setCamera] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  async function stop() {
    try { await starting.current; } catch { /* start() ya presenta su error en el modal. */ }
    const reader = scanner.current;
    if (reader) {
      try { if (reader.isScanning) await reader.stop(); } catch { /* La pista puede haber sido cerrada por el navegador. */ }
      try { reader.clear(); } catch { /* El contenedor puede haberse desmontado. */ }
    }
  }
  useEffect(() => () => { alive.current = false; void stop(); }, []);
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
    setError(''); setStartingCamera(true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('La cámara necesita HTTPS. Puedes escribir el código abajo.');
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!alive.current) return;
      const reader = new Html5Qrcode(id, { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8], verbose: false });
      scanner.current = reader;
      starting.current = reader.start({ facingMode: 'environment' }, {
        fps: 10, qrbox: (width, height) => ({ width: Math.max(50, Math.min(280, width - 24)), height: Math.max(50, Math.min(140, height - 24)) }),
      }, raw => { void detect(raw); }, () => {});
      await starting.current;
      if (alive.current) setCamera(true);
    } catch (err) {
      if (alive.current) setError(err?.message || 'No se ha podido abrir la cámara. Revisa el permiso o escribe el código.');
    } finally { if (alive.current) setStartingCamera(false); }
  }
  return <Modal title="Escanear un producto" onClose={onClose} busy={busy}>
    <p className="muted">Apunta al código de barras. Si ya está en casa, sumaremos una unidad.</p>
    <div className="camera-box"><div id={id} />{!camera && !startingCamera && <ScanBarcode size={70} strokeWidth={1} />}</div>
    {!camera && <button className="button primary full" onClick={start} disabled={startingCamera || busy}><Camera size={19} />{startingCamera ? 'Abriendo cámara…' : 'Activar cámara'}</button>}
    <form className="form-stack scanner-form" onSubmit={e => { e.preventDefault(); void detect(code); }}>
      <label>También puedes escribir el código<input inputMode="numeric" autoComplete="off" maxLength={13} placeholder="EAN-8 o EAN-13" value={code} onChange={e => setCode(e.target.value)} required /></label>
      <button className="button secondary full" disabled={busy || startingCamera || !code}>{busy ? 'Buscando producto…' : 'Buscar producto'}</button>
    </form>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <p className="small muted attribution">Datos de <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> · ODbL · Imágenes CC BY-SA</p>
  </Modal>;
}
