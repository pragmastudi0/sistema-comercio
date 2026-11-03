-- =============================================================
-- Permitir venta con stock negativo
-- =============================================================
-- El cliente arrastra del sistema anterior productos con stock
-- negativo (típico de sistemas viejos que permitían vender sin
-- stock). Decisión operativa: respetar los negativos y SEGUIR
-- permitiendo venta aunque el stock quede más negativo todavía.
--
-- Cambio: la RPC `rpc_crear_venta` deja de tirar "Stock insuficiente".
-- Simplemente descuenta sin validar — el stock puede ir tan negativo
-- como sea necesario. Sigue contemplando el caso null (fila inexistente
-- → la crea con cantidad 0 antes de descontar).
-- =============================================================

create or replace function rpc_crear_venta(
  p_caja_id          uuid,
  p_sesion_caja_id   uuid,
  p_local_id         uuid,
  p_deposito_id      uuid,
  p_empleado_id      uuid,
  p_cliente_id       uuid,
  p_items            jsonb,
  p_pagos            jsonb,
  p_subtotal         numeric,
  p_descuento_total  numeric,
  p_recargo_total    numeric,
  p_total            numeric
) returns ventas
language plpgsql security definer
as $$
declare
  v_id      bigint;
  v_numero  text;
  v_item    jsonb;
  v_venta   ventas%rowtype;
  v_pago    jsonb;
  v_stock   numeric;
begin
  -- Numerar
  update contadores set valor = valor + 1 where clave = 'ventas' returning valor into v_id;
  v_numero := '0001-' || lpad(v_id::text, 8, '0');

  -- 1) Validar existencia de fila y descontar stock (SIN bloquear por insuficiencia)
  for v_item in select * from jsonb_array_elements(p_items) loop
    select cantidad into v_stock
      from stock_items
     where producto_id = (v_item->>'producto_id')::uuid
       and deposito_id = p_deposito_id
       for update;

    if v_stock is null then
      -- Si no había fila para este producto en el depósito, la creamos
      -- en 0 antes de descontar (el resultado va a ser negativo).
      insert into stock_items(producto_id, deposito_id, cantidad)
        values ((v_item->>'producto_id')::uuid, p_deposito_id, 0);
    end if;

    -- Descontar SIN validar suficiencia. El stock puede quedar negativo
    -- — decisión operativa del cliente Turisteando.
    update stock_items
       set cantidad = cantidad - (v_item->>'cantidad')::numeric
     where producto_id = (v_item->>'producto_id')::uuid
       and deposito_id = p_deposito_id;
  end loop;

  -- 2) Insertar la venta
  insert into ventas(
    numero, caja_id, sesion_caja_id, local_id, deposito_id, empleado_id,
    cliente_id, items, pagos, subtotal, descuento_total, recargo_total, total
  ) values (
    v_numero, p_caja_id, p_sesion_caja_id, p_local_id, p_deposito_id, p_empleado_id,
    p_cliente_id, p_items, p_pagos, p_subtotal, p_descuento_total, p_recargo_total, p_total
  ) returning * into v_venta;

  -- 3) Registrar movimientos de stock (venta)
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into movimientos_stock(producto_id, deposito_id, tipo, cantidad, referencia_id, empleado_id)
    values (
      (v_item->>'producto_id')::uuid,
      p_deposito_id,
      'venta',
      (v_item->>'cantidad')::numeric,
      v_venta.id,
      p_empleado_id
    );
  end loop;

  -- 4) Registrar movimientos de caja por cada método de pago
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into movimientos_caja(
      sesion_caja_id, tipo, metodo, monto, venta_id, empleado_id
    ) values (
      p_sesion_caja_id,
      case
        when (v_pago->>'metodo') = 'cta_cte' then 'venta_cta_cte'::tipo_movimiento_caja
        else 'venta'::tipo_movimiento_caja
      end,
      (v_pago->>'metodo')::metodo_pago,
      (v_pago->>'monto')::numeric,
      v_venta.id,
      p_empleado_id
    );
  end loop;

  -- 5) Si hay pago en cta cte, cargar el saldo del cliente
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    if (v_pago->>'metodo') = 'cta_cte' and p_cliente_id is not null then
      insert into movimientos_ctacte(
        cliente_id, tipo, monto, venta_id, empleado_id, descripcion
      ) values (
        p_cliente_id,
        'venta',
        (v_pago->>'monto')::numeric,
        v_venta.id,
        p_empleado_id,
        'Venta ' || v_numero
      );
      update clientes set saldo = saldo + (v_pago->>'monto')::numeric where id = p_cliente_id;
    end if;
  end loop;

  return v_venta;
end $$;
