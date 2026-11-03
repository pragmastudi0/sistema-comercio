'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useSesion } from '@/stores/sesion';
import { getDb } from '@/lib/db';
import {
  Home,
  ShoppingCart,
  Wallet,
  Package,
  BarChart3,
  Settings,
  ChevronDown,
  LogOut,
  Menu,
  X,
  TrendingUp,
  PlusCircle,
  AlertTriangle,
  CreditCard,
  ArrowLeftRight,
  Store,
  ShoppingBag,
} from 'lucide-react';
import { toast } from 'sonner';
import { PRESET_IDS } from '@comercio/db';
import { cn } from '@comercio/ui/utils';
import { Button } from '@comercio/ui/button';

import type { AccionPermiso, ModuloPermiso } from '@comercio/business';
import { usePermisos } from '@/lib/permisos';

import { ModalSaldosCajas } from './modal-saldos-cajas';
import { ModalGananciasHoy } from './modal-ganancias-hoy';
import { BotonNovedades } from './boton-novedades';
import { DemoGuard } from './demo-guard';

type SubItem = {
  href: string;
  label: string;
  requiere?: { modulo: ModuloPermiso; accion: string };
};

type MenuItem = {
  label: string;
  // Si tiene href, es un link directo. Si tiene subs, es un dropdown.
  href?: string;
  icon: typeof Home;
  subs?: SubItem[];
  requiere?: { modulo: ModuloPermiso; accion: string };
};

function req<M extends ModuloPermiso>(
  modulo: M,
  accion: AccionPermiso<M>,
): { modulo: ModuloPermiso; accion: string } {
  return { modulo, accion: accion as string };
}

// Estructura del menubar — reorganizado al estilo ERP de escritorio.
// Las acciones más usadas (saldos, ganancias, cargar stock, faltantes)
// viven en la toolbar de íconos grandes debajo, no acá.
const MENU: MenuItem[] = [
  // Inicio = dashboard con KPIs financieros. Sólo lo ven los roles que
  // pueden ver reportes (admin). Encargado/catálogo van directo a su
  // página principal sin pasar por acá.
  { label: 'Inicio', href: '/', icon: Home, requiere: req('reportes', 'ver_local_propio') },
  // Ventas = historial completo (con totales). Lo ven sólo los que tienen
  // acceso a reportes. El permiso ventas.crear es para crear venta en el
  // PoS, no para ver el historial financiero del admin.
  { label: 'Ventas', href: '/ventas', icon: ShoppingCart, requiere: req('reportes', 'ver_local_propio') },
  { label: 'Caja', href: '/caja', icon: Wallet, requiere: req('caja', 'ver_propia') },
  {
    label: 'Productos',
    icon: Package,
    subs: [
      { href: '/productos', label: 'Catálogo', requiere: req('productos', 'ver') },
      { href: '/categorias', label: 'Categorías', requiere: req('categorias', 'ver') },
      { href: '/listas-precio', label: 'Listas de precio', requiere: req('listas_precio', 'ver') },
      { href: '/proveedores', label: 'Proveedores', requiere: req('proveedores', 'ver') },
    ],
  },
  {
    label: 'Reportes',
    href: '/reportes',
    icon: BarChart3,
    requiere: req('reportes', 'ver_local_propio'),
  },
  {
    label: 'Sistema',
    icon: Settings,
    subs: [
      { href: '/empleados', label: 'Empleados', requiere: req('empleados', 'ver') },
      { href: '/roles', label: 'Roles y permisos', requiere: req('roles', 'ver') },
      { href: '/configuracion', label: 'Configuración general', requiere: req('configuracion', 'ver') },
      { href: '/backup', label: 'Backup', requiere: req('configuracion', 'backup_restore') },
      // "/web" (E-commerce) se movió al TOOLBAR de íconos grandes,
      // al lado de Cobrar. Es una sección que Agus toca seguido
      // (publicar productos, editar descripciones, subir fotos)
      // y estaba escondido en el dropdown Sistema.
    ],
  },
];

// Acciones de la toolbar de íconos grandes (lo que Agus toca todo el tiempo).
// Cada una abre un modal o navega a una ruta. `requiere` esconde la acción
// si el rol no tiene ese permiso.
type ToolbarAction =
  | { type: 'modal'; key: 'saldos' | 'ganancias'; label: string; icon: typeof Home; color: string; requiere?: { modulo: ModuloPermiso; accion: string } }
  | { type: 'link'; href: string; label: string; icon: typeof Home; color: string; external?: boolean; requiere?: { modulo: ModuloPermiso; accion: string }; badge?: 'pedidosPendientes' };

// URL del PoS — se abre en pestaña nueva desde el botón Cobrar. Si no se
// define la env var, fallback al deployment de Vercel del cliente.
const POS_URL = process.env.NEXT_PUBLIC_POS_URL ?? 'https://turisteando-pos.vercel.app';

const TOOLBAR: ToolbarAction[] = [
  { type: 'modal', key: 'saldos', label: 'Saldos de cajas', icon: Wallet, color: 'bg-emerald-100 text-emerald-700', requiere: req('caja', 'ver_otras_del_local') },
  { type: 'modal', key: 'ganancias', label: 'Ganancias', icon: TrendingUp, color: 'bg-blue-100 text-blue-700', requiere: req('reportes', 'ver_ganancia') },
  { type: 'link', href: '/ventas', label: 'Ventas', icon: ShoppingCart, color: 'bg-indigo-100 text-indigo-700', requiere: req('reportes', 'ver_local_propio') },
  // Ventas mayoristas: pedidos que llegan desde el catálogo web. Al lado
  // de Ventas para que Agus los tenga juntos. Muestra badge rojo con el
  // contador de pendientes (ver PendientesBadge más abajo).
  { type: 'link', href: '/ventas-mayoristas', label: 'Mayoristas', icon: ShoppingBag, color: 'bg-cyan-100 text-cyan-700', requiere: req('reportes', 'ver_local_propio'), badge: 'pedidosPendientes' },
  // "Productos" abre /productos en su vista normal — el panel a la
  // derecha muestra el primer producto seleccionado. Para crear uno
  // nuevo Agus tiene el botón "Nuevo" dentro de la página.
  { type: 'link', href: '/productos', label: 'Productos', icon: PlusCircle, color: 'bg-purple-100 text-purple-700', requiere: req('productos', 'crear') },
  { type: 'link', href: '/productos?stock=bajo', label: 'Faltantes', icon: AlertTriangle, color: 'bg-red-100 text-red-700', requiere: req('productos', 'ver') },
  // Movimientos de stock — auditoría para Agus: quién transfirió qué, cuándo,
  // de dónde a dónde. Refleja también ajustes/mermas/ventas para tener todo
  // el historial en una sola vista.
  { type: 'link', href: '/movimientos-stock', label: 'Mov. stock', icon: ArrowLeftRight, color: 'bg-amber-100 text-amber-700', requiere: req('stock', 'ver_propio_deposito') },
  // Cobrar → abre el PoS en pestaña nueva CON LA SESIÓN YA INICIADA.
  // El handler pasa el access/refresh token de Supabase en el hash
  // fragment (que no llega al servidor) y el PoS los aplica al boot.
  // Sin permiso requerido: lo ven todos los roles que pueden entrar
  // al admin (cajeros ya están bloqueados arriba).
  { type: 'link', href: POS_URL, label: 'Cobrar', icon: CreditCard, color: 'bg-rose-100 text-rose-700', external: true },
  // Ecommerce → publicación de productos, fotos, descripciones. Antes
  // estaba en el dropdown "Sistema" pero Agus lo toca seguido; acá al
  // lado de Cobrar queda accesible de un click.
  { type: 'link', href: '/web', label: 'Ecommerce', icon: Store, color: 'bg-cyan-100 text-cyan-700', requiere: req('productos', 'publicar_ecommerce') },
];

/**
 * Abre el PoS en una pestaña nueva y le pasa la sesión Supabase actual
 * por hash fragment para que el cajero/dueño entre directo a abrir caja
 * sin volver a tipear su contraseña. Si no podemos resolver la sesión
 * (falta env, sin login, error de red), abrimos el PoS con `?email=...`
 * pre-llenado para que sólo tenga que escribir la contraseña.
 *
 * Hash fragment (no query string) para los tokens: NO viaja al servidor,
 * queda sólo en el browser, y el PoS lo borra apenas hidrata. El email
 * SÍ va en query string porque no es secreto.
 */
async function abrirPoSConSesion(emailHint?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const qs = emailHint ? `?email=${encodeURIComponent(emailHint)}` : '';
  let target = `${POS_URL}/${qs}`;
  try {
    if (url && key) {
      const { createSupabaseRaw } = await import('@comercio/db');
      const sb = createSupabaseRaw(url, key);
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token && data.session.refresh_token) {
        target = `${POS_URL}/${qs}#sso=${data.session.access_token}|${data.session.refresh_token}`;
      }
    }
  } catch {
    // Cualquier falla cae al PoS sin SSO — al menos el email queda pre-llenado.
  }
  window.open(target, '_blank', 'noopener');
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const empleado = useSesion((s) => s.empleado);
  const logout = useSesion((s) => s.logout);
  const { puede, cargando: permisosCargando } = usePermisos();
  const isLoginRoute = pathname === '/login';

  // Filtrar la toolbar de íconos grandes por permisos. Misma lógica que
  // el menubar: si el rol no tiene el permiso, no ve el botón.
  const toolbarVisible = TOOLBAR.filter((action) => {
    if (!action.requiere) return true;
    if (permisosCargando) return false;
    return puede(action.requiere.modulo, action.requiere.accion as AccionPermiso<ModuloPermiso>);
  });

  // Filtrar items del menú según permisos. Si todos los subs de un dropdown
  // quedan filtrados, ocultamos el dropdown entero.
  const menuVisible = MENU.map((item) => {
    if (item.subs) {
      const subs = item.subs.filter((s) => {
        if (!s.requiere) return true;
        if (permisosCargando) return false;
        return puede(s.requiere.modulo, s.requiere.accion as AccionPermiso<ModuloPermiso>);
      });
      return { ...item, subs };
    }
    return item;
  }).filter((item) => {
    if (item.subs) return item.subs.length > 0;
    if (!item.requiere) return true;
    if (permisosCargando) return false;
    return puede(item.requiere.modulo, item.requiere.accion as AccionPermiso<ModuloPermiso>);
  });

  // Estado del dropdown abierto en el menubar (solo 1 a la vez).
  const [dropdownAbierto, setDropdownAbierto] = useState<string | null>(null);
  const menubarRef = useRef<HTMLDivElement>(null);

  // Click fuera del menubar → cerrar dropdown.
  useEffect(() => {
    if (!dropdownAbierto) return;
    const handler = (e: MouseEvent) => {
      if (!menubarRef.current?.contains(e.target as Node)) {
        setDropdownAbierto(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownAbierto]);

  // Cerrar dropdown al navegar a una ruta.
  useEffect(() => {
    setDropdownAbierto(null);
  }, [pathname]);

  // Mobile menu (hamburger)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Modal activo (de la toolbar)
  const [modalActivo, setModalActivo] = useState<'saldos' | 'ganancias' | null>(null);

  // Guards de auth/rol (idénticos al shell anterior).
  useEffect(() => {
    if (!empleado && !isLoginRoute) {
      router.replace('/login');
    }
  }, [empleado, isLoginRoute, router]);

  const esCajeroPreset = empleado?.rol_id === PRESET_IDS.roles.cajero;
  useEffect(() => {
    if (esCajeroPreset && !isLoginRoute) {
      toast.error(
        'Como cajero tenés que usar el sistema de caja (PoS), no el panel admin.',
        { duration: 5000 },
      );
      logout();
      router.replace('/login');
    }
  }, [esCajeroPreset, isLoginRoute, router, logout]);

  if (isLoginRoute) return <>{children}</>;
  if (!empleado) return null;
  if (esCajeroPreset) return null;

  function cerrarSesion() {
    if (!confirm('¿Cerrar sesión?')) return;
    logout();
    router.push('/login');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      import('@comercio/db').then(({ createSupabaseRaw }) => {
        createSupabaseRaw(url, key).auth.signOut().catch(() => {});
      });
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      {/* Banner + toggle global de modo demo. Se renderiza fuera del
          header sticky para que el banner aparezca por encima de todo. */}
      <DemoGuard />
      {/* Top bar con título + menubar + user. Estilo ERP de escritorio. */}
      <header className="sticky top-0 z-40 border-b bg-background shadow-sm">
        {/* Banda 1: branding + user (h-9). Look "Office 2003 / Windows XP":
            gradiente azul oscuro institucional, borde inferior marcado. */}
        <div className="flex h-9 items-center justify-between border-b border-slate-900 bg-gradient-to-b from-slate-700 to-slate-800 px-3 text-slate-50 shadow-sm">
          <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <span className="hidden sm:inline">Turisteando</span>
            <span className="text-slate-400">·</span>
            <span>Administración</span>
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <BotonNovedades />
            <span className="hidden text-slate-200 sm:inline">
              {empleado.nombre} {empleado.apellido}
            </span>
            <button
              type="button"
              onClick={cerrarSesion}
              className="flex items-center gap-1 rounded border border-transparent px-2 py-0.5 hover:border-slate-500 hover:bg-slate-600"
              title="Cerrar sesión"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>

        {/* Banda 2: menubar (h-9) — estilo barra de menú de Windows clásica:
            hover azul claro, item activo con borde inferior. */}
        <div ref={menubarRef} className="hidden h-9 items-center gap-0.5 border-b border-slate-200 bg-white px-2 lg:flex">
          {menuVisible.map((item) => {
            const Icon = item.icon;
            const activo =
              item.href === '/'
                ? pathname === '/'
                : item.href
                  ? pathname.startsWith(item.href)
                  : item.subs?.some((s) => pathname.startsWith(s.href));
            const tieneDropdown = !!item.subs;
            const dropdownOpen = dropdownAbierto === item.label;

            if (!tieneDropdown && item.href) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-1.5 border-b-2 px-3 py-1 text-sm font-medium transition-colors',
                    activo
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-transparent text-slate-700 hover:border-blue-300 hover:bg-blue-50/60',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            }

            return (
              <div key={item.label} className="relative">
                <button
                  type="button"
                  onClick={() => setDropdownAbierto(dropdownOpen ? null : item.label)}
                  className={cn(
                    'flex items-center gap-1.5 border-b-2 px-3 py-1 text-sm font-medium transition-colors',
                    activo || dropdownOpen
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-transparent text-slate-700 hover:border-blue-300 hover:bg-blue-50/60',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {dropdownOpen && item.subs && (
                  <div className="absolute left-0 top-full z-50 mt-0 min-w-[220px] rounded-sm border border-slate-300 bg-white py-1 shadow-md">
                    {item.subs.map((sub) => {
                      const subActivo = pathname.startsWith(sub.href);
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={cn(
                            'block px-3 py-1.5 text-sm transition-colors',
                            subActivo
                              ? 'bg-blue-50 font-semibold text-blue-800'
                              : 'text-slate-700 hover:bg-blue-50/60',
                          )}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Mobile: hamburger */}
        <div className="flex h-10 items-center justify-between px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-accent"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            <span>Menú</span>
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="border-t bg-background px-2 py-2 lg:hidden">
            {menuVisible.map((item) => (
              <div key={item.label} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground">
                  {item.label}
                </div>
                {item.subs ? (
                  item.subs.map((sub) => (
                    <Link
                      key={sub.href}
                      href={sub.href}
                      className="block rounded px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      {sub.label}
                    </Link>
                  ))
                ) : item.href ? (
                  <Link
                    href={item.href}
                    className="block rounded px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    Ir
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Banda 3: toolbar de íconos grandes — estilo "ribbon" Office
            clásico. Íconos planos coloridos sin fondo de color en el
            cuadrado; el ícono mismo lleva el color. Border separador
            entre grupos como en Word/Excel viejos. */}
        <div className="flex h-[78px] items-center gap-0.5 overflow-x-auto border-t border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100 px-2 py-1.5">
          {toolbarVisible.map((action) => {
            const Icon = action.icon;
            // Extraemos solo el "text-color" del color combinado para
            // pintar el ícono sin fondo (estilo más plano y clásico).
            const colorClass = action.color.split(' ').find((c) => c.startsWith('text-')) ?? '';
            const badgeKey =
              action.type === 'link' ? action.badge : undefined;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  if (action.type === 'modal') {
                    setModalActivo(action.key);
                  } else if (action.external) {
                    // Si es el botón Cobrar (apunta al PoS), intentamos pasar
                    // los tokens de Supabase en el hash para que el PoS se
                    // loguee automático. Si por algún motivo no podemos
                    // (falta env, no hay sesión, error), abrimos sin SSO.
                    if (action.href === POS_URL) {
                      abrirPoSConSesion(empleado?.email);
                    } else {
                      window.open(action.href, '_blank', 'noopener');
                    }
                  } else {
                    router.push(action.href);
                  }
                }}
                className={cn(
                  'group relative flex h-[64px] w-[80px] shrink-0 flex-col items-center justify-center gap-0.5 rounded border border-transparent px-1 transition-all',
                  'hover:border-blue-400 hover:bg-blue-50/60 active:bg-blue-100',
                )}
                title={action.label}
              >
                <Icon className={cn('h-7 w-7', colorClass)} strokeWidth={1.5} />
                <span className="text-center text-[11px] font-medium leading-tight text-slate-700">
                  {action.label}
                </span>
                {badgeKey === 'pedidosPendientes' && <PedidosPendientesBadge />}
              </button>
            );
          })}
        </div>
      </header>

      {/* Contenido principal */}
      <main className="min-w-0 flex-1">{children}</main>

      {/* Modales globales de la toolbar */}
      <ModalSaldosCajas open={modalActivo === 'saldos'} onOpenChange={(v) => !v && setModalActivo(null)} />
      <ModalGananciasHoy open={modalActivo === 'ganancias'} onOpenChange={(v) => !v && setModalActivo(null)} />
    </div>
  );
}

/**
 * Badge rojo con el contador de pedidos web pendientes. Se pinta arriba
 * a la derecha del botón "Mayoristas" del toolbar. Refresca cada 30s.
 */
function PedidosPendientesBadge() {
  const db = getDb();
  const { data: count } = useQuery({
    queryKey: ['pedidos-web-pendientes'],
    queryFn: () => db.pedidosWeb.contarPendientes(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  if (!count || count <= 0) return null;
  return (
    <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm">
      {count > 99 ? '99+' : count}
    </span>
  );
}
