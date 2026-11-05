## 6. Comandos de terminal para inicializar el proyecto Vite + Tailwind + dependencias

```bash
npm create vite@latest CloudHouse -- --template react
cd CloudHouse
npm install
npm install @supabase/supabase-js html5-qrcode lucide-react @zxing/library
npm install -D tailwindcss @tailwindcss/vite vite-plugin-pwa gh-pages
```

El proyecto entregado ya está inicializado: usa `npm ci` para reproducir las versiones del lockfile.

## 7. Script SQL completo listo para copiar y pegar en Supabase

### `supabase/schema.sql`

```sql
begin;
-- CloudHouse: ejecutar una vez en SQL Editor de un proyecto Supabase gratuito.
-- Ejecutar íntegro: la migración final restringe el acceso a los miembros.
create extension if not exists pgcrypto;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  barcode text unique check (barcode is null or barcode ~ '^([0-9]{8}|[0-9]{13})$'),
  name text not null check (length(trim(name)) between 1 and 200),
  image_url text not null default '',
  location text not null default 'despensa' check (location in ('frigorifico','despensa','congelador')),
  category text not null default 'otros' check (category in ('pasta','carne','lacteos','verduras','bebidas','otros')),
  is_gluten_free boolean not null default false,
  quantity integer not null default 1 check (quantity between 0 and 100000),
  min_quantity integer not null default 1 check (min_quantity between 1 and 100000),
  in_shopping_list boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.household_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  assigned_to text not null default 'Ambos' check (assigned_to in ('Padre','Hijo','Ambos')),
  frequency text not null default 'diaria' check (frequency in ('diaria','semanal','puntual')),
  is_completed boolean not null default false,
  due_date date
);
create table if not exists public.weekly_menu (
  id uuid primary key default gen_random_uuid(),
  day_of_week text not null check (day_of_week in ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo')),
  meal_type text not null check (meal_type in ('comida','cena')),
  dish_name text not null check (length(trim(dish_name)) between 1 and 200),
  notes text not null default '',
  missing_ingredients text not null default '',
  week_start date not null default date_trunc('week', current_date)::date,
  constraint menu_monday check (extract(isodow from week_start) = 1),
  unique (week_start, day_of_week, meal_type)
);

create or replace function public.inventory_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.quantity = 0 then new.in_shopping_list := true;
  elsif tg_op = 'UPDATE' then
    if new.quantity > old.quantity and new.quantity >= new.min_quantity then
      new.in_shopping_list := false;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists inventory_before_write on public.inventory_items;
create trigger inventory_before_write before insert or update on public.inventory_items
for each row execute function public.inventory_before_write();

-- UPDATE incrementa sobre el valor actual de PostgreSQL, sin perder sumas concurrentes.
create or replace function public.adjust_inventory(p_id uuid, p_delta integer)
returns public.inventory_items language plpgsql security invoker set search_path = public as $$
declare result public.inventory_items;
begin
  if p_delta not in (-1, 1) then raise exception 'Cantidad inválida'; end if;
  update public.inventory_items set quantity = greatest(0, quantity + p_delta)
  where id = p_id returning * into result;
  if not found then raise exception 'El producto ya no existe'; end if;
  return result;
end;
$$;

-- Dos móviles escaneando a la vez crean un solo producto y suman ambas unidades.
create or replace function public.add_inventory(p_item jsonb)
returns public.inventory_items language plpgsql security invoker set search_path = public as $$
declare result public.inventory_items;
begin
  insert into public.inventory_items (barcode, name, image_url, location, category, is_gluten_free, quantity, min_quantity, in_shopping_list)
  values (nullif(p_item->>'barcode',''), trim(p_item->>'name'), coalesce(p_item->>'image_url',''),
    coalesce(p_item->>'location','despensa'), coalesce(p_item->>'category','otros'),
    coalesce((p_item->>'is_gluten_free')::boolean,false), coalesce((p_item->>'quantity')::integer,1),
    coalesce((p_item->>'min_quantity')::integer,1), coalesce((p_item->>'in_shopping_list')::boolean,false))
  on conflict (barcode) do update set quantity = public.inventory_items.quantity + excluded.quantity
  returning * into result;
  return result;
end;
$$;

create or replace function public.buy_inventory(p_id uuid)
returns public.inventory_items language plpgsql security invoker set search_path = public as $$
declare result public.inventory_items;
begin
  update public.inventory_items set quantity = greatest(quantity + 1, min_quantity), in_shopping_list = false
  where id = p_id and in_shopping_list = true returning * into result;
  return result;
end;
$$;

-- Idempotente: repetir el botón del menú no duplica un ingrediente.
create or replace function public.add_ingredient(p_name text)
returns public.inventory_items language plpgsql security invoker set search_path = public as $$
declare result public.inventory_items;
begin
  p_name := trim(p_name);
  if length(p_name) not between 1 and 200 then raise exception 'Ingrediente inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(p_name), 0));
  select * into result from public.inventory_items where lower(trim(name)) = lower(p_name) order by id limit 1 for update;
  if found then
    update public.inventory_items set in_shopping_list = true where id = result.id returning * into result;
  else
    insert into public.inventory_items (name, quantity, in_shopping_list) values (p_name, 0, true) returning * into result;
  end if;
  return result;
end;
$$;

alter table public.inventory_items enable row level security;
alter table public.household_tasks enable row level security;
alter table public.weekly_menu enable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.inventory_items, public.household_tasks, public.weekly_menu to anon, authenticated;
drop policy if exists family_access on public.inventory_items;
create policy family_access on public.inventory_items for all to anon, authenticated using (true) with check (true);
drop policy if exists family_access on public.household_tasks;
create policy family_access on public.household_tasks for all to anon, authenticated using (true) with check (true);
drop policy if exists family_access on public.weekly_menu;
create policy family_access on public.weekly_menu for all to anon, authenticated using (true) with check (true);

revoke all on function public.adjust_inventory(uuid,integer), public.add_inventory(jsonb), public.buy_inventory(uuid), public.add_ingredient(text) from public;
grant execute on function public.adjust_inventory(uuid,integer), public.add_inventory(jsonb), public.buy_inventory(uuid), public.add_ingredient(text) to anon, authenticated;

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['inventory_items','household_tasks','weekly_menu'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Horarios y organización familiar (migración 20261104).
alter table public.household_tasks
  add column if not exists scheduled_days smallint[] not null default '{0,1,2,3,4,5,6}',
  add column if not exists time_of_day text not null default 'flexible',
  add column if not exists scheduled_time time,
  add column if not exists notes text not null default '',
  add column if not exists completed_dates date[] not null default '{}';
alter table public.household_tasks drop constraint if exists task_scheduled_days;
alter table public.household_tasks add constraint task_scheduled_days check (
  cardinality(scheduled_days) > 0 and scheduled_days <@ array[0,1,2,3,4,5,6]::smallint[]
);
alter table public.household_tasks drop constraint if exists task_time_of_day;
alter table public.household_tasks add constraint task_time_of_day check (
  time_of_day in ('manana','mediodia','tarde','noche','flexible')
);
alter table public.weekly_menu add column if not exists is_skipped boolean not null default false;

create or replace function public.set_task_completion(p_id uuid, p_date date, p_completed boolean)
returns public.household_tasks language plpgsql security invoker set search_path = public as $$
declare result public.household_tasks;
begin
  if p_date is null or p_completed is null then raise exception 'Faltan la fecha o el estado'; end if;
  update public.household_tasks set
    completed_dates = case when p_completed then
      array(select distinct unnest(array_append(completed_dates, p_date)))
      else array_remove(completed_dates, p_date) end,
    is_completed = p_completed
  where id = p_id returning * into result;
  if not found then raise exception 'La tarea ya no existe'; end if;
  return result;
end;
$$;

create or replace function public.reset_task_period(p_frequency text, p_date date)
returns void language plpgsql security invoker set search_path = public as $$
declare first_day date; last_day date;
begin
  if p_frequency not in ('diaria','semanal') or p_date is null then raise exception 'Periodo inválido'; end if;
  first_day := case when p_frequency = 'semanal' then date_trunc('week', p_date)::date else p_date end;
  last_day := case when p_frequency = 'semanal' then first_day + 6 else p_date end;
  update public.household_tasks t set completed_dates = array(
    select d from unnest(t.completed_dates) d where d < first_day or d > last_day
  ), is_completed = false where frequency = p_frequency;
end;
$$;
revoke all on function public.set_task_completion(uuid,date,boolean), public.reset_task_period(text,date) from public;
grant execute on function public.set_task_completion(uuid,date,boolean), public.reset_task_period(text,date) to anon, authenticated;

-- Plantillas de menú compartidas, sin datos personales en el código.
create table if not exists public.menu_templates (
  id uuid primary key default gen_random_uuid(),
  day_of_week text not null check (day_of_week in ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo')),
  meal_type text not null check (meal_type in ('comida','cena')),
  dish_name text not null check (length(trim(dish_name)) between 1 and 200),
  notes text not null default '',
  missing_ingredients text not null default '',
  unique(day_of_week, meal_type)
);
alter table public.menu_templates enable row level security;
grant select, insert, update, delete on public.menu_templates to anon, authenticated;
drop policy if exists family_access on public.menu_templates;
create policy family_access on public.menu_templates for all to anon, authenticated using (true) with check (true);
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_templates') then
    alter publication supabase_realtime add table public.menu_templates;
  end if;
end $$;
-- Copia inicial del menú ya registrado, sin incluir sus datos en este script.
insert into public.menu_templates (day_of_week,meal_type,dish_name,notes,missing_ingredients)
select day_of_week,meal_type,dish_name,notes,missing_ingredients from public.weekly_menu
where week_start = (select min(week_start) from public.weekly_menu) and not is_skipped
on conflict (day_of_week,meal_type) do nothing;

-- Acceso exclusivo para miembros provisionados por el administrador.
-- No contiene usuarios, contraseñas ni datos personales.
create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (length(username) between 1 and 40),
  profile text not null check (profile in ('Padre','Hijo'))
);
alter table public.household_members enable row level security;
revoke all on public.household_members from public, anon, authenticated;
grant select on public.household_members to authenticated;
drop policy if exists own_membership on public.household_members;
create policy own_membership on public.household_members for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare t text; p record;
begin
  foreach t in array array['inventory_items','household_tasks','weekly_menu','menu_templates'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Retira todas las políticas anteriores, incluidas las abiertas.
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy family_members_only on public.%I for all to authenticated using (exists (select 1 from public.household_members where user_id = (select auth.uid()))) with check (exists (select 1 from public.household_members where user_id = (select auth.uid())))', t);
  end loop;
end $$;

revoke all on function public.adjust_inventory(uuid,integer), public.add_inventory(jsonb), public.buy_inventory(uuid), public.add_ingredient(text), public.set_task_completion(uuid,date,boolean), public.reset_task_period(text,date) from public, anon, authenticated;
grant execute on function public.adjust_inventory(uuid,integer), public.add_inventory(jsonb), public.buy_inventory(uuid), public.add_ingredient(text), public.set_task_completion(uuid,date,boolean), public.reset_task_period(text,date) to authenticated;
commit;
```

## 8. Código completo del servicio de conexión y Open Food Facts

### `src/services/supabaseClient.js`

```javascript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const isCloudConfigured = Boolean(url && key);
export const configurationError = Boolean(url) !== Boolean(key)
  ? 'Falta la URL o la clave pública de Supabase. Completa ambas variables y vuelve a desplegar.' : null;
export const supabase = isCloudConfigured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

export async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
```

### `src/services/barcodeService.js`

```javascript
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
```

### `src/services/householdService.js`

```javascript
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
```

## 9. Código completo de los componentes principales

### `src/App.jsx`

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ShoppingBasket, CalendarDays, CircleCheck, House, Leaf, ArrowUpRight, WifiOff, X, Download, RefreshCw, Heart, UserRound, Cloud, Info } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import InventoryView from './components/InventoryView.jsx';
import TasksView from './components/TasksView.jsx';
import MenuView from './components/MenuView.jsx';
import ScannerModal from './components/ScannerModal.jsx';
import ProductModal from './components/ProductModal.jsx';
import Modal from './components/Modal.jsx';
import AuthGate from './components/AuthGate.jsx';
import { cachedHousehold, household, loadHousehold, subscribeHousehold } from './services/householdService.js';
import { isCloudConfigured } from './services/supabaseClient.js';
import { lookupBarcode } from './services/barcodeService.js';

const NAV = [{ key: 'inventory', title: 'Inventario', Icon: Archive }, { key: 'shopping', title: 'Compra', Icon: ShoppingBasket }, { key: 'menu', title: 'Menú semanal', mobile: 'Menú', Icon: CalendarDays }, { key: 'tasks', title: 'Tareas del hogar', mobile: 'Tareas', Icon: CircleCheck }];
function savedProfile() { try { const value = localStorage.getItem('cloudhouse.profile'); return ['Padre', 'Hijo'].includes(value) ? value : null; } catch { return null; } }

export default function App() {
  return isCloudConfigured ? <AuthGate>{(account, logout) => <HouseholdApp key={account.user_id} account={account} onLogout={logout} />}</AuthGate> : <HouseholdApp />;
}

function HouseholdApp({ account, onLogout }) {
  const [profile, setProfile] = useState(() => account?.profile || savedProfile());
  const [profileOpen, setProfileOpen] = useState(!account && !profile);
  const [tab, setTab] = useState('inventory');
  const [data, setData] = useState(cachedHousehold);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const version = useRef(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [realtime, setRealtime] = useState('CONNECTING');
  const [scanner, setScanner] = useState(false);
  const [product, setProduct] = useState(null);
  const [settings, setSettings] = useState(false);
  const [install, setInstall] = useState(null);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try { const next = await loadHousehold(); if (request === version.current) { setData(next); setError(''); } }
    catch (e) { if (request === version.current) setError(`No se han actualizado los datos: ${e.message}`); }
    finally { if (request === version.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeHousehold(refresh, setRealtime);
    const connection = () => setOnline(navigator.onLine);
    const prompt = e => { e.preventDefault(); setInstall(e); };
    const installed = () => setInstall(null);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    window.addEventListener('beforeinstallprompt', prompt); window.addEventListener('appinstalled', installed);
    return () => { unsubscribe(); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); window.removeEventListener('beforeinstallprompt', prompt); window.removeEventListener('appinstalled', installed); };
  }, [refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  async function run(action, message) {
    if (mutation.current) return false;
    mutation.current = true; setBusy(true); setError('');
    try { await action(); await refresh(); if (message) setToast(message); return true; }
    catch (e) { setError(e.message || 'No se pudo guardar. Vuelve a intentarlo.'); return false; }
    finally { mutation.current = false; setBusy(false); }
  }
  async function detected(barcode) {
    return run(async () => {
      const existing = await household.findBarcode(barcode);
      if (existing) { await household.adjust(existing.id, 1); setToast(`Una unidad más de ${existing.name}`); return; }
      let item;
      try { item = await lookupBarcode(barcode); }
      catch { setToast('No pudimos consultar Open Food Facts. Completa el producto manualmente.'); }
      if (!item) setToast('Completa los datos del producto antes de guardarlo.');
      setProduct(item || { barcode });
    });
  }
  const changeTab = value => { setTab(value); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const choose = value => { try { localStorage.setItem('cloudhouse.profile', value); } catch { setToast('El navegador no permite recordar el perfil.'); } setProfile(value); setProfileOpen(false); };
  const count = data.inventory_items.filter(i => i.in_shopping_list).length;
  const stateText = !isCloudConfigured ? 'Solo este dispositivo' : !online ? 'Sin conexión · lectura' : realtime === 'SUBSCRIBED' ? 'Hogar sincronizado' : 'Conectando al hogar';
  const nav = mobile => NAV.map(({ key, title, Icon, mobile: short }) => <button key={key} className={tab === key ? 'nav-item active' : 'nav-item'} aria-current={tab === key ? 'page' : undefined} onClick={() => changeTab(key)}><Icon size={mobile ? 23 : 20} /><span>{mobile ? short || title : title}</span>{key === 'shopping' && count > 0 && <b>{count}</b>}</button>);
  return <div className="app-shell">
    <aside className="sidebar"><a href={import.meta.env.BASE_URL} className="brand"><span className="brand-icon"><House size={23} /></span>CloudHouse<span className="brand-dot">.</span></a><div className="home-label"><span className="status-dot" />NUESTRO HOGAR</div><nav aria-label="Navegación principal">{nav(false)}</nav><div className="sidebar-bottom"><div className="team-card"><Leaf size={24} strokeWidth={1.5} /><h3>La casa, en equipo.</h3><p>Pequeños hábitos.<br />Un hogar más feliz.</p><div className="team-avatars"><span>P</span><span>H</span><small>Papá & Hijo</small></div></div><button className="connection-button" onClick={() => setSettings(true)}><span className={`status-dot ${isCloudConfigured && online && realtime === 'SUBSCRIBED' ? '' : 'amber-dot'}`} />{stateText}<ArrowUpRight size={14} /></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><House size={16} /><span>Nuestro hogar</span><span>/</span><strong>{NAV.find(n => n.key === tab).title}</strong></div><a href={import.meta.env.BASE_URL} className="brand mobile-brand"><span className="brand-icon"><House size={21} /></span>CloudHouse.</a><div className="topbar-right"><span className="today-date">{new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</span><button className="profile-button" onClick={() => account ? setSettings(true) : setProfileOpen(true)} aria-label={account ? "Mi cuenta" : "Cambiar perfil"}><span>{profile === 'Padre' ? 'P' : 'H'}</span><span>{profile === 'Padre' ? 'Papá' : 'Hijo'}</span></button></div></header>
      <main><div className="greeting">Hola, {profile === 'Padre' ? 'Papá' : 'Hijo'} <span>☀</span><span className="greeting-note">Qué bien tenerte en casa.</span></div>
        {!isCloudConfigured && <div className="local-banner"><Info size={17} /><span>Modo local: tus datos se guardan en este navegador. La sincronización familiar está pendiente de conectar.</span><button onClick={() => setSettings(true)}>Ver detalles</button></div>}
        {!online && <div className="notice"><WifiOff size={18} />{isCloudConfigured ? 'Sin conexión. Estás viendo los últimos datos guardados.' : 'Sin conexión. Puedes seguir usando el modo local.'}</div>}
        {isCloudConfigured && online && realtime !== 'SUBSCRIBED' && <div className="notice"><RefreshCw size={17} />Reconectando la sincronización. También comprobamos los cambios cada 30 segundos.</div>}
        {needRefresh && <div className="notice">Hay una nueva versión disponible.<button disabled={busy} onClick={() => updateServiceWorker(true)}>Actualizar app</button></div>}
        {loading ? <div className="empty-state"><RefreshCw className="spin" /><p>Preparando tu hogar…</p></div> : <fieldset className="view-fieldset">
          {(tab === 'inventory' || tab === 'shopping') && <InventoryView items={data.inventory_items} shopping={tab === 'shopping'} onTab={changeTab} onAdd={() => setProduct({})} onEdit={setProduct} onScan={() => setScanner(true)} busy={busy} run={run} />}
          {tab === 'tasks' && <TasksView tasks={data.household_tasks} profile={profile || 'Hijo'} busy={busy} run={run} />}
          {tab === 'menu' && <MenuView meals={data.weekly_menu} templates={data.menu_templates} busy={busy} run={run} />}
        </fieldset>}
        <footer className="main-footer"><Heart size={13} />Menos pendientes. Más hogar.<button onClick={() => setSettings(true)}><Cloud size={14} />{stateText}</button></footer>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Navegación móvil">{nav(true)}</nav>
    {toast && <div className="toast" role="status"><CircleCheck size={18} />{toast}</div>}
    {error && createPortal(<div className="error-toast" role="alert"><div><strong>No se ha completado la operación</strong><p>{error}</p></div><button className="icon-button" aria-label="Cerrar error" onClick={() => setError('')}><X size={20} /></button></div>, document.querySelector('dialog[open]') || document.body)}
    {!account && profileOpen && <Modal title="Bienvenido a casa" onClose={() => setProfileOpen(false)}><p className="muted">Elige tu perfil. Lo recordaremos en este dispositivo.</p><div className="profile-options"><button onClick={() => choose('Padre')}><span className="avatar-large dad"><UserRound size={33} /></span><strong>Soy Papá</strong><span>Juntos, todo es más fácil.</span></button><button onClick={() => choose('Hijo')}><span className="avatar-large son"><UserRound size={33} /></span><strong>Soy Hijo</strong><span>Yo también pongo mi parte.</span></button></div><p className="small muted">Puedes cambiar de perfil cuando quieras desde la esquina superior.</p></Modal>}
    {scanner && <ScannerModal onClose={() => setScanner(false)} onDetected={detected} busy={busy} />}
    {product && !scanner && <ProductModal product={product} shopping={tab === 'shopping'} onClose={() => setProduct(null)} busy={busy} run={run} />}
    {settings && <Modal title="Tu hogar, siempre a mano" onClose={() => setSettings(false)}><div className="form-stack"><div className="settings-status"><Cloud size={24} /><div><strong>{stateText}</strong><p>{isCloudConfigured ? 'Los cambios se comparten entre Papá e Hijo a través de Supabase.' : 'Este dispositivo funciona de forma independiente. Para compartir el hogar, conecta Supabase y vuelve a publicar la app.'}</p></div></div><h3>Instalar CloudHouse</h3><p className="muted">En iPhone: abre en Safari, pulsa Compartir y «Añadir a la pantalla de inicio». En Android: abre el menú de Chrome y pulsa «Instalar aplicación».</p>{install && <button className="button primary" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}><Download size={18} />Instalar aplicación</button>}<p className="small muted">{account ? `Sesión de ${account.username} · ${account.profile}. Solo las cuentas autorizadas pueden acceder al hogar.` : "El modo local guarda los datos solo en este navegador."}</p>{account ? <button className="button secondary" onClick={onLogout}>Cerrar sesión</button> : <button className="button secondary" onClick={() => { setSettings(false); setProfileOpen(true); }}>Cambiar perfil</button>}<a className="small" href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Productos: Open Food Facts · ODbL · Fotos CC BY-SA</a></div></Modal>}
  </div>;
}
```

### `src/components/ScannerModal.jsx`

```jsx
import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode, Flashlight, Minus, Plus } from 'lucide-react';
import Modal from './Modal.jsx';
import { isValidBarcode } from '../lib/domain.js';
import { createCameraSession } from '../lib/cameraSession.js';
import { cameraConfig, cameraCapabilities, applyCameraControl } from '../lib/cameraControls.js';

export default function ScannerModal({ onClose, onDetected, busy }) {
  const host = useRef(null);
  const scanner = useRef(null);
  const detailedScan = useRef(null);
  const startLock = useRef(false);
  const attempt = useRef(0);
  const alive = useRef(true);
  const locked = useRef(false);
  const handler = useRef(onDetected);
  handler.current = onDetected;
  const [camera, setCamera] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [capabilities, setCapabilities] = useState({ torch: false, focus: false, zoom: null });
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [adjusting, setAdjusting] = useState(false);
  const adjustment = useRef(false);
  function stop() {
    attempt.current++;
    detailedScan.current?.();
    detailedScan.current = null;
    scanner.current?.stop();
    scanner.current = null;
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop(); }; }, []);
  async function detect(raw) {
    if (!alive.current || locked.current) return;
    const barcode = raw.trim();
    if (!isValidBarcode(barcode)) { setError('El código debe ser un EAN-8 o EAN-13 válido.'); return; }
    locked.current = true;
    setError('');
    await stop();
    if (!alive.current) return;
    setCamera(false);
    try {
      const ok = await handler.current(barcode);
      if (ok && alive.current) onClose();
    } finally { locked.current = false; }
  }
  async function start(deviceId = selectedCamera) {
    if (startLock.current || busy || locked.current) return;
    stop();
    startLock.current = true;
    const currentAttempt = ++attempt.current;
    setError(''); setCamera(false); setTorch(false); setStartingCamera(true);
    let root;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('La cámara necesita HTTPS. Puedes escribir el código abajo.');
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!alive.current || currentAttempt !== attempt.current) return;
      root = document.createElement('div');
      root.id = `scanner-${crypto.randomUUID()}`;
      root.className = 'camera-reader';
      host.current.append(root);
      const reader = new Html5Qrcode(root.id, { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8], verbose: false });
      const session = createCameraSession({ reader, root, config: cameraConfig(deviceId), onDetected: raw => { void detect(raw); } });
      scanner.current = session;
      await session.ready;
      if (!alive.current || currentAttempt !== attempt.current) return;
      setCamera(true);
      const track = session.getTrack();
      const caps = cameraCapabilities(track);
      setCapabilities(caps);
      const settings = track?.getSettings?.() || {};
      setSelectedCamera(settings.deviceId || deviceId);
      setZoom(settings.zoom || caps.zoom?.min || 1);
      if (caps.focus) void applyCameraControl(track, 'focusMode', 'continuous').catch(() => {});
      void navigator.mediaDevices.enumerateDevices().then(list => {
        if (alive.current && currentAttempt === attempt.current) setDevices(list.filter(d => d.kind === 'videoinput'));
      }).catch(() => {});
      void import('../lib/barcodeDecoder.js').then(({ startDetailedScan }) => {
        if (alive.current && currentAttempt === attempt.current) detailedScan.current = startDetailedScan(session.getVideo(), raw => { void detect(raw); });
      }).catch(() => { /* La lectura normal sigue disponible si falla la descarga. */ });
    } catch (err) {
      stop(); root?.remove();
      if (alive.current && err?.name !== 'AbortError') setError(err?.message || 'No se ha podido abrir la cámara. Revisa el permiso o escribe el código.');
    } finally { startLock.current = false; if (alive.current) setStartingCamera(false); }
  }
  async function adjust(name, value) {
    if (adjustment.current || !camera) return;
    adjustment.current = true; setAdjusting(true); setError('');
    const session = scanner.current;
    try {
      const result = await applyCameraControl(session?.getTrack(), name, value);
      if (alive.current && scanner.current === session) {
        if (name === 'torch') setTorch(result); else setZoom(result);
      }
    } catch {
      if (alive.current && scanner.current === session) setError('Safari no ha podido aplicar ese ajuste. Puedes cambiar de cámara o mejorar la luz.');
    } finally { adjustment.current = false; if (alive.current) setAdjusting(false); }
  }
  return <Modal title="Escanear un producto" onClose={onClose} busy={busy}>
    <p className="muted">Coloca todo el código horizontal dentro del marco, con un poco de blanco a cada lado. Si ya está en casa, sumaremos una unidad.</p>
    <div className="camera-box"><div ref={host} className="camera-host" />{!camera && !startingCamera && <ScanBarcode size={70} strokeWidth={1} />}</div>
    {!camera && <button className="button primary full" onClick={() => start()} disabled={startingCamera || busy}><Camera size={19} />{startingCamera ? 'Abriendo cámara…' : 'Activar cámara'}</button>}
    {camera && <div className="scanner-controls">
      <p className="scanner-tip">Empieza a unos 20–30 cm. Si se ve borroso, aleja un poco el móvil; usa zoom para ampliar sin acercarte tanto.</p>
      <div className="scanner-control-row">
        {capabilities.torch && <button className={`button ${torch ? 'primary' : 'secondary'}`} aria-pressed={torch} disabled={adjusting || busy} onClick={() => adjust('torch', !torch)}><Flashlight size={18} />{torch ? 'Apagar linterna' : 'Encender linterna'}</button>}
        {capabilities.zoom && <div className="scanner-zoom" role="group" aria-label="Zoom de la cámara"><button className="icon-button" aria-label="Reducir zoom" disabled={adjusting || busy || zoom <= capabilities.zoom.min} onClick={() => adjust('zoom', zoom - Math.max(0.5, capabilities.zoom.step))}><Minus size={18} /></button><output aria-live="polite">{zoom.toFixed(1)}×</output><button className="icon-button" aria-label="Aumentar zoom" disabled={adjusting || busy || zoom >= capabilities.zoom.max} onClick={() => adjust('zoom', zoom + Math.max(0.5, capabilities.zoom.step))}><Plus size={18} /></button></div>}
      </div>
      <p className="small muted">{capabilities.torch ? 'La linterna ayuda con poca luz. Apágala si crea reflejos en el envase.' : 'Safari no ofrece linterna en esta cámara. Prueba con más luz, evitando reflejos.'}</p>
    </div>}
    {devices.length > 1 && <label className="scanner-camera-choice">Cámara<select value={selectedCamera} disabled={startingCamera || busy || adjusting} onChange={e => { const id = e.target.value; setSelectedCamera(id); if (camera) void start(id); }}><option value="">Trasera automática</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}</select><span className="small muted">Si no enfoca de cerca, prueba otra cámara trasera.</span></label>}
    {(camera || startingCamera) && <button className="button secondary full" disabled={busy} onClick={() => { stop(); setCamera(false); }}>Apagar cámara</button>}
    <form className="form-stack scanner-form" onSubmit={e => { e.preventDefault(); void detect(code); }}>
      <label>También puedes escribir el código<input inputMode="numeric" autoComplete="off" maxLength={13} placeholder="EAN-8 o EAN-13" value={code} onChange={e => setCode(e.target.value)} required /></label>
      <button className="button secondary full" disabled={busy || startingCamera || !code}>{busy ? 'Buscando producto…' : 'Buscar producto'}</button>
    </form>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <p className="small muted attribution">Datos de <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> · ODbL · Imágenes CC BY-SA</p>
  </Modal>;
}
```

### `src/components/InventoryView.jsx`

```jsx
import { useState } from 'react';
import { Search, WheatOff, Plus, Minus, ShoppingBasket, Package, SlidersHorizontal, ArrowUpRight, Check, Refrigerator, Snowflake, Archive, ScanBarcode } from 'lucide-react';
import { CATEGORIES, FOOD_EMOJI, LOCATIONS, normalize } from '../lib/domain.js';
import { household } from '../services/householdService.js';

const LocationIcon = { frigorifico: Refrigerator, despensa: Archive, congelador: Snowflake };
export default function InventoryView({ items, shopping, onTab, onAdd, onEdit, onScan, busy, run }) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [glutenFree, setGlutenFree] = useState(false);
  const [sort, setSort] = useState('name');
  const stock = items.filter(i => i.quantity > 0);
  const list = items.filter(i => i.in_shopping_list);
  const source = shopping ? list : stock;
  const filtered = source.filter(i => normalize(i.name).includes(normalize(search)) && (!location || i.location === location) && (!category || i.category === category) && (!glutenFree || i.is_gluten_free))
    .sort((a, b) => sort === 'quantity' ? a.quantity - b.quantity || a.name.localeCompare(b.name, 'es') : a.name.localeCompare(b.name, 'es'));
  const low = stock.filter(i => i.quantity <= i.min_quantity);
  return <>
    <div className="page-heading"><div><div className="eyebrow">UN HOGAR BIEN ORGANIZADO</div><h1>{shopping ? 'La lista de la compra' : 'Todo en su sitio.'}</h1><p>{shopping ? 'Lo que falta en casa, siempre a mano.' : 'Saber lo que tienes es el primer paso para aprovecharlo.'}</p></div><button className="button primary desktop-add" onClick={onAdd}><Plus size={19} />{shopping ? 'Añadir a la lista' : 'Añadir producto'}</button></div>
    {!shopping && <div className="inventory-intro"><div><span className="eyebrow">MENOS DESPERDICIO, MÁS TRANQUILIDAD</span><h2>Tu cocina, al día.</h2><p>Un vistazo a lo que hay en casa.<br />Una cosa menos en la que pensar.</p><button className="text-button" onClick={onScan}>Escanear y guardar <ArrowUpRight size={18} /></button></div><div className="pantry-illustration" aria-hidden="true"><div className="jar tall"><span>PASTA</span><i /><i /><i /></div><div className="bottle"><span>OLIVA</span></div><div className="jar small-jar"><span>CASA</span></div><span className="leaf leaf-one">✦</span><span className="leaf leaf-two">✦</span><div className="shelf" /></div></div>}
    <div className="stats-grid"><div><span className="stat-icon sage"><Package size={20} /></span><div><strong>{stock.length}</strong><span>productos en casa</span></div></div><div><span className="stat-icon amber"><ShoppingBasket size={20} /></span><div><strong>{list.length}</strong><span>en la lista de compra</span></div></div><div><span className="stat-icon lilac"><WheatOff size={20} /></span><div><strong>{stock.filter(i => i.is_gluten_free).length}</strong><span>productos sin gluten</span></div></div></div>
    <section className="inventory-section" aria-label={shopping ? 'Lista de la compra' : 'Inventario'}>
      <div className="section-tabs"><button className={!shopping ? 'active' : ''} onClick={() => onTab('inventory')}>En stock <span>{stock.length}</span></button><button className={shopping ? 'active' : ''} onClick={() => onTab('shopping')}>Lista de la compra <span>{list.length}</span></button></div>
      <div className="search-row"><label className="search-box"><Search size={19} /><input aria-label="Buscar productos" placeholder="Buscar un producto…" value={search} onChange={e => setSearch(e.target.value)} /></label><button className={`gluten-toggle ${glutenFree ? 'active' : ''}`} aria-pressed={glutenFree} onClick={() => setGlutenFree(!glutenFree)}><WheatOff size={18} /><span>Sin gluten</span><span className="toggle-track" /></button></div>
      <div className="filter-row"><div className="pills"><button className={!location ? 'pill active' : 'pill'} aria-pressed={!location} onClick={() => setLocation('')}>Todos</button>{Object.entries(LOCATIONS).map(([key, title]) => { const Icon = LocationIcon[key]; return <button key={key} className={`pill ${location === key ? 'active' : ''}`} aria-pressed={location === key} onClick={() => setLocation(location === key ? '' : key)}><Icon size={16} />{title}</button>; })}</div><label className="category-select"><SlidersHorizontal size={16} /><select aria-label="Filtrar por categoría" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <div className="result-row"><span>{filtered.length} {filtered.length === 1 ? 'producto' : 'productos'}{location ? ` en ${LOCATIONS[location].toLowerCase()}` : ''}</span><label>Ordenar: <select aria-label="Ordenar productos" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Nombre A–Z</option><option value="quantity">Menor cantidad</option></select></label></div>
      {filtered.length ? <div className="product-grid">{filtered.map(item => <article className={`product-card category-${item.category}`} key={item.id}>
        <button className="product-cover" onClick={() => onEdit(item)} aria-label={`Editar ${item.name}`}><span className="food-emoji" aria-hidden="true">{FOOD_EMOJI[item.category]}</span>{item.image_url && <img src={item.image_url} alt={item.name} loading="lazy" onError={e => { e.currentTarget.hidden = true; }} />}{item.is_gluten_free && <span className="gf-badge"><WheatOff size={13} />Sin gluten</span>}</button>
        <div className="product-body"><span className="product-category">{CATEGORIES[item.category]}</span><button className="product-title" onClick={() => onEdit(item)}>{item.name}</button><div className="product-location">{(() => { const Icon = LocationIcon[item.location] || Archive; return <Icon size={14} />; })()}{LOCATIONS[item.location]}</div>
        <div className="product-bottom">{shopping ? <><span className="stock-label">{item.quantity ? `${item.quantity} en casa` : 'Agotado'}</span><button className="buy-button" disabled={busy} aria-label={`He comprado ${item.name}`} onClick={() => run(() => household.buy(item.id), 'Guardado en el inventario')}><Check size={17} />Comprado</button></> : <><span className={`stock-label ${item.quantity <= item.min_quantity ? 'low' : ''}`}><span />{item.quantity <= item.min_quantity ? 'Queda poco' : 'En stock'}</span><div className="quantity-stepper"><button disabled={busy} aria-label={`Restar una unidad de ${item.name}`} onClick={() => run(() => household.adjust(item.id, -1))}><Minus size={16} /></button><output aria-label={`Cantidad de ${item.name}`}>{item.quantity}</output><button disabled={busy} aria-label={`Sumar una unidad de ${item.name}`} onClick={() => run(() => household.adjust(item.id, 1))}><Plus size={16} /></button></div></>}</div>
        {!shopping && item.quantity <= item.min_quantity && !item.in_shopping_list && <button className="restock-button" disabled={busy} onClick={() => run(() => household.update('inventory_items', item.id, { in_shopping_list: true }), 'Añadido a la compra')}><ShoppingBasket size={14} />Añadir a la compra</button>}
        </div></article>)}</div> : <div className="empty-state"><span className="empty-icon">{shopping ? <ShoppingBasket size={32} /> : <Package size={32} />}</span><h3>{source.length ? 'No hay productos con estos filtros' : shopping ? 'Todo listo por aquí' : 'Tu cocina empieza aquí'}</h3><p>{source.length ? 'Prueba con otra categoría o elimina algún filtro.' : shopping ? 'Añade lo que necesitas. Los productos agotados aparecerán automáticamente.' : 'Escanea un código de barras o añade tu primer producto.'}</p><button className="button secondary" onClick={source.length ? () => { setSearch(''); setLocation(''); setCategory(''); setGlutenFree(false); } : onAdd}>{source.length ? 'Limpiar filtros' : 'Añadir producto'}<Plus size={17} /></button></div>}
    </section>
    {!shopping && low.length > 0 && <p className="inventory-note"><span className="status-dot amber-dot" />{low.length} {low.length === 1 ? 'producto está' : 'productos están'} llegando al mínimo. Buen momento para revisar la compra.</p>}
    <button className="scan-fab" onClick={onScan}><ScanBarcode size={23} /><span>Escanear producto</span></button>
    <button className="mobile-add button secondary" onClick={onAdd}><Plus size={18} />Añadir manualmente</button>
  </>;
}
```

### `src/components/TasksView.jsx`

```jsx
import { useEffect, useState } from 'react';
import { Check, Plus, RotateCcw, Sparkles, Trash2, Clock } from 'lucide-react';
import Modal from './Modal.jsx';
import { household } from '../services/householdService.js';
import { DAYS, dateKey, monday, shiftDate } from '../lib/domain.js';
import { dayIndex, PERIODS, taskOccursOn, taskCompletedOn, periodHasCompletions, scheduleLabel } from '../lib/familySchedule.js';

export default function TasksView({ tasks, profile, busy, run }) {
  const [filter, setFilter] = useState('Todas');
  const [form, setForm] = useState(null);
  const [reset, setReset] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [today, setToday] = useState(dateKey);
  const [chosenDay, setChosenDay] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => setToday(dateKey()), 30000);
    return () => clearInterval(timer);
  }, []);
  const week = monday(new Date(`${today}T12:00:00`));
  const selectedDate = chosenDay === null ? today : shiftDate(week, chosenDay);
  const selectedIndex = dayIndex(selectedDate);
  const selected = tasks.filter(t => (filter === 'Todas' || t.assigned_to === filter || t.assigned_to === 'Ambos') && taskOccursOn(t, selectedDate));
  const completed = selected.filter(t => taskCompletedOn(t, selectedDate)).length;
  const progress = selected.length ? Math.round(completed / selected.length * 100) : 0;
  const isToday = selectedDate === today;
  async function save(e) {
    e.preventDefault();
    const value = { ...form, title: form.title.trim(), due_date: form.due_date || null, scheduled_time: form.scheduled_time || null };
    if (!value.title || !value.scheduled_days.length) return;
    if (await run(() => household.addTask(value), 'Nueva tarea añadida')) setForm(null);
  }
  function addTask() {
    setForm({ title: '', assigned_to: profile, frequency: 'diaria', due_date: '', scheduled_days: [0, 1, 2, 3, 4, 5, 6], time_of_day: 'flexible', scheduled_time: '', notes: '', completed_dates: [] });
  }
  return <>
    <div className="page-heading">
      <div><div className="eyebrow">CUIDAR LA CASA ES COSA DE DOS</div><h1>Nuestra semana,<br />en equipo.</h1><p>Cada día tiene su ritmo. Cada uno, su parte.</p></div>
      <button className="button primary" onClick={addTask}><Plus size={19} />Nueva tarea</button>
    </div>
    <div className="family-context"><strong>Vuestra rutina, día a día.</strong><p>Elige un día para ver sus horarios, responsables y notas. Cada tarea vuelve a estar pendiente en su siguiente fecha.</p></div>
    <div className="schedule-days" aria-label="Día de las tareas">
      {DAYS.map((day, i) => <button key={day} className={selectedIndex === i ? 'active' : ''} aria-pressed={selectedIndex === i} aria-label={`Ver tareas del ${day}`} onClick={() => setChosenDay(i === dayIndex(today) ? null : i)}><span>{day.slice(0, 3)}</span><strong>{Number(shiftDate(week, i).slice(-2))}</strong>{i === dayIndex(today) && <small>HOY</small>}</button>)}
    </div>
    <div className="progress-card">
      <div className="progress-copy"><span className="eyebrow">{isToday ? 'ASÍ VA EL DÍA' : `ASÍ VA EL ${DAYS[selectedIndex].toUpperCase()}`}</span><h2>{selected.length && completed === selected.length ? '¡Buen trabajo, equipo!' : 'Cada tarea cuenta.'}</h2><p>{completed} de {selected.length} tareas {isToday ? 'de hoy' : `del ${DAYS[selectedIndex].toLowerCase()}`} completadas</p></div>
      <div className="progress-number">{progress}<span>%</span></div>
      <div className="progress-track" role="progressbar" aria-label="Tareas del día seleccionado completadas" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div>
    </div>
    <div className="tasks-toolbar"><div className="pills">{[['Todas', 'Todas'], ['Hijo', 'Mis tareas (Hijo)'], ['Padre', 'Tareas de Papá']].map(([key, text]) => <button key={key} className={`pill ${filter === key ? 'active' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{text}</button>)}</div><span className="muted small">Las tareas de «Ambos» aparecen en los dos perfiles. El completado se guarda por fecha.</span></div>
    {Object.entries(PERIODS).map(([period, label]) => {
      const group = selected.filter(t => (t.time_of_day || 'flexible') === period).sort((a, b) => (a.scheduled_time || '99').localeCompare(b.scheduled_time || '99') || a.id.localeCompare(b.id));
      return group.length > 0 && <section className="routine-group" key={period} aria-label={label}><h2>{label}<span>{group.length}</span></h2><div className="task-list">{group.map(task => {
        const done = taskCompletedOn(task, selectedDate);
        return <article key={task.id} className={`task-card ${done ? 'completed' : ''}`}>
          <button className="task-checkbox" role="checkbox" aria-checked={done} aria-label={`Completar ${task.title}`} disabled={busy} onClick={() => run(() => household.completeTask(task.id, selectedDate, !done))}>{done && <Check size={24} />}</button>
          <div className="task-info"><h3>{task.title}</h3><div><span className={`assignee ${task.assigned_to === 'Hijo' ? 'son' : ''}`}>{task.assigned_to === 'Padre' ? 'Papá' : task.assigned_to}</span>{task.scheduled_time && <span><Clock size={13} />{task.scheduled_time.slice(0, 5)}</span>}<span>{task.frequency === 'puntual' ? 'Una vez' : scheduleLabel(task)}</span></div>{task.notes && <p className="task-notes">{task.notes}</p>}</div>
          <button className="icon-button muted" disabled={busy} aria-label={`Eliminar ${task.title}`} onClick={() => setDeleting(task)}><Trash2 size={17} /></button>
        </article>;
      })}</div></section>;
    })}
    {!selected.length && <div className="empty-state"><Sparkles size={36} /><h3>Sin tareas para este día</h3><p>Prueba otro día o perfil, o añade una nueva tarea.</p></div>}
    <div className="reset-panel"><div><h3>Empezamos de nuevo</h3><p>Las rutinas empiezan pendientes en cada nueva fecha. También puedes desmarcarlas manualmente.</p></div><div className="reset-buttons">
      <button className="button secondary" disabled={busy || !periodHasCompletions(tasks, 'diaria', selectedDate)} onClick={() => setReset('diaria')}><RotateCcw size={16} />Reiniciar día</button>
      <button className="button secondary" disabled={busy || !periodHasCompletions(tasks, 'semanal', selectedDate)} onClick={() => setReset('semanal')}><RotateCcw size={16} />Reiniciar semana</button>
    </div></div>
    {form && <Modal title="Una nueva tarea" onClose={() => setForm(null)} busy={busy}><form className="form-stack" onSubmit={save}>
      <label>¿Qué hay que hacer?<input autoFocus value={form.title} required maxLength={200} placeholder="Por ejemplo, vaciar el lavavajillas" onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <div className="form-row"><label>¿Quién se encarga?<select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}><option value="Padre">Papá</option><option>Hijo</option><option>Ambos</option></select></label><label>Frecuencia<select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value, scheduled_days: e.target.value === 'semanal' ? [selectedIndex] : [0, 1, 2, 3, 4, 5, 6] })}><option value="diaria">Rutina diaria</option><option value="semanal">Cada semana</option><option value="puntual">Una vez</option></select></label></div>
      {form.frequency !== 'puntual' && <div><span className="field-label">Días de la semana</span><div className="pills schedule-form-days">{DAYS.map((day, i) => <button key={day} type="button" aria-label={day} aria-pressed={form.scheduled_days.includes(i)} className={`pill ${form.scheduled_days.includes(i) ? 'active' : ''}`} onClick={() => setForm({ ...form, scheduled_days: form.scheduled_days.includes(i) ? form.scheduled_days.filter(d => d !== i) : [...form.scheduled_days, i].sort() })}>{day.slice(0, 3)}</button>)}</div>{!form.scheduled_days.length && <p className="inline-error">Selecciona al menos un día.</p>}</div>}
      <div className="form-row"><label>Momento del día<select value={form.time_of_day} onChange={e => setForm({ ...form, time_of_day: e.target.value })}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Hora (opcional)<input type="time" value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })} /></label></div>
      <label>{form.frequency === 'puntual' ? 'Fecha prevista' : 'Empezar a partir de (opcional)'}<input type="date" required={form.frequency === 'puntual'} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label>
      <label>Notas (opcional)<textarea rows={2} maxLength={2000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      <button className="button primary full" disabled={busy || !form.scheduled_days.length}>Guardar tarea</button>
    </form></Modal>}
    {reset && <Modal title={reset === 'diaria' ? '¿Reiniciar este día?' : '¿Reiniciar esta semana?'} onClose={() => setReset(null)} busy={busy}><p>Se desmarcarán las tareas {reset === 'diaria' ? `diarias del ${selectedDate}` : `semanales del ${week} al ${shiftDate(week, 6)}`} de ambos perfiles. Los demás días y semanas conservarán su historial.</p><button className="button primary full" disabled={busy} onClick={async () => { if (await run(() => household.resetTasks(reset, selectedDate), 'Tareas reiniciadas')) setReset(null); }}>Reiniciar tareas</button></Modal>}
    {deleting && <Modal title="¿Eliminar esta tarea?" onClose={() => setDeleting(null)} busy={busy}><p>{deleting.title}. Se retirará de todos los días de la rutina.</p><button className="button danger full" disabled={busy} onClick={async () => { if (await run(() => household.remove('household_tasks', deleting.id), 'Tarea eliminada')) setDeleting(null); }}>Confirmar eliminación</button></Modal>}
  </>;
}
```

### `src/components/MenuView.jsx`

```jsx
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Sun, Moon, Plus, ShoppingBasket, Check, Utensils, Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { DAYS, monday, shiftDate, dateKey } from '../lib/domain.js';
import { household } from '../services/householdService.js';
import { menuForWeek } from '../lib/familySchedule.js';

export default function MenuView({ meals, templates = [], busy, run }) {
  const [week, setWeek] = useState(monday());
  const [meal, setMeal] = useState(null);
  const [added, setAdded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const current = menuForWeek(meals, week, templates);
  const formatted = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  function edit(day, type) {
    setMeal(current.find(m => m.day_of_week === day && m.meal_type === type) || { week_start: week, day_of_week: day, meal_type: type, dish_name: '', notes: '', missing_ingredients: '' });
    setAdded(false); setDeleting(false);
  }
  async function save(e) {
    e.preventDefault();
    const { id, ...value } = meal;
    value.dish_name = value.dish_name.trim(); value.is_skipped = false;
    if (!value.dish_name) return;
    if (await run(() => household.saveMeal(value), 'Menú guardado')) setMeal(null);
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow">LA SEMANA SABE MEJOR CON UN PLAN</div><h1>¿Qué comemos hoy?</h1><p>Siete días, muchas ideas y una compra más fácil.</p></div><div className="menu-count"><Utensils size={18} /><strong>{current.length}/14</strong> platos planeados</div></div>
    <div className="family-context"><strong>Vuestro menú habitual</strong><p>La plantilla compartida se repite cada semana. Las notas incluyen quién cocina y qué preparar; las ediciones solo afectan a la semana seleccionada.</p></div>
    <div className="week-toolbar"><button className="icon-button" aria-label="Semana anterior" onClick={() => setWeek(shiftDate(week, -7))}><ChevronLeft size={22} /></button><h2>{formatted(week)} — {formatted(shiftDate(week, 6))} <span>{week.slice(0, 4)}</span></h2><button className="icon-button" aria-label="Semana siguiente" onClick={() => setWeek(shiftDate(week, 7))}><ChevronRight size={22} /></button><button className="pill" onClick={() => setWeek(monday())}>Esta semana</button></div>
    <div className="menu-calendar">{DAYS.map((day, i) => <section key={day} className={`day-card ${shiftDate(week, i) === dateKey() ? 'today' : ''}`}><header><h3>{day}</h3><span>{shiftDate(week, i) === dateKey() ? 'HOY' : formatted(shiftDate(week, i))}</span></header><div className="day-meals">{['comida', 'cena'].map(type => { const item = current.find(m => m.day_of_week === day && m.meal_type === type); const Icon = type === 'comida' ? Sun : Moon; return <button key={type} className={`meal-slot ${item ? 'filled' : ''}`} onClick={() => edit(day, type)} aria-label={`${item ? 'Editar' : 'Añadir'} ${type} del ${day}`}><span className="meal-label"><Icon size={16} />{type === 'comida' ? 'COMIDA' : 'CENA'}</span>{item ? <><strong>{item.dish_name}</strong>{item.notes && <p>{item.notes}</p>}{item.missing_ingredients && <span className="missing-label"><ShoppingBasket size={13} />{item.missing_ingredients}</span>}</> : <span className="meal-placeholder"><Plus size={19} />Añadir plato</span>}</button>; })}</div></section>)}</div>
    <p className="menu-note"><span>✦</span>Ingredientes básicos orientativos: ajustadlos a vuestras recetas y existencias.</p>
    {meal && <Modal title={`${meal.day_of_week} · ${meal.meal_type === 'comida' ? 'Comida' : 'Cena'}`} onClose={() => setMeal(null)} busy={busy}><form className="form-stack" onSubmit={save}>
      <label>¿Qué vamos a preparar?<input autoFocus required maxLength={200} placeholder="Por ejemplo, pasta con verduras" value={meal.dish_name} onChange={e => setMeal({ ...meal, dish_name: e.target.value })} /></label>
      <label>Notas (opcional)<textarea rows={3} maxLength={2000} placeholder="La receta, una idea o algo que recordar…" value={meal.notes} onChange={e => setMeal({ ...meal, notes: e.target.value })} /></label>
      <label>¿Falta algún ingrediente?<input maxLength={1000} placeholder="Tomates, pasta sin gluten, queso" value={meal.missing_ingredients} onChange={e => { setMeal({ ...meal, missing_ingredients: e.target.value }); setAdded(false); }} /></label>
      <p className="muted small">Separa los ingredientes con comas. Se añadirán como productos pendientes de compra.</p>
      <button type="button" className="button secondary full" disabled={busy || !meal.missing_ingredients.trim() || added} onClick={async () => {
        const names = [...new Set(meal.missing_ingredients.split(',').map(s => s.trim()).filter(Boolean))];
        const ok = await run(async () => { for (const name of names) await household.addIngredient(name); }, 'Ingredientes añadidos a la compra');
        if (ok) setAdded(true);
      }}>{added ? <Check size={17} /> : <ShoppingBasket size={17} />}{added ? 'Añadidos a la compra' : 'Añadir ingredientes a la compra'}</button>
      <button className="button primary full" disabled={busy}>Guardar plato</button>
      {meal.dish_name && <button type="button" className="button danger" disabled={busy} onClick={async () => {
        if (!deleting) return setDeleting(true);
        const { id, ...value } = meal;
        if (await run(() => household.saveMeal({ ...value, is_skipped: true }), 'Plato retirado de esta semana')) setMeal(null);
      }}><Trash2 size={16} />{deleting ? 'Confirmar: quitar de esta semana' : 'Quitar plato de esta semana'}</button>}
    </form></Modal>}
  </>;
}
```

### `src/components/ProductModal.jsx`

```jsx
import { useState } from 'react';
import { Trash2, WheatOff } from 'lucide-react';
import Modal from './Modal.jsx';
import { CATEGORIES, LOCATIONS } from '../lib/domain.js';
import { household } from '../services/householdService.js';

export default function ProductModal({ product, shopping, busy, run, onClose }) {
  const [value, setValue] = useState({ name: '', barcode: null, image_url: '', category: 'otros', location: 'despensa', is_gluten_free: false, quantity: shopping ? 0 : 1, min_quantity: 1, in_shopping_list: shopping, ...product });
  const [deleting, setDeleting] = useState(false);
  const change = e => setValue(v => ({ ...v, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault();
    const { id, updated_at, ...item } = value;
    item.name = item.name.trim(); item.quantity = Number(item.quantity); item.min_quantity = Number(item.min_quantity);
    if (!item.name) return;
    if (id) { delete item.quantity; delete item.in_shopping_list; }
    const ok = await run(() => id ? household.update('inventory_items', id, item) : household.addItem(item), id ? 'Producto actualizado' : 'Producto añadido');
    if (ok) onClose();
  };
  return <Modal title={value.id ? 'Editar producto' : 'Un lugar para cada cosa'} onClose={onClose} busy={busy}>
    <form onSubmit={save} className="form-stack">
      {value.barcode && <p className="muted small">Código {value.barcode} · Revisa los datos antes de guardar.</p>}
      <label>Nombre del producto<input autoFocus name="name" value={value.name} onChange={change} required maxLength={200} placeholder="Por ejemplo, leche de avena" /></label>
      <div><span className="field-label">¿Dónde lo guardamos?</span><div className="choice-grid">{Object.entries(LOCATIONS).map(([key, label]) => <button key={key} type="button" className={value.location === key ? 'choice active' : 'choice'} aria-pressed={value.location === key} onClick={() => setValue(v => ({ ...v, location: key }))}>{label}</button>)}</div></div>
      <label>Categoría<select name="category" value={value.category} onChange={change}>{Object.entries(CATEGORIES).map(([k, text]) => <option key={k} value={k}>{text}</option>)}</select></label>
      <div className="form-row">{!value.id && <label>Unidades<input type="number" name="quantity" min="0" max="100000" required value={value.quantity} onChange={change} /></label>}<label>Stock mínimo<input name="min_quantity" type="number" min="1" max="100000" required value={value.min_quantity} onChange={change} /></label></div>
      <label className="check-label"><input name="is_gluten_free" type="checkbox" checked={value.is_gluten_free} onChange={change} /><WheatOff size={19} /> Sin gluten</label>
      <p className="small muted">Comprueba el envase: solo una etiqueta explícita «sin gluten» marca esta opción automáticamente.</p>
      <button className="button primary full" disabled={busy}>{busy ? 'Guardando…' : value.id ? 'Guardar cambios' : shopping ? 'Añadir a la compra' : 'Guardar producto'}</button>
      {value.id && <button type="button" className="button danger" disabled={busy} onClick={async () => {
        if (!deleting) return setDeleting(true);
        if (await run(() => household.remove('inventory_items', value.id), 'Producto eliminado')) onClose();
      }}><Trash2 size={17} />{deleting ? 'Confirmar eliminación' : 'Eliminar producto'}</button>}
    </form>
  </Modal>;
}
```

### `src/components/Modal.jsx`

```jsx
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { lockModalScroll } from '../lib/modalScroll.js';

export default function Modal({ title, children, onClose, busy = false, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element.showModal();
    const unlock = lockModalScroll(document.body);
    return () => {
      element.close();
      unlock();
      if (previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Cerrar ventana" disabled={busy} onClick={onClose}><X size={22} /></button></div>
    {children}
  </dialog>;
}
```

### `src/main.jsx`

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="fatal"><h1>No pudimos abrir la app</h1><p>Tus datos guardados siguen en su sitio.</p><button onClick={() => location.reload()}>Volver a intentar</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
```

### `src/lib/domain.js`

```javascript
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
```

### `src/styles.css`

```css
@import "tailwindcss";

@theme { --color-forest: #32634c; --color-paper: #f7f8f4; }
@layer base {
  :root { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; color: #293b31; background: #f7f8f4; font-synthesis: none; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  button, input, select, textarea { font: inherit; }
  button, a, input, select, textarea { -webkit-tap-highlight-color: transparent; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .48; }
  button, a { touch-action: manipulation; }
  button { transition: background .15s, border-color .15s, transform .15s; }
  :focus-visible { outline: 3px solid #93ab60; outline-offset: 3px; }
  a { color: inherit; }
  h1, h2, h3, p { margin: 0; }
  input, textarea, select { min-width: 0; }
  input, textarea { width: 100%; }
  svg { flex-shrink: 0; }
}
.app-shell { min-height: 100dvh; }
.sidebar { position: fixed; inset: 0 auto 0 0; width: 236px; display: flex; flex-direction: column; background: #fbfcf8; border-right: 1px solid #e3e7de; padding: 34px 22px 20px; z-index: 20; }
.brand { display: flex; align-items: center; text-decoration: none; font-size: 23px; font-weight: 740; letter-spacing: -.8px; gap: 9px; }
.brand-dot { margin-left: -9px; color: #7a9260; }
.brand-icon { width: 36px; height: 38px; display: grid; place-items: center; background: #32634c; color: #fff; border-radius: 11px 11px 11px 3px; }
.home-label { display: flex; align-items: center; gap: 8px; color: #8a9488; font-size: 10px; font-weight: 650; letter-spacing: 1.9px; margin: 46px 12px 17px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #71936b; display: inline-block; flex-shrink: 0; }
.amber-dot { background: #bf8c46; }
.sidebar nav { display: grid; gap: 7px; }
.nav-item { min-height: 49px; padding: 12px 15px; border: 0; border-radius: 9px; color: #68746a; background: transparent; display: flex; gap: 12px; align-items: center; font-size: 13px; font-weight: 530; text-align: left; }
.nav-item:hover { background: #eef1e8; }
.nav-item.active { background: #e8efdf; color: #32634c; font-weight: 660; }
.nav-item b { margin-left: auto; font-size: 10px; background: #e4e8df; border-radius: 5px; min-width: 21px; text-align: center; padding: 2px 5px; }
.sidebar-bottom { margin-top: auto; padding-top: 50px; }
.team-card { border: 1px solid #e0e6d6; background: #f1f4e9; border-radius: 11px; padding: 20px 17px; }
.team-card > svg { color: #698354; margin-bottom: 11px; }
.team-card h3 { font-family: Georgia, serif; font-weight: 500; font-size: 20px; margin-bottom: 8px; }
.team-card p { color: #7c8575; font-size: 12px; line-height: 1.7; }
.team-avatars { display: flex; align-items: center; margin-top: 18px; }
.team-avatars > span { border: 2px solid #f1f4e9; border-radius: 50%; width: 27px; height: 27px; display: grid; place-items: center; font-size: 10px; color: #5b724b; background: #d9e2c8; }
.team-avatars > span + span { margin-left: -7px; background: #e6dcc7; color: #886d4e; }
.team-avatars small { margin-left: 8px; color: #7e8775; font-size: 10px; }
.connection-button { border: 0; background: transparent; display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; font-size: 10px; color: #7a8377; margin-top: 21px; min-height: 38px; }
.main-shell { margin-left: 236px; }
.topbar { min-height: 83px; border-bottom: 1px solid #e7eae2; padding: 0 44px; display: flex; align-items: center; justify-content: space-between; background: #fafbf7; gap: 16px; }
.breadcrumb { display: flex; align-items: center; gap: 13px; color: #899184; font-size: 11px; }
.breadcrumb strong { color: #475447; font-weight: 550; }
.topbar-right { display: flex; align-items: center; gap: 22px; }
.today-date { font-size: 11px; color: #7b8578; text-transform: capitalize; }
.profile-button { min-height: 44px; display: flex; align-items: center; gap: 9px; border: 0; background: transparent; font-size: 12px; font-weight: 600; }
.profile-button > span:first-child { display: grid; place-items: center; width: 34px; height: 34px; border: 3px solid white; background: #dfdac6; color: #716442; border-radius: 50%; }
main { max-width: 1340px; padding: 30px 44px 35px; margin: auto; }
.greeting { color: #52604e; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 7px; margin-bottom: 25px; }
.greeting > span:first-child { color: #b6a56c; font-size: 19px; }
.greeting-note { color: #8a9183; font-size: 11px; font-weight: 400; margin-left: 3px; }
.eyebrow { font-size: 9px; font-weight: 650; letter-spacing: 2px; color: #7e8d72; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
.page-heading h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: clamp(32px, 3.1vw, 46px); line-height: 1.15; letter-spacing: -1.6px; margin: 10px 0 11px; color: #2d4334; }
.page-heading p { color: #7b8477; font-size: 12px; line-height: 1.6; }
.button { min-height: 44px; border-radius: 8px; border: 1px solid transparent; padding: 11px 17px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0; }
.primary { background: #32634c; color: #fff; box-shadow: 0 3px 5px #233e2310; }
.primary:hover { background: #254f3b; }
.secondary { border-color: #dce2d5; color: #49633f; background: #fcfdf9; }
.secondary:hover { background: #eef2e6; }
.danger { color: #a74f41; background: #fbf1ec; }
.full { width: 100%; }
.inventory-intro { min-height: 190px; background: #eaf0e0; border: 1px solid #e0e7d5; border-radius: 13px; padding: 26px 31px; display: flex; justify-content: space-between; position: relative; overflow: hidden; margin-bottom: 22px; }
.inventory-intro .eyebrow { font-size: 8px; color: #6b7e59; letter-spacing: 1.6px; }
.inventory-intro h2 { font-family: Georgia, serif; font-size: 31px; letter-spacing: -.6px; font-weight: 400; margin: 8px 0; }
.inventory-intro p { font-size: 11px; color: #76816a; line-height: 1.7; }
.text-button { display: flex; align-items: center; gap: 8px; border: 0; background: transparent; color: #466d3c; font-size: 11px; font-weight: 650; padding: 10px 0 0; min-height: 32px; }
.pantry-illustration { width: 300px; position: relative; margin: 0 18px -2px 20px; flex-shrink: 0; }
.shelf { position: absolute; height: 6px; border-radius: 50%; background: #b7c49c; opacity: .45; width: 280px; bottom: 4px; left: 7px; }
.jar { position: absolute; bottom: 7px; border: 2px solid #b7bf8f; border-radius: 9px 9px 17px 17px; width: 78px; height: 108px; background: #e0dfac88; transform: rotate(-6deg); left: 35px; z-index: 2; display: grid; place-items: center; }
.jar:before { content: ''; position: absolute; top: -11px; left: -4px; right: -4px; height: 17px; border-radius: 5px; background: #b4aa7e; border: 2px solid #a99f74; }
.jar > span { font-size: 8px; letter-spacing: 2px; color: #8b805c; background: #f4eed8; padding: 12px 5px; width: 100%; text-align: center; z-index: 2; }
.jar i { height: 25px; width: 5px; background: #cbbd78; position: absolute; top: 8px; left: 15px; transform: rotate(-13deg); border-radius: 2px; }
.jar i:nth-child(3) { left: 34px; transform: rotate(10deg); }
.jar i:nth-child(4) { left: 55px; }
.bottle { height: 144px; width: 58px; position: absolute; bottom: 8px; left: 133px; border-radius: 20px 20px 9px 9px; background: #77935c; transform: rotate(7deg); z-index: 1; border: 2px solid #68864e; }
.bottle:before { content: ''; background: #77935c; position: absolute; top: -18px; left: 14px; width: 25px; height: 20px; border-top: 8px solid #c3af76; border-radius: 4px 4px 0 0; }
.bottle span { position: absolute; left: 4px; right: 4px; bottom: 25px; background: #f2e7bd; height: 55px; display: grid; place-items: center; color: #71814f; font-size: 8px; letter-spacing: 2px; }
.small-jar { width: 72px; height: 72px; left: 204px; transform: rotate(4deg); background: #dbc2a0; border-color: #c4aa8a; }
.small-jar:before { background: #8d9d76; border-color: #7b8f65; height: 13px; }
.small-jar > span { padding: 9px 2px; background: #f7ecd8; }
.leaf { position: absolute; color: #a7b78b; font-size: 30px; }
.leaf-one { right: 3px; top: -6px; transform: rotate(12deg); }.leaf-two { left: 5px; top: 15px; font-size: 17px; }
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 0 0 28px; }
.stats-grid > div { border: 1px solid #e3e7dd; border-radius: 10px; padding: 17px 18px; display: flex; align-items: center; gap: 13px; background: #fffefa; }
.stat-icon { height: 41px; width: 41px; border-radius: 11px; display: grid; place-items: center; }
.sage { background: #edf2e5; color: #779062; }.amber { background: #f7efde; color: #b39459; }.lilac { background: #f0edf5; color: #a08cac; }
.stats-grid strong { font-family: Georgia, serif; font-size: 25px; font-weight: 500; line-height: 1; display: block; }
.stats-grid div div > span { font-size: 10px; color: #8a8f81; margin-top: 6px; display: block; }
.section-tabs { display: flex; gap: 27px; border-bottom: 1px solid #e1e6da; margin-bottom: 22px; }
.section-tabs button { display: flex; gap: 7px; align-items: center; min-height: 43px; border: 0; border-bottom: 2px solid transparent; padding: 0 0 13px; color: #8c9285; font-size: 12px; font-weight: 550; background: transparent; }
.section-tabs .active { color: #3f6448; border-bottom-color: #53774e; }
.section-tabs span { font-size: 9px; background: #e9eee2; border-radius: 5px; padding: 2px 6px; }
.search-row { display: flex; gap: 14px; align-items: center; }
.search-box { display: flex; align-items: center; gap: 10px; background: #fffefa; border: 1px solid #e0e5d8; border-radius: 8px; padding: 0 14px; flex: 1; min-height: 45px; color: #9a9e90; }
.search-box input { border: 0; background: transparent; outline: 0; font-size: 12px; color: #3e503b; padding: 12px 0; }
.search-box:focus-within { outline: 2px solid #98ad77; }
.search-box input::placeholder { color: #a2a595; }
.gluten-toggle { min-height: 45px; display: flex; align-items: center; justify-content: center; gap: 8px; background: #f1f3e9; border: 1px solid #e3e7d9; padding: 0 12px; border-radius: 8px; color: #7d866a; font-size: 11px; }
.gluten-toggle.active { background: #e0ead1; border-color: #a8bc8a; color: #436338; }
.toggle-track { width: 27px; height: 16px; background: #d5dac9; border-radius: 20px; position: relative; margin-left: 4px; }
.toggle-track:after { content: ''; width: 12px; height: 12px; position: absolute; left: 2px; top: 2px; background: white; border-radius: 50%; transition: transform .15s; }
.active .toggle-track { background: #74925b; }.active .toggle-track:after { transform: translateX(11px); }
.filter-row { margin: 14px 0 21px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.pills { display: flex; gap: 7px; flex-wrap: wrap; }
.pill { min-height: 36px; padding: 7px 12px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: #fffefa; border: 1px solid #e1e6d9; color: #8a907e; font-size: 10px; }
.pill.active { background: #e9eedf; color: #567047; border-color: #bccdaa; }
.category-select { min-height: 36px; display: flex; align-items: center; gap: 6px; color: #7e8771; font-size: 10px; }
.category-select select { border: 0; padding: 10px 0; background: transparent; max-width: 170px; }
.result-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 13px; color: #9a9f90; font-size: 10px; }
.result-row select { background: transparent; border: 0; color: #727c65; padding: 7px 0; }
.product-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 17px; }
.product-card { border: 1px solid #e1e6d9; border-radius: 11px; background: #fffefa; overflow: hidden; transition: box-shadow .15s; }
.product-card:hover { box-shadow: 0 5px 20px #42532d08; }
.product-cover { width: 100%; height: 148px; position: relative; background: #f1f0e7; border: 0; display: grid; place-items: center; overflow: hidden; }
.category-lacteos .product-cover { background: #eef0e9; }.category-verduras .product-cover { background: #edf0e3; }.category-carne .product-cover { background: #f5ece5; }.category-bebidas .product-cover { background: #f3eee1; }
.food-emoji { font-size: 58px; filter: saturate(.72); text-shadow: 0 10px 16px #59543315; transform: rotate(-4deg); }
.product-cover img { position: absolute; width: 100%; height: 100%; object-fit: contain; padding: 12px; background: inherit; }
.gf-badge { position: absolute; top: 10px; right: 9px; display: flex; align-items: center; gap: 3px; font-size: 8px; color: #6d8052; background: #fafbf2e8; border: 1px solid #e0e6d4; padding: 4px 6px; border-radius: 5px; }
.product-body { padding: 15px 15px 13px; }
.product-category { font-size: 8px; color: #9b9f8d; letter-spacing: 1.2px; text-transform: uppercase; }
.product-title { display: block; border: 0; background: transparent; text-align: left; font-size: 13px; font-weight: 600; padding: 4px 0 6px; line-height: 1.5; width: 100%; overflow-wrap: anywhere; }
.product-location { display: flex; gap: 5px; align-items: center; font-size: 9px; color: #939b86; }
.product-bottom { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #edf0e7; padding-top: 11px; margin-top: 13px; gap: 4px; }
.stock-label { display: flex; gap: 5px; align-items: center; font-size: 9px; color: #8b9a78; }
.stock-label > span { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }.stock-label.low { color: #b69b56; }
.quantity-stepper { display: flex; align-items: center; gap: 4px; }
.quantity-stepper button { width: 33px; height: 33px; border: 1px solid #e2e7d9; border-radius: 7px; background: #fcfdf9; color: #718461; display: grid; place-items: center; }
.quantity-stepper button:last-child { background: #edf2e6; border-color: #e3e9db; }
.quantity-stepper output { min-width: 20px; text-align: center; font-size: 11px; font-weight: 600; }
.restock-button { display: flex; align-items: center; justify-content: center; gap: 5px; background: #faf6eb; border: 0; border-radius: 5px; color: #98824c; padding: 7px 4px; font-size: 9px; width: 100%; margin-top: 9px; min-height: 32px; }
.buy-button { min-height: 38px; padding: 8px; border: 0; border-radius: 7px; background: #eaf0e1; color: #486b40; display: flex; align-items: center; gap: 4px; font-size: 10px; }
.inventory-note { display: flex; align-items: center; gap: 7px; color: #999a83; font-size: 10px; margin-top: 20px; line-height: 1.6; }
.scan-fab { position: fixed; right: 34px; bottom: 27px; z-index: 15; display: flex; align-items: center; gap: 9px; border: 0; background: #32634c; color: #fff; box-shadow: 0 5px 20px #203d3030; border-radius: 30px; padding: 14px 21px; font-size: 12px; min-height: 53px; }
.main-footer { margin-top: 39px; color: #a3a896; font-size: 9px; display: flex; align-items: center; gap: 6px; padding-top: 20px; border-top: 1px solid #e8ebdf; padding-bottom: 20px; }
.main-footer button { margin-left: auto; border: 0; background: transparent; display: flex; gap: 5px; align-items: center; min-height: 32px; }
.bottom-nav, .mobile-brand, .mobile-add { display: none; }
.view-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.empty-state { min-height: 245px; padding: 36px 20px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px; color: #819071; border: 1px dashed #d7dfcb; border-radius: 12px; background: #fbfcf8; }
.empty-icon { padding: 15px; background: #eef2e5; border-radius: 50%; }
.empty-state h3 { font-family: Georgia, serif; font-weight: 400; font-size: 23px; color: #4b6142; }
.empty-state p { color: #8b9480; font-size: 12px; max-width: 360px; line-height: 1.7; }
.modal { border: 1px solid #e2e6d9; border-radius: 19px; padding: 26px; width: min(490px, calc(100% - 30px)); max-height: calc(100dvh - 40px); margin: auto; color: #33452e; background: #fbfcf8; box-shadow: 0 24px 100px #1d2e3630; overflow-y: auto; }
.modal::backdrop { background: #192b245c; backdrop-filter: blur(4px); }
.modal.wide { width: min(650px, calc(100% - 30px)); }
.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 18px; }
.modal-header h2 { font-family: Georgia, serif; font-size: 27px; font-weight: 400; letter-spacing: -.5px; }
.modal > p { font-size: 13px; line-height: 1.7; margin-bottom: 20px; }
.icon-button { border: 0; background: transparent; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 44px; border-radius: 8px; color: #7b876e; }
.icon-button:hover { background: #edf1e5; }
.form-stack { display: flex; flex-direction: column; gap: 17px; }
.form-stack label:not(.check-label), .field-label { display: flex; flex-direction: column; gap: 8px; font-size: 12px; font-weight: 550; }
.form-stack input:not([type=checkbox]), .form-stack select, .form-stack textarea { min-height: 45px; padding: 11px 12px; border: 1px solid #dbe2ce; border-radius: 8px; background: #fff; color: #3c5131; font-size: 14px; }
.form-stack textarea { resize: vertical; }
.form-row { display: flex; gap: 14px; }.form-row > * { flex: 1; min-width: 0; }
.choice-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }
.choice { min-height: 44px; border: 1px solid #dce3d0; border-radius: 7px; background: #fff; color: #879377; font-size: 11px; padding: 6px; }
.choice.active { background: #eaf0df; border-color: #a7bf8b; color: #587244; }
.check-label { display: flex; align-items: center; gap: 8px; font-size: 13px; min-height: 44px; }
.check-label input { width: 20px; height: 20px; accent-color: #32634c; }
.muted { color: #8a947e; }.small { font-size: 11px; line-height: 1.65; }
.camera-box { min-height: 190px; background: #e8eddf; border-radius: 12px; margin: 17px 0; overflow: hidden; color: #78916a; display: grid; align-items: center; justify-items: center; }
.camera-box { position: relative; }
.camera-host, .camera-reader { display: block; width: 100%; min-width: 0; }
.camera-box > svg { position: absolute; pointer-events: none; }
.camera-box:has(video) > svg { display: none; }
/* El lector mide el contenedor vacío antes de insertar el vídeo. Nunca ocultarlo. */
.camera-box video { display: block; width: 100% !important; height: auto; max-height: none; object-fit: contain; }
.scanner-form { margin-top: 20px; }.attribution { margin: 17px 0 0 !important; text-align: center; }
.inline-error { font-size: 12px; color: #aa5949; padding: 10px; background: #faede7; border-radius: 8px; margin-top: 10px; }
.profile-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 23px 0; }
.profile-options button { display: flex; align-items: center; flex-direction: column; gap: 14px; border: 1px solid #dce3d1; background: #fffef9; border-radius: 12px; padding: 26px 10px; }
.profile-options button:hover { background: #edf2e6; border-color: #b3c69c; }.profile-options strong { font-size: 15px; }.profile-options button > span:last-child { font-size: 10px; color: #8e957f; }
.avatar-large { border-radius: 50%; width: 68px; height: 68px; display: grid; place-items: center; }.dad { background: #e1e9d4; color: #6b8555; }.son { background: #ede1cf; color: #b19972; }
.local-banner, .notice { font-size: 11px; color: #8e7c53; background: #f8f3e5; border: 1px solid #ede4c9; padding: 11px 14px; display: flex; align-items: center; gap: 9px; border-radius: 8px; margin: -7px 0 22px; line-height: 1.6; }
.local-banner button, .notice button { margin-left: auto; flex-shrink: 0; border: 0; border-bottom: 1px solid currentColor; background: transparent; font-size: 10px; }
.toast, .error-toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 100; background: #32634c; border-radius: 10px; color: white; padding: 14px 18px; display: flex; align-items: center; gap: 10px; font-size: 12px; width: max-content; max-width: calc(100% - 30px); box-shadow: 0 6px 30px #172c3020; }
.error-toast { background: #fbede6; color: #97503c; border: 1px solid #e7cbbb; top: auto; bottom: 100px; max-width: 520px; width: calc(100% - 30px); }
.error-toast p { font-size: 11px; line-height: 1.6; margin-top: 4px; }.error-toast .icon-button { margin-left: auto; }
.settings-status { display: flex; gap: 13px; align-items: flex-start; padding: 15px; background: #edf1e4; border-radius: 10px; }.settings-status strong { font-size: 13px; }.settings-status p { font-size: 12px; line-height: 1.7; margin-top: 6px; color: #7a8969; }
.progress-card { border: 1px solid #dce5cd; background: #eaf0df; border-radius: 14px; padding: 26px 30px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 22px; }
.progress-copy h2 { font-family: Georgia, serif; font-size: 28px; font-weight: 400; margin: 8px 0; }.progress-copy p { font-size: 12px; color: #829071; }
.progress-number { font-family: Georgia, serif; font-size: 56px; font-weight: 400; color: #5d7a49; }.progress-number span { font-size: 25px; }
.progress-track { height: 7px; width: 100%; border-radius: 10px; background: #d6e0c5; overflow: hidden; }.progress-track > div { background: #78985c; height: 100%; border-radius: inherit; transition: width .3s; }
.tasks-toolbar { display: flex; flex-direction: column; gap: 12px; margin: 27px 0 18px; }.task-list { display: grid; gap: 11px; }
.task-card { display: flex; align-items: center; gap: 17px; padding: 20px; border: 1px solid #e0e6d6; border-radius: 10px; background: #fffefa; }.task-checkbox { width: 44px; height: 44px; border-radius: 11px; border: 1px solid #cbd7bd; color: #fff; background: #fafcf5; display: grid; place-items: center; flex-shrink: 0; }.completed .task-checkbox { background: #77945d; border-color: #77945d; }.completed .task-info h3 { text-decoration: line-through; color: #9aab8a; }.task-info { flex: 1; min-width: 0; }.task-info h3 { font-size: 14px; font-weight: 560; margin-bottom: 8px; overflow-wrap: anywhere; }.task-info > div { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 10px; color: #8e987f; }.task-info > div > span { display: flex; gap: 4px; align-items: center; }.assignee { padding: 4px 8px; background: #e9efde; color: #7e9366; border-radius: 5px; }.assignee.son { background: #f0e5d4; color: #a78d66; }.overdue { color: #b2765e; }
.reset-panel { padding: 24px; border: 1px dashed #d8e0cc; border-radius: 11px; margin-top: 30px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }.reset-panel h3 { font-size: 13px; font-weight: 600; margin-bottom: 7px; }.reset-panel p { font-size: 11px; color: #8f987f; line-height: 1.7; }.reset-buttons { display: flex; gap: 8px; flex-wrap: wrap; }.reset-buttons .button { font-size: 10px; padding: 9px 12px; }
.menu-count { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #8b987a; background: #edf2e5; border-radius: 8px; padding: 13px; white-space: nowrap; }.menu-count strong { font-size: 14px; color: #5d7848; }
.week-toolbar { display: flex; align-items: center; gap: 12px; margin: 20px 0; }.week-toolbar h2 { font-family: Georgia, serif; font-size: 22px; font-weight: 400; }.week-toolbar h2 span { color: #9ca68e; font-size: 15px; margin-left: 8px; }.week-toolbar > .pill { margin-left: auto; }
.menu-calendar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }.day-card { background: #fffefa; border: 1px solid #e1e6d8; border-radius: 12px; overflow: hidden; }.day-card.today { border-color: #9eb780; }.day-card header { padding: 15px 17px; border-bottom: 1px solid #e8ecdf; display: flex; justify-content: space-between; align-items: center; background: #f3f5ec; }.day-card.today header { background: #eaf0df; }.day-card h3 { font-size: 13px; font-weight: 600; }.day-card header > span { font-size: 9px; color: #91a07c; }.day-meals { display: grid; grid-template-columns: 1fr 1fr; }.meal-slot { background: transparent; padding: 18px 15px; border: 0; text-align: left; min-height: 133px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }.meal-slot + .meal-slot { border-left: 1px solid #eef0e6; }.meal-slot:hover { background: #f5f8ed; }.meal-label { display: flex; align-items: center; gap: 6px; font-size: 8px; letter-spacing: 1px; color: #9caa87; }.meal-slot:first-child .meal-label { color: #b4a168; }.meal-placeholder { color: #b2bba5; display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 10px 0; }.meal-slot strong { font-family: Georgia, serif; font-size: 19px; font-weight: 400; color: #526c42; overflow-wrap: anywhere; }.meal-slot p { font-size: 10px; color: #8b977a; overflow-wrap: anywhere; }.missing-label { display: flex; align-items: start; gap: 4px; font-size: 9px; color: #ab965f; overflow-wrap: anywhere; }.menu-note { text-align: center; font-family: Georgia, serif; color: #a0ab8d; font-size: 15px; margin: 30px 0; }.menu-note span { color: #9cac80; margin-right: 8px; }
.fatal { max-width: 500px; margin: 20vh auto; text-align: center; }.fatal button { margin-top: 25px; background: #32634c; color: white; padding: 12px 20px; border-radius: 8px; }
.spin { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 1500px) { .product-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }.menu-calendar { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1150px) { .sidebar { width: 210px; padding-left: 17px; padding-right: 17px; }.main-shell { margin-left: 210px; }main { padding-left: 28px; padding-right: 28px; }.topbar { padding-left: 28px; padding-right: 28px; }.today-date { display: none; }.product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.reset-panel { flex-direction: column; align-items: flex-start; }.pantry-illustration { transform: scale(.85); transform-origin: right bottom; margin-left: -20px; margin-right: 0; width: 275px; }.inventory-intro { padding: 23px; }.stats-grid > div { padding: 14px 12px; gap: 9px; }.stats-grid div div > span { font-size: 9px; } }
@media (max-width: 800px) {
  .sidebar { display: none; }.main-shell { margin-left: 0; }.topbar { padding: 0 22px; min-height: 73px; }.breadcrumb { display: none; }.mobile-brand { display: flex; font-size: 22px; }.profile-button { gap: 6px; }.greeting { margin-bottom: 22px; }.greeting-note { font-size: 10px; }
  main { padding: 24px 22px 160px; }.page-heading h1 { font-size: 39px; }.page-heading { gap: 12px; align-items: flex-start; }.page-heading .button { margin-top: 23px; }.desktop-add { display: none; }.eyebrow { font-size: 8px; letter-spacing: 1.7px; }.page-heading p { font-size: 12px; }.inventory-intro { min-height: 177px; padding: 23px; }.inventory-intro h2 { font-size: 28px; }.stats-grid { gap: 10px; margin-bottom: 23px; }.stats-grid > div { padding: 13px 12px; }.stat-icon { width: 35px; height: 35px; }.stats-grid strong { font-size: 23px; }
  .bottom-nav { display: grid; grid-template-columns: repeat(4, 1fr); position: fixed; bottom: 0; left: 0; right: 0; padding: 7px 8px calc(7px + env(safe-area-inset-bottom)); background: #fafcf8f5; backdrop-filter: blur(16px); border-top: 1px solid #e1e7d9; z-index: 30; }.bottom-nav .nav-item { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 7px 3px; font-size: 9px; border-radius: 8px; position: relative; }.bottom-nav .nav-item b { position: absolute; left: calc(50% + 9px); top: 2px; border-radius: 10px; background: #e3ead8; color: #426437; font-size: 8px; min-width: 17px; }.bottom-nav .nav-item.active { background: #eaf0e1; }
  .scan-fab { right: 20px; bottom: calc(90px + env(safe-area-inset-bottom)); min-height: 52px; padding: 14px 19px; }.mobile-add { display: inline-flex; margin-top: 24px; font-size: 11px; }.main-footer { padding-bottom: 0; margin-top: 28px; }.main-footer button { display: none; }.view-fieldset .button { min-height: 44px; }.pill { min-height: 42px; }.quantity-stepper button { width: 38px; height: 40px; }.product-bottom { flex-wrap: wrap; row-gap: 8px; }.local-banner { font-size: 10px; padding: 10px; }.local-banner button { display: none; }.desktop-break { display: none; }
}
@media (max-width: 520px) {
  main { padding: 22px 18px 160px; }.topbar { padding: 0 18px; }.page-heading h1 { font-size: 36px; }.page-heading { flex-wrap: wrap; margin-bottom: 24px; }.page-heading .button { margin-top: 0; }.greeting-note { display: none; }.inventory-intro { padding: 22px 19px; min-height: 180px; }.inventory-intro > div:first-child { z-index: 3; max-width: 65%; }.inventory-intro .eyebrow { max-width: 180px; display: block; line-height: 1.7; font-size: 7px; letter-spacing: 1.2px; }.inventory-intro h2 { font-size: 27px; }.inventory-intro p { max-width: 190px; font-size: 10px; }.pantry-illustration { position: absolute; right: 8px; bottom: 20px; height: 150px; transform: scale(.57); width: 285px; opacity: .9; }.pantry-illustration .leaf-one { top: -30px; }
  .stats-grid { gap: 8px; }.stats-grid > div { padding: 13px 9px; flex-direction: column; align-items: flex-start; gap: 10px; }.stat-icon { height: 30px; width: 30px; border-radius: 8px; }.stat-icon svg { width: 16px; }.stats-grid strong { font-size: 24px; }.stats-grid div div > span { font-size: 9px; line-height: 1.5; }.section-tabs { gap: 24px; margin-bottom: 18px; }.section-tabs button { font-size: 12px; }.search-row { gap: 8px; }.search-box { padding: 0 11px; }.search-box input { font-size: 12px; }.gluten-toggle { gap: 5px; padding: 0 9px; font-size: 10px; }.toggle-track { display: none; }.gluten-toggle svg { width: 16px; }.filter-row { gap: 4px; margin-bottom: 9px; }.pills { gap: 5px; }.pill { padding: 7px 9px; font-size: 10px; }.pill svg { width: 14px; }.category-select { width: 100%; justify-content: flex-end; }.product-grid { gap: 11px; }.product-cover { height: 130px; }.product-body { padding: 12px 11px; }.product-title { font-size: 12px; min-height: 43px; }.product-bottom { align-items: center; }.quantity-stepper { gap: 1px; }.quantity-stepper button { width: 33px; height: 44px; }.quantity-stepper output { min-width: 18px; }.stock-label { font-size: 8px; }.gf-badge { font-size: 7px; right: 6px; top: 7px; padding: 3px 4px; }.buy-button { min-height: 44px; font-size: 9px; }.restock-button { min-height: 39px; font-size: 8px; }.food-emoji { font-size: 48px; }.result-row { margin-bottom: 12px; }.modal { padding: 22px; width: calc(100% - 24px); }.modal-header h2 { font-size: 25px; }.form-stack input:not([type=checkbox]), .form-stack select, .form-stack textarea { font-size: 16px; }.choice { font-size: 10px; }.profile-options { gap: 9px; }.profile-options button { padding: 22px 8px; }.profile-options button > span:last-child { font-size: 9px; }.toast { font-size: 11px; padding: 12px; }.error-toast { bottom: calc(83px + env(safe-area-inset-bottom)); }.progress-card { padding: 22px; gap: 20px; }.progress-copy h2 { font-size: 25px; }.progress-copy p { font-size: 11px; }.progress-number { font-size: 43px; }.task-card { gap: 12px; padding: 16px 12px; }.task-info h3 { font-size: 13px; }.task-info > div { gap: 7px; font-size: 9px; }.reset-panel { padding: 19px; }.week-toolbar { gap: 4px; flex-wrap: wrap; }.week-toolbar h2 { font-size: 19px; }.week-toolbar h2 span { display: none; }.week-toolbar .icon-button { min-width: 34px; }.week-toolbar > .pill { font-size: 9px; }.menu-calendar { grid-template-columns: 1fr; gap: 13px; }.meal-slot { min-height: 120px; padding: 18px; }.menu-note { font-size: 13px; line-height: 1.6; }.menu-count { font-size: 10px; }.small { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }

/* Textos secundarios legibles y objetivos táctiles de 44 px. */
.muted, .page-heading p, .inventory-intro p, .greeting-note, .product-location,
.product-category, .result-row, .category-select, .stats-grid div div > span,
.task-info > div, .progress-copy p, .reset-panel p, .main-footer, .empty-state p,
.settings-status p, .connection-button, .team-card p, .eyebrow, .meal-slot p,
.meal-placeholder, .day-card header > span, .inventory-note { color: #65745d; }
.pill, .gluten-toggle, .section-tabs button, .choice, .menu-note { color: #647657; }
.stock-label { color: #557545; }.stock-label.low, .missing-label { color: #927135; }
.pills button, .quantity-stepper button, .buy-button, .restock-button { min-height: 44px; }
.quantity-stepper button { min-width: 44px; }.quantity-stepper output { min-width: 22px; }
.product-bottom { flex-wrap: wrap; gap: 8px; }.quantity-stepper { margin-left: auto; }
@media (max-width: 520px) { .pantry-illustration { transform: scale(.48); right: 4px; } }

.family-context { background: #eef2e7; border: 1px solid #dfe6d4; border-radius: 10px; padding: 16px 19px; margin-bottom: 20px; font-size: 12px; color: #4f6545; }
.family-context p { font-size: 11px; color: #65745d; line-height: 1.75; margin-top: 6px; }
.schedule-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; margin: 20px 0; }
.schedule-days button { min-height: 78px; border: 1px solid #dce3d2; background: #fffefa; border-radius: 9px; color: #68785b; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.schedule-days button.active { background: #32634c; color: white; border-color: #32634c; }
.schedule-days span { font-size: 11px; }.schedule-days strong { font-size: 20px; font-weight: 600; }.schedule-days small { font-size: 8px; letter-spacing: 1px; }
.routine-group { margin: 28px 0; }.routine-group > h2 { font-family: Georgia, serif; font-size: 23px; font-weight: 400; display: flex; gap: 10px; align-items: center; margin-bottom: 13px; }
.routine-group > h2 span { font-family: system-ui, sans-serif; font-size: 11px; background: #e7eddd; color: #647657; border-radius: 5px; padding: 3px 8px; }
.task-info .task-notes { font-size: 11px; color: #65745d; line-height: 1.7; margin-top: 9px; }
.schedule-form-days { margin-top: 9px; }
.meal-slot .missing-label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.7; }
.meal-slot .missing-label svg { display: inline; vertical-align: middle; margin-right: 4px; }
@media (max-width: 520px) { .schedule-days { gap: 4px; }.schedule-days button { min-height: 75px; }.schedule-days span { font-size: 10px; }.family-context { padding: 14px; }.task-card { align-items: flex-start; }.task-info .task-notes { font-size: 10px; }.schedule-form-days { gap: 4px; }.schedule-form-days .pill { padding: 6px 8px; } }

/* Entrada al hogar */
.auth-page { min-height: 100dvh; display: grid; place-items: center; padding: 28px 20px; background: #f4f6f1; }
.auth-card { width: min(100%, 440px); padding: 38px 32px; border: 1px solid #e0e6dc; border-radius: 28px; background: #fff; box-shadow: 0 18px 60px #2143310a; }
.auth-card .brand { margin-bottom: 38px; }
.auth-lock { width: 60px; height: 60px; display: grid; place-items: center; border-radius: 20px; color: #32634c; background: #edf3e9; margin-bottom: 22px; }
.auth-card h1 { font-family: Georgia, serif; font-size: clamp(30px, 7vw, 39px); line-height: 1.15; margin: 10px 0 14px; }
.auth-card .form-stack { margin-top: 30px; }
.auth-card label { display: grid; gap: 9px; font-size: 14px; font-weight: 600; }
.auth-card input { width: 100%; min-height: 50px; border: 1px solid #d4ddd2; border-radius: 12px; padding: 12px 14px; background: #fff; font-size: 16px; }
.auth-card .button { min-height: 50px; width: 100%; justify-content: center; }
.auth-error { color: #a33927; background: #fff2ee; padding: 12px; border-radius: 10px; margin-top: 18px; }
.auth-footnote { margin-top: 24px; text-align: center; }
.auth-checking { display: flex; align-items: center; gap: 10px; margin: 28px 0; }
@media (max-width: 480px) { .auth-card { padding: 28px 22px; } }

.scanner-controls { display: grid; gap: 10px; margin: 12px 0; }
.scanner-tip { font-size: 13px; line-height: 1.55; color: #4c6547; }
.scanner-control-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.scanner-control-row .button { flex: 1; min-height: 46px; }
.scanner-zoom { display: flex; align-items: center; border: 1px solid #dbe2ce; border-radius: 10px; background: #fff; }
.scanner-zoom output { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
.scanner-camera-choice { display: grid; gap: 7px; margin: 12px 0; font-size: 13px; }
.scanner-camera-choice select { width: 100%; min-width: 0; min-height: 46px; padding: 8px; border: 1px solid #dbe2ce; border-radius: 8px; background: #fff; font-size: 16px; }
.modal { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
```

### `vite.config.js`

```javascript
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/';
  return {
    base,
    plugins: [react(), tailwindcss(), VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '.nojekyll'],
      manifestFilename: 'manifest.json',
      manifest: {
        id: base, name: 'CloudHouse · Nuestro hogar', short_name: 'CloudHouse',
        description: 'La despensa, la compra, el menú y las tareas. Un hogar, en equipo.',
        lang: 'es', start_url: base, scope: base, display: 'standalone',
        background_color: '#f7f8f4', theme_color: '#32634c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true },
    })],
  };
});
```

### `index.html`

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#32634c" />
    <meta name="description" content="Organiza la comida, la compra y las tareas de casa en equipo." />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="icon" type="image/svg+xml" href="%BASE_URL%icon.svg" />
    <link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png" />
    <title>CloudHouse · Nuestro hogar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### `package.json`

```json
{
  "name": "cloudhouse",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0",
    "test": "node --test tests/*.test.js",
    "predeploy": "node scripts/check-deploy.mjs && npm run build",
    "deploy": "gh-pages -d dist --dotfiles"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "@zxing/library": "^0.23.0",
    "html5-qrcode": "^2.3.8",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "gh-pages": "^6.3.0",
    "tailwindcss": "^4.0.0",
    "vite": "^7.0.0",
    "vite-plugin-pwa": "^1.0.0"
  }
}
```

### `.env.example`

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_BASE_PATH=/CloudHouse/
```

### `scripts/check-deploy.mjs`

```javascript
import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), '');
if (!env.VITE_BASE_PATH?.startsWith('/') || !env.VITE_BASE_PATH.endsWith('/')) {
  throw new Error('Define VITE_BASE_PATH=/CloudHouse/ en .env.local para GitHub Pages.');
}
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  if (process.env.ALLOW_LOCAL_MODE !== 'true') throw new Error('Faltan las variables públicas de Supabase. Para publicar explícitamente sin sincronización usa ALLOW_LOCAL_MODE=true npm run deploy.');
  console.warn('Publicando en modo local, sin sincronización familiar.');
}
```

### `public/icon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#32634c"/><path d="M132 252 256 146l124 106v116a18 18 0 0 1-18 18H150a18 18 0 0 1-18-18Z" fill="#f2f4dc"/><path d="M222 386V278h68v108" fill="#32634c"/><path d="M310 175c-3-42 37-58 64-47 8 34-14 62-50 59" fill="#c4d6a7"/></svg>
```

Los iconos PNG, `.nojekyll`, el lockfile y las pruebas están incluidos en el repositorio.


### `src/lib/familySchedule.js`

```javascript
import { dateKey, DAYS, monday, shiftDate } from './domain.js';

export const PERIODS = { manana: 'Por la mañana', mediodia: 'Comidas y mediodía', tarde: 'Por la tarde', noche: 'Cenas y noche', flexible: 'Sin hora fija' };
export const dayIndex = date => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
export function taskOccursOn(task, date = dateKey()) {
  if (task.frequency === 'puntual') return !task.due_date || task.due_date === date;
  return (!task.due_date || task.due_date <= date) && (task.scheduled_days || [0, 1, 2, 3, 4, 5, 6]).includes(dayIndex(date));
}
export function taskCompletedOn(task, date) {
  if (Array.isArray(task.completed_dates)) return task.completed_dates.includes(date);
  return Boolean(task.is_completed);
}
export function periodHasCompletions(tasks, frequency, date) {
  const first = frequency === 'semanal' ? monday(new Date(`${date}T12:00:00`)) : date;
  const last = frequency === 'semanal' ? shiftDate(first, 6) : date;
  return tasks.some(t => t.frequency === frequency && (t.completed_dates || []).some(d => d >= first && d <= last));
}
export function scheduleLabel(task) {
  const days = task.scheduled_days || [0, 1, 2, 3, 4, 5, 6];
  return days.length === 7 ? 'Todos los días' : days.map(i => DAYS[i].slice(0, 3)).join(' · ');
}
export function menuForWeek(meals, week, templates = []) {
  const slots = new Map(templates.map(({ id, ...base }) => [`${base.day_of_week}:${base.meal_type}`, { ...base, week_start: week }]));
  for (const stored of meals.filter(m => m.week_start === week)) slots.set(`${stored.day_of_week}:${stored.meal_type}`, stored);
  return [...slots.values()].filter(meal => !meal.is_skipped);
}
```

### `scripts/seed-family.mjs`

```javascript
import { authenticateClients } from './authenticate.mjs';
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { monday, normalize } from '../src/lib/domain.js';

const env = loadEnv('production', process.cwd(), '');
assert.ok(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY, 'Falta configurar Supabase');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
await authenticateClients([db]);
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
```

### `src/components/AuthGate.jsx`

```jsx
import { useEffect, useState } from 'react';
import { House, LockKeyhole, LogOut, RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { supabase } from '../services/supabaseClient.js';
import { usernameEmail, validMembership } from '../lib/auth.js';
import { cachedHousehold } from '../services/householdService.js';

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  useEffect(() => {
    cachedHousehold();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    setAccount(null);
    if (session === undefined) return;
    if (!session) { setChecking(false); return; }
    setChecking(true);
    supabase.from('household_members').select('user_id,username,profile').eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) setError('No se ha podido comprobar el acceso. Revisa tu conexión y vuelve a intentarlo.');
        else if (!validMembership(data, session.user.id)) setError('Esta cuenta no tiene acceso a este hogar.');
        else { setAccount(data); setError(''); }
        setChecking(false);
      }).catch(() => { if (active) { setError('No se ha podido comprobar el acceso. Revisa tu conexión.'); setChecking(false); } });
    return () => { active = false; };
  }, [session, attempt]);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { error: failure } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (failure) throw new Error(failure.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : 'No se pudo entrar. Comprueba el usuario, la contraseña y la conexión.');
      setPassword('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setAccount(null); setBusy(true); setError(''); cachedHousehold();
    try {
      const { error: failure } = await supabase.auth.signOut({ scope: 'local' });
      if (failure) setError('No se pudo cerrar la sesión. Conéctate y vuelve a intentarlo.');
    } finally { setBusy(false); }
  }
  if (account) return children(account, logout);
  return <main className="auth-page"><section className="auth-card" aria-labelledby="auth-title">
    <a className="brand" href={import.meta.env.BASE_URL}><span className="brand-icon"><House size={25} /></span>CloudHouse<span className="brand-dot">.</span></a>
    <span className="auth-lock"><LockKeyhole size={28} strokeWidth={1.5} /></span>
    <p className="eyebrow">NUESTRO HOGAR</p><h1 id="auth-title">Bienvenido a casa.</h1>
    <p className="muted">Tu casa, organizada. Entra para continuar.</p>
    {checking ? <p role="status" className="auth-checking"><RefreshCw className="spin" size={20} />Comprobando tu sesión…</p> : session ? <div className="form-stack"><button className="button primary" disabled={busy} onClick={() => setAttempt(v => v + 1)}>Reintentar conexión</button><button className="button secondary" disabled={busy} onClick={logout}><LogOut size={18} />Cerrar sesión</button></div> : <form className="form-stack" onSubmit={login}>
      <label>Usuario<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={40} value={username} onChange={e => setUsername(e.target.value)} placeholder="Tu nombre de usuario" /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Tu contraseña" /></label>
      <button className="button primary" type="submit" disabled={busy}><LockKeyhole size={18} />{busy ? 'Entrando…' : 'Entrar en casa'}</button>
    </form>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {needRefresh && <button className="button secondary" onClick={() => updateServiceWorker(true)}>Actualizar app</button>}
    <p className="small muted auth-footnote">Acceso reservado a las cuentas de este hogar.</p>
  </section></main>;
}
```

### `src/lib/auth.js`

```js
export function usernameEmail(value) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(username)) throw new Error('Escribe tu nombre de usuario, sin espacios.');
  return `${username}@users.cloudhouse.invalid`;
}

export function validMembership(member, userId) {
  return Boolean(member && member.user_id === userId && ['Padre', 'Hijo'].includes(member.profile));
}
```

### `scripts/authenticate.mjs`

```js
import { createInterface } from 'node:readline';
import { usernameEmail } from '../src/lib/auth.js';

export async function authenticateClients(clients) {
  console.log('Introduce por stdin un JSON con username y password de un miembro (no se guarda).');
  if (process.stdin.isTTY) console.log('Para ocultar la entrada en terminal, ejecuta primero: stty -echo');
  const input = createInterface({ input: process.stdin, terminal: false });
  const credentials = await new Promise(resolve => input.once('line', line => { input.close(); resolve(JSON.parse(line)); }));
  for (const db of clients) {
    const { error } = await db.auth.signInWithPassword({ email: usernameEmail(credentials.username), password: credentials.password });
    if (error) throw new Error('No se pudo autenticar la cuenta de pruebas.');
  }
}
```

### `src/lib/cameraSession.js`

```js
// Mantiene cada intento aislado: un permiso tardío no puede reabrir el escáner cerrado.
export function createCameraSession({ reader, root, config, onDetected, timeoutMs = 20000, observe = callback => new MutationObserver(callback) }) {
  let cancelled = false;
  let settled = false;
  let started = false;
  let timer;
  let poll;
  let resolveReady;
  let rejectReady;
  let stopping;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const video = () => root.querySelector('video');
  const stopTracks = () => {
    const surface = video();
    surface?.srcObject?.getTracks().forEach(track => track.stop());
    return Boolean(surface);
  };
  const releaseReader = () => {
    if (started && !stopping && reader.isScanning) stopping = Promise.resolve().then(() => reader.stop()).catch(() => {});
  };
  function inspect() {
    if (cancelled) {
      if (stopTracks()) observer.disconnect();
      releaseReader();
      return;
    }
    const surface = video();
    if (!surface) return;
    surface.muted = true;
    surface.playsInline = true;
    surface.setAttribute('playsinline', '');
    surface.setAttribute('webkit-playsinline', '');
    if (started && surface.readyState >= 2 && !surface.paused && surface.videoWidth > 0 && surface.clientWidth > 0 && surface.clientHeight > 0) {
      settled = true; clearTimeout(timer); clearInterval(poll);
      observer.disconnect(); resolveReady();
    }
  }
  const observer = observe(inspect);
  observer.observe(root, { childList: true, subtree: true });
  function stop() {
    if (cancelled) return;
    cancelled = true; clearTimeout(timer); clearInterval(poll);
    if (!settled) { settled = true; rejectReady(new DOMException('Cámara cerrada', 'AbortError')); }
    inspect();
    // Conservamos el observador del nodo separado mientras un permiso siga pendiente.
    // Si aparece un stream más tarde, inspect() lo apaga inmediatamente.
    root.remove();
  }
  timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectReady(new Error('La cámara no ha mostrado imagen. Pulsa «Activar cámara» para reintentarlo o escribe el código.'));
      stop();
    }
  }, timeoutMs);
  poll = setInterval(inspect, 100);
  Promise.resolve().then(() => {
    if (cancelled) return;
    return reader.start({ facingMode: 'environment' }, config, raw => { if (!cancelled) onDetected(raw); }, () => {});
  }).then(() => { started = true; inspect(); }).catch(error => {
    started = true;
    if (!settled) { settled = true; rejectReady(error); }
    stop();
    observer.disconnect();
  });
  return { ready, stop, getVideo: video, getTrack: () => video()?.srcObject?.getVideoTracks?.()[0] };
}
```

### `src/lib/modalScroll.js`

```js
const locks = new WeakMap();

// Las ventanas pueden desmontarse en distinto orden al que se abrieron.
export function lockModalScroll(body) {
  let state = locks.get(body);
  if (!state) {
    state = { count: 0, overflow: body.style.overflow };
    locks.set(body, state);
    body.style.overflow = 'hidden';
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count === 0) {
      body.style.overflow = state.overflow;
      locks.delete(body);
    }
  };
}
```

### `src/lib/cameraControls.js`

```js
export function cameraConfig(deviceId) {
  return {
    fps: 6, disableFlip: true,
    videoConstraints: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 },
    },
    qrbox: (width, height) => ({ width: Math.floor(width * 0.9), height: Math.floor(height * 0.55) }),
  };
}

export function cameraCapabilities(track) {
  let caps = {};
  try { caps = track?.getCapabilities?.() || {}; } catch {}
  const range = caps.zoom;
  const maxZoom = range ? Math.min(range.max, Math.max(3, range.min)) : 0;
  return {
    torch: caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true)),
    focus: Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous'),
    zoom: range && Number.isFinite(range.min) && Number.isFinite(range.max) && maxZoom > range.min
      ? { min: range.min, max: maxZoom, step: range.step || 0.1 } : null,
  };
}

export async function applyCameraControl(track, name, value) {
  if (!track || track.readyState === 'ended') throw new Error('La cámara está apagada.');
  const caps = cameraCapabilities(track);
  if ((name === 'torch' && !caps.torch) || (name === 'focusMode' && !caps.focus) || (name === 'zoom' && !caps.zoom)) throw new Error('Esta cámara no permite ese ajuste.');
  if (name === 'zoom') {
    if (!Number.isFinite(value)) throw new Error('Zoom inválido.');
    value = Math.min(caps.zoom.max, Math.max(caps.zoom.min, value));
    value = Math.min(caps.zoom.max, caps.zoom.min + Math.round((value - caps.zoom.min) / caps.zoom.step) * caps.zoom.step);
  }
  // Safari puede devolver un valor de torch antiguo en getSettings().
  await track.applyConstraints({ [name]: value, advanced: [{ [name]: value }] });
  return value;
}
```

### `src/lib/barcodeDecoder.js`

```js
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
```

## 10. Guía breve de 5 pasos para subirlo a GitHub Pages con gh-pages y conectar las variables de entorno

1. Crea un proyecto **Free** en [Supabase](https://supabase.com/dashboard).
   Ejecuta íntegramente [`supabase/schema.sql`](supabase/schema.sql) en SQL Editor.
2. Crea `.env.local` a partir de `.env.example`. Copia la URL del proyecto en
   `VITE_SUPABASE_URL` y la clave **anon o publishable** en
   `VITE_SUPABASE_ANON_KEY`. Nunca uses la clave `service_role` o una secret key.
   Establece `VITE_BASE_PATH=/CloudHouse/` (respeta el nombre de tu repositorio).
3. Sube el código a tu repositorio público de GitHub:
   ```bash
   git init -b main
   git add .
   git commit -m "Crear CloudHouse"
   gh repo create CloudHouse --public --source=. --remote=origin --push
   ```
   Si el repositorio ya existe, usa su remoto y `git push origin main`.
4. Ejecuta `npm ci`, `npm test` y `npm run deploy`.
   El script compila con las variables de `.env.local` y publica `dist/`
   en la rama `gh-pages`. Las variables de Vite se incorporan al JavaScript:
   la URL y la clave pública serán visibles en el navegador.
5. En GitHub → Settings → Pages selecciona **Deploy from a branch**,
   rama **gh-pages**, carpeta **/(root)**. Abre
   `https://TU_USUARIO.github.io/CloudHouse/` en ambos móviles.
   Inicia sesión con una cuenta autorizada e instala desde el menú de Chrome o desde
   Safari → Compartir → Añadir a la pantalla de inicio.

Para publicar actualizaciones: `git push origin main` y `npm run deploy`.
El workflow incluido ejecuta las pruebas y la compilación; el despliegue se
realiza con `gh-pages`. GitHub Pages y Supabase usan sus planes gratuitos,
sujetos a sus límites. No se ha contratado ningún servicio de pago.


Publicación de este proyecto: [CloudHouse](https://pep-vnd.github.io/CloudHouse/).

Documentación consultada: [Tailwind](https://tailwindcss.com/docs/installation/using-vite), [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [Open Food Facts](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/), [Vite y Pages](https://vite.dev/guide/static-deploy.html#github-pages).

El acceso requiere crear las cuentas y sus miembros como indica README.md, apartado «Acceso y datos». No incluyas contraseñas en el código.
