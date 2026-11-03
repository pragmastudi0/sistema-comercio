# Changelog

> Bitácora del repo `sistema-comercio` (producto SaaS multi-empresa). Agregar una entrada por
> sesión al cierre. El historial del proyecto original (Turisteando, a medida) **no** vive acá:
> quedó en el repo `comercio`.

---

### 2026-11-03 — Sesión 1 (bootstrap del repo SaaS)
- Creado el repo `sistema-comercio` como fork **greenfield** del sistema hecho a medida para
  Turisteando, con el objetivo de convertirlo en un **producto SaaS multi-empresa** (datos de
  cada empresa aislados por `empresa_id` + RLS por inquilino). Ver plan completo del proyecto.
- Historial de git limpio (sin arrastrar commits ni datos del cliente original).
- Removidos del árbol los archivos y scripts específicos de Turisteando (manual de cliente,
  importadores one-off, resets de go-live, changelog con PII del cliente).
- Documentación reorganizada para IA: `CLAUDE.md` lean + `docs/` (`ARQUITECTURA`, `SCHEMA`,
  `PRODUCTIZACION`, `ONBOARDING-CLIENTE`, `DEMO`, `RESTORE`) + `.env.example` por app.
- `SUPER_ADMIN_EMAILS` / `PRAGMA_DEV_EMAILS` (`packages/business/src/dev-access.ts`) pasan a ser
  solo el operador del SaaS; el super-admin por-empresa se resolverá por rol en cada empresa.

**Pendiente** (según plan): consolidar migraciones (Fase 1), multi-tenancy en DB + RLS por
inquilino (Fase 2), "empresa actual" en la capa de datos (Fase 3), apps + tienda web por
subdominio (Fase 4), provisioning de empresas (Fase 5), verificación de aislamiento (Fase 6).
