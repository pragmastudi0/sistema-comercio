// Precio mayorista para el catálogo web (turisteando-web).
//
// El catálogo apunta a clientes mayoristas que arman el pedido y lo
// mandan por WhatsApp. Se aplica un descuento sobre el precio
// Consumidor Final (CF). No se toca nada del PoS ni del admin —
// esos siguen mostrando CF sin alterar.
//
// Orden de precedencia del % de descuento base:
//   1) producto.descuento_mayorista_pct_override  (si != null)
//   2) config.descuento_mayorista_pct             (global de la empresa)
//   3) 0                                          (fallback → precio CF sin descuento)
//
// Escalas por cantidad (opcionales):
//   Sobre el pct base, si la cantidad del ítem alcanza una escala, se
//   USA el % de la escala en vez del base (no se suman). Se toma la
//   escala con mayor `desde` que sea <= cantidad.

export type CalcularPrecioMayoristaFuente =
  | 'override' // vino del producto
  | 'global' // vino de configuracion_empresa
  | 'escala' // vino de una escala por cantidad
  | 'ninguno'; // no había % aplicable → precio CF sin descuento

export type CalcularPrecioMayoristaResult = {
  /** Precio final por unidad, ya con el descuento aplicado y redondeado. */
  precio: number;
  /** % de descuento aplicado sobre CF. */
  pctAplicado: number;
  /** De dónde salió el pct final. */
  fuente: CalcularPrecioMayoristaFuente;
  /** Precio CF de referencia (sin descuento). */
  precioCF: number;
  /** Ahorro por unidad respecto al CF. */
  ahorroUnitario: number;
};

export type CalcularPrecioMayoristaInput = {
  /** Precio Consumidor Final de referencia (por unidad, según cantidad para escalas CF). */
  precioCF: number;
  /** Producto solo aporta el override opcional — el resto del pricing se hace acá. */
  descuentoOverridePct?: number | null;
  /** Descuento global de la empresa (0-100). undefined → 0. */
  descuentoGlobalPct?: number;
  /** Escalas por cantidad (opcional). */
  escalas?: { desde: number; pct: number }[];
  /** Cantidad del ítem — determina qué escala aplicar. Default 1. */
  cantidad?: number;
  /** Redondeo del precio final. 'cent' (default) redondea a 2 decimales,
   *  'entero' redondea al peso, 'ninguno' devuelve el float crudo. */
  redondeo?: 'cent' | 'entero' | 'ninguno';
};

export function calcularPrecioMayorista(
  input: CalcularPrecioMayoristaInput,
): CalcularPrecioMayoristaResult {
  const precioCF = Number.isFinite(input.precioCF) ? Math.max(0, input.precioCF) : 0;
  const cantidad = Math.max(1, Math.floor(input.cantidad ?? 1));
  const redondeo = input.redondeo ?? 'cent';

  // 1) Base pct: override > global > 0.
  let basePct = 0;
  let fuente: CalcularPrecioMayoristaFuente = 'ninguno';

  if (input.descuentoOverridePct != null && input.descuentoOverridePct > 0) {
    basePct = clampPct(input.descuentoOverridePct);
    fuente = 'override';
  } else if (input.descuentoGlobalPct != null && input.descuentoGlobalPct > 0) {
    basePct = clampPct(input.descuentoGlobalPct);
    fuente = 'global';
  }

  // 2) Escalas por cantidad: gana la mayor `desde` <= cantidad.
  //    Se comparan contra el pct base y se toma el mayor (nunca dan menos
  //    descuento del que ya tenía el producto por override/global).
  const escalas = [...(input.escalas ?? [])]
    .filter((e) => e && e.desde > 0 && e.pct > 0)
    .sort((a, b) => a.desde - b.desde);

  let pctFinal = basePct;
  for (const e of escalas) {
    if (cantidad >= e.desde) {
      const escPct = clampPct(e.pct);
      if (escPct > pctFinal) {
        pctFinal = escPct;
        fuente = 'escala';
      }
    }
  }

  const precioBruto = precioCF * (1 - pctFinal / 100);
  const precio =
    redondeo === 'entero'
      ? Math.round(precioBruto)
      : redondeo === 'cent'
      ? Math.round(precioBruto * 100) / 100
      : precioBruto;

  return {
    precio,
    pctAplicado: pctFinal,
    fuente,
    precioCF,
    ahorroUnitario: Math.max(0, precioCF - precio),
  };
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/** Helper para preview en admin: solo devuelve el precio mayorista y el %
 *  aplicado, sin la desagregación. Ideal para labels chicos ("$X · 30% off"). */
export function previewPrecioMayorista(
  precioCF: number,
  descuentoOverridePct: number | null | undefined,
  descuentoGlobalPct: number | undefined,
): { precio: number; pctAplicado: number } {
  const r = calcularPrecioMayorista({
    precioCF,
    descuentoOverridePct,
    descuentoGlobalPct,
    cantidad: 1,
    redondeo: 'cent',
  });
  return { precio: r.precio, pctAplicado: r.pctAplicado };
}
