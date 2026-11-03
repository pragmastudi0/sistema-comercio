import type { ListasPrecioRepo } from '../../repos/listas-precio.repo';
import type { ListaPrecio } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeListasPrecioRepo(store: Store): ListasPrecioRepo {
  return {
    async list() {
      return clone(store.listasPrecio);
    },
    async get(id) {
      const l = store.listasPrecio.find((x) => x.id === id);
      return l ? clone(l) : null;
    },
    async create(input) {
      const l: ListaPrecio = { ...input, id: makeId('lp') };
      store.listasPrecio.push(l);
      return clone(l);
    },
    async update(id, patch) {
      const idx = store.listasPrecio.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Lista de precio', id);
      store.listasPrecio[idx] = { ...store.listasPrecio[idx]!, ...patch, id };
      return clone(store.listasPrecio[idx]!);
    },
    async delete(id) {
      store.listasPrecio = store.listasPrecio.filter((l) => l.id !== id);
    },
  };
}
