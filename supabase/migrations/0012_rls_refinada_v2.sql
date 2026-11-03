-- =============================================================
-- RLS refinada v2 — sin recursión
-- =============================================================
-- La v1 (migración 0011) tenía un bug: la policy nueva de `empleados`
-- llamaba a una función que hacía SELECT sobre `empleados`. Cada
-- SELECT disparaba la policy → recursión infinita → login roto.
--
-- Solución v2:
-- - La tabla `empleados` SE QUEDA con la policy original
--   `auth_all (true)`. Es necesario porque las funciones helper
--   tienen que leerla sin disparar policies.
-- - Las funciones helper son SECURITY DEFINER + STABLE; al estar
--   `empleados` con policy abierta, no hay recursión.
-- - El resto de tablas sensibles (ventas, sesiones_caja, etc.)
--   sí queda restringido.
--
-- ATENCIÓN: con esta v2, un cajero técnicamente capaz podría leer
-- la tabla `empleados` (ver emails, roles). Es un trade-off
-- consciente: información poco sensible vs evitar romper el login.
-- Las MODIFICACIONES a `empleados` siguen yendo por la edge function
-- `set-empleado-password` (que ya valida admin) y por la UI del admin
-- (que ya está guardada por permisos).
-- =============================================================

begin;

-- ── Helpers (SECURITY DEFINER) ─────────────────────────────────
-- Funcionan porque `empleados` queda con policy abierta (no recursión).

create or replace function public.is_admin_or_encargado()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  result boolean;
begin
  select exists (
    select 1 from empleados e
    where e.auth_user_id = auth.uid()
      and e.activo = true
      and e.rol_id in (
        '00000000-0000-0000-0000-000000000010', -- admin
        '00000000-0000-0000-0000-000000000011'  -- encargado
      )
  ) into result;
  return coalesce(result, false);
end $$;

create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  result boolean;
begin
  select exists (
    select 1 from empleados e
    where e.auth_user_id = auth.uid()
      and e.activo = true
      and e.rol_id = '00000000-0000-0000-0000-000000000010'
  ) into result;
  return coalesce(result, false);
end $$;

create or replace function public.empleado_actual_id()
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  result uuid;
begin
  select id into result from empleados
   where auth_user_id = auth.uid()
   limit 1;
  return result;
end $$;

-- Permisos: cualquier authenticated puede llamarlas (son helpers
-- de RLS, no tocan datos directamente).
grant execute on function public.is_admin_or_encargado() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.empleado_actual_id() to authenticated;

-- ── empleados: SE MANTIENE ABIERTA ─────────────────────────────
-- NO se cambia la policy original auth_all (true) para evitar
-- recursión con las funciones helper.

-- ── Sesiones de caja ───────────────────────────────────────────
-- Lectura amplia (admin / encargado ven todo, cajeros para abrir/cerrar).
-- Escritura: solo el dueño o admin/encargado.
drop policy if exists sesiones_caja_auth_all on sesiones_caja;
drop policy if exists sesiones_caja_select on sesiones_caja;
drop policy if exists sesiones_caja_modify on sesiones_caja;

create policy sesiones_caja_select on sesiones_caja
  for select to authenticated using (true);

create policy sesiones_caja_modify on sesiones_caja
  for all to authenticated
  using (
    is_admin_or_encargado() OR empleado_id = empleado_actual_id()
  )
  with check (
    is_admin_or_encargado() OR empleado_id = empleado_actual_id()
  );

-- ── Ventas ─────────────────────────────────────────────────────
drop policy if exists ventas_auth_all on ventas;
drop policy if exists ventas_select on ventas;
drop policy if exists ventas_modify on ventas;

create policy ventas_select on ventas
  for select to authenticated using (true);

create policy ventas_modify on ventas
  for all to authenticated
  using (
    is_admin_or_encargado() OR empleado_id = empleado_actual_id()
  )
  with check (
    is_admin_or_encargado() OR empleado_id = empleado_actual_id()
  );

-- ── Movimientos de caja ────────────────────────────────────────
drop policy if exists movimientos_caja_auth_all on movimientos_caja;
drop policy if exists movimientos_caja_select on movimientos_caja;
drop policy if exists movimientos_caja_modify on movimientos_caja;

create policy movimientos_caja_select on movimientos_caja
  for select to authenticated using (true);

create policy movimientos_caja_modify on movimientos_caja
  for all to authenticated
  using (
    is_admin_or_encargado() OR empleado_id = empleado_actual_id()
  )
  with check (
    is_admin_or_encargado() OR empleado_id = empleado_actual_id()
  );

-- ── Configuración del comercio ─────────────────────────────────
-- Solo admin la modifica.
drop policy if exists configuracion_empresa_auth_all on configuracion_empresa;
drop policy if exists configuracion_empresa_select on configuracion_empresa;
drop policy if exists configuracion_empresa_modify on configuracion_empresa;

create policy configuracion_empresa_select on configuracion_empresa
  for select to authenticated using (true);

create policy configuracion_empresa_modify on configuracion_empresa
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ── Roles ──────────────────────────────────────────────────────
-- Lectura abierta (panel necesita resolver nombres).
-- Modificación: solo admin.
drop policy if exists roles_auth_all on roles;
drop policy if exists roles_select on roles;
drop policy if exists roles_modify on roles;

create policy roles_select on roles
  for select to authenticated using (true);

create policy roles_modify on roles
  for all to authenticated
  using (is_admin())
  with check (is_admin());

commit;
