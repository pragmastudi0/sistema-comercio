-- ===========================================================================
-- sistema-comercio — Provisioning de empresas (alta multi-empresa)
-- ===========================================================================
-- `rpc_provisionar_empresa` crea, en una transacción, la estructura mínima de
-- una empresa nueva: empresa + configuración + 4 roles preset + listas (CF
-- default + Mayorista) + depósito central. Devuelve los IDs creados.
--
-- El PRIMER usuario admin (Supabase Auth + fila empleados) se crea aparte con
-- un script que use el service_role + Auth Admin API (no se puede crear un
-- auth.users desde SQL). Ver docs/ONBOARDING-CLIENTE.md.
--
-- Pensada para el OPERADOR del SaaS: se ejecuta con service_role (que además
-- saltea RLS). NO se concede a anon/authenticated.
-- ===========================================================================

create or replace function public.rpc_provisionar_empresa(
  p_nombre text,
  p_subdominio text default null,
  p_cuit text default null
) returns table(
  empresa_id uuid,
  rol_admin_id uuid, rol_encargado_id uuid, rol_cajero_id uuid, rol_catalogo_id uuid,
  lista_cf_id uuid, lista_may_id uuid,
  deposito_central_id uuid
) language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_admin uuid; v_enc uuid; v_caj uuid; v_cat uuid;
  v_cf uuid; v_may uuid;
  v_dep uuid;
begin
  insert into empresas(nombre, subdominio, cuit) values (p_nombre, p_subdominio, p_cuit)
    returning id into v_emp;

  insert into configuracion_empresa(empresa_id) values (v_emp);

  insert into roles(empresa_id, nombre, preset, preset_key) values
    (v_emp, 'Admin', true, 'admin') returning id into v_admin;
  insert into roles(empresa_id, nombre, preset, preset_key) values
    (v_emp, 'Encargado', true, 'encargado') returning id into v_enc;
  insert into roles(empresa_id, nombre, preset, preset_key) values
    (v_emp, 'Cajero', true, 'cajero') returning id into v_caj;
  insert into roles(empresa_id, nombre, preset, preset_key) values
    (v_emp, 'Carga de catálogo', true, 'catalogo') returning id into v_cat;

  insert into listas_precio(empresa_id, nombre, es_default, activa) values
    (v_emp, 'Consumidor Final', true, true) returning id into v_cf;
  insert into listas_precio(empresa_id, nombre, es_default, activa) values
    (v_emp, 'Mayorista', false, true) returning id into v_may;

  insert into depositos(empresa_id, nombre, tipo) values
    (v_emp, 'Central', 'central') returning id into v_dep;

  return query select v_emp, v_admin, v_enc, v_caj, v_cat, v_cf, v_may, v_dep;
end $$;

grant execute on function public.rpc_provisionar_empresa(text,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- SEED DEMO (opcional, manual). Descomentar para crear una empresa de prueba
-- en una base de desarrollo. NO dejar activo en producción.
--
--   select * from public.rpc_provisionar_empresa('Comercio Demo', 'demo', null);
--
-- Después, crear el usuario admin con el script de onboarding (service_role +
-- Auth Admin API) y linkearlo a un empleado con rol_admin de la empresa demo.
-- ---------------------------------------------------------------------------
