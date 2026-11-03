import type { ID, NotaCredito } from '../types';

export type NotasCreditoRepo = {
  list(filtro?: { venta_id?: ID; desde?: string; hasta?: string }): Promise<NotaCredito[]>;
  get(id: ID): Promise<NotaCredito | null>;
  /** Emite una NC vinculada a una venta. Devuelve stock al depósito de la venta. */
  emitir(input: {
    venta_id: ID;
    empleado_id: ID;
    motivo: string;
    items: { producto_id: ID; cantidad: number; precio_unitario: number }[];
  }): Promise<NotaCredito>;
};
