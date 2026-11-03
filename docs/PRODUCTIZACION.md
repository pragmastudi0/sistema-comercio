# Productización multi-cliente

> Roadmap para convertir este sistema (hoy hecho a medida de Turisteando) en algo que se
> pueda instanciar para **nuevos clientes** con mínimo esfuerzo por alta.

El sistema **ya está en producción para Turisteando**. Toda generalización se hace sin romper
esa instancia: feature branch → Vercel preview → test → merge. Prioridad: no regresión.

## Modelo objetivo

Una instancia = un proyecto Supabase + 3 deploys Vercel (admin/pos/web) + un set de env vars.
El **código es el mismo** para todos; lo que cambia por cliente son datos y configuración.
Todo lo específico del cliente debe salir por **env var** o por la **tabla `configuracion_empresa`**,
nunca hardcodeado.

## Fases

1. **Fundación de docs + estructura** ✅ (sesión 2026-11-03): docs reorganizados, `.env.example`,
   archivos de cliente fuera de la raíz, scripts indexados.
2. **Consolidar el schema** → una base limpia = producción. Ver [`SCHEMA.md`](./SCHEMA.md).
3. **Sacar los hardcodings de Turisteando** (catálogo abajo). Que el branding, URLs, datos de
   empresa y claves salgan de env/config.
4. **Alta de cliente reproducible** → documentar y/o scriptar el flujo de [`ONBOARDING-CLIENTE.md`](./ONBOARDING-CLIENTE.md).
5. **Seed parametrizable** → `createMockClient` y el seed inicial de una instancia nueva
   tomando nombre de comercio, locales, depósitos, cuotas, etc. de un único lugar.

## Catálogo de hardcodings a generalizar

### Branding ("#turisteando" / "Turisteando")
`packages/business/src/brand.ts` ya centraliza el nombre vía `NEXT_PUBLIC_BRAND_NAME` /
`VITE_BRAND_NAME`. Pero hay strings literales que **no** pasan por ahí:

- `apps/admin/src/app/layout.tsx` — `title: '#turisteando · Admin'`.
- `apps/admin/src/components/admin-shell.tsx` — `<span>Turisteando</span>`.
- `apps/admin/src/lib/pdf-catalogo.ts` — fallback `'Turisteando'`.
- `apps/admin/src/app/backup/page.tsx` — labels y nombres de archivo `turisteando-backup_*`.
- `apps/pos/vite.config.ts` — manifest PWA `name: '#turisteando · PoS'`, `short_name`.
- `apps/admin/src/app/login/page.tsx` — placeholder `admin@turisteando.local`.
- `apps/web/src/lib/config.ts` — `nombre` default `'turisteando'`.

→ **Acción**: todos deben leer de `BRAND` / env / `configuracion_empresa`.

### URLs cross-app hardcodeadas (`*.vercel.app`)
Ya existen env vars (`NEXT_PUBLIC_POS_URL`, `NEXT_PUBLIC_WEB_URL`, `VITE_ADMIN_URL`) pero con
**fallback hardcodeado a los deploys de Turisteando**:

- `apps/admin/src/components/admin-shell.tsx` → `https://turisteando-pos.vercel.app`.
- `apps/admin/src/app/web/page.tsx` → `https://turisteando-web.vercel.app`.
- `apps/pos/src/pages/Caja.tsx` → `https://turisteando-admin.vercel.app`.

→ **Acción**: dejar el fallback vacío/relativo o fallar ruidoso en vez de apuntar a otra instancia.

### Claves de localStorage con prefijo `turisteando-`
`turisteando-admin-sesion`, `turisteando-pos-sesion-v2`, `turisteando-pos-sesion`,
`turisteando-pos-carrito`, `turisteando-web-carrito`.

→ **Acción**: derivar el prefijo del brand/slug de la instancia (evita colisión si dos
instancias corren en el mismo dominio padre; raro pero más limpio).

### Regex que quita el prefijo "#Turisteando" de los nombres de depósito
- `apps/admin/src/app/ventas/page.tsx` (`/^#?\s*turisteando\s*/i`).
- `apps/pos/src/components/BuscadorProducto.tsx` (ídem).

→ **Acción**: esto asume que los depósitos se llaman "#Turisteando B12". Para otros clientes
el nombre corto debería salir de un campo, no de un regex con el nombre del cliente embebido.

### Emails de super-admin / dev hardcodeados
`packages/business/src/dev-access.ts` — `SUPER_ADMIN_EMAILS` incluye el email del dueño de
Turisteando; `PRAGMA_DEV_EMAILS` el del dev.

→ **Acción**: `PRAGMA_DEV_EMAILS` (dev de la agencia) está bien que quede fijo. El email del
**dueño** debería venir por env/config por instancia, no en el código compartido.

### ID legacy de lista de precios `'lp_cf'`
Varios call-sites buscan por `[PRESET_IDS.listas.consumidorFinal, 'lp_cf']` para tolerar el id
legacy del mock. No es específico de Turisteando pero es deuda: conviene unificar en un helper
único en `packages/db` en vez de repetir `LISTA_CF_IDS` en 5 lugares.

### Políticas de negocio asumidas de Turisteando
Comentarios `// Política Turisteando` marcan decisiones que pueden no valer para otro cliente:
vender siempre aunque el stock quede negativo, no devolver plata (solo cambio), el dueño retira
el efectivo del turno, el cajero no ve cantidades totales. Revisar cuáles deben ser
**configurables** (`configuracion_empresa`) vs fijas.

## Cómo usar este doc

Al atacar la Fase 3, ir tachando cada bullet. Al tocar una zona marcada acá, resolver el
hardcoding en el mismo PR en vez de propagarlo.
