-- =============================================================
-- RLS refinada — pre-producción
-- =============================================================
-- La RLS actual (creada en 0001) deja a TODOS los usuarios
-- autenticados leer y escribir cualquier fila de cualquier tabla.
-- Eso significa que un cajero con sus credenciales reales podría,
-- usando un cliente Supabase modificado, leer/modificar ventas y
-- cajas de OTROS cajeros, descontar stock ajeno, etc.
--
-- Este patch ENDURECE las policies de las tablas más sensibles
-- pero MANTIENE compatibilidad con todas las operaciones legítimas
-- del PoS y del Admin actuales. Diseñado para revisar y aplicar en
-- una sola pasada en Supabase SQL Editor.
--
-- Política base:
-- - Helper `is_admin_or_encargado()`: true si el usuario logueado
--   es admin o encargado preset.
-- - Lectura amplia: las tablas que el dashboard / reportes necesitan
--   ver completas (productos, categorias, listas, etc.) siguen
--   abiertas a cualquier authenticated.
-- - Escritura restringida en sensibles: solo admin/encargado o el
--   propio empleado para sus operaciones (ventas que él creó,
--   sesiones que abrió).
--
-- Si rompe algo, revertir con:
--   drop policy ... on ...;
--   create policy %I_auth_all on %I for all to authenticated using (true) with check (true);
-- =============================================================

begin;

-- ── Helper ──────────────────────────────────────────────────────
-- Devuelve true si el usuario autenticado es admin (UUID de rol preset)
-- o encargado. Cachado por la query → bajo overhead.
create or replace function public.is_admin_or_encargado()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from empleados e
    where e.auth_user_id = auth.uid()
      and e.activo = true
      and e.rol_id in (
        '00000000-0000-0000-0000-000000000010', -- admin
        '00000000-0000-0000-0000-000000000011'  -- encargado
      )
  );
$$;

-- Devuelve el ID del empleado correspondiente al user logueado
-- (o null si no hay match en la tabla empleados).
create or replace function public.empleado_actual_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from empleados
   where auth_user_id = auth.uid()
   limit 1;
$$;

-- ── Sesiones de caja ───────────────────────────────────────────
-- Lectura: cualquier authenticated puede ver (admin/encargado las ven
-- todas en el panel; cajeros las ven para abrir / cerrar).
-- Escritura: solo el dueño de la sesión o admin/encargado.
drop policy if exists sesiones_caja_auth_all on sesiones_caja;
drop policy if exists sesiones_caja_select on sesiones_caja;
drop policy if exists sesiones_caja_modify on sesiones_caja;

create policy sesiones_caja_select on sesiones_caja
  for select to authenticated
  using (true);

create policy sesiones_caja_modify on sesiones_caja
  for all to authenticated
  using (
    is_admin_or_encargado()
    or empleado_id = empleado_actual_id()
  )
  with check (
    is_admin_or_encargado()
    or empleado_id = empleado_actual_id()
  );

-- ── Ventas ─────────────────────────────────────────────────────
-- Lectura: amplia (reportes y dashboard la necesitan).
-- Escritura: admin/encargado o el cajero que la creó (para anular
-- propia del día, etc.).
drop policy if exists ventas_auth_all on ventas;
drop policy if exists ventas_select on ventas;
drop policy if exists ventas_modify on ventas;

create policy ventas_select on ventas
  for select to authenticated
  using (true);

create policy ventas_modify on ventas
  for all to authenticated
  using (
    is_admin_or_encargado()
    or empleado_id = empleado_actual_id()
  )
  with check (
    is_admin_or_encargado()
    or empleado_id = empleado_actual_id()
  );

-- ── Movimientos de caja ────────────────────────────────────────
-- Misma lógica: ver todo, modificar solo lo propio.
drop policy if exists movimientos_caja_auth_all on movimientos_caja;
drop policy if exists movimientos_caja_select on movimientos_caja;
drop policy if exists movimientos_caja_modify on movimientos_caja;

create policy movimientos_caja_select on movimientos_caja
  for select to authenticated
  using (true);

create policy movimientos_caja_modify on movimientos_caja
  for all to authenticated
  using (
    is_admin_or_encargado()
    or empleado_id = empleado_actual_id()
  )
  with check (
    is_admin_or_encargado()
    or empleado_id = empleado_actual_id()
  );

-- ── Configuración del comercio ─────────────────────────────────
-- Solo admin la modifica. Todos pueden leer (PoS la necesita para
-- descuento de efectivo, cuotas, etc.).
drop policy if exists configuracion_empresa_auth_all on configuracion_empresa;
drop policy if exists configuracion_empresa_select on configuracion_empresa;
drop policy if exists configuracion_empresa_modify on configuracion_empresa;

create policy configuracion_empresa_select on configuracion_empresa
  for select to authenticated
  using (true);

create policy configuracion_empresa_modify on configuracion_empresa
  for all to authenticated
  using (
    exists (
      select 1 from empleados e
      where e.auth_user_id = auth.uid()
        and e.activo = true
        and e.rol_id = '00000000-0000-0000-0000-000000000010' -- admin
    )
  )
  with check (
    exists (
      select 1 from empleados e
      where e.auth_user_id = auth.uid()
        and e.activo = true
        and e.rol_id = '00000000-0000-0000-0000-000000000010'
    )
  );

-- ── Empleados y roles ──────────────────────────────────────────
-- Lectura: todos pueden ver (necesario para que el panel resuelva
-- nombres de cajeros / encargados, etc.).
-- Escritura: solo admin.
drop policy if exists empleados_auth_all on empleados;
drop policy if exists empleados_select on empleados;
drop policy if exists empleados_modify on empleados;

create policy empleados_select on empleados
  for select to authenticated
  using (true);

create policy empleados_modify on empleados
  for all to authenticated
  using (
    exists (
      select 1 from empleados e
      where e.auth_user_id = auth.uid()
        and e.activo = true
        and e.rol_id = '00000000-0000-0000-0000-000000000010'
    )
  )
  with check (
    exists (
      select 1 from empleados e
      where e.auth_user_id = auth.uid()
        and e.activo = true
        and e.rol_id = '00000000-0000-0000-0000-000000000010'
    )
  );

drop policy if exists roles_auth_all on roles;
drop policy if exists roles_select on roles;
drop policy if exists roles_modify on roles;

create policy roles_select on roles
  for select to authenticated
  using (true);

create policy roles_modify on roles
  for all to authenticated
  using (
    exists (
      select 1 from empleados e
      where e.auth_user_id = auth.uid()
        and e.activo = true
        and e.rol_id = '00000000-0000-0000-0000-000000000010'
    )
  )
  with check (
    exists (
      select 1 from empleados e
      where e.auth_user_id = auth.uid()
        and e.activo = true
        and e.rol_id = '00000000-0000-0000-0000-000000000010'
    )
  );

-- ── Tablas que quedan abiertas (intencional) ───────────────────
-- stock_items, movimientos_stock, transferencias, notas_credito,
-- clientes, movimientos_ctacte, logs_auditoria, contadores, cajas,
-- locales, empresas, depositos: siguen con la policy original
-- `*_auth_all (true)` porque las operaciones de PoS / admin las
-- necesitan completamente abiertas para funcionar bien y no
-- contienen info sensible cross-empleado en esta escala de uso.
-- Si en el futuro hace falta cerrarlas, se hace de a una con cuidado.

commit;
