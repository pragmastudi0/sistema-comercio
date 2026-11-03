// Operaciones de stock sin acceso a DB.

export type MovimientoStock =
  | { tipo: 'venta'; cantidad: number }
  | { tipo: 'devolucion'; cantidad: number }
  | { tipo: 'ajuste'; cantidad: number; motivo: string }
  | { tipo: 'merma'; cantidad: number; motivo: string }
  | { tipo: 'transferencia_salida'; cantidad: number; depositoDestino: string }
  | { tipo: 'transferencia_entrada'; cantidad: number; depositoOrigen: string };

export function aplicarMovimiento(stockActual: number, mov: MovimientoStock): number {
  switch (mov.tipo) {
    case 'venta':
    case 'transferencia_salida':
    case 'merma':
      return stockActual - mov.cantidad;
    case 'devolucion':
    case 'transferencia_entrada':
      return stockActual + mov.cantidad;
    case 'ajuste':
      return stockActual + mov.cantidad; // ajuste puede ser positivo o negativo
  }
}

export function puedeDescontar(
  stockActual: number,
  cantidad: number,
  permiteSinStock: boolean,
): boolean {
  if (cantidad <= 0) return false;
  if (permiteSinStock) return true;
  return stockActual >= cantidad;
}

// Motivos preset para ajustes de stock — evitan que el dueño tenga que
// escribir cada vez. Los usa el modal "Cargar stock" del admin y el panel
// de detalle de producto. Se muestran según el signo del delta:
//   +N → MOTIVOS_INGRESO
//   -N → MOTIVOS_EGRESO
// Además de las opciones fijas, hay "Otros" que abre un textarea libre.
export const MOTIVOS_INGRESO_STOCK = [
  'Corrección de inventario',
  'Compra a proveedor',
  'Sobrante de mercadería',
] as const;

export const MOTIVOS_EGRESO_STOCK = [
  'Venta no registrada',
  'Extravío de mercadería',
  'Mercadería en mal estado',
  'Devolución al proveedor',
  'Vale mercadería',
  'Corrección de mercadería',
  'Uso interno',
] as const;

export const MOTIVO_OTROS = 'Otros';

export type MotivoIngresoStock = (typeof MOTIVOS_INGRESO_STOCK)[number] | typeof MOTIVO_OTROS;
export type MotivoEgresoStock = (typeof MOTIVOS_EGRESO_STOCK)[number] | typeof MOTIVO_OTROS;
