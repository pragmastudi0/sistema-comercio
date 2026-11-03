# Arquitectura

Detalle de la capa de datos, el sistema de permisos y los flujos críticos. Para el resumen
y las convenciones, ver [`../CLAUDE.md`](../CLAUDE.md).

## Monorepo

- **`apps/pos`** — caja (Vite + React + PWA). Prioridad: velocidad de teclado. Corre offline-first.
- **`apps/admin`** — gestión (Next.js 14 app router). ABMs, reportes, caja, backup.
- **`apps/web`** — e-commerce mayorista (Next.js 14). Catálogo + carrito que termina en WhatsApp.
- **`packages/db`** — tipos + interfaces de repos + dos implementaciones (mock / supabase).
- **`packages/business`** — lógica pura sin IO: `permisos`, `pricing`, `stock`, `caja`,
  `mayorista`, `validators`, `brand`, `dev-access`.
- **`packages/ui`** — primitives (Button, Card, Table, Input, Sheet, Dialog, Tabs…).
- **`packages/config`** — ESLint/Tailwind/TS compartidos.

## Capa de datos

```
app → getDb() (src/lib/db.ts) → DbClient → repo (interfaz) → impl mock | supabase
```

- La **interfaz** de cada repo vive en `packages/db/src/repos/`. Es el contrato.
- El **mock** (`packages/db/src/mock/`) mantiene todo en memoria con seed (`seed.ts`).
  Usado en modo demo y dev sin DB.
- La impl **supabase** (`packages/db/src/supabase/`) habla con Postgres vía PostgREST + RPCs.
- Selección automática por env (ver [`DEMO.md`](./DEMO.md)): hay vars de Supabase → supabase; si no → mock.

### Reglas de oro (aprendidas en producción)

- **Paginación**: PostgREST devuelve máximo 1000 filas sin `.range()`. Todo `list()` con
  volumen real usa `paginarTodo()` (`packages/db/src/supabase/helpers.ts`). Afecta a
  `ventas`, `notas_credito`, `transferencias`, `auditoria`.
- **Orden de arrays JSONB**: Supabase no garantiza el orden de las escalas de precio.
  Ordenar por `desde` ASC de forma defensiva en el repo y en `pricing.ts`.
- **RLS silencioso**: `UPDATE`/`DELETE` sin policy para `authenticated` fallan sin error.
  Siempre testear con un usuario real, no con el SQL Editor (que usa `service_role`).
- **Cache de React Query**: dos números distintos para el mismo dato casi siempre es
  `staleTime` alto + dos fuentes que no leen del mismo cache. Bajar `staleTime` y unificar fuente.

### Venta atómica

La venta descuenta stock + registra movimiento de caja + carga cta cte si corresponde, todo
junto. En Supabase es la RPC `crear_venta`; en el mock lo hace `ventas.crear()`. Las
anulaciones devuelven stock y registran movimiento de caja tipo `anulacion`. El cambio
(devolución) genera una nota de crédito y, si hay diferencia, una venta nueva vinculada.

## Permisos

- Config por módulo/acción (`PermisosConfig`), definida en `packages/business/src/permisos.ts`.
- Roles preset: `admin`, `encargado`, `cajero`, `catalogo`. El permiso efectivo de un empleado
  es `evaluarPermisos(rol.permisos, empleado.permisos_override)`.
- **Decisión clave**: para los 4 presets, el hook `usePermisos` usa el **preset hardcoded de
  `@comercio/business` como fuente de verdad, ignorando la BD** → un cambio en el código se
  aplica al instante sin tocar datos. Excepciones editables desde BD:
  `productos.ver_costo`, `productos.ver_margen`, `productos.ver_precio_venta`. Roles custom
  sí leen de BD. Mantener cualquier nueva excepción explícita y mínima.
- **Super-admin / dev de emergencia** (`packages/business/src/dev-access.ts`): whitelist
  hardcoded por email. `esSuperAdmin(empleado)` bypasea todo `puede(...)`. `esPragmaDev` da
  acceso a corregir sesiones de caja rotas. Sobrevive a resets de BD a propósito.
- **Auditoría**: toda acción crítica se loguea en `auditoria` **antes** de ejecutarse
  (incluso borrados); si el borrado falla, el log queda igual para reconstruir qué se intentó.

## Flujos críticos del PoS

- **Caja multi-sesión**: una caja física puede tener varias sesiones (turnos solapados).
  `empleado_id` = quién abrió; `empleado_actual_id` = responsable actual ("tomar posta").
  Cerrar una cierra las otras de la misma caja física. Cada venta apunta a la sesión de quién cobró.
- **Arqueo**: compara el declarado contra `saldo_inicial` (no contra "efectivo esperado").
  El dueño retira el efectivo del turno (`declarado − inicial`).
- **Service worker + deploys**: el HTML va por `NetworkFirst` (timeout 3s) + `cleanupOutdatedCaches`.
  Los chunks JS se precachean (offline-first). Precachear el HTML causaba pantalla en blanco tras deploy.

## Branding

`packages/business/src/brand.ts` expone `BRAND`. Se puede sobreescribir por env:
`NEXT_PUBLIC_BRAND_NAME` (Next) / `VITE_BRAND_NAME` (Vite, vía `setBrandName()` en `main.tsx`).
Default: `#turisteando`. ⚠️ Hay muchos lugares donde el branding **no** pasa por acá y está
hardcodeado — ver [`PRODUCTIZACION.md`](./PRODUCTIZACION.md).
