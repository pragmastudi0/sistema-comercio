import type { ID, ListaPrecio } from '../types';

export type ListasPrecioRepo = {
  list(): Promise<ListaPrecio[]>;
  get(id: ID): Promise<ListaPrecio | null>;
  create(input: Omit<ListaPrecio, 'id'>): Promise<ListaPrecio>;
  update(id: ID, patch: Partial<ListaPrecio>): Promise<ListaPrecio>;
  delete(id: ID): Promise<void>;
};
