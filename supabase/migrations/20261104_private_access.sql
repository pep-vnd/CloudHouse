-- Acceso exclusivo para miembros provisionados por el administrador.
-- No contiene usuarios, contraseñas ni datos personales.
begin;
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
