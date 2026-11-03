import type { ID, PedidoWeb } from '../types';

export type FiltroPedidosWeb = {
  estado?: PedidoWeb['estado'] | 'todos';
  desde?: string;
  hasta?: string;
  texto?: string; // busca en razón social / contacto / teléfono
};

export type CrearPedidoWebInput = Omit<
  PedidoWeb,
  'id' | 'numero' | 'estado' | 'creado_en' | 'venta_id' | 'procesado_por' | 'procesado_en' | 'motivo_rechazo'
>;

export type PedidosWebRepo = {
  list(filtro?: FiltroPedidosWeb): Promise<PedidoWeb[]>;
  get(id: ID): Promise<PedidoWeb | null>;
  /** Cantidad de pedidos con estado 'pendiente' — para el badge del toolbar. */
  contarPendientes(): Promise<number>;
  /** Crea el pedido desde la web pública. Anon puede llamarla vía RLS. */
  crear(input: CrearPedidoWebInput): Promise<PedidoWeb>;
  /** Aprueba el pedido:
   *   1. Descuenta el stock del depósito elegido (atómico via RPC).
   *   2. Genera movimiento_stock por cada ítem con motivo
   *      "Aprobación pedido web #N".
   *   3. Marca el pedido como aprobado + procesado_por/en.
   *
   *  NO crea venta en la tabla `ventas` del PoS — los pedidos
   *  mayoristas viven en su propio universo (`pedidos_web`) para no
   *  mezclar con las ventas del mostrador y no requerir sesión de
   *  caja abierta al aprobar.
   */
  aprobar(input: {
    pedido_id: ID;
    empleado_id: ID;
    deposito_id: ID;
  }): Promise<PedidoWeb>;
  rechazar(input: {
    pedido_id: ID;
    empleado_id: ID;
    motivo: string;
  }): Promise<PedidoWeb>;
};
