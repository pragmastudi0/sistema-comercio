// Lógica pura de precios: escalas por cantidad, descuento efectivo, recargo por cuotas.

export type EscalaPrecio = {
  desde: number; // cantidad mínima (inclusive)
  precio: number;
};

export type ListaPrecio = {
  id: string;
  nombre: string;
  escalas: EscalaPrecio[]; // ordenadas asc por `desde`
};

export type CuotaConfig = {
  cuotas: number;
  recargoPct: number; // recargo % aplicado al total
};

export type ConfigPagos = {
  descuentoEfectivoPct: number; // p.ej. 10 = 10% off
  cuotas: CuotaConfig[];
};

export function precioPorCantidad(lista: ListaPrecio, cantidad: number): number {
  if (cantidad <= 0) return 0;
  // Ordenamos defensivamente por `desde` ASC. Supabase no garantiza el
  // orden del array de escalas al hacer el fetch, y varios call-sites
  // pasaban escalas "como venían" — cuando la primera resultaba ser la
  // mayorista (desde=12) el consumidor final se cobraba mal. Ordenar
  // acá cubre a todos los consumidores del helper sin depender de que
  // cada uno se acuerde.
  const escalas = [...lista.escalas].sort((a, b) => a.desde - b.desde);
  let aplicado = escalas[0]?.precio ?? 0;
  for (const e of escalas) {
    if (cantidad >= e.desde) aplicado = e.precio;
    else break;
  }
  return aplicado;
}

export function aplicarDescuentoEfectivo(subtotal: number, config: ConfigPagos): number {
  const pct = config.descuentoEfectivoPct ?? 0;
  return redondear2(subtotal * (1 - pct / 100));
}

export function aplicarRecargoCuotas(
  subtotal: number,
  cuotas: number,
  config: ConfigPagos,
): { total: number; recargoPct: number } {
  const conf = config.cuotas.find((c) => c.cuotas === cuotas);
  const recargoPct = conf?.recargoPct ?? 0;
  return { total: redondear2(subtotal * (1 + recargoPct / 100)), recargoPct };
}

export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aplica promo NxM (2x1, 3x2, etc.) a la cantidad de una línea del carrito.
 * Devuelve cuántas unidades EFECTIVAMENTE se cobran.
 *
 * Regla:
 *   packs   = floor(cantidad / lleva)   // packs completos que entran
 *   sueltas = cantidad % lleva          // unidades del último pack incompleto
 *   cobradas = packs * paga + sueltas
 *
 * Ejemplos con 2x1 (lleva=2, paga=1):
 *   1u  → 1u cobrada (aún no completa pack)
 *   2u  → 1u cobrada (1 gratis)
 *   3u  → 2u cobradas (1 gratis)
 *   5u  → 3u cobradas (2 gratis)
 *
 * Ejemplos con 3x2 (lleva=3, paga=2):
 *   3u  → 2u cobradas (1 gratis)
 *   6u  → 4u cobradas (2 gratis)
 *
 * Si la config es inválida (lleva <= paga, etc.) devuelve `cantidad` sin
 * aplicar promo.
 */
export function unidadesCobradasNxM(
  cantidad: number,
  lleva: number,
  paga: number,
): number {
  if (cantidad <= 0) return 0;
  if (!Number.isFinite(lleva) || !Number.isFinite(paga)) return cantidad;
  if (lleva <= paga || paga < 1) return cantidad;
  const packs = Math.floor(cantidad / lleva);
  const sueltas = cantidad % lleva;
  return packs * paga + sueltas;
}

/**
 * Aplica promo COMBO (N unidades por $X fijo) a una línea del carrito.
 * Devuelve el subtotal FINAL de esa línea — a diferencia de NxM, acá el
 * precio del pack NO depende del precio unitario del producto (viene
 * cargado a mano por Agus desde /admin/productos).
 *
 * Regla:
 *   packs   = floor(cantidad / comboCantidad)
 *   sueltas = cantidad % comboCantidad
 *   subtotal = packs * comboPrecio + sueltas * precioUnitario
 *
 * Ejemplos con combo (3 x $1200) y precio unitario $500:
 *   1u  → $500          (1 suelta, aún no completa pack)
 *   2u  → $1000         (2 sueltas)
 *   3u  → $1200         (1 pack — el pack es más barato que 3 sueltas)
 *   4u  → $1700         (1 pack + 1 suelta)
 *   6u  → $2400         (2 packs completos)
 *
 * Si la config es inválida (cantidad < 2, precio <= 0, no-finito) devuelve
 * el subtotal a precio normal sin aplicar combo.
 */
export function subtotalComboXPrecio(
  cantidad: number,
  comboCantidad: number,
  comboPrecio: number,
  precioUnitario: number,
): number {
  if (cantidad <= 0) return 0;
  if (
    !Number.isFinite(comboCantidad) ||
    !Number.isFinite(comboPrecio) ||
    comboCantidad < 2 ||
    comboPrecio <= 0
  ) {
    return cantidad * precioUnitario;
  }
  const packs = Math.floor(cantidad / comboCantidad);
  const sueltas = cantidad % comboCantidad;
  return packs * comboPrecio + sueltas * precioUnitario;
}
