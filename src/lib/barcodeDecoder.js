import { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } from '@zxing/library';
import { isValidBarcode } from './domain.js';

export function createBarcodeDecoder() {
  const reader = new MultiFormatReader();
  reader.setHints(new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]],
    [DecodeHintType.TRY_HARDER, true],
  ]));
  return (pixels, width, height) => {
    const result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))));
    const code = result.getText();
    return isValidBarcode(code) ? code : null;
  };
}

// El lector de html5-qrcode analiza a tamaño de pantalla (~300 px).
// Esta segunda pasada conserva hasta 1280 px del fotograma, sin subir imágenes.
export function startDetailedScan(video, onDetected) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const decode = createBarcodeDecoder();
  let stopped = false;
  let timer;
  const tick = () => {
    if (stopped) return;
    if (document.visibilityState === 'visible' && video.readyState >= 2 && !video.paused && video.videoWidth) {
      try {
        const sw = Math.floor(video.videoWidth * 0.9), sh = Math.floor(video.videoHeight * 0.55);
        const scale = Math.min(1, 1280 / sw);
        canvas.width = Math.floor(sw * scale); canvas.height = Math.floor(sh * scale);
        context.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
        for (let i = 0; i < luminance.length; i++) luminance[i] = (rgba[i * 4] + 2 * rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 4;
        const code = decode(luminance, canvas.width, canvas.height);
        if (code && !stopped) onDetected(code);
      } catch { /* No encontrar un código en un fotograma es normal. */ }
    }
    if (!stopped) timer = setTimeout(tick, 400);
  };
  timer = setTimeout(tick, 500);
  return () => { stopped = true; clearTimeout(timer); canvas.width = 0; canvas.height = 0; };
}
