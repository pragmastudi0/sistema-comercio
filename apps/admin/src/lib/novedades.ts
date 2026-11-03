/**
 * Novedades del sistema — se muestran en el botón "campana" del header
 * del admin. Cada vez que sumamos un feature grande o cambio visible,
 * agregamos una entrada al inicio del array (más nueva primero).
 *
 * Cómo agregar una nueva:
 *   1. Ponerla PRIMERA en el array.
 *   2. `id` único (kebab-case) — sirve para el tracking de "leída".
 *   3. `fecha` en ISO (YYYY-MM-DD).
 *   4. `titulo` corto (≤ 50 chars), `descripcion` de 1 línea (≤ 140 chars).
 *   5. Opcional `href` para linkear directo a la feature.
 *
 * NO borrar las viejas — quedan como changelog en la UI para el cliente.
 */
export type Novedad = {
  /** Kebab-case único. Usado para tracking de "leídas" en localStorage. */
  id: string;
  fecha: string; // ISO YYYY-MM-DD
  titulo: string;
  descripcion: string;
  href?: string;
  /** Etiqueta que se muestra al lado del título. */
  tag?: 'nuevo' | 'mejora' | 'fix';
  /** Emoji ilustrativo — se muestra grande a la izquierda de la card. */
  emoji?: string;
};

export const NOVEDADES: Novedad[] = [
  {
    id: 'carga-masiva-fotos-oct-2026-10-30',
    fecha: '2026-10-30',
    titulo: 'Primera tanda de fotos cargada',
    descripcion:
      '216 fotos nuevas asociadas a 183 productos del catálogo (comprimidas automáticamente para no comerse el storage). Ya se ven en el ecommerce.',
    href: '/web',
    tag: 'nuevo',
    emoji: '📸',
  },
  {
    id: 'precio-en-historial-producto-2026-10-30',
    fecha: '2026-10-30',
    titulo: 'Precio de venta en el historial del producto',
    descripcion:
      'En el historial de movimientos de un producto, al abrir una venta ahora ves ticket, precio unitario, cantidad, descuento y subtotal — sin ir a Ventas.',
    href: '/productos',
    tag: 'mejora',
    emoji: '💵',
  },
  {
    id: 'fix-promo-2x1-2026-10-14',
    fecha: '2026-10-14',
    titulo: 'Fix: 2x1 y combos ahora siempre se aplican',
    descripcion:
      'Cerrado el agujero por el que a veces un 2x1 no se aplicaba si la promo se cargaba con el cajero ya logueado. Ahora el carrito refresca el producto antes de cobrar.',
    href: '/caja',
    tag: 'fix',
    emoji: '🏷️',
  },
  {
    id: 'caja-columnas-utiles-2026-10-02',
    fecha: '2026-10-02',
    titulo: 'Cajas muestra lo que importa',
    descripcion:
      'En Cajas: total cobrado, cantidad de ventas y ticket promedio por sesión, más un resumen por local arriba.',
    href: '/caja',
    tag: 'mejora',
    emoji: '💰',
  },
  {
    id: 'valor-mercaderia-por-deposito-2026-09-28',
    fecha: '2026-09-28',
    titulo: 'Valor de mercadería por depósito',
    descripcion:
      'En Inicio y Reportes ahora ves cuánto capital tenés en cada depósito por separado, además del total.',
    href: '/reportes',
    tag: 'nuevo',
    emoji: '🏬',
  },
  {
    id: 'top-productos-rotacion-2026-09-05',
    fecha: '2026-09-05',
    titulo: 'Ya tenés Top 10 productos',
    descripcion:
      'Nuevo ranking de productos por rotación en Reportes. Ordenable por unidades vendidas o por facturado.',
    href: '/reportes',
    tag: 'nuevo',
    emoji: '🏆',
  },
  {
    id: 'estadisticas-simplificadas-2026-09-05',
    fecha: '2026-09-05',
    titulo: 'Historial de stock más claro',
    descripcion:
      'Cards de stock actual por depósito + filas expandibles con el detalle. Los movimientos son más fáciles de leer.',
    href: '/productos',
    tag: 'mejora',
    emoji: '📦',
  },
  {
    id: 'pdf-productos-flexible-2026-08-22',
    fecha: '2026-08-22',
    titulo: 'PDF de productos con selección',
    descripcion:
      'Podés exportar cualquier lista de productos a PDF, elegir cuáles y qué precio mostrar (local, mayorista o ambos).',
    href: '/productos',
    tag: 'nuevo',
    emoji: '📄',
  },
  {
    id: 'ventas-mayoristas-2026-08-22',
    fecha: '2026-08-22',
    titulo: 'Panel Ventas Mayoristas',
    descripcion:
      'Los pedidos del catálogo web ahora se guardan y aparecen en /ventas-mayoristas para aprobar o rechazar.',
    href: '/ventas-mayoristas',
    tag: 'nuevo',
    emoji: '🛍️',
  },
  {
    id: 'umbral-mayorista-2026-08-22',
    fecha: '2026-08-22',
    titulo: 'Precio mayorista desde un monto',
    descripcion:
      'Nuevo campo en E-commerce para exigir compra mínima antes de aplicar el precio mayorista.',
    href: '/web',
    tag: 'nuevo',
    emoji: '💰',
  },
];
