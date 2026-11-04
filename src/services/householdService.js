import { supabase, unwrap, configurationError } from './supabaseClient.js';
import { nextQuantity, dateKey, monday, shiftDate } from '../lib/domain.js';

const TABLES = ['inventory_items', 'household_tasks', 'weekly_menu', 'menu_templates'];
const LOCAL_KEY = 'cloudhouse.local.v1';
const CACHE_KEY = 'cloudhouse.cloud-cache.v1';
const empty = () => Object.fromEntries(TABLES.map(t => [t, []]));
function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && Array.isArray(value.inventory_items) && TABLES.every(t => value[t] === undefined || Array.isArray(value[t])) ? { ...empty(), ...value } : empty();
  } catch { return empty(); }
}
export function cachedHousehold() {
  if (!supabase) return read(LOCAL_KEY);
  // Retira la copia anterior, creada antes de incorporar el acceso privado.
  try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem('cloudhouse.profile'); } catch {}
  return empty();
}
export async function loadHousehold() {
  if (configurationError) throw new Error(configurationError);
  if (!supabase) return read(LOCAL_KEY);
  const result = Object.fromEntries(await Promise.all(TABLES.map(async t => {
    const rows = [];
    for (let start = 0; ; start += 1000) {
      const page = await unwrap(supabase.from(t).select('*').order('id').range(start, start + 999));
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return [t, rows];
  })));
  return result;
}
async function localWrite(action) {
  const write = () => {
    const data = read(LOCAL_KEY);
    const result = action(data);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event('cloudhouse-change'));
    return result;
  };
  return navigator.locks ? navigator.locks.request(LOCAL_KEY, write) : write();
}
function ensureOnline() {
  if (configurationError) throw new Error(configurationError);
  if (supabase && !navigator.onLine) throw new Error('Estás sin conexión. Puedes consultar tus datos; vuelve a conectarte para guardar cambios.');
}
export function subscribeHousehold(onChange, onStatus) {
  const wake = () => onChange();
  window.addEventListener('storage', wake);
  window.addEventListener('cloudhouse-change', wake);
  window.addEventListener('online', wake);
  const visible = () => { if (document.visibilityState === 'visible') wake(); };
  document.addEventListener('visibilitychange', visible);
  let channel;
  if (supabase) {
    channel = supabase.channel(`household-${crypto.randomUUID()}`);
    TABLES.forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table }, wake));
    channel.subscribe(status => { onStatus(status); if (status === 'SUBSCRIBED') wake(); });
  }
  // Recupera cambios si un WebSocket se interrumpe sin emitir un evento de error.
  const timer = supabase ? setInterval(visible, 30000) : null;
  return () => {
    window.removeEventListener('storage', wake);
    window.removeEventListener('cloudhouse-change', wake);
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', visible);
    clearInterval(timer);
    if (channel) supabase.removeChannel(channel);
  };
}
export const household = {
  async findBarcode(barcode) {
    ensureOnline();
    return supabase ? unwrap(supabase.from('inventory_items').select('*').eq('barcode', barcode).maybeSingle())
      : read(LOCAL_KEY).inventory_items.find(i => i.barcode === barcode);
  },
  async addItem(item) {
    ensureOnline();
    if (supabase) return unwrap(supabase.rpc('add_inventory', { p_item: item }));
    return localWrite(data => {
      const existing = item.barcode && data.inventory_items.find(i => i.barcode === item.barcode);
      if (existing) { Object.assign(existing, nextQuantity(existing, item.quantity)); return existing; }
      const row = { ...item, id: crypto.randomUUID(), updated_at: new Date().toISOString(), in_shopping_list: item.quantity === 0 || item.in_shopping_list };
      data.inventory_items.push(row); return row;
    });
  },
  async adjust(id, delta) {
    ensureOnline();
    if (![-1, 1].includes(delta)) throw new Error('Cantidad inválida');
    if (supabase) return unwrap(supabase.rpc('adjust_inventory', { p_id: id, p_delta: delta }));
    return localWrite(data => {
      const row = data.inventory_items.find(i => i.id === id);
      if (!row) throw new Error('El producto ya no existe');
      Object.assign(row, nextQuantity(row, delta)); return row;
    });
  },
  async buy(id) {
    ensureOnline();
    if (supabase) return unwrap(supabase.rpc('buy_inventory', { p_id: id }));
    return localWrite(data => {
      const row = data.inventory_items.find(i => i.id === id);
      if (row?.in_shopping_list) Object.assign(row, { quantity: Math.max(row.quantity + 1, row.min_quantity), in_shopping_list: false });
    });
  },
  async update(table, id, values) {
    ensureOnline();
    if (supabase) return unwrap(supabase.from(table).update(values).eq('id', id));
    return localWrite(data => {
      const row = data[table].find(i => i.id === id);
      if (!row) throw new Error('Este elemento ya no existe');
      Object.assign(row, values);
    });
  },
  async remove(table, id) {
    ensureOnline();
    if (supabase) return unwrap(supabase.from(table).delete().eq('id', id));
    return localWrite(data => { data[table] = data[table].filter(i => i.id !== id); });
  },
  async addTask(task) {
    ensureOnline();
    if (supabase) return unwrap(supabase.from('household_tasks').insert(task));
    return localWrite(data => data.household_tasks.push({ ...task, id: crypto.randomUUID(), is_completed: false }));
  },
  async completeTask(id, date, completed) {
    ensureOnline();
    if (supabase) return unwrap(supabase.rpc('set_task_completion', { p_id: id, p_date: date, p_completed: completed }));
    return localWrite(data => {
      const task = data.household_tasks.find(t => t.id === id);
      if (!task) throw new Error('La tarea ya no existe');
      const dates = new Set(task.completed_dates || []);
      if (completed) dates.add(date); else dates.delete(date);
      task.completed_dates = [...dates]; task.is_completed = completed;
    });
  },
  async resetTasks(frequency, date = dateKey()) {
    ensureOnline();
    if (supabase) return unwrap(supabase.rpc('reset_task_period', { p_frequency: frequency, p_date: date }));
    const first = frequency === 'semanal' ? monday(new Date(`${date}T12:00:00`)) : date;
    const last = frequency === 'semanal' ? shiftDate(first, 6) : date;
    return localWrite(data => data.household_tasks.filter(t => t.frequency === frequency).forEach(t => {
      t.completed_dates = (t.completed_dates || []).filter(d => d < first || d > last);
      t.is_completed = false;
    }));
  },
  async saveMeal(meal) {
    ensureOnline();
    if (supabase) return unwrap(supabase.from('weekly_menu').upsert(meal, { onConflict: 'week_start,day_of_week,meal_type' }));
    return localWrite(data => {
      const old = data.weekly_menu.find(m => m.week_start === meal.week_start && m.day_of_week === meal.day_of_week && m.meal_type === meal.meal_type);
      if (old) Object.assign(old, meal); else data.weekly_menu.push({ ...meal, id: crypto.randomUUID() });
    });
  },
  async addIngredient(name) {
    ensureOnline();
    name = name.trim();
    if (!name || name.length > 200) throw new Error('Escribe un ingrediente de hasta 200 caracteres.');
    if (supabase) return unwrap(supabase.rpc('add_ingredient', { p_name: name }));
    return localWrite(data => {
      const row = data.inventory_items.find(i => i.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (row) row.in_shopping_list = true;
      else data.inventory_items.push({ id: crypto.randomUUID(), barcode: null, name, image_url: '', location: 'despensa', category: 'otros', is_gluten_free: false, quantity: 0, min_quantity: 1, in_shopping_list: true, updated_at: new Date().toISOString() });
    });
  },
};
