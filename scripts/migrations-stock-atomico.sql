-- Migración: aplicar delta de stock atómico + signo real en ajustes
--
-- Motivo (2026-08-10):
--   Dos problemas de datos en el flujo de stock:
--
--   1) Race condition en aplicarDeltaStock:
--      El helper JS hacía SELECT cantidad → cantidad + delta → UPDATE
--      en 3 pasos separados. Si dos operaciones (ventas o transferencias)
--      tocaban el mismo (producto, depósito) casi simultáneamente,
--      ambas leían el mismo valor viejo, calculaban por su lado y
--      escribían — se perdía uno de los deltas ("lost update").
--      Poco probable pero real, sobre todo con 2 locales activos.
--
--   2) Ajustes guardaban Math.abs(cantidad) sin el signo:
--      Ver stock.repo.ts. Al momento de auditar (¿este ajuste sumó
--      o restó?) era imposible saberlo desde la BD. El motivo a veces
--      lo aclaraba ("Corrección", "Merma"), a veces no ("pase al depo"
--      podía ser + o −). El fix en TS guarda el signo real; los viejos
--      quedan como están (irreconstruibles).
--
-- Esta migración crea `rpc_aplicar_delta_stock`, una función Postgres
-- que hace SELECT ... FOR UPDATE + UPDATE dentro de la misma transacción
-- implícita, eliminando la race condition de raíz. El helper JS pasa
-- a ser un wrapper que llama a esta RPC.
--
-- Todo esto es back-end. Ningún cambio para PoS / caja / ventas /
-- admin visualmente — solo la capa de datos.
--
-- Ejecutar UNA vez en Supabase Dashboard → SQL Editor. No-destructivo:
-- crea función nueva + concede permisos. No toca tablas.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_aplicar_delta_stock(
  p_producto_id uuid,
  p_variante_id uuid,
  p_deposito_id uuid,
  p_delta numeric,
  p_permitir_negativo boolean DEFAULT true
) RETURNS TABLE(cantidad_anterior numeric, cantidad_nueva numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual numeric;
  v_nueva numeric;
BEGIN
  -- SELECT con FOR UPDATE bloquea la fila hasta el fin de esta
  -- transacción. Cualquier otra operación en paralelo sobre el mismo
  -- (producto, depósito, variante) espera acá — al terminar la primera
  -- (COMMIT implícito), la segunda relee el valor ya actualizado.
  -- Esa es la garantía atómica: no hay lost updates.
  IF p_variante_id IS NULL THEN
    SELECT cantidad INTO v_actual
    FROM stock_items
    WHERE producto_id = p_producto_id
      AND deposito_id = p_deposito_id
      AND variante_id IS NULL
    FOR UPDATE;
  ELSE
    SELECT cantidad INTO v_actual
    FROM stock_items
    WHERE producto_id = p_producto_id
      AND deposito_id = p_deposito_id
      AND variante_id = p_variante_id
    FOR UPDATE;
  END IF;

  IF v_actual IS NULL THEN
    -- No existía la fila. Insertar con el delta como valor inicial.
    v_actual := 0;
    v_nueva := p_delta;

    IF NOT p_permitir_negativo AND v_nueva < 0 THEN
      RAISE EXCEPTION
        'Stock insuficiente (actual: 0, delta: %)', p_delta
        USING ERRCODE = 'P0001';
    END IF;

    BEGIN
      INSERT INTO stock_items (producto_id, variante_id, deposito_id, cantidad)
      VALUES (p_producto_id, p_variante_id, p_deposito_id, v_nueva);
    EXCEPTION WHEN unique_violation THEN
      -- Race edge: otro proceso creó la fila entre nuestro SELECT y este
      -- INSERT (poco probable, pero posible sin lock predicativo).
      -- Releemos con lock y hacemos UPDATE.
      IF p_variante_id IS NULL THEN
        SELECT cantidad INTO v_actual
        FROM stock_items
        WHERE producto_id = p_producto_id
          AND deposito_id = p_deposito_id
          AND variante_id IS NULL
        FOR UPDATE;
      ELSE
        SELECT cantidad INTO v_actual
        FROM stock_items
        WHERE producto_id = p_producto_id
          AND deposito_id = p_deposito_id
          AND variante_id = p_variante_id
        FOR UPDATE;
      END IF;
      v_nueva := v_actual + p_delta;

      IF NOT p_permitir_negativo AND v_nueva < 0 THEN
        RAISE EXCEPTION
          'Stock insuficiente (actual: %, delta: %)', v_actual, p_delta
          USING ERRCODE = 'P0001';
      END IF;

      IF p_variante_id IS NULL THEN
        UPDATE stock_items SET cantidad = v_nueva
        WHERE producto_id = p_producto_id
          AND deposito_id = p_deposito_id
          AND variante_id IS NULL;
      ELSE
        UPDATE stock_items SET cantidad = v_nueva
        WHERE producto_id = p_producto_id
          AND deposito_id = p_deposito_id
          AND variante_id = p_variante_id;
      END IF;
    END;
  ELSE
    v_nueva := v_actual + p_delta;

    IF NOT p_permitir_negativo AND v_nueva < 0 THEN
      RAISE EXCEPTION
        'Stock insuficiente (actual: %, delta: %)', v_actual, p_delta
        USING ERRCODE = 'P0001';
    END IF;

    IF p_variante_id IS NULL THEN
      UPDATE stock_items SET cantidad = v_nueva
      WHERE producto_id = p_producto_id
        AND deposito_id = p_deposito_id
        AND variante_id IS NULL;
    ELSE
      UPDATE stock_items SET cantidad = v_nueva
      WHERE producto_id = p_producto_id
        AND deposito_id = p_deposito_id
        AND variante_id = p_variante_id;
    END IF;
  END IF;

  RETURN QUERY SELECT v_actual, v_nueva;
END;
$$;

-- Los usuarios `authenticated` (empleados logueados) usan la función
-- desde el cliente. Permiso EXECUTE es necesario para llamarla vía RPC.
GRANT EXECUTE ON FUNCTION public.rpc_aplicar_delta_stock(uuid, uuid, uuid, numeric, boolean) TO authenticated;

COMMIT;

-- Verificación (correr aparte después del COMMIT):
--   SELECT proname, pg_get_function_arguments(oid)
--   FROM pg_proc
--   WHERE proname = 'rpc_aplicar_delta_stock';
--   -- Debe listar la función con sus 5 parámetros.
--
--   -- Prueba en vivo (elegir un producto/depósito real, delta 0 para
--   -- no afectar stock):
--   SELECT * FROM rpc_aplicar_delta_stock(
--     '<producto_uuid>'::uuid,
--     NULL,
--     '<deposito_uuid>'::uuid,
--     0,
--     true
--   );
--   -- Debe devolver la cantidad actual en ambas columnas.
