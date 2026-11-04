import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { monday, normalize } from '../src/lib/domain.js';

const env = loadEnv('production', process.cwd(), '');
assert.ok(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY, 'Falta configurar Supabase');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
// Datos familiares locales: este archivo NO se incluye en Git ni en el bundle.
const { tasks: FAMILY_TASKS, menu: FIXED_MENU, products: BASIC_PRODUCTS } = JSON.parse(readFileSync(new URL('../.family-plan.local.json', import.meta.url), 'utf8'));
async function query(request) {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}
// Comprobar primero la migración, sin empezar una carga parcial por falta de columnas.
await query(db.from('household_tasks').select('id,scheduled_days,completed_dates').limit(1));
await query(db.from('weekly_menu').select('id,is_skipped').limit(1));
await query(db.from('menu_templates').select('id').limit(1));
const inventory = await query(db.from('inventory_items').select('id,name'));
const present = new Set(inventory.map(item => normalize(item.name)));
const additions = BASIC_PRODUCTS.filter(item => !present.has(normalize(item.name)));
// Los UUID estables y ON CONFLICT DO NOTHING preservan las modificaciones del hogar.
const insertedTasks = await query(db.from('household_tasks').upsert(FAMILY_TASKS, { onConflict: 'id', ignoreDuplicates: true }).select('id'));
const insertedItems = additions.length ? await query(db.from('inventory_items').upsert(additions, { onConflict: 'id', ignoreDuplicates: true }).select('id')) : [];
const week = monday();
const insertedMeals = await query(db.from('weekly_menu').upsert(FIXED_MENU.map(meal => ({ ...meal, week_start: week })), { onConflict: 'week_start,day_of_week,meal_type', ignoreDuplicates: true }).select('id'));
const insertedTemplates = await query(db.from('menu_templates').upsert(FIXED_MENU.map(({ is_skipped, ...meal }) => meal), { onConflict: 'day_of_week,meal_type', ignoreDuplicates: true }).select('id'));
console.log(JSON.stringify({ week, insertedTasks: insertedTasks.length, insertedProducts: insertedItems.length, insertedMeals: insertedMeals.length, insertedTemplates: insertedTemplates.length }));
