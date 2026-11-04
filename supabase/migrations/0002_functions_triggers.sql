-- ===========================================================================
-- sistema-comercio — Funciones (RPC) + triggers · MULTI-EMPRESA
-- ===========================================================================
-- Todas las operaciones atómicas (venta, nota de crédito, stock, pedido web)
-- derivan la empresa del empleado logueado (`empresa_actual_id()`) o la reciben
-- explícita (flujo anon de la web). La numeración es POR empresa.
-- Todo vive bajo el schema `sistema_comercio` (ver 0001_schema.sql).
-- ===========================================================================

set search_path = sistema_comercio, public;

-- ============== HELPERS DE CONTEXTO (resuelven desde auth.uid()) ==============

create or replace function sistema_comercio.empleado_actual_id()
returns uuid language sql security definer stable set search_path = sistema_comercio, public as $$
  select id from empleados where auth_user_id = auth.uid() and activo = true limit 1;
$$;

create or replace function sistema_comercio.empresa_actual_id()
returns uuid language sql security definer stable set search_path = sistema_comercio, public as $$
  select empresa_id from empleados where auth_user_id = auth.uid() and activo = true limit 1;
$$;

create or replace function sistema_comercio.preset_key_actual()
returns text language sql security definer stable set search_path = sistema_comercio, public as $$
  select r.preset_key
    from empleados e join roles r on r.id = e.rol_id
   where e.auth_user_id = auth.uid() and e.activo = true
   limit 1;
$$;

create or replace function sistema_comercio.is_admin()
returns boolean language sql security definer stable set search_path = sistema_comercio, public as $$
  select coalesce(sistema_comercio.preset_key_actual() = 'admin', false);
$$;

create or replace function sistema_comercio.is_admin_or_encargado()
returns boolean language sql security definer stable set search_path = sistema_comercio, public as $$
  select coalesce(sistema_comercio.preset_key_actual() in ('admin','encargado'), false);
$$;

grant execute on function sistema_comercio.empleado_actual_id() to authenticated;
grant execute on function sistema_comercio.empresa_actual_id() to authenticated;
grant execute on function sistema_comercio.preset_key_actual() to authenticated;
grant execute on function sistema_comercio.is_admin() to authenticated;
grant execute on function sistema_comercio.is_admin_or_encargado() to authenticated;

-- ============== NUMERACIÓN POR EMPRESA ==============
-- Incrementa y devuelve el siguiente valor del contador (empresa, clave),
-- creando la fila si no existe. SECURITY DEFINER para que el flujo anon de la
-- web (pedidos) pueda numerar sin permisos directos sobre `contadores`.
create or replace function sistema_comercio.siguiente_numero(p_empresa_id uuid, p_clave text)
returns bigint language plpgsql security definer set search_path = sistema_comercio, public as $$
declare v_val bigint;
begin
  insert into contadores(empresa_id, clave, valor) values (p_empresa_id, p_clave, 1)
    on conflict (empresa_id, clave) do update set valor = contadores.valor + 1
    returning valor into v_val;
  return v_val;
end $$;

-- ============== TRIGGER: default empresa_id = empresa del empleado ==============
-- Para inserts de usuarios autenticados que no setean empresa_id explícito.
-- No pisa un empresa_id ya provisto (flujo anon / provisioning).
create or replace function sistema_comercio.set_empresa_id_default()
returns trigger language plpgsql security definer set search_path = sistema_comercio, public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := sistema_comercio.empresa_actual_id();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'locales','depositos','cajas','roles','empleados','categorias','proveedores',
    'productos','variantes','producto_imagenes','listas_precio','producto_lista_precio',
    'stock_items','movimientos_stock','transferencias','clientes','movimientos_ctacte',
    'sesiones_caja','ventas','movimientos_caja','notas_credito','pedidos_web','logs_auditoria'
  ]) loop
    execute format('drop trigger if exists trg_set_empresa_id on sistema_comercio.%I', t);
    execute format(
      'create trigger trg_set_empresa_id before insert on sistema_comercio.%I
       for each row execute function sistema_comercio.set_empresa_id_default()', t);
  end loop;
end $$;

-- ============== TRIGGERS: timestamps de trazabilidad ==============
create or replace function sistema_comercio.set_precio_actualizado_en()
returns trigger language plpgsql as $$
begin
  if new.escalas is distinct from old.escalas then new.actualizado_en := now(); end if;
  return new;
end $$;
drop trigger if exists trg_precio_actualizado_en on sistema_comercio.producto_lista_precio;
create trigger trg_precio_actualizado_en before update on sistema_comercio.producto_lista_precio
  for each row execute function sistema_comercio.set_precio_actualizado_en();

create or replace function sistema_comercio.set_costo_actualizado_en()
returns trigger language plpgsql as $$
begin
  if new.costo is distinct from old.costo then new.costo_actualizado_en := now(); end if;
  return new;
end $$;
drop trigger if exists trg_costo_actualizado_en on sistema_comercio.productos;
create trigger trg_costo_actualizado_en before update on sistema_comercio.productos
  for each row execute function sistema_comercio.set_costo_actualizado_en();

-- ============== RPC: crear_venta (atómica, multi-empresa) ==============
-- Deriva la empresa del empleado logueado. Numera por empresa con el prefijo
-- del local (numeracion_prefijo). Permite stock negativo (no valida).
create or replace function sistema_comercio.rpc_crear_venta(
  p_caja_id uuid, p_sesion_caja_id uuid, p_local_id uuid, p_deposito_id uuid,
  p_empleado_id uuid, p_cliente_id uuid, p_items jsonb, p_pagos jsonb,
  p_subtotal numeric, p_descuento_total numeric, p_recargo_total numeric, p_total numeric
) returns ventas language plpgsql security definer set search_path = sistema_comercio, public as $$
declare
  v_empresa uuid;
  v_prefijo text;
  v_seq     bigint;
  v_numero  text;
  v_item    jsonb;
  v_pago    jsonb;
  v_venta   ventas%rowtype;
begin
  v_empresa := sistema_comercio.empresa_actual_id();
  if v_empresa is null then
    raise exception 'No se pudo resolver la empresa del usuario logueado';
  end if;

  select coalesce(numeracion_prefijo, '0001') into v_prefijo from locales where id = p_local_id;
  v_prefijo := coalesce(v_prefijo, '0001');

  v_seq := sistema_comercio.siguiente_numero(v_empresa, 'ventas');
  v_numero := v_prefijo || '-' || lpad(v_seq::text, 8, '0');

  -- 1) Descontar stock (permite negativo)
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform 1 from stock_items
      where producto_id = (v_item->>'producto_id')::uuid and deposito_id = p_deposito_id
      for update;
    if not found then
      insert into stock_items(empresa_id, producto_id, deposito_id, cantidad)
        values (v_empresa, (v_item->>'producto_id')::uuid, p_deposito_id, 0);
    end if;
    update stock_items set cantidad = cantidad - (v_item->>'cantidad')::numeric
     where producto_id = (v_item->>'producto_id')::uuid and deposito_id = p_deposito_id;
  end loop;

  -- 2) Insertar la venta
  insert into ventas(
    empresa_id, numero, caja_id, sesion_caja_id, local_id, deposito_id, empleado_id,
    cliente_id, items, pagos, subtotal, descuento_total, recargo_total, total
  ) values (
    v_empresa, v_numero, p_caja_id, p_sesion_caja_id, p_local_id, p_deposito_id, p_empleado_id,
    p_cliente_id, p_items, p_pagos, p_subtotal, p_descuento_total, p_recargo_total, p_total
  ) returning * into v_venta;

  -- 3) Movimientos de stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into movimientos_stock(empresa_id, producto_id, deposito_id, tipo, cantidad, referencia_id, empleado_id)
      values (v_empresa, (v_item->>'producto_id')::uuid, p_deposito_id, 'venta',
              (v_item->>'cantidad')::numeric, v_venta.id, p_empleado_id);
  end loop;

  -- 4) Movimientos de caja + cta cte
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into movimientos_caja(empresa_id, sesion_caja_id, tipo, metodo, monto, venta_id, empleado_id)
      values (v_empresa, p_sesion_caja_id, 'venta', (v_pago->>'metodo')::metodo_pago,
              (v_pago->>'monto')::numeric, v_venta.id, p_empleado_id);

    if (v_pago->>'metodo') = 'cta_cte' and p_cliente_id is not null then
      insert into movimientos_ctacte(empresa_id, cliente_id, tipo, monto, venta_id, empleado_id, nota)
        values (v_empresa, p_cliente_id, 'cargo', (v_pago->>'monto')::numeric, v_venta.id, p_empleado_id,
                'Venta ' || v_numero);
      update clientes set saldo = saldo + (v_pago->>'monto')::numeric where id = p_cliente_id;
    end if;
  end loop;

  return v_venta;
end $$;
grant execute on function sistema_comercio.rpc_crear_venta(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,numeric,numeric,numeric,numeric) to authenticated;

-- ============== RPC: emitir_nota_credito (atómica, multi-empresa) ==============
create or replace function sistema_comercio.rpc_emitir_nota_credito(
  p_venta_id uuid, p_empleado_id uuid, p_motivo text, p_items jsonb
) returns notas_credito language plpgsql security definer set search_path = sistema_comercio, public as $$
declare
  v_empresa uuid;
  v_seq     bigint;
  v_numero  text;
  v_item    jsonb;
  v_venta   ventas%rowtype;
  v_nc      notas_credito%rowtype;
  v_monto_total numeric := 0;
begin
  select * into v_venta from ventas where id = p_venta_id;
  if v_venta.id is null then raise exception 'Venta % no encontrada', p_venta_id; end if;
  v_empresa := v_venta.empresa_id;

  v_seq := sistema_comercio.siguiente_numero(v_empresa, 'notas_credito');
  v_numero := 'NC-0001-' || lpad(v_seq::text, 8, '0');

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into stock_items(empresa_id, producto_id, deposito_id, cantidad)
      values (v_empresa, (v_item->>'producto_id')::uuid, v_venta.deposito_id, (v_item->>'cantidad')::numeric)
      on conflict (producto_id, deposito_id) where variante_id is null
      do update set cantidad = stock_items.cantidad + excluded.cantidad;

    insert into movimientos_stock(empresa_id, producto_id, deposito_id, tipo, cantidad, referencia_id, empleado_id, motivo)
      values (v_empresa, (v_item->>'producto_id')::uuid, v_venta.deposito_id, 'devolucion',
              (v_item->>'cantidad')::numeric, p_venta_id, p_empleado_id, 'Nota de crédito');

    v_monto_total := v_monto_total + coalesce(
      (v_item->>'subtotal')::numeric,
      (v_item->>'cantidad')::numeric * (v_item->>'precio_unitario')::numeric, 0);
  end loop;

  insert into notas_credito(empresa_id, numero, venta_id, empleado_id, motivo, items, monto_total)
    values (v_empresa, v_numero, p_venta_id, p_empleado_id, p_motivo, p_items, v_monto_total)
    returning * into v_nc;
  return v_nc;
end $$;
grant execute on function sistema_comercio.rpc_emitir_nota_credito(uuid,uuid,text,jsonb) to authenticated;

-- ============== RPC: aplicar_delta_stock (atómico, sin race) ==============
create or replace function sistema_comercio.rpc_aplicar_delta_stock(
  p_producto_id uuid, p_variante_id uuid, p_deposito_id uuid,
  p_delta numeric, p_permitir_negativo boolean default true
) returns table(cantidad_anterior numeric, cantidad_nueva numeric)
language plpgsql security definer set search_path = sistema_comercio, public as $$
declare v_actual numeric; v_nueva numeric; v_empresa uuid;
begin
  select empresa_id into v_empresa from productos where id = p_producto_id;
  if p_variante_id is null then
    select cantidad into v_actual from stock_items
      where producto_id = p_producto_id and deposito_id = p_deposito_id and variante_id is null for update;
  else
    select cantidad into v_actual from stock_items
      where producto_id = p_producto_id and deposito_id = p_deposito_id and variante_id = p_variante_id for update;
  end if;

  if v_actual is null then
    v_nueva := p_delta;
    if not p_permitir_negativo and v_nueva < 0 then
      raise exception 'Stock insuficiente (actual: 0, delta: %)', p_delta using errcode = 'P0001';
    end if;
    insert into stock_items(empresa_id, producto_id, variante_id, deposito_id, cantidad)
      values (v_empresa, p_producto_id, p_variante_id, p_deposito_id, v_nueva);
    v_actual := 0;
  else
    v_nueva := v_actual + p_delta;
    if not p_permitir_negativo and v_nueva < 0 then
      raise exception 'Stock insuficiente (actual: %, delta: %)', v_actual, p_delta using errcode = 'P0001';
    end if;
    if p_variante_id is null then
      update stock_items set cantidad = v_nueva
        where producto_id = p_producto_id and deposito_id = p_deposito_id and variante_id is null;
    else
      update stock_items set cantidad = v_nueva
        where producto_id = p_producto_id and deposito_id = p_deposito_id and variante_id = p_variante_id;
    end if;
  end if;
  return query select v_actual, v_nueva;
end $$;
grant execute on function sistema_comercio.rpc_aplicar_delta_stock(uuid,uuid,uuid,numeric,boolean) to authenticated;

-- ============== RPC: crear_pedido_web (anon, multi-empresa) ==============
-- La web pública (anon) no tiene auth.uid(): la empresa llega explícita
-- (resuelta por subdominio en el server de apps/web). SECURITY DEFINER bypasea
-- RLS para insertar y devolver la fila.
create or replace function sistema_comercio.rpc_crear_pedido_web(
  p_empresa_id uuid, p_cliente_datos jsonb, p_items jsonb,
  p_subtotal numeric, p_descuento_total numeric, p_total numeric,
  p_metodo_pago text, p_forma_entrega text, p_notas text default null
) returns pedidos_web language plpgsql security definer set search_path = sistema_comercio, public as $$
declare v_nuevo pedidos_web; v_num bigint;
begin
  if p_empresa_id is null then raise exception 'empresa_id requerido'; end if;
  v_num := sistema_comercio.siguiente_numero(p_empresa_id, 'pedidos_web');
  insert into pedidos_web(
    empresa_id, numero, cliente_datos, items, subtotal, descuento_total, total,
    metodo_pago, forma_entrega, notas
  ) values (
    p_empresa_id, v_num, p_cliente_datos, p_items, p_subtotal, p_descuento_total, p_total,
    p_metodo_pago, p_forma_entrega, p_notas
  ) returning * into v_nuevo;
  return v_nuevo;
end $$;
grant execute on function sistema_comercio.rpc_crear_pedido_web(uuid,jsonb,jsonb,numeric,numeric,numeric,text,text,text) to anon, authenticated;
