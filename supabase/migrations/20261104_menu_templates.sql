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
