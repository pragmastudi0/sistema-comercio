-- =============================================================
-- Migraciones SQL — iteración 7 post go-live
-- =============================================================
-- Correr en Supabase → SQL Editor antes de mergear la rama
-- feat/responsable-caja-por-turno. Idempotente (IF NOT EXISTS).
-- =============================================================

-- 1. Nueva columna sesiones_caja.empleado_actual_id
--    Guarda quién es el responsable ACTUAL de la caja después de un
--    "Cambiar usuario". Null cuando nunca hubo cambio (usar empleado_id
--    como fallback). Se llena/actualiza cada vez que un empleado nuevo
--    toma la posta desde el PoS sin cerrar la caja.
alter table sesiones_caja
  add column if not exists empleado_actual_id uuid
  references empleados(id) on delete restrict;

-- Index chico para las consultas del admin (buscar por responsable actual).
create index if not exists sesiones_caja_emp_actual_idx
  on sesiones_caja(empleado_actual_id)
  where empleado_actual_id is not null;
