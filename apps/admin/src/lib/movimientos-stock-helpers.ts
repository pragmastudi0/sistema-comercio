// Helpers compartidos entre /admin/movimientos-stock y el modal
// Estadísticas de producto — deducen el origen y formatean el motivo
// de un movimiento_stock a partir de su campo `motivo`.

/**
 * A qué "canal" pertenece este movimiento. Se deduce por tipo + prefijo
 * del motivo:
 *   - tipo 'venta'                    → 'pos' (siempre — la venta la
 *                                       hace el cajero en la caja).
 *   - tipo 'devolucion'               → 'pos' (anulación de venta).
 *   - "Transferencia PoS ·"           → 'pos' (modal Stock del PoS)
 *   - "Anulación de transferencia"    → 'pos' (pestaña Movimientos del PoS)
 * Cualquier otro caso (ajuste manual, ingreso, transferencia hecha desde
 * el admin, etc.) → 'admin'.
 *
 * Si algún día agregamos otras fuentes que ensucien la heurística,
 * migramos a un campo enum `origen` en BD.
 */
export function origenDeMovimiento(
  motivo: string | undefined,
  tipo?: string,
): 'pos' | 'admin' {
  // Las ventas del PoS caían como "Admin" porque su motivo no matcheaba
  // ningún prefijo — ahora las etiquetamos por tipo directamente.
  if (tipo === 'venta' || tipo === 'devolucion') return 'pos';
  if (!motivo) return 'admin';
  if (motivo.startsWith('Transferencia PoS ')) return 'pos';
  if (motivo.startsWith('Anulación de transferencia')) return 'pos';
  if (motivo.startsWith('Anulacion de transferencia')) return 'pos';
  return 'admin';
}

/**
 * Formatea el motivo para mostrar en la UI. Los internos del PoS quedan
 * verbosos ("Transferencia PoS · Termo Stanley"); acá los recortamos
 * porque el nombre del producto ya suele estar en la misma fila.
 */
export function motivoLegible(motivo: string | undefined): string {
  if (!motivo) return '—';
  if (motivo.startsWith('Transferencia PoS · ')) return 'Transferencia entre depósitos';
  if (motivo.startsWith('Anulación de transferencia')) return 'Anulación de una transferencia previa';
  if (motivo.startsWith('Anulacion de transferencia')) return 'Anulación de una transferencia previa';
  return motivo;
}
