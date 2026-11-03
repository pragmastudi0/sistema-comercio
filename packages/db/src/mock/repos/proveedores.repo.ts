import type { ProveedoresRepo } from '../../repos/proveedores.repo';
import type { Proveedor } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeProveedoresRepo(store: Store): ProveedoresRepo {
  return {
    async list(filtro) {
      return clone(
        store.proveedores.filter((p) => {
          if (filtro?.activo !== undefined && p.activo !== filtro.activo) return false;
          if (filtro?.texto && !p.nombre.toLowerCase().includes(filtro.texto.toLowerCase())) return false;
          return true;
        }),
      );
    },
    async get(id) {
      const p = store.proveedores.find((x) => x.id === id);
      return p ? clone(p) : null;
    },
    async create(input) {
      const p: Proveedor = { ...input, id: makeId('prov') };
      store.proveedores.push(p);
      return clone(p);
    },
    async update(id, patch) {
      const idx = store.proveedores.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Proveedor', id);
      store.proveedores[idx] = { ...store.proveedores[idx]!, ...patch, id };
      return clone(store.proveedores[idx]!);
    },
    async delete(id) {
      store.proveedores = store.proveedores.filter((p) => p.id !== id);
    },
  };
}
