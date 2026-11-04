import { isValidBarcode } from '../lib/domain.js';

export function inferCategory(product) {
  const tags = (product.categories_tags || []).join(' ').toLowerCase();
  const rules = [
    ['pasta', /pasta|noodle|spaghetti|macaroni/],
    ['carne', /meat|poultr|chicken|beef|pork|fish|seafood|carne|pescado/],
    ['lacteos', /dair|milk|cheese|yog[hu]urt|butter|leche|queso|lacteo/],
    ['verduras', /vegetable|fruit|legume|verdura|fruta|legumbre/],
    ['bebidas', /beverage|drink|juice|water|bebida|zumo/],
  ];
  return rules.find(([, regex]) => regex.test(tags))?.[0] || 'otros';
}

export function mapProduct(product, barcode) {
  const labels = product.labels_tags || [];
  const allergens = [...(product.allergens_tags || []), ...(product.traces_tags || [])];
  const explicitlyFree = labels.some(tag => /^(en:gluten-free|es:sin-gluten|fr:sans-gluten)$/.test(tag));
  const glutenWarning = allergens.some(tag => /:(gluten|wheat|barley|rye|trigo|cebada|centeno)$/.test(tag));
  return {
    barcode, name: (product.product_name_es || product.product_name || '').trim(),
    image_url: product.image_front_small_url || '',
    category: inferCategory(product), is_gluten_free: explicitlyFree && !glutenWarning,
    location: 'despensa', quantity: 1, min_quantity: 1, in_shopping_list: false,
  };
}

export async function lookupBarcode(barcode, { signal } = {}) {
  if (!isValidBarcode(barcode)) throw new Error('Introduce un código EAN-8 o EAN-13 válido.');
  const fields = 'product_name_es,product_name,image_front_small_url,categories_tags,labels_tags,allergens_tags,traces_tags';
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Open Food Facts no está disponible. Puedes añadir el producto manualmente.');
  const json = await response.json();
  return json.status === 1 && json.product ? mapProduct(json.product, barcode) : null;
}
