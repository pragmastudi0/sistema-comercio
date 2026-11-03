import type { ID, MovimientoStock, StockItem } from '../types';

export type StockRepo = {
  // Lectura
  porProducto(productoId: ID): Promise<StockItem[]>; // todos los depósitos
  porDeposito(depositoId: ID): Promise<StockItem[]>;
  cantidad(productoId: ID, depositoId: ID, varianteId?: ID): Promise<number>;
  consolidado(filtro?: { producto_id?: ID; deposito_id?: ID; sin_stock?: boolean }): Promise<StockItem[]>;
  /**
   * Devuelve un Map productoId → stock total (suma de todos los depósitos)
   * para los IDs dados. Útil para evitar N+1 en listados: una sola request
   * batch en lugar de una por producto.
   */
  totalesDeMuchos(productoIds: ID[], depositoId?: ID): Promise<Map<ID, number>>;

  // Movimientos
  ajustar(input: { producto_id: ID; variante_id?: ID; deposito_id: ID; cantidad: number; motivo: string; empleado_id: ID }): Promise<MovimientoStock>;
  registrarMerma(input: { producto_id: ID; variante_id?: ID; deposito_id: ID; cantidad: number; motivo: string; empleado_id: ID }): Promise<MovimientoStock>;
  // Llamado por VentasRepo. Falla si no hay stock y el llamante no autoriza vender sin stock.
  descontarPorVenta(input: { producto_id: ID; variante_id?: ID; deposito_id: ID; cantidad: number; venta_id: ID; empleado_id: ID; permitirSinStock: boolean }): Promise<MovimientoStock>;

  /**
   * Transferencia inmediata entre dos depósitos: decrementa origen, incrementa
   * destino, registra los 2 movimientos (transferencia_salida / transferencia_entrada).
   * Pensado para el botón "Stock" del PoS — el cajero asienta una transferencia
   * que ya ocurrió físicamente. NO hay flujo de aprobación (a diferencia del
   * crear→emitir→recibir de TransferenciasRepo).
   *
   * Devuelve los 2 movimientos creados [salida, entrada]. Falla si origen=destino
   * o si cantidad <= 0.
   */
  transferenciaInmediata?(input: {
    producto_id: ID;
    variante_id?: ID;
    deposito_origen_id: ID;
    deposito_destino_id: ID;
    cantidad: number;
    motivo?: string;
    empleado_id: ID;
  }): Promise<{ salida: MovimientoStock; entrada: MovimientoStock }>;

  /**
   * Anula una transferencia inmediata creando el par inverso. Recibe el id
   * de uno de los 2 movimientos (salida o entrada) y revierte el efecto:
   * suma al origen, resta al destino, registra 2 movs nuevos con motivo
   * "Anulación de transferencia #...". NO borra los movs originales para
   * mantener el historial auditable.
   *
   * Falla si el id no corresponde a una transferencia o si ya fue anulada.
   */
  anularTransferenciaInmediata?(input: {
    movimiento_id: ID;
    empleado_id: ID;
  }): Promise<{ salida: MovimientoStock; entrada: MovimientoStock }>;

  /**
   * Anula un ajuste de stock creando un ajuste inverso. Recibe el id del
   * ajuste original y genera un nuevo movimiento con delta inverso y
   * motivo "Anulación de ajuste #...". NO borra el original para
   * mantener el historial auditable — el efecto NETO sobre el stock queda
   * en 0.
   *
   * Solo funciona con movimientos tipo 'ajuste' y cuya cantidad tenga
   * signo real (post-fix rpc_aplicar_delta_stock del 2026-08-10). Para
   * ajustes viejos en abs no se puede garantizar el signo → falla.
   *
   * Idempotente: si ya existe una anulación previa del mismo id, falla
   * con mensaje amigable.
   */
  anularAjuste?(input: {
    movimiento_id: ID;
    empleado_id: ID;
  }): Promise<MovimientoStock>;

  movimientos(filtro?: { producto_id?: ID; deposito_id?: ID; desde?: string; hasta?: string }): Promise<MovimientoStock[]>;
};
