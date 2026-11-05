// Mantiene cada intento aislado: un permiso tardío no puede reabrir el escáner cerrado.
export function createCameraSession({ reader, root, config, onDetected, timeoutMs = 20000, observe = callback => new MutationObserver(callback) }) {
  let cancelled = false;
  let settled = false;
  let started = false;
  let timer;
  let poll;
  let resolveReady;
  let rejectReady;
  let stopping;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const video = () => root.querySelector('video');
  const stopTracks = () => {
    const surface = video();
    surface?.srcObject?.getTracks().forEach(track => track.stop());
    return Boolean(surface);
  };
  const releaseReader = () => {
    if (started && !stopping && reader.isScanning) stopping = Promise.resolve().then(() => reader.stop()).catch(() => {});
  };
  function inspect() {
    if (cancelled) {
      if (stopTracks()) observer.disconnect();
      releaseReader();
      return;
    }
    const surface = video();
    if (!surface) return;
    surface.muted = true;
    surface.playsInline = true;
    surface.setAttribute('playsinline', '');
    surface.setAttribute('webkit-playsinline', '');
    if (started && surface.readyState >= 2 && !surface.paused && surface.videoWidth > 0 && surface.clientWidth > 0 && surface.clientHeight > 0) {
      settled = true; clearTimeout(timer); clearInterval(poll);
      observer.disconnect(); resolveReady();
    }
  }
  const observer = observe(inspect);
  observer.observe(root, { childList: true, subtree: true });
  function stop() {
    if (cancelled) return;
    cancelled = true; clearTimeout(timer); clearInterval(poll);
    if (!settled) { settled = true; rejectReady(new DOMException('Cámara cerrada', 'AbortError')); }
    inspect();
    // Conservamos el observador del nodo separado mientras un permiso siga pendiente.
    // Si aparece un stream más tarde, inspect() lo apaga inmediatamente.
    root.remove();
  }
  timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectReady(new Error('La cámara no ha mostrado imagen. Pulsa «Activar cámara» para reintentarlo o escribe el código.'));
      stop();
    }
  }, timeoutMs);
  poll = setInterval(inspect, 100);
  Promise.resolve().then(() => {
    if (cancelled) return;
    return reader.start({ facingMode: 'environment' }, config, raw => { if (!cancelled) onDetected(raw); }, () => {});
  }).then(() => { started = true; inspect(); }).catch(error => {
    started = true;
    if (!settled) { settled = true; rejectReady(error); }
    stop();
    observer.disconnect();
  });
  return { ready, stop, getVideo: video, getTrack: () => video()?.srcObject?.getVideoTracks?.()[0] };
}
