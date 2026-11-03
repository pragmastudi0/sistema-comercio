# Disaster Recovery — Turisteando

Runbook para reconstruir el sistema desde cero si Supabase o Vercel
dejan de funcionar. Los backups automáticos corren todas las noches y
se guardan en el repo privado
[pragmastudi0/turisteando-backups](https://github.com/pragmastudi0/turisteando-backups).

Última revisión de este documento: 2026-08-03.

---

## Cuándo usar este runbook

- Un `DELETE` masivo mal hecho borró data crítica.
- Supabase suspendió el proyecto o la cuenta.
- Migración de BD rompió algo y el rollback no alcanza.
- Necesitás levantar un entorno de staging idéntico a producción.

## Antes de arrancar

Reunir credenciales / accesos:

- Cuenta de GitHub con acceso al repo `pragmastudi0/turisteando-backups` (donde están los `.sql.gz`).
- Cuenta de GitHub con acceso al repo `pragmastudi0/comercio` (código).
- Cuenta de Vercel con acceso al proyecto.
- Cuenta de Supabase (nueva si el problema es a nivel proveedor).
- Variables de entorno del proyecto (guardadas en Vercel → Settings → Environment Variables).

---

## Escenario A: Restaurar la BD en la Supabase actual

Cuando la Supabase está OK pero la data está corrupta o falta.

### 1. Bajar el backup más reciente
```bash
git clone --depth 1 https://github.com/pragmastudi0/turisteando-backups.git
cd turisteando-backups
ls -1 turisteando_*.sql.gz | sort -r | head -1
```

El último archivo listado es el más reciente. Descomprimir:

```bash
gunzip turisteando_YYYY-MM-DD_HH-MM-SS.sql.gz
```

Queda un `.sql` legible.

### 2. Restaurar

**IMPORTANTE**: esto **DROPEA** todas las tablas actuales y las recrea
desde el backup. Todo lo que no esté en el backup se pierde.

```bash
psql "$SUPABASE_DB_URL" < turisteando_YYYY-MM-DD_HH-MM-SS.sql
```

Donde `SUPABASE_DB_URL` la sacás de Supabase Dashboard → Settings →
Database → Connection String → URI (o Session Pooler para IPv4).

### 3. Verificar

- Entrar al admin y revisar que ventas, productos, empleados estén.
- Probar login desde el PoS.
- Chequear el dashboard con datos del último día backupeado.

---

## Escenario B: Recrear todo el proyecto en una Supabase nueva

Cuando Supabase suspendió el proyecto o querés migrar de cuenta.

### 1. Crear nuevo proyecto en Supabase
- supabase.com → New Project.
- Región: `sa-east-1` (São Paulo) — misma que la actual, baja latencia.
- Plan: Pro (USD 25/mes). El Free tier no soporta el volumen.
- Anotar el password del postgres (aparece 1 sola vez).

### 2. Obtener la nueva Connection String
Settings → Database → Connection String → URI (o Session Pooler para IPv4).

### 3. Restaurar el backup
```bash
git clone --depth 1 https://github.com/pragmastudi0/turisteando-backups.git
cd turisteando-backups
gunzip turisteando_YYYY-MM-DD_HH-MM-SS.sql.gz
psql "$NUEVA_SUPABASE_DB_URL" < turisteando_YYYY-MM-DD_HH-MM-SS.sql
```

### 4. Actualizar Vercel

En Vercel → tu proyecto → Settings → Environment Variables, actualizar
para cada uno de los proyectos (admin, pos, web):

- `NEXT_PUBLIC_SUPABASE_URL` → URL del proyecto nuevo (`https://xxx.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → Anon key (Settings → API)
- `SUPABASE_SERVICE_ROLE_KEY` → Service role key (misma pantalla)

### 5. Redeployar

En cada proyecto de Vercel → Deployments → último deploy → **Redeploy**.

### 6. Actualizar el workflow de backup

En GitHub → repo `comercio` → Settings → Secrets and variables →
Actions, actualizar `SUPABASE_DB_URL` con la nueva connection string.
Sino los próximos backups van a la Supabase vieja.

### 7. Verificar RLS policies

Es posible que algunas policies de RLS no vengan bien en el dump.
Contra-check: entrar como cajero y confirmar que:

- Puede abrir caja.
- Puede vender.
- Puede cerrar caja.

Si algo falla con permisos, revisar policies en Supabase → Auth → Policies.

---

## Escenario C: Recrear todo en un nuevo proveedor

Solo si tanto Vercel como Supabase están fuera de juego. Reemplazos:

- **Base de datos**: cualquier Postgres 17+ (Neon, Railway, self-hosted).
- **Hosting**: cualquier plataforma Node (Netlify, Cloudflare Pages, Railway, VPS con PM2).
- **Auth**: si migrás fuera de Supabase, la auth actual no se traduce.
  Habría que migrar a otro provider (Clerk, Auth.js, custom).

Este escenario es el más complejo y requiere 1-2 días. No documentado
en detalle por baja probabilidad.

---

## Test de recovery (hacer cada 6 meses)

Para asegurarnos que los backups funcionan de verdad:

1. Crear un proyecto Supabase de test (Free tier alcanza).
2. Clonar el repo de backups y descomprimir el más reciente.
3. Restaurar con el comando del Escenario A.
4. Ejecutar queries de sanity check:
   ```sql
   SELECT count(*) FROM ventas;
   SELECT count(*) FROM productos;
   SELECT count(*) FROM movimientos_stock;
   SELECT max(fecha) FROM ventas;
   ```
5. Los números tienen que dar consistentes con producción.
6. Borrar el proyecto de test cuando termines.

Si algún paso falla, arreglar antes de que sea urgente.

---

## Cómo funciona el sistema de backup por dentro

- **Workflow**: `.github/workflows/backup-db.yml` en este repo.
- **Cron**: todos los días a las 06:00 UTC (03:00 hora Argentina).
- **Proceso**:
  1. Instala `postgresql-client-17`.
  2. `pg_dump` de toda la BD, comprime con gzip.
  3. Sanity check: dump tiene que pesar al menos 10 KB (si no, aborta).
  4. Clona el repo `turisteando-backups`.
  5. Copia el archivo nuevo.
  6. Rotación: mantiene los últimos 30 archivos, borra los más viejos.
  7. Commit + push al repo de backups.
- **Trigger manual**: Actions → "Backup diario de Supabase → GitHub" → Run workflow. Útil antes de una migración crítica.
- **Secrets requeridos** (en el repo `comercio`):
  - `SUPABASE_DB_URL`: connection string de Supabase.
  - `BACKUP_REPO_TOKEN`: Personal Access Token con permiso `contents: write` sobre `turisteando-backups`.

---

## Contacto

Si algo de este runbook está desactualizado, avisar a
pragmasolucionesdigitales@gmail.com para corregirlo.
