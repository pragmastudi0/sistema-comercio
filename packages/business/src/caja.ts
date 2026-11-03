// Modelo de sesión de caja (apertura/cierre, totales por método).

export type MetodoPago = 'efectivo' | 'transferencia' | 'debito' | 'credito' | 'qr' | 'cta_cte';

export type MovimientoCaja = {
  tipo: 'venta' | 'ingreso' | 'egreso' | 'retiro' | 'anulacion';
  metodo: MetodoPago;
  monto: number;
};

export type SesionCaja = {
  id: string;
  cajaId: string;
  empleadoId: string;
  abiertaEn: string;
  cerradaEn?: string;
  saldoInicial: number;
  movimientos: MovimientoCaja[];
};

export type TotalesCaja = Record<MetodoPago, number>;

export function totalesPorMetodo(sesion: SesionCaja): TotalesCaja {
  const base: TotalesCaja = {
    efectivo: 0,
    transferencia: 0,
    debito: 0,
    credito: 0,
    qr: 0,
    cta_cte: 0,
  };
  for (const m of sesion.movimientos) {
    const signo = m.tipo === 'egreso' || m.tipo === 'retiro' || m.tipo === 'anulacion' ? -1 : 1;
    base[m.metodo] += signo * m.monto;
  }
  return base;
}

export function saldoEfectivoEsperado(sesion: SesionCaja): number {
  return sesion.saldoInicial + totalesPorMetodo(sesion).efectivo;
}
