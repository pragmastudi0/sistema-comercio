-- =============================================================
-- Fix: rpc_emitir_nota_credito insertaba movimientos_stock con
-- tipo='ingreso', valor que NO existe en el enum tipo_movimiento_stock
-- (acepta: venta, devolucion, ajuste, merma, transferencia_*).
--
-- Síntoma observado en prod:
--   notas_credito.emitir: invalid input value for enum
--   tipo_movimiento_stock: "ingreso"
--
-- Fix: usar 'devolucion' (que es semánticamente lo correcto: la NC
-- DEVUELVE stock al depósito).
-- =============================================================

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
  select * into v_venta from ventas where id = p_venta_id;
  if v_venta.id is null then
    raise exception 'Venta % no encontrada', p_venta_id;
  end if;

  update contadores
     set valor = valor + 1
   where clave = 'notas_credito'
   returning valor into v_seq;
  v_numero := 'NC-0001-' || lpad(v_seq::text, 8, '0');

  for v_item in select * from jsonb_array_elements(p_items) loop
    -- Devolver stock al depósito de la venta.
    insert into stock_items(producto_id, deposito_id, cantidad)
      values ((v_item->>'producto_id')::uuid, v_venta.deposito_id, (v_item->>'cantidad')::numeric)
      on conflict (producto_id, deposito_id) where variante_id is null
      do update set cantidad = stock_items.cantidad + excluded.cantidad;

    -- Registrar movimiento. ANTES decía 'ingreso' (no existe en el enum).
    -- Ahora 'devolucion', que es lo semánticamente correcto.
    insert into movimientos_stock(producto_id, deposito_id, tipo, cantidad, referencia_id, empleado_id, motivo)
      values (
        (v_item->>'producto_id')::uuid, v_venta.deposito_id, 'devolucion',
        (v_item->>'cantidad')::numeric, p_venta_id, p_empleado_id, 'Nota de crédito'
      );

    -- Si vino subtotal explícito, lo uso; si no, lo calculo de
    -- cantidad * precio_unitario (el front actual manda los dos
    -- formatos según versión).
    v_monto_total := v_monto_total +
      coalesce(
        (v_item->>'subtotal')::numeric,
        (v_item->>'cantidad')::numeric * (v_item->>'precio_unitario')::numeric,
        0
      );
  end loop;

  insert into notas_credito(numero, venta_id, empleado_id, motivo, items, monto_total)
    values (v_numero, p_venta_id, p_empleado_id, p_motivo, p_items, v_monto_total)
    returning * into v_nc;

  return v_nc;
end $$;
