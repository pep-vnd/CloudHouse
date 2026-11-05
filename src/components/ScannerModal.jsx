import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode, Flashlight, Minus, Plus } from 'lucide-react';
import Modal from './Modal.jsx';
import { isValidBarcode } from '../lib/domain.js';
import { createCameraSession } from '../lib/cameraSession.js';
import { cameraConfig, cameraCapabilities, applyCameraControl } from '../lib/cameraControls.js';

export default function ScannerModal({ onClose, onDetected, busy }) {
  const host = useRef(null);
  const scanner = useRef(null);
  const detailedScan = useRef(null);
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
  const [devices, setDevices] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [capabilities, setCapabilities] = useState({ torch: false, focus: false, zoom: null });
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [adjusting, setAdjusting] = useState(false);
  const adjustment = useRef(false);
  function stop() {
    attempt.current++;
    detailedScan.current?.();
    detailedScan.current = null;
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
  async function start(deviceId = selectedCamera) {
    if (startLock.current || busy || locked.current) return;
    stop();
    startLock.current = true;
    const currentAttempt = ++attempt.current;
    setError(''); setCamera(false); setTorch(false); setStartingCamera(true);
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
      const session = createCameraSession({ reader, root, config: cameraConfig(deviceId), onDetected: raw => { void detect(raw); } });
      scanner.current = session;
      await session.ready;
      if (!alive.current || currentAttempt !== attempt.current) return;
      setCamera(true);
      const track = session.getTrack();
      const caps = cameraCapabilities(track);
      setCapabilities(caps);
      const settings = track?.getSettings?.() || {};
      setSelectedCamera(settings.deviceId || deviceId);
      setZoom(settings.zoom || caps.zoom?.min || 1);
      if (caps.focus) void applyCameraControl(track, 'focusMode', 'continuous').catch(() => {});
      void navigator.mediaDevices.enumerateDevices().then(list => {
        if (alive.current && currentAttempt === attempt.current) setDevices(list.filter(d => d.kind === 'videoinput'));
      }).catch(() => {});
      void import('../lib/barcodeDecoder.js').then(({ startDetailedScan }) => {
        if (alive.current && currentAttempt === attempt.current) detailedScan.current = startDetailedScan(session.getVideo(), raw => { void detect(raw); });
      }).catch(() => { /* La lectura normal sigue disponible si falla la descarga. */ });
    } catch (err) {
      stop(); root?.remove();
      if (alive.current && err?.name !== 'AbortError') setError(err?.message || 'No se ha podido abrir la cámara. Revisa el permiso o escribe el código.');
    } finally { startLock.current = false; if (alive.current) setStartingCamera(false); }
  }
  async function adjust(name, value) {
    if (adjustment.current || !camera) return;
    adjustment.current = true; setAdjusting(true); setError('');
    const session = scanner.current;
    try {
      const result = await applyCameraControl(session?.getTrack(), name, value);
      if (alive.current && scanner.current === session) {
        if (name === 'torch') setTorch(result); else setZoom(result);
      }
    } catch {
      if (alive.current && scanner.current === session) setError('Safari no ha podido aplicar ese ajuste. Puedes cambiar de cámara o mejorar la luz.');
    } finally { adjustment.current = false; if (alive.current) setAdjusting(false); }
  }
  return <Modal title="Escanear un producto" onClose={onClose} busy={busy}>
    <p className="muted">Coloca todo el código horizontal dentro del marco, con un poco de blanco a cada lado. Si ya está en casa, sumaremos una unidad.</p>
    <div className="camera-box"><div ref={host} className="camera-host" />{!camera && !startingCamera && <ScanBarcode size={70} strokeWidth={1} />}</div>
    {!camera && <button className="button primary full" onClick={() => start()} disabled={startingCamera || busy}><Camera size={19} />{startingCamera ? 'Abriendo cámara…' : 'Activar cámara'}</button>}
    {camera && <div className="scanner-controls">
      <p className="scanner-tip">Empieza a unos 20–30 cm. Si se ve borroso, aleja un poco el móvil; usa zoom para ampliar sin acercarte tanto.</p>
      <div className="scanner-control-row">
        {capabilities.torch && <button className={`button ${torch ? 'primary' : 'secondary'}`} aria-pressed={torch} disabled={adjusting || busy} onClick={() => adjust('torch', !torch)}><Flashlight size={18} />{torch ? 'Apagar linterna' : 'Encender linterna'}</button>}
        {capabilities.zoom && <div className="scanner-zoom" role="group" aria-label="Zoom de la cámara"><button className="icon-button" aria-label="Reducir zoom" disabled={adjusting || busy || zoom <= capabilities.zoom.min} onClick={() => adjust('zoom', zoom - Math.max(0.5, capabilities.zoom.step))}><Minus size={18} /></button><output aria-live="polite">{zoom.toFixed(1)}×</output><button className="icon-button" aria-label="Aumentar zoom" disabled={adjusting || busy || zoom >= capabilities.zoom.max} onClick={() => adjust('zoom', zoom + Math.max(0.5, capabilities.zoom.step))}><Plus size={18} /></button></div>}
      </div>
      <p className="small muted">{capabilities.torch ? 'La linterna ayuda con poca luz. Apágala si crea reflejos en el envase.' : 'Safari no ofrece linterna en esta cámara. Prueba con más luz, evitando reflejos.'}</p>
    </div>}
    {devices.length > 1 && <label className="scanner-camera-choice">Cámara<select value={selectedCamera} disabled={startingCamera || busy || adjusting} onChange={e => { const id = e.target.value; setSelectedCamera(id); if (camera) void start(id); }}><option value="">Trasera automática</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}</select><span className="small muted">Si no enfoca de cerca, prueba otra cámara trasera.</span></label>}
    {(camera || startingCamera) && <button className="button secondary full" disabled={busy} onClick={() => { stop(); setCamera(false); }}>Apagar cámara</button>}
    <form className="form-stack scanner-form" onSubmit={e => { e.preventDefault(); void detect(code); }}>
      <label>También puedes escribir el código<input inputMode="numeric" autoComplete="off" maxLength={13} placeholder="EAN-8 o EAN-13" value={code} onChange={e => setCode(e.target.value)} required /></label>
      <button className="button secondary full" disabled={busy || startingCamera || !code}>{busy ? 'Buscando producto…' : 'Buscar producto'}</button>
    </form>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <p className="small muted attribution">Datos de <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> · ODbL · Imágenes CC BY-SA</p>
  </Modal>;
}
