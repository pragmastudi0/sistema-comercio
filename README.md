# Comercio

Sistema de gestión comercial para retail: **PoS (caja) + Admin web + e-commerce**.
En producción para **Turisteando** (Terminal de Córdoba); en proceso de generalización
para nuevos clientes.

## Requisitos

- Node 20.10+
- pnpm 9+

## Setup

```bash
pnpm install

# Opcional: configurar Supabase por app (si no, corre en modo demo con datos mock)
cp apps/admin/.env.example apps/admin/.env.local
cp apps/pos/.env.example   apps/pos/.env.local
cp apps/web/.env.example   apps/web/.env.local

pnpm dev          # levanta admin + pos en paralelo
```

| App    | URL dev                  | Framework |
| ------ | ------------------------ | --------- |
| Admin  | http://localhost:3000    | Next.js   |
| PoS    | http://localhost:3100    | Vite      |
| Web    | http://localhost:3200    | Next.js   |

Sin env vars de Supabase, cada app arranca en **modo demo** (datos en memoria). Ver
[`docs/DEMO.md`](./docs/DEMO.md).

## Comandos

```bash
pnpm dev:admin    # solo admin
pnpm dev:pos      # solo PoS
pnpm typecheck    # tsc --noEmit en todo el monorepo
pnpm lint
pnpm test
pnpm build
```

## Documentación

Todo arranca en [`CLAUDE.md`](./CLAUDE.md) (stack, estructura, reglas). Docs específicos
en [`docs/`](./docs):

- [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md) — capa de datos, permisos, flujos críticos.
- [`docs/SCHEMA.md`](./docs/SCHEMA.md) — estado del schema y migraciones.
- [`docs/ONBOARDING-CLIENTE.md`](./docs/ONBOARDING-CLIENTE.md) — alta de un cliente nuevo.
- [`docs/PRODUCTIZACION.md`](./docs/PRODUCTIZACION.md) — roadmap multi-cliente.
- [`docs/DEMO.md`](./docs/DEMO.md) · [`docs/RESTORE.md`](./docs/RESTORE.md) · [`docs/CHANGELOG.md`](./docs/CHANGELOG.md)
