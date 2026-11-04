import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { monday } from '../src/lib/domain.js';

const env = loadEnv('production', process.cwd(), '');
assert.ok(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY, 'Configura .env.local primero');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const a = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options);
const b = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options);
const tag = `CloudHouse QA ${crypto.randomUUID()}`;
const created = [];
const events = new Set();
async function data(query) { const r = await query; if (r.error) throw r.error; return r.data; }
const channel = b.channel(tag);
for (const table of ['inventory_items', 'household_tasks', 'weekly_menu']) {
  channel.on('postgres_changes', { event: '*', schema: 'public', table }, event => { if (event.new?.name?.includes(tag) || event.new?.title?.includes(tag) || event.new?.dish_name?.includes(tag)) events.add(table); });
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime no se conectó')), 12000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timer); reject(new Error(status)); }
    });
  });
  const barcode = '0000000000000';
  assert.equal(await data(a.from('inventory_items').select('id').eq('barcode', barcode).maybeSingle()), null, 'No se sobreescribe un producto existente');
  const item = await data(a.rpc('add_inventory', { p_item: { name: tag, barcode, quantity: 1, min_quantity: 2 } }));
  created.push(['inventory_items', item.id]);
  await Promise.all(Array.from({ length: 12 }, (_, i) => data((i % 2 ? a : b).rpc('adjust_inventory', { p_id: item.id, p_delta: 1 }))));
  assert.equal((await data(a.from('inventory_items').select('*').eq('id', item.id).single())).quantity, 13, 'Sin sumas perdidas entre dos clientes');
  await data(b.rpc('add_inventory', { p_item: { name: tag, barcode, quantity: 1 } }));
  assert.equal((await data(a.from('inventory_items').select('*').eq('id', item.id).single())).quantity, 14);
  await data(a.from('inventory_items').update({ quantity: 0 }).eq('id', item.id));
  assert.equal((await data(b.from('inventory_items').select('*').eq('id', item.id).single())).in_shopping_list, true);
  await Promise.all([data(a.rpc('buy_inventory', { p_id: item.id })), data(b.rpc('buy_inventory', { p_id: item.id }))]);
  const bought = await data(a.from('inventory_items').select('*').eq('id', item.id).single());
  assert.equal(bought.quantity, 2); assert.equal(bought.in_shopping_list, false);
  const ingredient = await data(a.rpc('add_ingredient', { p_name: `${tag} ingrediente` }));
  created.push(['inventory_items', ingredient.id]);
  assert.equal((await data(b.rpc('add_ingredient', { p_name: `${tag} ingrediente` }))).id, ingredient.id);
  const task = await data(a.from('household_tasks').insert({ title: tag, assigned_to: 'Hijo', frequency: 'diaria' }).select().single());
  created.push(['household_tasks', task.id]);
  await data(b.from('household_tasks').update({ is_completed: true }).eq('id', task.id));
  assert.equal((await data(a.from('household_tasks').select('*').eq('id', task.id).single())).is_completed, true);
  const menu = await data(a.from('weekly_menu').insert({ week_start: monday(new Date('2099-01-05T12:00:00')), day_of_week: 'Domingo', meal_type: 'cena', dish_name: tag }).select().single());
  created.push(['weekly_menu', menu.id]);
  const limit = Date.now() + 10000;
  while (events.size < 3 && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(events.size, 3, 'Realtime recibe cambios de las tres tablas');
  console.log('OK: RLS anon, CRUD, 12 incrementos concurrentes, barcode único, stock cero, compra idempotente, ingredientes y Realtime de las 3 tablas.');
} finally {
  for (const [table, id] of created.reverse()) await data(a.from(table).delete().eq('id', id));
  await b.removeChannel(channel);
}
