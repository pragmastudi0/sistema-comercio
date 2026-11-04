# Alta de un cliente nuevo

Pasos para levantar una instancia real (con Supabase) para un cliente nuevo. Para una demo
sin DB, ver [`DEMO.md`](./DEMO.md).

> Estado: el código todavía tiene hardcodings de Turisteando (ver [`PRODUCTIZACION.md`](./PRODUCTIZACION.md)).
> Mientras no se completen esas fases, revisá el catálogo antes de prometer un alta 100% por config.

## 1. Base de datos (Supabase)

1. Crear un proyecto Supabase nuevo (una sola base sirve a todas las empresas si es multi-tenant;
   ver [`SCHEMA.md`](./SCHEMA.md)).
2. Aplicar las migraciones `supabase/migrations/0001`–`0004` (aplican de cero, en orden). Todo el
   modelo queda bajo el schema **`sistema_comercio`**.
3. **Exponer el schema `sistema_comercio`** en Supabase (Settings → API → Exposed schemas, o el
   SQL equivalente en [`SCHEMA.md`](./SCHEMA.md)). Sin esto, la API REST no ve las tablas.
4. Crear el bucket de storage `producto-imagenes` (las policies van en `0003_rls.sql`).
5. Desplegar la Edge Function `supabase/functions/set-empleado-password`.
6. **Dar de alta la empresa**: `select * from sistema_comercio.rpc_provisionar_empresa('<nombre>', '<subdominio>', '<cuit>');`
   (crea empresa + configuración + 4 roles preset + listas CF/Mayorista + depósito central).
7. Crear el primer usuario admin (Supabase Auth + fila `empleados` con rol admin de la empresa),
   con un script que use el `service_role` + Auth Admin API.
8. Ajustar la configuración del comercio en `configuracion_empresa` (cuotas, descuento efectivo,
   datos del comercio, etc.).

## 2. Datos iniciales

- **Locales, depósitos, cajas, roles, empleados**: ver `scripts/crear-empleados-*.mjs` como
  referencia (hoy específico de Turisteando; parametrizar al productizar).
- **Catálogo + stock**: el cliente entrega un Excel. Flujo:
  1. `scripts/excel-a-json.py` → convierte el Excel a JSON.
  2. `scripts/importar-stock.mjs <local>` → UPSERT de productos/categorías/proveedores + SET
     de stock por depósito + precio Consumidor Final.
  - Credenciales via `scripts/.env` (ver `scripts/.env.example`). **No** usar `export` en el
    shell (zsh con clipboard sucio rompió intentos previos — ver CHANGELOG go-live).
- **Reset previo a producción**: `scripts/reset-transacciones-go-live.sql` borra las
  transacciones de prueba dejando catálogo/stock/empleados intactos y resetea los contadores.

## 3. Deploys (Vercel)

Tres proyectos Vercel apuntando al mismo repo, con distinto Root Directory:

| Proyecto | Root Directory | Framework |
| --- | --- | --- |
| `<cliente>-admin` | `apps/admin` | Next.js |
| `<cliente>-pos`   | `apps/pos`   | Vite (output `dist`) |
| `<cliente>-web`   | `apps/web`   | Next.js |

Env vars por proyecto: copiar del `.env.example` de cada app y completar con el Supabase del
cliente + branding + URLs cruzadas. Ojo con los fallbacks hardcodeados a `*.vercel.app` de
Turisteando (ver PRODUCTIZACION): setear explícitamente `NEXT_PUBLIC_POS_URL`,
`NEXT_PUBLIC_WEB_URL`, `VITE_ADMIN_URL`.

## 4. Backups

Configurar el workflow de backup (ver [`RESTORE.md`](./RESTORE.md)): secrets `SUPABASE_DB_URL`
(session pooler) + `BACKUP_REPO_TOKEN`, y un repo de backups separado por cliente.

## Checklist rápido

- [ ] Proyecto Supabase + schema aplicado y verificado contra un dump
- [ ] `configuracion_empresa` cargada
- [ ] Locales / depósitos / cajas / roles / empleados
- [ ] Catálogo + stock importados
- [ ] Reset transaccional corrido
- [ ] 3 deploys Vercel con env vars completas (sin fallbacks a otra instancia)
- [ ] Backups configurados
- [ ] Super-admin (email del dueño) habilitado
