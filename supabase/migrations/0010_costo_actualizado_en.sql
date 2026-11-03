-- =============================================================
-- Trazabilidad: cuándo se cambió el costo del producto por última vez
-- =============================================================
-- Misma idea que la migración 0009 (que trackea precios), pero ahora
-- sobre `productos.costo`. Útil para detectar costos desactualizados —
-- típico cuando los precios subieron pero el costo no se actualizó
-- y la ganancia bruta del dashboard sale mal.
--
-- Para filas existentes, llenamos con `now()`. A partir de acá, cada
-- UPDATE que MODIFIQUE el costo refresca la columna automáticamente.
-- =============================================================

alter table productos
  add column if not exists costo_actualizado_en timestamptz not null default now();

create or replace function set_costo_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  -- Solo actualiza el timestamp si el costo realmente cambia.
  -- Así un UPDATE que solo cambia el nombre/descripción no ensucia el
  -- dato de "última vez que se tocó el costo".
  if new.costo is distinct from old.costo then
    new.costo_actualizado_en := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_costo_actualizado_en on productos;
create trigger trg_costo_actualizado_en
  before update on productos
  for each row
  execute function set_costo_actualizado_en();
