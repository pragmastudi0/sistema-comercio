import type { Categoria, ID } from '../types';

export type CategoriasRepo = {
  list(): Promise<Categoria[]>;
  get(id: ID): Promise<Categoria | null>;
  create(input: Omit<Categoria, 'id'>): Promise<Categoria>;
  update(id: ID, patch: Partial<Categoria>): Promise<Categoria>;
  delete(id: ID): Promise<void>;
};
