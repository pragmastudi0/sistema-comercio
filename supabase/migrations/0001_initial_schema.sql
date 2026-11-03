-- ===========================================================================
-- #turisteando — Schema inicial
-- Ejecutar en Supabase: Project → SQL Editor → New query → pegar → Run
--
-- Crea las 19 tablas del modelo de dominio (alineadas con packages/db/src/types.ts),
-- los enums, índices recomendados, las funciones (RPC) para ventas y notas de
-- crédito que tienen que ser atómicas, y las políticas RLS básicas.
--
-- Es idempotente: usa IF NOT EXISTS y CREATE OR REPLACE.
-- ===========================================================================

-- ============== EXTENSIONES ==============
create extension if not exists "uuid-ossp";

-- ============== ENUMS ==============
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_deposito') then
    create type tipo_deposito as enum ('central', 'local', 'web');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_venta') then
    create type estado_venta as enum ('completada', 'anulada', 'presupuesto');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_sesion') then
    create type estado_sesion as enum ('abierta', 'cerrada');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_transferencia') then
    create type estado_transferencia as enum ('borrador', 'emitida', 'recibida', 'anulada');
  end if;
  if not exists (select 1 from pg_type where typname = 'metodo_pago') then
    create type metodo_pago as enum ('efectivo', 'transferencia', 'debito', 'credito', 'qr', 'cta_cte');
  end if;
  if not exists (select 1 from pg_type where typname = 'tipo_movimiento_caja') then
    create type tipo_movimiento_caja as enum ('venta', 'ingreso', 'egreso', 'retiro', 'anulacion');
  end if;
  if not exists (select 1 from pg_type where typname = 'tipo_movimiento_stock') then
    create type tipo_movimiento_stock as enum (
      'venta', 'devolucion', 'ajuste', 'merma',
      'transferencia_salida', 'transferencia_entrada'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'tipo_movimiento_ctacte') then
    create type tipo_movimiento_ctacte as enum ('cargo', 'pago', 'condonacion', 'ajuste');
  end if;
end $$;

-- ============== TABLAS ==============

create table if not exists empresas (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  cuit text,
  direccion text,
  telefono text,
  email text,
  creada_en timestamptz not null default now()
);

create table if not exists locales (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  direccion text,
  activo boolean not null default true
);

create table if not exists depositos (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  tipo tipo_deposito not null,
  local_id uuid references locales(id) on delete set null,
  activo boolean not null default true
);

create table if not exists cajas (
  id uuid primary key default uuid_generate_v4(),
  local_id uuid not null references locales(id) on delete cascade,
  nombre text not null,
  activa boolean not null default true
);

create table if not exists roles (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  preset boolean not null default false,
  permisos jsonb not null default '{}'::jsonb
);

create table if not exists empleados (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  -- Vinculación con Supabase Auth (auth.users.id). Nullable mientras se crea.
  auth_user_id uuid unique,
  nombre text not null,
  apellido text not null,
  email text not null unique,
  rol_id uuid not null references roles(id),
  local_id uuid references locales(id) on delete set null,
  deposito_id uuid references depositos(id) on delete set null,
  permisos_override jsonb,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists categorias (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  parent_id uuid references categorias(id) on delete set null,
  atributos jsonb
);

create table if not exists proveedores (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  cuit text,
  telefono text,
  email text,
  contacto text,
  activo boolean not null default true
);

create table if not exists productos (
  id uuid primary key default uuid_generate_v4(),
  codigo_interno text not null unique,
  nombre text not null,
  descripcion text,
  descripcion_larga text,
  categoria_id uuid not null references categorias(id),
  proveedor_id uuid references proveedores(id) on delete set null,
  costo numeric(12, 2) not null default 0,
  atributos jsonb,
  publicado_web boolean not null default false,
  solo_por_bulto boolean not null default false,
  cantidad_minima_web integer,
  incremento_web integer,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index if not exists productos_codigo_idx on productos(codigo_interno);
create index if not exists productos_categoria_idx on productos(categoria_id);
create index if not exists productos_nombre_idx on productos using gin (to_tsvector('spanish', nombre));

create table if not exists variantes (
  id uuid primary key default uuid_generate_v4(),
  producto_id uuid not null references productos(id) on delete cascade,
  atributos jsonb not null,
  codigo_interno text
);

create table if not exists producto_imagenes (
  id uuid primary key default uuid_generate_v4(),
  producto_id uuid not null references productos(id) on delete cascade,
  url text not null,
  orden integer not null default 0
);

create table if not exists listas_precio (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  es_default boolean not null default false,
  activa boolean not null default true
);

create table if not exists producto_lista_precio (
  producto_id uuid not null references productos(id) on delete cascade,
  lista_precio_id uuid not null references listas_precio(id) on delete cascade,
  escalas jsonb not null,
  primary key (producto_id, lista_precio_id)
);

create table if not exists stock_items (
  producto_id uuid not null references productos(id) on delete cascade,
  variante_id uuid references variantes(id) on delete cascade,
  deposito_id uuid not null references depositos(id) on delete cascade,
  cantidad numeric(12, 3) not null default 0,
  minimo numeric(12, 3),
  primary key (producto_id, deposito_id, variante_id)
);

create index if not exists stock_deposito_idx on stock_items(deposito_id);

create table if not exists movimientos_stock (
  id uuid primary key default uuid_generate_v4(),
  producto_id uuid not null references productos(id) on delete cascade,
  variante_id uuid references variantes(id) on delete cascade,
  deposito_id uuid not null references depositos(id) on delete cascade,
  tipo tipo_movimiento_stock not null,
  cantidad numeric(12, 3) not null,
  motivo text,
  referencia_id uuid,
  empleado_id uuid not null references empleados(id),
  fecha timestamptz not null default now()
);

create index if not exists movs_stock_producto_idx on movimientos_stock(producto_id, fecha desc);
create index if not exists movs_stock_deposito_idx on movimientos_stock(deposito_id, fecha desc);

create table if not exists transferencias (
  id uuid primary key default uuid_generate_v4(),
  deposito_origen_id uuid not null references depositos(id),
  deposito_destino_id uuid not null references depositos(id),
  estado estado_transferencia not null default 'borrador',
  items jsonb not null,
  emitida_por uuid references empleados(id),
  recibida_por uuid references empleados(id),
  emitida_en timestamptz,
  recibida_en timestamptz,
  creada_en timestamptz not null default now()
);

create table if not exists clientes (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  apellido text not null,
  dni text,
  cuit text,
  direccion text,
  codigo_postal text,
  telefono text,
  email text,
  lista_precio_id uuid not null references listas_precio(id),
  limite_credito numeric(12, 2),
  saldo numeric(12, 2) not null default 0,
  suspendido boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index if not exists clientes_nombre_idx on clientes (lower(nombre), lower(apellido));
create index if not exists clientes_dni_idx on clientes(dni);

create table if not exists movimientos_ctacte (
  id uuid primary key default uuid_generate_v4(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo tipo_movimiento_ctacte not null,
  monto numeric(12, 2) not null,
  metodo_pago metodo_pago,
  venta_id uuid,
  fecha timestamptz not null default now(),
  empleado_id uuid not null references empleados(id),
  nota text
);

create table if not exists sesiones_caja (
  id uuid primary key default uuid_generate_v4(),
  caja_id uuid not null references cajas(id),
  empleado_id uuid not null references empleados(id),
  saldo_inicial numeric(12, 2) not null,
  saldo_final_declarado numeric(12, 2),
  abierta_en timestamptz not null default now(),
  cerrada_en timestamptz,
  estado estado_sesion not null default 'abierta'
);

create index if not exists sesiones_caja_estado_idx on sesiones_caja(estado);

create table if not exists ventas (
  id uuid primary key default uuid_generate_v4(),
  numero text not null unique,
  caja_id uuid not null references cajas(id),
  sesion_caja_id uuid not null references sesiones_caja(id),
  local_id uuid not null references locales(id),
  deposito_id uuid not null references depositos(id),
  empleado_id uuid not null references empleados(id),
  cliente_id uuid references clientes(id) on delete set null,
  items jsonb not null,
  pagos jsonb not null,
  subtotal numeric(12, 2) not null,
  descuento_total numeric(12, 2) not null default 0,
  recargo_total numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  estado estado_venta not null default 'completada',
  anulada_por uuid references empleados(id),
  anulada_en timestamptz,
  motivo_anulacion text,
  fecha timestamptz not null default now()
);

create index if not exists ventas_fecha_idx on ventas(fecha desc);
create index if not exists ventas_empleado_idx on ventas(empleado_id, fecha desc);
create index if not exists ventas_sesion_idx on ventas(sesion_caja_id);

create table if not exists movimientos_caja (
  id uuid primary key default uuid_generate_v4(),
  sesion_caja_id uuid not null references sesiones_caja(id) on delete cascade,
  tipo tipo_movimiento_caja not null,
  metodo metodo_pago not null,
  monto numeric(12, 2) not null,
  motivo text,
  venta_id uuid references ventas(id) on delete set null,
  empleado_id uuid not null references empleados(id),
  fecha timestamptz not null default now()
);

create index if not exists movs_caja_sesion_idx on movimientos_caja(sesion_caja_id);

create table if not exists notas_credito (
  id uuid primary key default uuid_generate_v4(),
  numero text not null unique,
  venta_id uuid not null references ventas(id) on delete cascade,
  empleado_id uuid not null references empleados(id),
  motivo text not null,
  items jsonb not null,
  monto_total numeric(12, 2) not null,
  fecha timestamptz not null default now()
);

create table if not exists configuracion_empresa (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  descuento_efectivo_pct numeric(5, 2) not null default 0,
  cuotas jsonb not null default '[]'::jsonb,
  validez_presupuesto_dias integer not null default 7,
  permitir_venta_sin_stock_default boolean not null default false,
  comercio jsonb,
  pedido_minimo_web numeric(12, 2) default 0,
  mensaje_wa_template text
);

create table if not exists logs_auditoria (
  id uuid primary key default uuid_generate_v4(),
  empleado_id uuid not null references empleados(id),
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  detalle jsonb,
  fecha timestamptz not null default now()
);

create index if not exists auditoria_fecha_idx on logs_auditoria(fecha desc);

-- Asociación entre ventas y notas (referencia inversa para reportes)
alter table notas_credito
  drop constraint if exists notas_credito_venta_id_fkey;
alter table notas_credito
  add constraint notas_credito_venta_id_fkey
  foreign key (venta_id) references ventas(id) on delete cascade;

-- Contadores globales para numeración de comprobantes
create table if not exists contadores (
  clave text primary key,
  valor bigint not null default 0
);

insert into contadores(clave, valor) values ('ventas', 0)
  on conflict (clave) do nothing;
insert into contadores(clave, valor) values ('notas_credito', 0)
  on conflict (clave) do nothing;

-- ============== RPC: crear_venta (atómica) ==============
-- Descuenta stock, crea la venta, registra movimientos de caja, carga cta cte si aplica.
-- Llamada desde el PoS al confirmar el cobro.

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
  v_id uuid;
  v_item jsonb;
  v_pago jsonb;
  v_stock numeric;
  v_venta ventas%rowtype;
begin
  -- Numerar
  update contadores set valor = valor + 1 where clave = 'ventas' returning valor into v_id;
  v_numero := '0001-' || lpad(v_id::text, 8, '0');

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

-- ============== RPC: emitir_nota_credito (atómica) ==============
create or replace function rpc_emitir_nota_credito(
  p_venta_id uuid,
  p_empleado_id uuid,
  p_motivo text,
  p_items jsonb
) returns notas_credito
language plpgsql security definer
as $$
declare
  v_venta ventas%rowtype;
  v_item jsonb;
  v_item_venta jsonb;
  v_cant_vendida numeric;
  v_monto numeric := 0;
  v_items_completos jsonb := '[]'::jsonb;
  v_id bigint;
  v_numero text;
  v_nc notas_credito%rowtype;
begin
  select * into v_venta from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;

  -- Validar cantidades y construir items con subtotal
  for v_item in select * from jsonb_array_elements(p_items) loop
    -- Buscar el item en la venta original
    select i into v_item_venta
      from jsonb_array_elements(v_venta.items) as i
      where (i->>'producto_id') = (v_item->>'producto_id');
    if v_item_venta is null then
      raise exception 'Producto % no estaba en la venta original', v_item->>'producto_id';
    end if;
    v_cant_vendida := (v_item_venta->>'cantidad')::numeric;
    if (v_item->>'cantidad')::numeric > v_cant_vendida then
      raise exception 'Cantidad a devolver supera la vendida';
    end if;

    -- Devolver stock
    insert into stock_items(producto_id, deposito_id, cantidad)
      values ((v_item->>'producto_id')::uuid, v_venta.deposito_id, (v_item->>'cantidad')::numeric)
      on conflict (producto_id, deposito_id, variante_id) do update
      set cantidad = stock_items.cantidad + (v_item->>'cantidad')::numeric;

    insert into movimientos_stock(producto_id, deposito_id, tipo, cantidad, referencia_id, empleado_id, motivo)
      values ((v_item->>'producto_id')::uuid, v_venta.deposito_id, 'devolucion',
              (v_item->>'cantidad')::numeric, v_venta.id, p_empleado_id, p_motivo);

    -- Agregar subtotal
    v_monto := v_monto + (v_item->>'cantidad')::numeric * (v_item->>'precio_unitario')::numeric;
    v_items_completos := v_items_completos || jsonb_build_object(
      'producto_id', v_item->>'producto_id',
      'cantidad', (v_item->>'cantidad')::numeric,
      'precio_unitario', (v_item->>'precio_unitario')::numeric,
      'subtotal', (v_item->>'cantidad')::numeric * (v_item->>'precio_unitario')::numeric
    );
  end loop;

  update contadores set valor = valor + 1 where clave = 'notas_credito' returning valor into v_id;
  v_numero := 'NC-' || lpad(v_id::text, 8, '0');

  insert into notas_credito(numero, venta_id, empleado_id, motivo, items, monto_total)
    values (v_numero, p_venta_id, p_empleado_id, p_motivo, v_items_completos, v_monto)
    returning * into v_nc;

  return v_nc;
end $$;

-- ============== ROW LEVEL SECURITY ==============
-- Por simplicidad inicial: políticas permisivas para usuarios autenticados.
-- Para producción real se afinan según rol del empleado.

alter table empresas enable row level security;
alter table locales enable row level security;
alter table depositos enable row level security;
alter table cajas enable row level security;
alter table roles enable row level security;
alter table empleados enable row level security;
alter table categorias enable row level security;
alter table proveedores enable row level security;
alter table productos enable row level security;
alter table variantes enable row level security;
alter table producto_imagenes enable row level security;
alter table listas_precio enable row level security;
alter table producto_lista_precio enable row level security;
alter table stock_items enable row level security;
alter table movimientos_stock enable row level security;
alter table transferencias enable row level security;
alter table clientes enable row level security;
alter table movimientos_ctacte enable row level security;
alter table sesiones_caja enable row level security;
alter table ventas enable row level security;
alter table movimientos_caja enable row level security;
alter table notas_credito enable row level security;
alter table configuracion_empresa enable row level security;
alter table logs_auditoria enable row level security;
alter table contadores enable row level security;

-- Productos / categorías / listas / proveedores: lectura pública
-- (necesario para el e-commerce sin login).
do $$
declare t text;
begin
  for t in select unnest(array[
    'productos','categorias','listas_precio','producto_lista_precio',
    'producto_imagenes','proveedores','variantes'
  ]) loop
    execute format('drop policy if exists %I_select_all on %I', t, t);
    execute format('create policy %I_select_all on %I for select using (true)', t, t);
  end loop;
end $$;

-- Resto de tablas: lectura/escritura solo para usuarios autenticados.
do $$
declare t text;
begin
  for t in select unnest(array[
    'empresas','locales','depositos','cajas','roles','empleados',
    'stock_items','movimientos_stock','transferencias','clientes',
    'movimientos_ctacte','sesiones_caja','ventas','movimientos_caja',
    'notas_credito','configuracion_empresa','logs_auditoria','contadores'
  ]) loop
    execute format('drop policy if exists %I_auth_all on %I', t, t);
    execute format(
      'create policy %I_auth_all on %I for all to authenticated using (true) with check (true)', t, t
    );
  end loop;
end $$;

-- Para productos/categorías/listas también permitir escritura a usuarios autenticados
do $$
declare t text;
begin
  for t in select unnest(array[
    'productos','categorias','listas_precio','producto_lista_precio',
    'producto_imagenes','proveedores','variantes'
  ]) loop
    execute format('drop policy if exists %I_auth_write on %I', t, t);
    execute format(
      'create policy %I_auth_write on %I for all to authenticated using (true) with check (true)', t, t
    );
  end loop;
end $$;

-- ============== SEED MÍNIMO ==============
-- Crea la empresa por defecto, 4 roles preset, una lista CF y una Mayorista.
-- Estos IDs son fijos para que las apps los referencien.

insert into empresas (id, nombre)
  values ('00000000-0000-0000-0000-000000000001', '#turisteando')
  on conflict (id) do nothing;

insert into roles (id, nombre, preset, permisos) values
  ('00000000-0000-0000-0000-000000000010', 'Admin', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000011', 'Encargado', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000012', 'Cajero', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000013', 'Carga de catálogo', true, '{}'::jsonb)
  on conflict (id) do nothing;

insert into listas_precio (id, nombre, es_default, activa) values
  ('00000000-0000-0000-0000-000000000020', 'Consumidor Final', true, true),
  ('00000000-0000-0000-0000-000000000021', 'Mayorista', false, true)
  on conflict (id) do nothing;

insert into configuracion_empresa (
  empresa_id, descuento_efectivo_pct, cuotas, validez_presupuesto_dias,
  permitir_venta_sin_stock_default
) values (
  '00000000-0000-0000-0000-000000000001', 10,
  '[{"cuotas":1,"recargo_pct":0},{"cuotas":3,"recargo_pct":12},{"cuotas":6,"recargo_pct":25},{"cuotas":12,"recargo_pct":55}]'::jsonb,
  7, false
) on conflict (empresa_id) do nothing;

-- ============== FIN ==============
-- Listo. Ahora desde el código de las apps se puede leer/escribir vía supabase-js.
