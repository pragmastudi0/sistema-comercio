import type { ID, Transferencia } from '../types';

export type TransferenciasRepo = {
  list(filtro?: { estado?: Transferencia['estado']; deposito_id?: ID }): Promise<Transferencia[]>;
  get(id: ID): Promise<Transferencia | null>;
  crearBorrador(input: Omit<Transferencia, 'id' | 'estado' | 'creada_en'>): Promise<Transferencia>;
  /** Edita un borrador (NO permite cambios si ya está emitida/recibida). */
  actualizarBorrador(
    id: ID,
    patch: Partial<Pick<Transferencia, 'deposito_origen_id' | 'deposito_destino_id' | 'items'>>,
  ): Promise<Transferencia>;
  emitir(id: ID, empleadoId: ID): Promise<Transferencia>;
  recibir(id: ID, empleadoId: ID): Promise<Transferencia>;
  anular(id: ID, empleadoId: ID, motivo: string): Promise<Transferencia>;
  /** Borra física una transferencia. Solo permitido si estado='borrador' o 'anulada'. */
  delete(id: ID): Promise<void>;
};
