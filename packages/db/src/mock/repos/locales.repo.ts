import type { LocalesRepo } from '../../repos/locales.repo';
import type { Local } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeLocalesRepo(store: Store): LocalesRepo {
  return {
    async list() {
      return clone(store.locales);
    },
    async get(id) {
      const l = store.locales.find((x) => x.id === id);
      return l ? clone(l) : null;
    },
    async create(input) {
      const l: Local = { ...input, id: makeId('loc') };
      store.locales.push(l);
      return clone(l);
    },
    async update(id, patch) {
      const idx = store.locales.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Local', id);
      store.locales[idx] = { ...store.locales[idx]!, ...patch, id };
      return clone(store.locales[idx]!);
    },
    async delete(id) {
      store.locales = store.locales.filter((l) => l.id !== id);
    },
  };
}
