-- Migración: pedidos_web — pedidos que llegan desde el catálogo web mayorista
--
-- Motivo (2026-08-XX):
--   Etapa 2 del ecommerce dejó el flujo del cliente: arma pedido en la web
--   → click "Enviar" → se manda mensaje de WhatsApp al comercio. Pero
--   NO quedaba registro en el sistema. Este módulo cierra el ciclo:
--     - El pedido se guarda antes de mandar WhatsApp (estado pendiente).
--     - Aparece en /admin/ventas-mayoristas con badge de "nuevo".
--     - Agus lo revisa y aprueba (descuenta stock + crea venta) o rechaza.
--     - Queda historial completo con auditoría.
--
-- Ejecutar UNA vez en Supabase Dashboard → SQL Editor. No-destructivo:
-- crea tabla + policies. No toca datos existentes.

BEGIN;

-- Tabla principal de pedidos web.
--   items: snapshot completo del carrito al momento de enviar (no
--     depende de precios/stock actuales — auditable).
--   cliente_datos: snapshot de razón social + contacto + notas.
--   estado: pendiente / aprobado / rechazado / anulado.
--   venta_id: se llena cuando se aprueba (link a la venta generada).
--   procesado_por / procesado_en: para auditar quién y cuándo aprobó
--     o rechazó.
CREATE TABLE IF NOT EXISTS public.pedidos_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL,
  cliente_datos jsonb NOT NULL,
  items jsonb NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0,
  descuento_total numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  metodo_pago text,
  forma_entrega text,
  notas text,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'anulado')),
  motivo_rechazo text,
  venta_id uuid REFERENCES public.ventas(id) ON DELETE SET NULL,
  procesado_por uuid REFERENCES public.empleados(id) ON DELETE SET NULL,
  procesado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_web_estado_idx ON public.pedidos_web(estado);
CREATE INDEX IF NOT EXISTS pedidos_web_creado_en_idx ON public.pedidos_web(creado_en DESC);

-- Contador propio para numeración legible (P-0001, P-0002, ...).
-- Reutilizamos el patrón de la tabla `contadores` que ya existe.
INSERT INTO public.contadores (clave, valor)
  VALUES ('pedidos_web', 0)
  ON CONFLICT (clave) DO NOTHING;

-- Trigger para autonumerar. SECURITY DEFINER porque cuando el insert
-- lo hace `anon` desde la web pública, no tiene permisos sobre
-- `contadores` — la función corre con los permisos del owner que sí
-- puede actualizar el contador.
CREATE OR REPLACE FUNCTION public.trg_pedidos_web_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    UPDATE public.contadores
       SET valor = valor + 1
     WHERE clave = 'pedidos_web'
     RETURNING valor INTO NEW.numero;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_web_numero ON public.pedidos_web;
CREATE TRIGGER trg_pedidos_web_numero
  BEFORE INSERT ON public.pedidos_web
  FOR EACH ROW EXECUTE FUNCTION public.trg_pedidos_web_numero();

ALTER TABLE public.pedidos_web ENABLE ROW LEVEL SECURITY;

-- El cliente en la web pública (anon) puede INSERTAR pedidos, pero NO
-- puede leer ni modificar (no debe ver pedidos de otros clientes).
-- Los usuarios autenticados (empleados del comercio) pueden todo.
DROP POLICY IF EXISTS pedidos_web_anon_insert ON public.pedidos_web;
CREATE POLICY pedidos_web_anon_insert
  ON public.pedidos_web
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS pedidos_web_auth_all ON public.pedidos_web;
CREATE POLICY pedidos_web_auth_all
  ON public.pedidos_web
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Supabase NO da GRANTs automáticos a anon/authenticated en tablas
-- creadas por SQL raw en el SQL Editor — solo el owner tiene acceso.
-- Sin estos GRANTs, aunque las RLS policies existan, el request desde
-- el cliente falla con "permission denied for table pedidos_web".
GRANT INSERT ON public.pedidos_web TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.pedidos_web TO authenticated;
-- El trigger de numeración usa la secuencia implícita — no requiere
-- grants extra sobre `contadores` porque corre como SECURITY DEFINER
-- del owner de la función.

-- RPC para crear pedido desde anon.
--
-- Por qué RPC y no INSERT directo desde el cliente:
--   El cliente hace `.insert(...).select('*').single()` para tener la
--   fila (numero autogenerado, id, etc). Ese `.select` compila a
--   INSERT ... RETURNING *, y RETURNING evalúa la policy SELECT.
--   Anon NO tiene policy SELECT (a propósito — no queremos que anon
--   lea pedidos ajenos), así que Postgres rechaza con
--   "new row violates row-level security policy" — mensaje engañoso,
--   el problema es el SELECT del RETURNING, no el INSERT.
--
--   La RPC bypasea RLS con SECURITY DEFINER, hace el INSERT, y
--   devuelve la fila. El anon puede EJECUTAR la RPC (GRANT EXECUTE)
--   pero no puede leer la tabla arbitrariamente.
CREATE OR REPLACE FUNCTION public.rpc_crear_pedido_web(
  p_cliente_datos jsonb,
  p_items jsonb,
  p_subtotal numeric,
  p_descuento_total numeric,
  p_total numeric,
  p_metodo_pago text,
  p_forma_entrega text,
  p_notas text DEFAULT NULL
)
RETURNS public.pedidos_web
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nuevo public.pedidos_web;
BEGIN
  INSERT INTO public.pedidos_web (
    cliente_datos, items, subtotal, descuento_total, total,
    metodo_pago, forma_entrega, notas
  )
  VALUES (
    p_cliente_datos, p_items, p_subtotal, p_descuento_total, p_total,
    p_metodo_pago, p_forma_entrega, p_notas
  )
  RETURNING * INTO nuevo;
  RETURN nuevo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_crear_pedido_web(
  jsonb, jsonb, numeric, numeric, numeric, text, text, text
) TO anon, authenticated;

COMMIT;

-- Verificación (correr aparte):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'pedidos_web' ORDER BY ordinal_position;
--
--   SELECT * FROM public.contadores WHERE clave = 'pedidos_web';
--   -- Esperado: valor = 0 (o el número del último pedido si ya hubo).
