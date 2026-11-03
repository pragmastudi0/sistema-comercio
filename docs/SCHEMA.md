# Schema de base de datos (Supabase/Postgres) — MULTI-EMPRESA

> Estado del esquema y de las migraciones. **Leer antes de tocar SQL o levantar una instancia nueva.**

## Migraciones (consolidadas, aplican de cero)

El esquema vive **solo** en `supabase/migrations/`, en orden:

| Archivo | Contenido |
| --- | --- |
| `0001_schema.sql` | Tablas, enums, índices, constraints. Multi-tenant: `empresa_id` en toda tabla de dominio. |
| `0002_functions_triggers.sql` | Helpers de contexto, numeración por empresa, RPCs (venta/NC/stock/pedido), triggers. |
| `0003_rls.sql` | RLS por inquilino + lectura pública de catálogo (anon) + grants + storage. |
| `0004_seed_provisioning.sql` | `rpc_provisionar_empresa` (alta de empresa) + seed demo opcional. |

Se consolidaron las 14 migraciones + 11 SQL sueltos del sistema original en este set limpio.

## Modelo multi-empresa (cómo aísla)

- **`empresa_id` en cada tabla de dominio.** La tabla raíz es `empresas` (con `subdominio`
  para la tienda web). `configuracion_empresa` cuelga 1:1 de `empresas`.
- **RLS por inquilino** (`0003`): los usuarios `authenticated` solo ven/escriben filas donde
  `empresa_id = empresa_actual_id()`. Helper `empresa_actual_id()` (SECURITY DEFINER) = la
  `empresa_id` del empleado de `auth.uid()`.
- **Trigger `set_empresa_id_default`**: en INSERT de un usuario logueado, si `empresa_id` viene
  null, se setea solo a su empresa → el código de la app casi no cambia para insertar.
- **Tienda web (anon)**: lee catálogo (`productos`, `categorias`, `listas_precio`,
  `producto_lista_precio`, `producto_imagenes`, `variantes`) + `empresas` + `configuracion_empresa`
  con policy `select to anon using(true)`; la app filtra por `empresa_id` resuelto del **subdominio**.
- **Roles preset por empresa**: cada empresa tiene sus 4 roles (`preset_key` =
  `admin|encargado|cajero|catalogo`). La RLS y los permisos del front se apoyan en `preset_key`,
  **no** en UUIDs fijos. `is_admin()`/`is_admin_or_encargado()` leen `preset_key`.
- **Numeración por empresa**: `contadores` PK `(empresa_id, clave)`; `siguiente_numero(empresa, clave)`
  incrementa atómico. El prefijo del comprobante sale de `locales.numeracion_prefijo` (punto de venta),
  no es un literal `'0001'`.

## RPCs clave

- `rpc_crear_venta` — venta atómica (stock + caja + cta cte). Deriva empresa de `empresa_actual_id()`.
  Permite stock negativo (no valida). En el mock lo replica `ventas.crear()`.
- `rpc_emitir_nota_credito` — NC atómica (devuelve stock). Numera por empresa.
- `rpc_aplicar_delta_stock` — delta de stock atómico con `FOR UPDATE` (evita lost updates).
- `rpc_crear_pedido_web(p_empresa_id, ...)` — alta de pedido desde la web (anon); SECURITY DEFINER,
  recibe la empresa explícita (resuelta por subdominio).
- `rpc_provisionar_empresa(nombre, subdominio, cuit)` — alta de empresa (operador/service_role).

## ⚠️ Pendiente de verificación (Fase 6 del plan)

Este schema está **escrito pero NO verificado contra una base real todavía** (no hay proyecto
Supabase del SaaS aún). Antes de confiar en él:

1. Aplicar las 4 migraciones en una base limpia (Supabase branch o local).
2. Provisionar 2 empresas (`rpc_provisionar_empresa`) + un admin en cada una.
3. **Test de aislamiento con usuarios `authenticated` reales** (no el SQL Editor, que usa
   service_role y siempre pasa): un empleado de la empresa A no debe ver productos/ventas/clientes/
   caja de la B. Esta es la lección #1 del sistema original: **la RLS falla en silencio**.
4. Venta end-to-end en cada empresa: numeración independiente + prefijo del local.

## TODOs de seguridad conocidos

- `configuracion_empresa` se expone a anon entera (la web la necesita), pero incluye `arranque`
  (facturación acumulada). Refinar exponiendo solo columnas públicas vía una vista.
- Storage `producto-imagenes`: la escritura autenticada no valida el prefijo de empresa del path.
  Validar `<empresa_id>/...` en la policy de INSERT (Fase 4).

## Tipos TypeScript

`packages/db/src/types.ts` es la fuente de verdad de los tipos de dominio. Al cambiar el schema,
mantenerlos en sync (o regenerar con `supabase gen types typescript`). Agregar `empresa_id` a los
tipos que lo necesiten al hacer la Fase 3.
