import type { CategoriasRepo } from '../../repos/categorias.repo';
import type { Categoria } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeCategoriasRepo(store: Store): CategoriasRepo {
  return {
    async list() {
      return clone(store.categorias);
    },
    async get(id) {
      const c = store.categorias.find((x) => x.id === id);
      return c ? clone(c) : null;
    },
    async create(input) {
      const c: Categoria = { ...input, id: makeId('cat') };
      store.categorias.push(c);
      return clone(c);
    },
    async update(id, patch) {
      const idx = store.categorias.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Categoría', id);
      store.categorias[idx] = { ...store.categorias[idx]!, ...patch, id };
      return clone(store.categorias[idx]!);
    },
    async delete(id) {
      store.categorias = store.categorias.filter((c) => c.id !== id);
    },
  };
}
