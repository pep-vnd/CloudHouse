import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeDecoder } from '../src/lib/barcodeDecoder.js';

// EAN-13 público de prueba: 4006381333931, codificado según sus barras y paridad.
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = L.map(pattern => [...pattern].map(bit => bit === '1' ? '0' : '1').join(''));
function fixture(code, parity, moduleWidth = 3) {
  const bits = '101' + [...code.slice(1,7)].map((n,i) => (parity[i] === 'L' ? L : G)[Number(n)]).join('') + '01010' + [...code.slice(7)].map(n => R[Number(n)]).join('') + '101';
  const width = 1280, height = 160;
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  const start = Math.floor((width - bits.length * moduleWidth) / 2);
  for (let y = 15; y < height - 15; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') pixels.fill(0, y * width + start + i * moduleWidth, y * width + start + (i + 1) * moduleWidth);
  return { pixels, width, height };
}
test('Lee un EAN pequeño en el fotograma original que se pierde al reducirlo al móvil', () => {
  const decode = createBarcodeDecoder();
  const f = fixture('4006381333931', 'LGLLGG');
  assert.equal(decode(f.pixels, f.width, f.height), '4006381333931');
  const width = 300, height = 38, reduced = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) reduced[y * width + x] = f.pixels[Math.floor(y * f.height / height) * f.width + Math.floor(x * f.width / width)];
  assert.throws(() => decode(reduced, width, height));
});
test('No acepta barras con dígito de control incorrecto', () => {
  const f = fixture('4006381333932', 'LGLLGG');
  assert.throws(() => createBarcodeDecoder()(f.pixels, f.width, f.height));
});
test('También reconoce EAN-8', () => {
  const code = '96385074';
  const bits = '101' + [...code.slice(0, 4)].map(n => L[Number(n)]).join('') + '01010' + [...code.slice(4)].map(n => R[Number(n)]).join('') + '101';
  const width = 400, height = 80, pixels = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 10; y < height - 10; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') pixels.fill(0, y * width + 80 + i * 3, y * width + 80 + (i + 1) * 3);
  assert.equal(createBarcodeDecoder()(pixels, width, height), code);
});
