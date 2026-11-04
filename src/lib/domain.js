export const LOCATIONS = { frigorifico: 'Frigorífico', despensa: 'Despensa', congelador: 'Congelador' };
export const CATEGORIES = { pasta: 'Pasta', carne: 'Carne', lacteos: 'Lácteos', verduras: 'Verduras', bebidas: 'Bebidas', otros: 'Otros' };
export const FOOD_EMOJI = { pasta: '🍝', carne: '🥩', lacteos: '🥛', verduras: '🥬', bebidas: '🧃', otros: '🥫' };
export const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function monday(date = new Date()) {
  const d = new Date(date); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dateKey(d);
}
export function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return dateKey(d);
}
export function normalize(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
export function isValidBarcode(code) {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  const digits = [...code].map(Number); const check = digits.pop();
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check;
}
export function nextQuantity(item, delta) {
  const quantity = Math.max(0, item.quantity + delta);
  const in_shopping_list = quantity === 0 || (quantity >= item.min_quantity && delta > 0 ? false : item.in_shopping_list);
  return { ...item, quantity, in_shopping_list, updated_at: new Date().toISOString() };
}
export function isDueToday(task, today = dateKey()) {
  return !task.due_date || task.due_date <= today;
}
