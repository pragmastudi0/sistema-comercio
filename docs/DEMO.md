# Cómo armar una instancia demo

El sistema soporta correr en modo "demo": sin Supabase conectado, todo
contra datos en memoria (~50 productos, 2 sucursales, 3 cajas, 3 roles,
un par de clientes). Sirve para enseñarle a un prospect sin exponer
datos reales y sin necesidad de crear una base de datos nueva.

Probado con **Comercio Demo** como nombre, pero el branding se puede
cambiar por env var.

---

## ¿Cómo funciona el modo demo?

Cada app (`admin`, `pos`, `web`) lee dos env vars de Supabase:

```
NEXT_PUBLIC_SUPABASE_URL     ← admin y web (Next.js)
NEXT_PUBLIC_SUPABASE_ANON_KEY
VITE_SUPABASE_URL            ← pos (Vite)
VITE_SUPABASE_ANON_KEY
```

**Si esas envs están seteadas**, la app habla con la DB real.
**Si NO**, cae al cliente mock con seed en memoria. Es automático,
no hay flag extra.

Como bonus: el login del admin detecta el modo demo y muestra abajo
una tarjeta con las 3 credenciales pre-cargadas (un click para entrar).

---

## Pasos para deployar la demo en Vercel

Esto crea **3 proyectos nuevos** apuntando al mismo repo de GitHub.

### 1. Admin demo

1. Vercel → New Project → importar `pragmastudi0/comercio`
2. **Project name**: `comercio-demo-admin`
3. **Root Directory**: `apps/admin`
4. **Framework**: Next.js (lo detecta solo)
5. **Environment Variables** (solo branding, NADA de Supabase):
   ```
   NEXT_PUBLIC_BRAND_NAME = Comercio Demo
   ```
6. Deploy

Una vez listo, en *Settings → Domains* le ponés algo como
`comercio-demo-admin.vercel.app` (o un alias custom).

### 2. PoS demo

1. Vercel → New Project → mismo repo
2. **Project name**: `comercio-demo-pos`
3. **Root Directory**: `apps/pos`
4. **Framework**: Vite
5. **Build Command**: `pnpm build` (debería autodetectarlo)
6. **Output Directory**: `dist`
7. **Environment Variables**:
   ```
   VITE_BRAND_NAME = Comercio Demo
   ```
8. Deploy

### 3. E-commerce demo

1. Vercel → New Project → mismo repo
2. **Project name**: `comercio-demo-web`
3. **Root Directory**: `apps/web`
4. **Framework**: Next.js
5. **Environment Variables**:
   ```
   NEXT_PUBLIC_BRAND_NAME = Comercio Demo
   ```
6. Deploy

---

## Credenciales del modo demo

Quedan visibles en la pantalla de login del admin, pero las dejo acá
también:

| Rol       | Email                | Contraseña    |
|-----------|----------------------|---------------|
| Admin     | admin@demo.com       | admin123      |
| Encargado | encargado@demo.com   | encargado123  |
| Cajero    | cajero@demo.com      | cajero123     |

---

## Qué viene precargado

- **50 productos** distribuidos en 6 categorías (Tecnología, Bazar,
  Belleza, Juguetes, Papelería, Artículos de viaje).
- **2 sucursales** (Centro y Norte) con depósitos asociados +
  depósito Central + depósito Web.
- **3 cajas** (2 en Centro, 1 en Norte).
- **4 roles preset** con permisos granulares.
- **4 empleados** (admin, encargado, 2 cajeros).
- **2 listas de precio** (Consumidor Final con escala, Mayorista).
- **Configuración**: descuento efectivo 10%, cuotas 3/6/12 con
  recargos, validez presupuesto 7 días.
- **Datos del comercio**: razón social "Comercio Demo", dirección y
  CUIT inventados.

---

## Detalles a tener en cuenta

- **Los datos viven en memoria del navegador del visitante**. Cada
  pestaña que abre arranca con el seed limpio. Si hace ventas y
  refresca la pestaña, las ventas se pierden — eso es esperado en una
  demo.
- **Service Worker del PoS**: si actualizás el seed y deployás de
  nuevo, el visitante puede ver una versión cacheada hasta hacer
  hard refresh. El SW ya viene con `skipWaiting` para minimizar esto.
- **El admin demo NO conecta con Supabase** y por lo tanto **no
  necesita** la Edge Function `set-empleado-password`, ni RLS, ni
  storage, ni nada. Levantás los 3 proyectos sin tocar la nube.
- **Compartí el link** del admin demo. Desde ahí el visitante también
  puede navegar al PoS (botón "Ir al PoS") y al e-commerce. O mandá
  los 3 links sueltos.

---

## Para cambiar el nombre a otra cosa

Si en lugar de "Comercio Demo" querés "MiTienda", "Despensa Don
Pepe", etc.: solo cambias el valor de la env var en Vercel y
redeployás. No toca código.

```
NEXT_PUBLIC_BRAND_NAME = Despensa Don Pepe   ← admin/web
VITE_BRAND_NAME = Despensa Don Pepe          ← pos
```
