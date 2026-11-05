import test from 'node:test';
import assert from 'node:assert/strict';
import { lockModalScroll } from '../src/lib/modalScroll.js';

test('El paso de escáner a producto restaura scroll aunque el primero cierre antes', () => {
  const body = { style: { overflow: '' } };
  const scanner = lockModalScroll(body);
  const product = lockModalScroll(body);
  scanner(); assert.equal(body.style.overflow, 'hidden');
  product(); assert.equal(body.style.overflow, '');
  product(); assert.equal(body.style.overflow, '');
});
test('Cierre inverso y reapertura conservan el estilo original', () => {
  const body = { style: { overflow: 'auto' } };
  const first = lockModalScroll(body), second = lockModalScroll(body);
  second(); assert.equal(body.style.overflow, 'hidden');
  first(); assert.equal(body.style.overflow, 'auto');
  lockModalScroll(body)(); assert.equal(body.style.overflow, 'auto');
});
