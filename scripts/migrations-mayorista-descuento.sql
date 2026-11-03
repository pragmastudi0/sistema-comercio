-- Migración: descuento mayorista global + override por producto
--
-- Motivo (2026-08-05):
--   Etapa 2 e-commerce. La web (turisteando-web) apunta a clientes
--   mayoristas que hacen pedidos por WhatsApp. Se aplica un
--   descuento sobre el precio Consumidor Final (CF) para mostrar
--   precios mayoristas en el catálogo público.
--
-- Modelo:
--   - Configuración global (configuracion_empresa.descuento_mayorista_pct):
--     % de descuento sobre CF que aplica por default a todos los
--     productos publicados en la web. Ej: 30 = 30% off.
--   - Override por producto (productos.descuento_mayorista_pct_override):
--     Si está seteado, gana sobre el global. Nullable para "usar global".
--   - Escalas por cantidad (configuracion_empresa.escalas_mayorista_cantidad):
--     JSONB opcional con formato [{desde:1, pct:30}, {desde:10, pct:35}, ...]
--     Se aplican en el carrito según cantidad. Sobre el mayorista base.
--
-- Todo esto es SOLO para la web pública. El PoS y admin siguen
-- trabajando con CF sin cambios.
--
-- Ejecutar UNA vez en Supabase Dashboard → SQL Editor. No-destructivo:
-- solo agrega columnas nullables con defaults sensatos.

BEGIN;

-- 1) Descuento mayorista global (default 0 = sin descuento)
ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS descuento_mayorista_pct numeric NOT NULL DEFAULT 0;

-- 2) Escalas por cantidad para mayoristas (opcional)
--    Formato: [{"desde": 10, "pct": 35}, {"desde": 30, "pct": 40}]
--    Vacío/null = solo aplica el descuento global sin escalonar
ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS escalas_mayorista_cantidad jsonb;

-- 3) Override por producto (nullable — null = usar el global)
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS descuento_mayorista_pct_override numeric;

-- 3.b) Nombre alternativo para mostrar en la tienda web (opcional).
--     Sirve cuando internamente Agus usa un nombre raro para diferenciar
--     ("Valija PLC 20 rosa CH3" en el sistema pero "Valija cabina rosa"
--     en la web). Si está null, la web usa `nombre`.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS nombre_web text;

-- 4) Constraint sanity: los % deben estar entre 0 y 100
ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS productos_descuento_mayorista_override_range;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_descuento_mayorista_override_range
  CHECK (
    descuento_mayorista_pct_override IS NULL
    OR (descuento_mayorista_pct_override >= 0 AND descuento_mayorista_pct_override <= 100)
  );

ALTER TABLE public.configuracion_empresa
  DROP CONSTRAINT IF EXISTS config_descuento_mayorista_range;
ALTER TABLE public.configuracion_empresa
  ADD CONSTRAINT config_descuento_mayorista_range
  CHECK (descuento_mayorista_pct >= 0 AND descuento_mayorista_pct <= 100);

COMMIT;

-- Verificación (correr aparte):
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'productos'
--     AND column_name = 'descuento_mayorista_pct_override';
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'configuracion_empresa'
--     AND column_name IN ('descuento_mayorista_pct', 'escalas_mayorista_cantidad');
