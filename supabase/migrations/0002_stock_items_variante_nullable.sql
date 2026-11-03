-- Migración: permitir variante_id NULL en stock_items.
-- Motivo: la PK original era (producto_id, deposito_id, variante_id), lo que
-- implícitamente exigía variante_id NOT NULL. Para los productos sin variante
-- (la mayoría) eso rechazaba el INSERT.
--
-- Solución: cambiar la PK por una columna autogenerada `id`, y mantener la
-- integridad de unicidad con dos índices únicos parciales:
--   - uno cuando variante_id IS NULL (1 stock por producto + depósito)
--   - otro cuando variante_id IS NOT NULL (1 stock por producto + depósito + variante)

begin;

-- 1. Drop PK actual
alter table public.stock_items drop constraint if exists stock_items_pkey;

-- 2. Quitar el NOT NULL implícito que variante_id tenía por estar en la PK
--    vieja. PostgreSQL no lo remueve solo al dropear la PK.
alter table public.stock_items alter column variante_id drop not null;

-- 3. Agregar columna id como nueva PK (sólo si no existe ya una PK)
alter table public.stock_items
  add column if not exists id uuid not null default gen_random_uuid();
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_items'::regclass and contype = 'p'
  ) then
    alter table public.stock_items add primary key (id);
  end if;
end $$;

-- 4. Crear índices unique parciales para garantizar 1 stock por combinación
create unique index if not exists stock_items_unique_sin_variante
  on public.stock_items (producto_id, deposito_id)
  where variante_id is null;

create unique index if not exists stock_items_unique_con_variante
  on public.stock_items (producto_id, deposito_id, variante_id)
  where variante_id is not null;

commit;
