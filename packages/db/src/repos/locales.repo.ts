import type { ID, Local } from '../types';

export type LocalesRepo = {
  list(): Promise<Local[]>;
  get(id: ID): Promise<Local | null>;
  create(input: Omit<Local, 'id'>): Promise<Local>;
  update(id: ID, patch: Partial<Local>): Promise<Local>;
  delete(id: ID): Promise<void>;
};
