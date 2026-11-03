# CLAUDE.md

> Guía estable para trabajar en este repo. **Leer antes de cada sesión.**
> Acá va solo lo que no cambia seguido. El historial de sesiones vive en
> [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — actualizarlo al cierre de cada sesión.

## Mapa de documentación

| Documento | Para qué |
| --- | --- |
| **CLAUDE.md** (este) | Stack, estructura, reglas de datos, convenciones. Punto de entrada. |
| [`README.md`](./README.md) | Setup y comandos (para humanos). |
| [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md) | Detalle de la capa de datos, permisos y flujos críticos. |
| [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Estado del schema Supabase y migraciones (fuente de verdad). |
| [`docs/PRODUCTIZACION.md`](./docs/PRODUCTIZACION.md) | Roadmap multi-cliente + catálogo de hardcodings a generalizar. |
| [`docs/ONBOARDING-CLIENTE.md`](./docs/ONBOARDING-CLIENTE.md) | Cómo dar de alta un cliente/instancia nueva. |
| [`docs/DEMO.md`](./docs/DEMO.md) | Modo demo (sin Supabase, datos en memoria). |
| [`docs/RESTORE.md`](./docs/RESTORE.md) | Backups y restauración. |
| [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | Bitácora de todas las sesiones. |

---

## 1. Qué es esto

Producto **SaaS multi-empresa** de gestión comercial para retail minorista:
**PoS (caja) + Admin web + e-commerce**. Cada empresa tiene sus datos **aislados**
(sus usuarios, locales, depósitos, catálogo, ventas, caja…) en una base compartida, separados
por `empresa_id` + RLS por inquilino.

Es un fork **greenfield** de un sistema que nació a medida para un cliente (Turisteando) y hoy
se está convirtiendo en producto. Ese cliente original corre en su propio repo/instancia
(`comercio`) y **no** se toca desde acá.

Rasgos del dominio (heredados del caso de uso origen, ajustables por empresa):
- Varios locales con caja, depósitos físicos + 1 depósito virtual "Web".
- Catálogo grande con categorías. Códigos internos numéricos (sin código de barras).
- Marca dentro del nombre del producto (no es campo separado).
- **Velocidad de caja es prioridad #1** (retail de terminal: tickets cortos, alta rotación).

> ⚠️ **En transición a multi-empresa.** Todavía quedan supuestos de empresa única y hardcodings
> del caso origen (branding, URLs, claves de localStorage, `PRESET_IDS.empresa`, numeración
> global, emails super-admin). El trabajo pendiente está en [`docs/PRODUCTIZACION.md`](./docs/PRODUCTIZACION.md)
> y el plan de fases. Al tocar esas zonas, resolver el supuesto en vez de propagarlo.

---

## 2. Stack (cerrado, no negociable sin discusión)

- Monorepo: pnpm workspaces + Turborepo · TypeScript 5.6+ estricto
- **PoS**: React 18 + Vite + PWA (`vite-plugin-pwa`)
- **Admin**: Next.js 14 (app router)
- **Web (e-commerce)**: Next.js 14
- UI: Tailwind + componentes propios en `packages/ui` (estilo shadcn)
- Estado servidor: TanStack Query v5 · Estado UI: Zustand
- Forms: React Hook Form + Zod · Tablas: TanStack Table v8 · Fechas: date-fns
- DB: Supabase (Postgres + Auth + Realtime + Storage + Edge Functions)
- Hosting: Vercel · Email: Resend
- Tests: Vitest + Playwright (E2E críticos) · Lint: ESLint + Prettier
- Keyboard: react-hotkeys-hook · Toasts: sonner

No agregar dependencias sin confirmar.

---

## 3. Estructura del monorepo

```
comercio/
├── apps/
│   ├── pos/            # Vite + React + PWA (caja)
│   ├── admin/          # Next.js 14 (gestión)
│   └── web/            # Next.js 14 (e-commerce)
├── packages/
│   ├── db/             # Tipos + interfaces de repos + impl (mock / supabase)
│   ├── ui/             # Primitives propios (Button, Card, Table, Input, …)
│   ├── business/       # Lógica pura (permisos, pricing, stock, caja, mayorista, validators)
│   └── config/         # ESLint, Tailwind, TS configs compartidos
├── supabase/           # migrations/ + functions/
├── scripts/            # Importadores, creación de usuarios, migraciones sueltas (ver scripts/README.md)
└── docs/               # Documentación (ver mapa arriba)
```

Imports: alias absolutos `@/`, `@comercio/db`, `@comercio/business`, `@comercio/ui`.

---

## 4. Capa de datos (packages/db)

La capa vive detrás de **interfaces de repo** (`packages/db/src/repos/`). El consumidor
obtiene un `DbClient` y no sabe si habla con mocks o con Supabase. Hay dos implementaciones:

- **mock** (`packages/db/src/mock/`, seed en `seed.ts`) → modo demo / dev sin DB.
- **supabase** (`packages/db/src/supabase/`) → producción.

La selección es **automática por env**: si están las vars de Supabase, usa Supabase;
si no, cae al mock. Las apps obtienen el singleton vía `src/lib/db.ts` (`getDb()` por app).

`DbClient` agrupa 17 repos: `productos`, `categorias`, `proveedores`, `clientes`, `ctaCte`,
`empleados`, `roles`, `locales`, `depositos`, `cajas`, `sesionesCaja`, `stock`,
`transferencias`, `listasPrecio`, `ventas`, `configuracion`, `auditoria`.

**Reglas importantes:**
- `packages/db/src/types.ts` es la fuente de verdad de los tipos de dominio.
- El stock vive **por depósito** (`StockItem`). Las ventas descuentan del depósito del cajero.
  Las transferencias generan `transferencia_salida` + `transferencia_entrada`.
- La venta es atómica: descontar stock + movimiento de caja + cta cte si corresponde.
  En Supabase va en una **RPC** (`crear_venta`); en mock lo hace `ventas.crear()`.
- Anulaciones devuelven stock y registran movimiento de caja tipo `anulacion`.
- **PostgREST corta a 1000 filas** sin `.range()`. Cualquier `list()` con volumen usa
  `paginarTodo()` (`packages/db/src/supabase/helpers.ts`). Ver lección en CHANGELOG (Iteración 2/3).
- Supabase **no garantiza orden de arrays JSONB** (escalas de precio) → ordenar defensivo en el repo.

---

## 5. Permisos (packages/business/src/permisos.ts)

- `PermisosConfig` con módulos: `ventas`, `caja`, `productos`, `categorias`, `clientes`,
  `cuenta_corriente`, `stock`, `proveedores`, `listas_precio`, `reportes`, `empleados`,
  `roles`, `configuracion`, `auditoria`.
- Roles preset: `admin`, `encargado`, `cajero`, `catalogo`.
- Cada empleado: `rol_id` + `permisos_override` opcional. Efectivo =
  `evaluarPermisos(rol.permisos, empleado.permisos_override)`.
- En UI: `tienePermiso(permisos, modulo, accion)` o `makePuede(permisos)`.
- Los 4 presets usan el **preset hardcoded de `@comercio/business` como fuente de verdad**
  (no la BD), con excepciones puntuales editables (`productos.ver_costo/ver_margen/ver_precio_venta`).
  Roles custom sí leen de BD. Detalle en [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md).
- **Super-admin / dev de emergencia**: whitelist hardcoded por email en
  `packages/business/src/dev-access.ts` (`SUPER_ADMIN_EMAILS`, `PRAGMA_DEV_EMAILS`).
  Sobrevive a resets de BD. ⚠️ Contiene emails específicos del cliente → ver PRODUCTIZACION.
- **Acciones críticas** (cambio de permisos, asignación de rol, alta/baja de empleado,
  borrado de roles, acciones destructivas del dev) **deben loguearse en `auditoria` ANTES de ejecutar**.

---

## 6. Convenciones de código

- TypeScript estricto. **Sin `any`, sin `@ts-ignore`.**
- Presentacionales en `components/`, hooks con datos en `hooks/use*.ts`.
- Estilos Tailwind, variantes con `cva`. Forms con RHF + Zod (validators en `packages/business`).
- Queries TanStack con keys consistentes. Estado UI cruzado en Zustand.
- Errores: toast con sonner, mensajes **en español accionables**. Loading: Skeleton en listados.
- Optimistic en operaciones frecuentes; **confirmación de servidor para críticas** (cobrar, cerrar caja).
- **Confirm-before-destroy** es no negociable para acciones fáciles de disparar por error.
- Atajos: react-hotkeys-hook, documentados en `apps/pos/src/lib/shortcuts.ts`.
- Naming: archivos `kebab-case.tsx`, componentes `PascalCase`, hooks `useCamelCase`.
- Idioma: UI, mensajes y código **en español**. Comentarios solo cuando el "por qué" no es obvio.
- Commits: convencionales en español, chicos y frecuentes.
- Branches: con producción viva, **feature branch → Vercel preview → test del cliente → merge a main**.

---

## 7. Cómo trabajar (notas para Claude Code)

- **Pausá ante decisiones con trade-offs no triviales.** No agregues dependencias sin confirmar.
- Trabajo incremental: esqueleto que compila → datos → estilos. Commits chicos.
- Tests donde importan: lógica pura de `@comercio/business`, edge cases del PoS con Playwright.
- Patrón de ABMs: `<DataTable>`, `<EntityFormSheet>`, `<DeleteConfirmDialog>`, `useCrud<T>()`.
- Si algo no encaja con el schema o los defaults, **parar y discutir**.
- **RLS silencioso es la primera sospecha** cuando algo "no se guarda" en Supabase sin error.
  El SQL Editor usa `service_role` y siempre pasa; testear con role `authenticated` real.
- Cliente reporta **síntomas, no causas**. Escuchar el síntoma, no diagnosticar por dónde parece.
- Al cierre de cada sesión, agregar entrada en [`docs/CHANGELOG.md`](./docs/CHANGELOG.md).
