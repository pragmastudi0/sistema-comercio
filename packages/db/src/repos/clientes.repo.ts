import type { Cliente, ID } from '../types';

export type FiltroClientes = {
  texto?: string;
  con_deuda?: boolean;
  suspendido?: boolean;
  activo?: boolean;
};

export type ClientesRepo = {
  list(filtro?: FiltroClientes): Promise<Cliente[]>;
  get(id: ID): Promise<Cliente | null>;
  buscarPorDni(dni: string): Promise<Cliente | null>;
  create(input: Omit<Cliente, 'id' | 'saldo' | 'creado_en'>): Promise<Cliente>;
  update(id: ID, patch: Partial<Cliente>): Promise<Cliente>;
  delete(id: ID): Promise<void>;
  suspender(id: ID, suspendido: boolean): Promise<Cliente>;
};
