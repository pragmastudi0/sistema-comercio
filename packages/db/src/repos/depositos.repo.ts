import type { Deposito, ID } from '../types';

export type DepositosRepo = {
  list(): Promise<Deposito[]>;
  get(id: ID): Promise<Deposito | null>;
  create(input: Omit<Deposito, 'id'>): Promise<Deposito>;
  update(id: ID, patch: Partial<Deposito>): Promise<Deposito>;
  delete(id: ID): Promise<void>;
};
