import { authenticateClients } from './authenticate.mjs';
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { monday } from '../src/lib/domain.js';

const env = loadEnv('production', process.cwd(), '');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
await authenticateClients([db]);
const { tasks: FAMILY_TASKS, menu: FIXED_MENU, products: BASIC_PRODUCTS } = JSON.parse(readFileSync(new URL('../.family-plan.local.json', import.meta.url), 'utf8'));
async function query(q) { const { data, error } = await q; if (error) throw new Error(error.message); return data; }
const tasks = await query(db.from('household_tasks').select('*').in('id', FAMILY_TASKS.map(t => t.id)));
assert.equal(tasks.length, FAMILY_TASKS.length);
for (const expected of FAMILY_TASKS) {
  const actual = tasks.find(t => t.id === expected.id);
  for (const field of ['title', 'assigned_to', 'scheduled_days', 'time_of_day', 'notes']) assert.deepEqual(actual[field], expected[field], `${expected.title}: ${field}`);
}
const products = await query(db.from('inventory_items').select('*').in('id', BASIC_PRODUCTS.map(p => p.id)));
assert.equal(products.length, BASIC_PRODUCTS.length);
assert.ok(products.every(p => p.quantity === 0 && p.in_shopping_list));
const meals = await query(db.from('weekly_menu').select('*').eq('week_start', monday()));
for (const dish of FIXED_MENU) assert.ok(meals.some(m => m.day_of_week === dish.day_of_week && m.meal_type === dish.meal_type && m.dish_name === dish.dish_name));
const templates = await query(db.from('menu_templates').select('*'));
for (const dish of FIXED_MENU) assert.ok(templates.some(m => m.day_of_week === dish.day_of_week && m.meal_type === dish.meal_type && m.dish_name === dish.dish_name && m.notes === dish.notes));
const task = await query(db.from('household_tasks').insert({ title: `QA fechas ${crypto.randomUUID()}`, assigned_to: 'Ambos', frequency: 'diaria' }).select().single());
try {
  await Promise.all(['2099-01-05', '2099-01-06'].map(date => query(db.rpc('set_task_completion', { p_id: task.id, p_date: date, p_completed: true }))));
  let row = await query(db.from('household_tasks').select('*').eq('id', task.id).single());
  assert.deepEqual(row.completed_dates.sort(), ['2099-01-05', '2099-01-06']);
  await query(db.rpc('set_task_completion', { p_id: task.id, p_date: '2099-01-05', p_completed: true }));
  row = await query(db.from('household_tasks').select('*').eq('id', task.id).single());
  assert.equal(row.completed_dates.length, 2, 'No se duplica una fecha completada');
  await query(db.rpc('set_task_completion', { p_id: task.id, p_date: '2099-01-05', p_completed: false }));
  row = await query(db.from('household_tasks').select('*').eq('id', task.id).single());
  assert.deepEqual(row.completed_dates, ['2099-01-06']);
  console.log(`OK: ${tasks.length} rutinas, ${products.length} productos, ${meals.length} platos y completado atómico por fecha.`);
} finally { await query(db.from('household_tasks').delete().eq('id', task.id)); }
