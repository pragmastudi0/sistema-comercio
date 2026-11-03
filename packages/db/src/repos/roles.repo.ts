import type { ID, Rol } from '../types';

export type RolesRepo = {
  list(): Promise<Rol[]>;
  get(id: ID): Promise<Rol | null>;
  create(input: Omit<Rol, 'id'>): Promise<Rol>;
  update(id: ID, patch: Partial<Rol>): Promise<Rol>;
  delete(id: ID): Promise<void>;
};
