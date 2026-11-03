-- Migración: productos.categoria_id nullable + ON DELETE SET NULL
--
-- Motivo (2026-08-06):
--   Agus reportó que al elegir "— Ninguna —" en el select de categoría
--   de un producto, no se guarda. Mismo escenario que ya arreglamos
--   con proveedor_id en agosto:
--     1) La columna es NOT NULL en BD → aunque el UPDATE mande null
--        Postgres lo rechaza.
--     2) El código mandaba `|| undefined` → PostgREST ni siquiera
--        incluye la columna en el UPDATE → el valor viejo persiste.
--
-- Fix en dos partes:
--   a) BD: categoria_id nullable + FK con ON DELETE SET NULL
--      (borrar una categoría → productos que la tenían quedan sin
--      categoría automáticamente, no rompe integridad).
--   b) Código: cambiar `|| undefined` a `|| null` en /admin/productos
--      (commit aparte).
--
-- Ejecutar UNA vez en Supabase Dashboard → SQL Editor. No-destructivo:
-- solo relaja constraints, no borra data.

BEGIN;

-- 1) Permitir NULL en la columna
ALTER TABLE public.productos
  ALTER COLUMN categoria_id DROP NOT NULL;

-- 2) Reemplazar la FK actual por una con ON DELETE SET NULL.
--    El nombre puede variar según cómo se creó originalmente.
--    Detectamos el nombre dinámicamente y lo dropeamos.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'public.productos'::regclass
    AND contype = 'f'
    AND conkey = (SELECT array_agg(attnum)
                  FROM pg_attribute
                  WHERE attrelid = 'public.productos'::regclass
                    AND attname = 'categoria_id');

  IF fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.productos DROP CONSTRAINT %I',
      fk_name
    );
    RAISE NOTICE 'FK vieja "%s" dropeada.', fk_name;
  END IF;
END $$;

-- 3) Crear la nueva FK con ON DELETE SET NULL
ALTER TABLE public.productos
  ADD CONSTRAINT productos_categoria_id_fkey
  FOREIGN KEY (categoria_id)
  REFERENCES public.categorias(id)
  ON DELETE SET NULL;

COMMIT;

-- Verificación (correr aparte después del COMMIT):
--   SELECT is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'productos' AND column_name = 'categoria_id';
--   -- Esperado: is_nullable = 'YES'
--
--   SELECT confdeltype
--   FROM pg_constraint
--   WHERE conname = 'productos_categoria_id_fkey';
--   -- Esperado: confdeltype = 'n' (SET NULL)
