import type { Caja, ID } from '../types';

export type CajasRepo = {
  list(localId?: ID): Promise<Caja[]>;
  get(id: ID): Promise<Caja | null>;
  create(input: Omit<Caja, 'id'>): Promise<Caja>;
  update(id: ID, patch: Partial<Caja>): Promise<Caja>;
};
