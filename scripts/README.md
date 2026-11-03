# scripts/

Utilidades de operación y datos. No forman parte del build. Credenciales via `scripts/.env`
(ver `.env.example`). La mayoría necesita la **service_role key** de Supabase — tratarla como secreto.

## Importadores de catálogo / stock

| Script | Qué hace |
| --- | --- |
| `excel-a-json.py` | Convierte el Excel del cliente a JSON intermedio. Correr primero. |
| `importar-stock.mjs <local>` | UPSERT productos/categorías/proveedores + SET stock por depósito + precio CF. |

> Nota multi-empresa: estos importadores asumen una empresa. Al ejecutar la Fase 3/5 del plan
> (ver `../docs/PRODUCTIZACION.md`) deben recibir el `empresa_id` destino como parámetro.

## Alta de usuarios / roles / empresas

| Script | Qué hace |
| --- | --- |
| `crear-usuario-demo.mjs` | Usuarios demo para presentaciones. |
| `rol-demo.sql` | Rol "Demo (solo lectura)" para prospectos. |

> Pendiente (Fase 5): `provisionar-empresa` — alta de una empresa nueva (empresa +
> configuración + roles preset + listas + depósito central + primer admin + subdominio).

## Migraciones SQL (pendientes de consolidar)

⚠️ Estas migraciones se aplicaron a mano en el SQL Editor del sistema original y **todavía no
están incorporadas** a `supabase/migrations/`. La **Fase 1** del plan las consolida en una
secuencia numerada. Ver [`../docs/SCHEMA.md`](../docs/SCHEMA.md).

`migrations-iteracion-{1,5,7,10,11}.sql`, `migrations-categoria-nullable.sql`,
`migrations-proveedor-nullable.sql`, `migrations-stock-atomico.sql`,
`migrations-mayorista-descuento.sql`, `migrations-mayorista-desde-monto.sql`,
`migrations-pedidos-web.sql`.

## Deploy

| Script | Qué hace |
| --- | --- |
| `deploy-demo.sh` | Levanta los proyectos demo en Vercel (ver `../docs/DEMO.md`). |
