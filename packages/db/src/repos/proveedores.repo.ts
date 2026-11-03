import type { ID, Proveedor } from '../types';

export type ProveedoresRepo = {
  list(filtro?: { activo?: boolean; texto?: string }): Promise<Proveedor[]>;
  get(id: ID): Promise<Proveedor | null>;
  create(input: Omit<Proveedor, 'id'>): Promise<Proveedor>;
  update(id: ID, patch: Partial<Proveedor>): Promise<Proveedor>;
  delete(id: ID): Promise<void>;
};
