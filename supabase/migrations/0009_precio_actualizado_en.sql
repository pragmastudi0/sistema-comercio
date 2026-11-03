-- =============================================================
-- Trazabilidad: cuándo se cambió el precio por última vez
-- =============================================================
-- Agrega `actualizado_en` a `producto_lista_precio` para que el admin
-- pueda mostrar "última actualización: hace X días" en el detalle del
-- producto. Útil para detectar precios desactualizados sin tener que
-- hacer auditoría manual.
--
-- Para filas ya existentes, llenamos con `now()` (es lo único que
-- podemos hacer sin un audit log previo). A partir de acá, cada UPDATE
-- de la fila refresca la columna automáticamente vía trigger.
-- =============================================================

alter table producto_lista_precio
  add column if not exists actualizado_en timestamptz not null default now();

-- Trigger BEFORE UPDATE para mantener `actualizado_en` siempre fresco
-- sin tener que recordarlo en cada repo/llamada.
create or replace function set_precio_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  -- Solo actualiza el timestamp si las escalas (el precio real) cambian.
  -- Así un UPDATE que solo "toca" la fila sin cambiar el precio no
  -- ensucia el dato.
  if new.escalas is distinct from old.escalas then
    new.actualizado_en := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_precio_actualizado_en on producto_lista_precio;
create trigger trg_precio_actualizado_en
  before update on producto_lista_precio
  for each row
  execute function set_precio_actualizado_en();
