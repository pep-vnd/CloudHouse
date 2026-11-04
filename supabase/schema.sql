-- CloudHouse: ejecutar una vez en SQL Editor de un proyecto Supabase gratuito.
-- Acceso compartido abierto solicitado: cualquiera con URL y anon key puede
-- leer y modificar estas tres tablas. El selector de perfil no es autenticación.
begin;
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
commit;

-- Horarios y organización familiar (migración 20261104).
begin;
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
commit;

-- Plantillas de menú compartidas, sin datos personales en el código.
begin;
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
commit;
