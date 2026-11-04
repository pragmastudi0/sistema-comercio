-- ===========================================================================
-- sistema-comercio — Schema consolidado MULTI-EMPRESA (SaaS)
-- ===========================================================================
-- Reemplaza el schema fragmentado del sistema original (14 migraciones +
-- 11 SQL sueltos). Levanta una base completa de cero, multi-tenant desde el
-- arranque: cada tabla de dominio lleva `empresa_id` y el aislamiento entre
-- empresas lo garantiza la RLS (ver 0003_rls.sql).
--
-- Orden de archivos:
--   0001_schema.sql            → tablas, enums, índices, constraints
--   0002_functions_triggers.sql→ RPCs (venta/NC/stock/pedido), triggers
--   0003_rls.sql               → helpers + RLS por inquilino + storage + grants
--   0004_seed_provisioning.sql → función provisionar_empresa + empresa demo
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE.
--
-- NAMESPACING: todo vive bajo el schema `sistema_comercio` (tablas, enums,
-- funciones, triggers). El search_path se fija acá para que el resto del
-- archivo cree los objetos ahí sin calificar cada nombre. Las apps conectan
-- con el cliente Supabase configurado con { db: { schema: 'sistema_comercio' } }.
-- IMPORTANTE: exponer el schema en Supabase (API settings) — ver docs/SCHEMA.md.
-- Usamos gen_random_uuid() (core en PG13+), sin depender de uuid-ossp.
-- ===========================================================================

create schema if not exists sistema_comercio;
set search_path = sistema_comercio, public;

-- ============== ENUMS ==============
-- La existencia se chequea DENTRO del schema sistema_comercio (n.nspname),
-- para no colisionar con tipos homónimos de otros schemas.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'tipo_deposito' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.tipo_deposito as enum ('central', 'local', 'web');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'estado_venta' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.estado_venta as enum ('completada', 'anulada', 'presupuesto', 'cancelada');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'estado_sesion' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.estado_sesion as enum ('abierta', 'cerrada');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'estado_transferencia' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.estado_transferencia as enum ('borrador', 'emitida', 'recibida', 'anulada');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'metodo_pago' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.metodo_pago as enum ('efectivo', 'transferencia', 'debito', 'credito', 'qr', 'cta_cte');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'tipo_movimiento_caja' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.tipo_movimiento_caja as enum ('venta', 'ingreso', 'egreso', 'retiro', 'anulacion');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'tipo_movimiento_stock' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.tipo_movimiento_stock as enum (
      'venta', 'devolucion', 'ajuste', 'merma',
      'transferencia_salida', 'transferencia_entrada'
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'tipo_movimiento_ctacte' and n.nspname = 'sistema_comercio') then
    create type sistema_comercio.tipo_movimiento_ctacte as enum ('cargo', 'pago', 'condonacion', 'ajuste');
  end if;
end $$;

-- ============== TENANT ROOT ==============

create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- subdominio para resolver la tienda web pública (empresa.<ROOT_DOMAIN>).
  subdominio text unique,
  cuit text,
  direccion text,
  telefono text,
  email text,
  activa boolean not null default true,
  creada_en timestamptz not null default now()
);

create table if not exists configuracion_empresa (
  empresa_id uuid primary key references empresas(id) on delete cascade,
  descuento_efectivo_pct numeric(5, 2) not null default 0,
  cuotas jsonb not null default '[]'::jsonb,
  validez_presupuesto_dias integer not null default 7,
  permitir_venta_sin_stock_default boolean not null default false,
  comercio jsonb,
  pedido_minimo_web numeric(12, 2) default 0,
  mensaje_wa_template text,
  arranque jsonb,
  -- e-commerce mayorista
  descuento_mayorista_pct numeric not null default 0
    check (descuento_mayorista_pct >= 0 and descuento_mayorista_pct <= 100),
  escalas_mayorista_cantidad jsonb,
  mayorista_desde_monto numeric not null default 0
    check (mayorista_desde_monto >= 0)
);

-- ============== ESTRUCTURA FÍSICA ==============

create table if not exists locales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  direccion text,
  -- prefijo de numeración de comprobantes de este punto de venta (AFIP-style).
  numeracion_prefijo text not null default '0001',
  activo boolean not null default true
);
create index if not exists locales_empresa_idx on locales(empresa_id);

create table if not exists depositos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  tipo tipo_deposito not null,
  local_id uuid references locales(id) on delete set null,
  activo boolean not null default true
);
create index if not exists depositos_empresa_idx on depositos(empresa_id);

create table if not exists cajas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  local_id uuid not null references locales(id) on delete cascade,
  nombre text not null,
  activa boolean not null default true
);
create index if not exists cajas_empresa_idx on cajas(empresa_id);

-- ============== ROLES Y EMPLEADOS ==============

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  preset boolean not null default false,
  -- clave estable del preset ('admin'|'encargado'|'cajero'|'catalogo'|null para custom).
  -- La RLS y los permisos del front se apoyan en esto, NO en UUIDs fijos.
  preset_key text check (preset_key is null or preset_key in ('admin','encargado','cajero','catalogo')),
  permisos jsonb not null default '{}'::jsonb
);
create index if not exists roles_empresa_idx on roles(empresa_id);
create unique index if not exists roles_empresa_preset_uq
  on roles(empresa_id, preset_key) where preset_key is not null;

create table if not exists empleados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  -- Vinculación con Supabase Auth (auth.users.id). Único global: un usuario
  -- de login pertenece a exactamente una empresa.
  auth_user_id uuid unique,
  nombre text not null,
  apellido text not null,
  email text not null,
  rol_id uuid not null references roles(id),
  local_id uuid references locales(id) on delete set null,
  deposito_id uuid references depositos(id) on delete set null,
  permisos_override jsonb,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
-- Email único POR empresa (no global): dos empresas pueden tener el mismo email.
create unique index if not exists empleados_empresa_email_uq on empleados(empresa_id, lower(email));
create index if not exists empleados_auth_idx on empleados(auth_user_id);

-- ============== CATÁLOGO ==============

create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  parent_id uuid references categorias(id) on delete set null,
  atributos jsonb
);
create index if not exists categorias_empresa_idx on categorias(empresa_id);

create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  cuit text,
  telefono text,
  email text,
  contacto text,
  activo boolean not null default true
);
create index if not exists proveedores_empresa_idx on proveedores(empresa_id);

create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  codigo_interno text not null,
  nombre text not null,
  nombre_web text,
  descripcion text,
  descripcion_larga text,
  categoria_id uuid references categorias(id) on delete set null,
  proveedor_id uuid references proveedores(id) on delete set null,
  costo numeric(12, 2) not null default 0,
  costo_actualizado_en timestamptz not null default now(),
  atributos jsonb,
  publicado_web boolean not null default false,
  solo_por_bulto boolean not null default false,
  cantidad_minima_web integer,
  incremento_web integer,
  -- Promos
  promo_texto text,
  promo_pct numeric check (promo_pct is null or (promo_pct >= 0 and promo_pct <= 100)),
  cuotas_sin_recargo boolean not null default false,
  promo_tipo text check (promo_tipo is null or promo_tipo in ('pct','nxm','combo')),
  promo_nxm_lleva int check (promo_nxm_lleva is null or promo_nxm_lleva >= 2),
  promo_nxm_paga int check (promo_nxm_paga is null or promo_nxm_paga >= 1),
  promo_combo_cantidad int check (promo_combo_cantidad is null or promo_combo_cantidad >= 2),
  promo_combo_precio numeric(12, 2) check (promo_combo_precio is null or promo_combo_precio > 0),
  -- Mayorista (e-commerce)
  descuento_mayorista_pct_override numeric
    check (descuento_mayorista_pct_override is null
           or (descuento_mayorista_pct_override >= 0 and descuento_mayorista_pct_override <= 100)),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint productos_promo_nxm_valido check (
    promo_tipo <> 'nxm'
    or (promo_nxm_lleva is not null and promo_nxm_paga is not null and promo_nxm_lleva > promo_nxm_paga)
  ),
  constraint productos_promo_combo_valido check (
    promo_tipo <> 'combo'
    or (promo_combo_cantidad is not null and promo_combo_precio is not null)
  )
);
-- Código interno único POR empresa.
create unique index if not exists productos_empresa_codigo_uq on productos(empresa_id, codigo_interno);
create index if not exists productos_categoria_idx on productos(empresa_id, categoria_id);
create index if not exists productos_nombre_idx on productos using gin (to_tsvector('spanish', nombre));

create table if not exists variantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  atributos jsonb not null,
  codigo_interno text
);
create index if not exists variantes_producto_idx on variantes(producto_id);

create table if not exists producto_imagenes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  url text not null,
  orden integer not null default 0
);
create index if not exists producto_imagenes_producto_idx on producto_imagenes(producto_id);

-- ============== PRECIOS ==============

create table if not exists listas_precio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  es_default boolean not null default false,
  activa boolean not null default true
);
create index if not exists listas_precio_empresa_idx on listas_precio(empresa_id);
-- Una sola lista default por empresa.
create unique index if not exists listas_precio_default_uq
  on listas_precio(empresa_id) where es_default;

create table if not exists producto_lista_precio (
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  lista_precio_id uuid not null references listas_precio(id) on delete cascade,
  escalas jsonb not null,
  actualizado_en timestamptz not null default now(),
  primary key (producto_id, lista_precio_id)
);

-- ============== STOCK ==============

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  variante_id uuid references variantes(id) on delete cascade,
  deposito_id uuid not null references depositos(id) on delete cascade,
  cantidad numeric(12, 3) not null default 0,
  minimo numeric(12, 3)
);
create unique index if not exists stock_items_unique_sin_variante
  on stock_items (producto_id, deposito_id) where variante_id is null;
create unique index if not exists stock_items_unique_con_variante
  on stock_items (producto_id, deposito_id, variante_id) where variante_id is not null;
create index if not exists stock_deposito_idx on stock_items(deposito_id);
create index if not exists stock_empresa_idx on stock_items(empresa_id);

create table if not exists movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
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
create index if not exists movs_stock_empresa_idx on movimientos_stock(empresa_id, fecha desc);

create table if not exists transferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
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
create index if not exists transferencias_empresa_idx on transferencias(empresa_id, creada_en desc);

-- ============== CLIENTES / CTA CTE ==============

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  apellido text not null,
  dni text,
  cuit text,
  direccion text,
  codigo_postal text,
  telefono text,
  email text,
  lista_precio_id uuid references listas_precio(id),
  limite_credito numeric(12, 2),
  saldo numeric(12, 2) not null default 0,
  suspendido boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index if not exists clientes_empresa_idx on clientes(empresa_id);
create index if not exists clientes_nombre_idx on clientes (empresa_id, lower(nombre), lower(apellido));
create index if not exists clientes_dni_idx on clientes(dni);

-- ============== CAJA / VENTAS ==============

create table if not exists sesiones_caja (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  caja_id uuid not null references cajas(id),
  empleado_id uuid not null references empleados(id),
  empleado_actual_id uuid references empleados(id) on delete restrict,
  saldo_inicial numeric(12, 2) not null,
  saldo_final_declarado numeric(12, 2),
  abierta_en timestamptz not null default now(),
  cerrada_en timestamptz,
  estado estado_sesion not null default 'abierta'
);
create index if not exists sesiones_caja_estado_idx on sesiones_caja(estado);
create index if not exists sesiones_caja_empresa_idx on sesiones_caja(empresa_id);
create index if not exists sesiones_caja_emp_actual_idx
  on sesiones_caja(empleado_actual_id) where empleado_actual_id is not null;

create table if not exists ventas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  numero text not null,
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
-- Número de comprobante único POR empresa.
create unique index if not exists ventas_empresa_numero_uq on ventas(empresa_id, numero);
create index if not exists ventas_fecha_idx on ventas(empresa_id, fecha desc);
create index if not exists ventas_empleado_idx on ventas(empleado_id, fecha desc);
create index if not exists ventas_sesion_idx on ventas(sesion_caja_id);

create table if not exists movimientos_caja (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
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

create table if not exists movimientos_ctacte (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo tipo_movimiento_ctacte not null,
  monto numeric(12, 2) not null,
  metodo_pago metodo_pago,
  venta_id uuid,
  fecha timestamptz not null default now(),
  empleado_id uuid not null references empleados(id),
  nota text
);
create index if not exists movs_ctacte_cliente_idx on movimientos_ctacte(cliente_id, fecha desc);

create table if not exists notas_credito (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  numero text not null,
  venta_id uuid not null references ventas(id) on delete cascade,
  empleado_id uuid not null references empleados(id),
  motivo text not null,
  items jsonb not null,
  monto_total numeric(12, 2) not null,
  fecha timestamptz not null default now()
);
create unique index if not exists notas_credito_empresa_numero_uq on notas_credito(empresa_id, numero);

-- ============== PEDIDOS WEB (e-commerce) ==============

create table if not exists pedidos_web (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  numero integer not null,
  cliente_datos jsonb not null,
  items jsonb not null,
  subtotal numeric not null default 0,
  descuento_total numeric not null default 0,
  total numeric not null default 0,
  metodo_pago text,
  forma_entrega text,
  notas text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','aprobado','rechazado','anulado')),
  motivo_rechazo text,
  venta_id uuid references ventas(id) on delete set null,
  procesado_por uuid references empleados(id) on delete set null,
  procesado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists pedidos_web_estado_idx on pedidos_web(empresa_id, estado);
create index if not exists pedidos_web_creado_en_idx on pedidos_web(empresa_id, creado_en desc);

-- ============== NUMERACIÓN / AUDITORÍA ==============

-- Contadores por empresa (y clave: 'ventas' | 'notas_credito' | 'pedidos_web').
create table if not exists contadores (
  empresa_id uuid not null references empresas(id) on delete cascade,
  clave text not null,
  valor bigint not null default 0,
  primary key (empresa_id, clave)
);

create table if not exists logs_auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  empleado_id uuid references empleados(id),
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  detalle jsonb,
  fecha timestamptz not null default now()
);
create index if not exists auditoria_fecha_idx on logs_auditoria(empresa_id, fecha desc);
