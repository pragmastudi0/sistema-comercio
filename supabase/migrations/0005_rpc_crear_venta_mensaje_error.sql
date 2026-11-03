-- Mensaje de error de stock insuficiente con código + nombre del producto.
-- Antes mostraba el UUID crudo lo cual es ilegible para el cajero.

create or replace function rpc_crear_venta(
  p_caja_id uuid,
  p_sesion_caja_id uuid,
  p_local_id uuid,
  p_deposito_id uuid,
  p_empleado_id uuid,
  p_cliente_id uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_subtotal numeric,
  p_descuento_total numeric,
  p_recargo_total numeric,
  p_total numeric
) returns ventas
language plpgsql security definer
as $$
declare
  v_numero text;
  v_seq    integer;
  v_item   jsonb;
  v_pago   jsonb;
  v_stock  numeric;
  v_venta  ventas%rowtype;
  v_prod_cod text;
  v_prod_nom text;
  v_dep_nom  text;
begin
  -- Numerar
  update contadores set valor = valor + 1 where clave = 'ventas' returning valor into v_seq;
  v_numero := '0001-' || lpad(v_seq::text, 8, '0');

  -- 1) Validar y descontar stock por cada ítem
  for v_item in select * from jsonb_array_elements(p_items) loop
    select cantidad into v_stock
      from stock_items
     where producto_id = (v_item->>'producto_id')::uuid
       and deposito_id = p_deposito_id
       for update;

    if v_stock is null then
      insert into stock_items(producto_id, deposito_id, cantidad)
        values ((v_item->>'producto_id')::uuid, p_deposito_id, 0);
      v_stock := 0;
    end if;

    if v_stock < (v_item->>'cantidad')::numeric then
      -- Mensaje detallado con código y nombre del producto + depósito
      select codigo_interno, nombre
        into v_prod_cod, v_prod_nom
        from productos
       where id = (v_item->>'producto_id')::uuid;
      select nombre into v_dep_nom from depositos where id = p_deposito_id;
      raise exception
        'Stock insuficiente para "% (cód. %)" en %. Hay % unidades, necesitás %.',
        coalesce(v_prod_nom, '?'),
        coalesce(v_prod_cod, '?'),
        coalesce(v_dep_nom, 'el depósito'),
        v_stock,
        (v_item->>'cantidad')::numeric;
    end if;

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
        (v_item->>'producto_id')::uuid, p_deposito_id, 'venta',
        (v_item->>'cantidad')::numeric, v_venta.id, p_empleado_id
      );
  end loop;

  -- 4) Movimientos de caja por cada pago
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into movimientos_caja(sesion_caja_id, tipo, metodo, monto, venta_id, empleado_id)
      values (
        p_sesion_caja_id, 'venta',
        (v_pago->>'metodo')::metodo_pago,
        (v_pago->>'monto')::numeric,
        v_venta.id, p_empleado_id
      );

    if (v_pago->>'metodo') = 'cta_cte' and p_cliente_id is not null then
      insert into movimientos_ctacte(cliente_id, tipo, monto, venta_id, empleado_id, nota)
        values (p_cliente_id, 'cargo', (v_pago->>'monto')::numeric, v_venta.id, p_empleado_id,
                'Venta ' || v_numero);
      update clientes set saldo = saldo + (v_pago->>'monto')::numeric where id = p_cliente_id;
    end if;
  end loop;

  return v_venta;
end $$;
