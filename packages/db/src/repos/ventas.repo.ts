import type { ID, Venta } from '../types';

export type FiltroVentas = {
  desde?: string;
  hasta?: string;
  local_id?: ID;
  caja_id?: ID;
  /** Filtra por una sesión específica (turno de cajero). Útil para ver
   *  las ventas de un cierre en particular. */
  sesion_caja_id?: ID;
  empleado_id?: ID;
  cliente_id?: ID;
  estado?: Venta['estado'];
};

export type VentasRepo = {
  list(filtro?: FiltroVentas): Promise<Venta[]>;
  get(id: ID): Promise<Venta | null>;
  // Crea la venta, descuenta stock y registra el movimiento de caja en la sesión activa.
  crear(input: Omit<Venta, 'id' | 'numero' | 'estado' | 'fecha'>): Promise<Venta>;
  anular(id: ID, empleadoId: ID, motivo: string): Promise<Venta>;
  // Devuelve un "presupuesto": misma forma que venta pero no descuenta stock ni afecta caja.
  presupuesto(input: Omit<Venta, 'id' | 'numero' | 'estado' | 'fecha'>): Promise<Venta>;
  /**
   * Registra una venta cancelada (carrito armado pero no cobrado).
   * NO descuenta stock, NO afecta caja, NO genera movimientos. Sirve sólo
   * para auditoría: el dueño puede ver qué carritos se cargan y se cancelan.
   * Los `pagos` siempre quedan vacíos.
   */
  cancelar(
    input: Omit<Venta, 'id' | 'numero' | 'estado' | 'fecha' | 'pagos'>,
  ): Promise<Venta>;
};
