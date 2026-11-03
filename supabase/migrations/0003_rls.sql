-- ===========================================================================
-- sistema-comercio — Row Level Security MULTI-EMPRESA
-- ===========================================================================
-- Aislamiento por inquilino: cada usuario autenticado SOLO ve/escribe filas de
-- SU empresa (empresa_id = empresa_actual_id()). La tienda web pública (anon)
-- lee el catálogo filtrando por empresa en la query (resuelta por subdominio).
--
-- ⚠️ LECCIÓN DEL SISTEMA ORIGINAL: la RLS falla en SILENCIO. El SQL Editor usa
-- service_role y siempre pasa. OBLIGATORIO verificar con un usuario
-- `authenticated` real de dos empresas distintas (ver docs/SCHEMA.md, Fase 6).
--
-- Los helpers empresa_actual_id()/is_admin()/... son SECURITY DEFINER y leen
-- `empleados` salteando RLS → no hay recursión aunque empleados tenga policies.
-- ===========================================================================

begin;

-- ============== ENABLE RLS en todo ==============
do $$
declare t text;
begin
  for t in select unnest(array[
    'empresas','configuracion_empresa','locales','depositos','cajas','roles','empleados',
    'categorias','proveedores','productos','variantes','producto_imagenes','listas_precio',
    'producto_lista_precio','stock_items','movimientos_stock','transferencias','clientes',
    'movimientos_ctacte','sesiones_caja','ventas','movimientos_caja','notas_credito',
    'pedidos_web','contadores','logs_auditoria'
  ]) loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ============== PATRÓN A: operacionales — authenticated scoped por empresa ==============
-- ALL (select/insert/update/delete) para authenticated, solo filas de su empresa.
do $$
declare t text;
begin
  for t in select unnest(array[
    'locales','depositos','cajas','roles','empleados','proveedores',
    'stock_items','movimientos_stock','transferencias','clientes','movimientos_ctacte',
    'sesiones_caja','ventas','movimientos_caja','notas_credito','pedidos_web',
    'contadores','logs_auditoria'
  ]) loop
    execute format('drop policy if exists %I_tenant_all on %I', t, t);
    execute format(
      'create policy %I_tenant_all on %I for all to authenticated
         using (empresa_id = public.empresa_actual_id())
         with check (empresa_id = public.empresa_actual_id())', t, t);
  end loop;
end $$;

-- ============== PATRÓN B: catálogo — anon lee público, authenticated scoped ==============
-- La web (anon) filtra por empresa_id en la query (subdominio). Para authenticated,
-- solo su empresa.
do $$
declare t text;
begin
  for t in select unnest(array[
    'productos','categorias','listas_precio','producto_lista_precio',
    'producto_imagenes','variantes'
  ]) loop
    execute format('drop policy if exists %I_public_select on %I', t, t);
    execute format('create policy %I_public_select on %I for select to anon using (true)', t, t);

    execute format('drop policy if exists %I_tenant_all on %I', t, t);
    execute format(
      'create policy %I_tenant_all on %I for all to authenticated
         using (empresa_id = public.empresa_actual_id())
         with check (empresa_id = public.empresa_actual_id())', t, t);
  end loop;
end $$;

-- ============== empresas ==============
-- anon: lee (resolución de subdominio en la web). authenticated: ve/edita la propia.
drop policy if exists empresas_public_select on empresas;
create policy empresas_public_select on empresas for select to anon using (true);
drop policy if exists empresas_tenant on empresas;
create policy empresas_tenant on empresas for all to authenticated
  using (id = public.empresa_actual_id())
  with check (id = public.empresa_actual_id());

-- ============== configuracion_empresa ==============
-- anon: lee (branding/mayorista de la tienda). authenticated: lee la propia,
-- modifica solo admin. (TODO: exponer a anon solo columnas no sensibles vía vista;
-- `arranque` es dato de negocio. Ver docs/PRODUCTIZACION.md.)
drop policy if exists config_public_select on configuracion_empresa;
create policy config_public_select on configuracion_empresa for select to anon using (true);
drop policy if exists config_tenant_select on configuracion_empresa;
create policy config_tenant_select on configuracion_empresa for select to authenticated
  using (empresa_id = public.empresa_actual_id());
drop policy if exists config_tenant_modify on configuracion_empresa;
create policy config_tenant_modify on configuracion_empresa for all to authenticated
  using (empresa_id = public.empresa_actual_id() and public.is_admin())
  with check (empresa_id = public.empresa_actual_id() and public.is_admin());

commit;

-- ============== GRANTS de tabla (RLS filtra filas; grants dan privilegio) ==============
-- Catálogo + empresa visible a anon (la tienda pública).
grant select on
  productos, categorias, listas_precio, producto_lista_precio, producto_imagenes,
  variantes, empresas, configuracion_empresa
  to anon;
-- Operación completa a usuarios logueados (RLS los acota a su empresa).
grant select, insert, update, delete on
  empresas, configuracion_empresa, locales, depositos, cajas, roles, empleados,
  categorias, proveedores, productos, variantes, producto_imagenes, listas_precio,
  producto_lista_precio, stock_items, movimientos_stock, transferencias, clientes,
  movimientos_ctacte, sesiones_caja, ventas, movimientos_caja, notas_credito,
  pedidos_web, contadores, logs_auditoria
  to authenticated;

-- ============== STORAGE: bucket producto-imagenes ==============
-- SELECT público (tienda sin login). Escritura: authenticated.
-- NOTA: multi-empresa, las fotos van en carpetas por empresa (path
-- "<empresa_id>/<producto_id>/...") desde la app. El aislamiento de lectura NO
-- es crítico (son fotos de catálogo público), pero la escritura debería validar
-- el prefijo de empresa (TODO Fase 4). El bucket se crea vía API de Storage.
drop policy if exists "producto_imagenes_select_publico" on storage.objects;
drop policy if exists "producto_imagenes_insert_auth"    on storage.objects;
drop policy if exists "producto_imagenes_update_auth"    on storage.objects;
drop policy if exists "producto_imagenes_delete_auth"    on storage.objects;

create policy "producto_imagenes_select_publico" on storage.objects
  for select to public using (bucket_id = 'producto-imagenes');
create policy "producto_imagenes_insert_auth" on storage.objects
  for insert to authenticated with check (bucket_id = 'producto-imagenes');
create policy "producto_imagenes_update_auth" on storage.objects
  for update to authenticated using (bucket_id = 'producto-imagenes');
create policy "producto_imagenes_delete_auth" on storage.objects
  for delete to authenticated using (bucket_id = 'producto-imagenes');
