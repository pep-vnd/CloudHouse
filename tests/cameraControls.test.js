import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraCapabilities, applyCameraControl, cameraConfig } from '../src/lib/cameraControls.js';

test('No ofrece controles cuando Safari no expone capacidades', () => {
  assert.deepEqual(cameraCapabilities({}), { torch: false, focus: false, zoom: null });
});
test('Zoom limitado y linterna se aplican solo a cámaras compatibles', async () => {
  const calls = [];
  const track = { getCapabilities: () => ({ torch: true, focusMode: ['continuous'], zoom: { min: 1, max: 10, step: 0.1 } }), applyConstraints: async x => calls.push(x) };
  assert.equal(await applyCameraControl(track, 'zoom', 20), 3);
  assert.equal(await applyCameraControl(track, 'torch', true), true);
  assert.equal(calls[1].advanced[0].torch, true);
  await assert.rejects(applyCameraControl({}, 'torch', true), /no permite/);
});
test('Seleccionar otra lente no fuerza la cámara trasera ni resoluciones exactas', () => {
  const config = cameraConfig('camera-two');
  assert.deepEqual(config.videoConstraints.deviceId, { exact: 'camera-two' });
  assert.equal(config.videoConstraints.facingMode, undefined);
  assert.equal(config.videoConstraints.width.ideal, 1920);
  assert.equal(config.videoConstraints.width.exact, undefined);
});
