import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraSession } from '../src/lib/cameraSession.js';

function fixture({ width = 320, pending = false, fail = false } = {}) {
  let notify;
  let finishStart;
  let stopped = 0;
  let decoded;
  let detections = 0;
  const surface = { readyState: 4, paused: false, videoWidth: 1280, clientWidth: width, clientHeight: 240, setAttribute() {}, srcObject: { getTracks: () => [{ stop() { stopped++; } }] } };
  const root = { surface: pending ? null : surface, removed: false, querySelector() { return this.surface; }, remove() { this.removed = true; } };
  const reader = {
    isScanning: false,
    async start(_constraints, _config, callback) {
      decoded = callback;
      if (pending) await new Promise(resolve => { finishStart = resolve; });
      if (fail) throw new Error('Permiso denegado');
      this.isScanning = true;
    },
    async stop() { this.isScanning = false; },
  };
  const session = createCameraSession({ reader, root, config: {}, timeoutMs: 30, onDetected: () => { detections++; }, observe: callback => {
    notify = callback;
    return { observe() {}, disconnect() {} };
  } });
  return { session, root, reader, surface, stopped: () => stopped, detections: () => detections, decode: () => decoded('123'), attach: () => { root.surface = surface; notify(); }, finish: () => finishStart() };
}

test('La cámara solo se considera lista cuando el vídeo tiene imagen y tamaño visible', async () => {
  const f = fixture();
  await f.session.ready;
  assert.equal(f.surface.playsInline, true);
  assert.equal(f.surface.muted, true);
  f.decode(); assert.equal(f.detections(), 1);
  f.session.stop();
  f.decode(); assert.equal(f.detections(), 1, 'No detecta tras cerrar');
  assert.ok(f.stopped() > 0); assert.equal(f.root.removed, true);
});
test('Un vídeo con ancho cero termina con error y apaga las pistas', async () => {
  const f = fixture({ width: 0 });
  await assert.rejects(f.session.ready, /no ha mostrado imagen/);
  assert.ok(f.stopped() > 0); assert.equal(f.root.removed, true);
});
test('Cerrar durante la petición de permisos apaga también un stream que llega tarde', async () => {
  const f = fixture({ pending: true });
  await Promise.resolve();
  f.session.stop();
  await assert.rejects(f.session.ready, { name: 'AbortError' });
  f.attach(); assert.ok(f.stopped() > 0);
  f.finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reader.isScanning, false);
  f.decode(); assert.equal(f.detections(), 0);
});
test('Un permiso rechazado libera el contenedor y permite otro intento', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(f.session.ready, /Permiso denegado/);
  assert.equal(f.root.removed, true);
  const next = fixture(); await next.session.ready; next.session.stop();
});
