export function cameraConfig(deviceId) {
  return {
    fps: 6, disableFlip: true,
    videoConstraints: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 },
    },
    qrbox: (width, height) => ({ width: Math.floor(width * 0.9), height: Math.floor(height * 0.55) }),
  };
}

export function cameraCapabilities(track) {
  let caps = {};
  try { caps = track?.getCapabilities?.() || {}; } catch {}
  const range = caps.zoom;
  const maxZoom = range ? Math.min(range.max, Math.max(3, range.min)) : 0;
  return {
    torch: caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true)),
    focus: Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous'),
    zoom: range && Number.isFinite(range.min) && Number.isFinite(range.max) && maxZoom > range.min
      ? { min: range.min, max: maxZoom, step: range.step || 0.1 } : null,
  };
}

export async function applyCameraControl(track, name, value) {
  if (!track || track.readyState === 'ended') throw new Error('La cámara está apagada.');
  const caps = cameraCapabilities(track);
  if ((name === 'torch' && !caps.torch) || (name === 'focusMode' && !caps.focus) || (name === 'zoom' && !caps.zoom)) throw new Error('Esta cámara no permite ese ajuste.');
  if (name === 'zoom') {
    if (!Number.isFinite(value)) throw new Error('Zoom inválido.');
    value = Math.min(caps.zoom.max, Math.max(caps.zoom.min, value));
    value = Math.min(caps.zoom.max, caps.zoom.min + Math.round((value - caps.zoom.min) / caps.zoom.step) * caps.zoom.step);
  }
  // Safari puede devolver un valor de torch antiguo en getSettings().
  await track.applyConstraints({ [name]: value, advanced: [{ [name]: value }] });
  return value;
}
