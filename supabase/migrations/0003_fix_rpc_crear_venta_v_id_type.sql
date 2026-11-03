-- Fix: rpc_crear_venta declaraba v_id como uuid pero le asignaba
-- el valor entero del contador. Al castear '1'::uuid Postgres fallaba
-- con "invalid input syntax for type uuid: 1" en cualquier intento de
-- crear venta. Mismo fix para rpc_emitir_nota_credito.
--
-- También: introducimos una variable separada v_venta_id para guardar
-- el UUID generado por la fila insertada, así no mezclamos significados.

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
  v_seq    integer;  -- contador autoincremental
  v_item   jsonb;
  v_pago   jsonb;
  v_stock  numeric;
  v_venta  ventas%rowtype;
begin
  -- Numerar
  update contadores
     set valor = valor + 1
   where clave = 'ventas'
   returning valor into v_seq;
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
      raise exception 'Stock insuficiente para producto %', v_item->>'producto_id';
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

    -- Si es cta cte y hay cliente, generar cargo
    if (v_pago->>'metodo') = 'cta_cte' and p_cliente_id is not null then
      insert into movimientos_ctacte(cliente_id, tipo, monto, venta_id, empleado_id, nota)
        values (p_cliente_id, 'cargo', (v_pago->>'monto')::numeric, v_venta.id, p_empleado_id,
                'Venta ' || v_numero);
      update clientes set saldo = saldo + (v_pago->>'monto')::numeric where id = p_cliente_id;
    end if;
  end loop;

  return v_venta;
end $$;


-- Mismo fix para rpc_emitir_nota_credito (mismo patrón, mismo bug).
create or replace function rpc_emitir_nota_credito(
  p_venta_id uuid,
  p_empleado_id uuid,
  p_motivo text,
  p_items jsonb
) returns notas_credito
language plpgsql security definer
as $$
declare
  v_numero text;
  v_seq    integer;
  v_item   jsonb;
  v_venta  ventas%rowtype;
  v_nc     notas_credito%rowtype;
  v_monto_total numeric := 0;
begin
  -- Traer la venta original
  select * into v_venta from ventas where id = p_venta_id;
  if v_venta.id is null then
    raise exception 'Venta % no encontrada', p_venta_id;
  end if;

  -- Numerar
  update contadores
     set valor = valor + 1
   where clave = 'notas_credito'
   returning valor into v_seq;
  v_numero := 'NC-0001-' || lpad(v_seq::text, 8, '0');

  -- Devolver stock + sumar montos
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into stock_items(producto_id, deposito_id, cantidad)
      values ((v_item->>'producto_id')::uuid, v_venta.deposito_id, (v_item->>'cantidad')::numeric)
      on conflict (producto_id, deposito_id) where variante_id is null
      do update set cantidad = stock_items.cantidad + excluded.cantidad;

    insert into movimientos_stock(producto_id, deposito_id, tipo, cantidad, referencia_id, empleado_id, motivo)
      values (
        (v_item->>'producto_id')::uuid, v_venta.deposito_id, 'ingreso',
        (v_item->>'cantidad')::numeric, p_venta_id, p_empleado_id, 'Nota de crédito'
      );

    v_monto_total := v_monto_total + (v_item->>'subtotal')::numeric;
  end loop;

  insert into notas_credito(numero, venta_id, empleado_id, motivo, items, monto_total)
    values (v_numero, p_venta_id, p_empleado_id, p_motivo, p_items, v_monto_total)
    returning * into v_nc;

  return v_nc;
end $$;
