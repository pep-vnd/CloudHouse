import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidBarcode, nextQuantity, monday, shiftDate, isDueToday, normalize } from '../src/lib/domain.js';
import { mapProduct, lookupBarcode } from '../src/services/barcodeService.js';

test('valida EAN-8, EAN-13 y dígitos de control, sin perder ceros', () => {
  for (const code of ['3017620422003', '96385074', '0000000000000']) assert.equal(isValidBarcode(code), true);
  for (const code of ['3017620422004', '96385075', '123', 'not-a-barcode', ' 96385074']) assert.equal(isValidBarcode(code), false);
});
test('agotar stock activa compra y nunca produce cantidades negativas', () => {
  const item = { quantity: 1, min_quantity: 1, in_shopping_list: false };
  assert.equal(nextQuantity(item, -1).in_shopping_list, true);
  assert.equal(nextQuantity({ ...item, quantity: 0 }, -1).quantity, 0);
  assert.equal(nextQuantity({ ...item, quantity: 0, in_shopping_list: true }, 1).in_shopping_list, false);
  assert.equal(nextQuantity({ ...item, quantity: 0, min_quantity: 3, in_shopping_list: true }, 1).in_shopping_list, true);
});
test('menús separados por semanas, incluidos domingo y cambio de año', () => {
  assert.equal(monday(new Date('2026-11-08T12:00:00')), '2026-11-02');
  assert.equal(monday(new Date('2027-01-01T12:00:00')), '2026-12-28');
  assert.equal(shiftDate('2026-12-28', 7), '2027-01-04');
});
test('el progreso incluye tareas vencidas y excluye futuras', () => {
  assert.equal(isDueToday({ due_date: '2026-11-05' }, '2026-11-04'), false);
  assert.equal(isDueToday({ due_date: '2026-11-03' }, '2026-11-04'), true);
  assert.equal(isDueToday({ due_date: null }, '2026-11-04'), true);
  assert.equal(normalize('  LÁCTEOS  '), 'lacteos');
});
test('OFF: nombre español, imagen, etiquetas y categoría reales', () => {
  const product = mapProduct({ product_name_es: 'Pasta de maíz', product_name: 'Corn pasta', image_front_small_url: 'https://images.openfoodfacts.org/test.jpg', categories_tags: ['en:plant-based-foods', 'en:pastas'], labels_tags: ['en:gluten-free'], allergens_tags: [] }, '96385074');
  assert.equal(product.name, 'Pasta de maíz'); assert.equal(product.category, 'pasta');
  assert.equal(product.is_gluten_free, true); assert.match(product.image_url, /test.jpg$/);
});
test('OFF: ausencia de alérgenos no certifica sin gluten; contradicciones y trazas prevalecen', () => {
  assert.equal(mapProduct({ allergens_tags: [] }, '96385074').is_gluten_free, false);
  assert.equal(mapProduct({ labels_tags: ['en:gluten-free'], allergens_tags: ['en:gluten'] }, '96385074').is_gluten_free, false);
  assert.equal(mapProduct({ labels_tags: ['en:gluten-free'], traces_tags: ['en:wheat'] }, '96385074').is_gluten_free, false);
});
test('OFF: fallback de nombre, categoría desconocida y producto no encontrado', async () => {
  assert.equal(mapProduct({ product_name: 'Producto' }, '96385074').name, 'Producto');
  assert.equal(mapProduct({}, '96385074').category, 'otros');
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 0 }) });
    assert.equal(await lookupBarcode('96385074'), null);
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(lookupBarcode('96385074'), /no está disponible/);
    await assert.rejects(lookupBarcode('96385075'), /válido/);
  } finally { globalThis.fetch = fetchOriginal; }
});
