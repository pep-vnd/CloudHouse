-- Ejecutar desde SQL Editor: simula una cuenta sin pertenencia al hogar.
-- No crea usuarios ni conserva modificaciones.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare t text; n integer;
begin
  foreach t in array array['inventory_items','household_tasks','weekly_menu','menu_templates','household_members'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'Una cuenta sin pertenencia pudo leer %', t; end if;
  end loop;
  begin
    insert into public.household_tasks(title) values ('QA no autorizado');
    raise exception 'Inserción no autorizada permitida';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.add_ingredient('QA no autorizado');
    raise exception 'RPC no autorizada permitida';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.household_members(user_id,username,profile)
    values ('00000000-0000-4000-8000-000000000001','qa_no_autorizado','Padre');
    raise exception 'Alta de miembro no autorizada permitida';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
select 'OK: una cuenta autenticada sin pertenencia no puede acceder' as resultado;
