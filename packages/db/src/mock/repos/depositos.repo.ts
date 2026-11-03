import type { DepositosRepo } from '../../repos/depositos.repo';
import type { Deposito } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeDepositosRepo(store: Store): DepositosRepo {
  return {
    async list() {
      return clone(store.depositos);
    },
    async get(id) {
      const d = store.depositos.find((x) => x.id === id);
      return d ? clone(d) : null;
    },
    async create(input) {
      const d: Deposito = { ...input, id: makeId('dep') };
      store.depositos.push(d);
      return clone(d);
    },
    async update(id, patch) {
      const idx = store.depositos.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Depósito', id);
      store.depositos[idx] = { ...store.depositos[idx]!, ...patch, id };
      return clone(store.depositos[idx]!);
    },
    async delete(id) {
      store.depositos = store.depositos.filter((d) => d.id !== id);
    },
  };
}
