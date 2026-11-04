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
