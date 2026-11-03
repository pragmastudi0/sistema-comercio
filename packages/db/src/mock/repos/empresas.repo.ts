import type { EmpresasRepo } from '../../repos/empresas.repo';
import type { Store } from '../store';
import { clone } from '../utils';

// Mock single-empresa: sirve la única empresa del seed.
export function makeEmpresasRepo(store: Store): EmpresasRepo {
  return {
    async get(id) {
      return store.empresa.id === id ? clone(store.empresa) : null;
    },
    async getBySubdominio(subdominio) {
      return store.empresa.subdominio === subdominio ? clone(store.empresa) : null;
    },
    async update(id, patch) {
      if (store.empresa.id !== id) throw new Error(`empresas.update: ${id} no encontrada`);
      store.empresa = { ...store.empresa, ...patch, id };
      return clone(store.empresa);
    },
  };
}
