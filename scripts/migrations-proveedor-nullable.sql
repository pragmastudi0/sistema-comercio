-- Migración: productos.proveedor_id nullable + ON DELETE SET NULL
--
-- Motivo (2026-08-03):
--   Agus reportó dos problemas relacionados:
--     1) No puede borrar proveedores que ya no usa porque están
--        asociados a productos (Postgres rechaza el DELETE por
--        integridad referencial con RESTRICT).
--     2) No puede asignar "Ninguno" a un producto porque la columna
--        es NOT NULL en BD.
--
-- Ambos se resuelven con:
--   a) proveedor_id nullable
--   b) FK con ON DELETE SET NULL (borrar proveedor → productos
--      quedan con proveedor NULL automáticamente, sin bloquear
--      el delete).
--
-- Ejecutar UNA vez en Supabase Dashboard → SQL Editor. Es
-- no-destructivo: no borra data, solo relaja constraints.

BEGIN;

-- 1) Permitir NULL en la columna
ALTER TABLE public.productos
  ALTER COLUMN proveedor_id DROP NOT NULL;

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
                    AND attname = 'proveedor_id');

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
  ADD CONSTRAINT productos_proveedor_id_fkey
  FOREIGN KEY (proveedor_id)
  REFERENCES public.proveedores(id)
  ON DELETE SET NULL;

COMMIT;

-- Verificación (correr aparte después del COMMIT):
--   SELECT is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'productos' AND column_name = 'proveedor_id';
--   -- Esperado: is_nullable = 'YES'
--
--   SELECT confdeltype
--   FROM pg_constraint
--   WHERE conname = 'productos_proveedor_id_fkey';
--   -- Esperado: confdeltype = 'n' (SET NULL)
