import type { CajasRepo } from '../../repos/cajas.repo';
import type { Caja } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeCajasRepo(store: Store): CajasRepo {
  return {
    async list(localId) {
      return clone(localId ? store.cajas.filter((c) => c.local_id === localId) : store.cajas);
    },
    async get(id) {
      const c = store.cajas.find((x) => x.id === id);
      return c ? clone(c) : null;
    },
    async create(input) {
      const c: Caja = { ...input, id: makeId('caja') };
      store.cajas.push(c);
      return clone(c);
    },
    async update(id, patch) {
      const idx = store.cajas.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Caja', id);
      store.cajas[idx] = { ...store.cajas[idx]!, ...patch, id };
      return clone(store.cajas[idx]!);
    },
  };
}
