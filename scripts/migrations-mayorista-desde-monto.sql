-- Migración: umbral de monto para aplicar precio mayorista
--
-- Motivo (2026-08-22):
--   El catálogo web mostraba siempre el precio mayorista, sin importar
--   el subtotal del carrito. Esto exponía precios bajos a compras
--   pequeñas que no calificaban como mayorista.
--
--   Nueva regla: si el subtotal del carrito < mayorista_desde_monto,
--   se recalcula todo al precio local (CF) y se muestra un banner
--   "Te faltan $X para el precio mayorista". Al superar el umbral,
--   los precios cambian solos.
--
-- Ejecutar UNA vez en Supabase → SQL Editor. No-destructivo.

BEGIN;

ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS mayorista_desde_monto numeric NOT NULL DEFAULT 0;

-- Sanity: valor no negativo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuracion_empresa_mayorista_desde_monto_nonneg'
  ) THEN
    ALTER TABLE public.configuracion_empresa
      ADD CONSTRAINT configuracion_empresa_mayorista_desde_monto_nonneg
      CHECK (mayorista_desde_monto >= 0);
  END IF;
END $$;

COMMIT;

-- Verificación (correr aparte):
--   SELECT empresa_id, descuento_mayorista_pct, mayorista_desde_monto
--   FROM public.configuracion_empresa;
