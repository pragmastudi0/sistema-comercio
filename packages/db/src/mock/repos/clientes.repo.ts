import type { ClientesRepo } from '../../repos/clientes.repo';
import type { Cliente } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';

export function makeClientesRepo(store: Store): ClientesRepo {
  return {
    async list(filtro) {
      return clone(
        store.clientes.filter((c) => {
          if (filtro?.activo !== undefined && c.activo !== filtro.activo) return false;
          if (filtro?.suspendido !== undefined && c.suspendido !== filtro.suspendido) return false;
          if (filtro?.con_deuda && c.saldo <= 0) return false;
          if (filtro?.texto) {
            const q = filtro.texto.toLowerCase();
            const full = `${c.nombre} ${c.apellido} ${c.dni ?? ''}`.toLowerCase();
            if (!full.includes(q)) return false;
          }
          return true;
        }),
      );
    },
    async get(id) {
      const c = store.clientes.find((x) => x.id === id);
      return c ? clone(c) : null;
    },
    async buscarPorDni(dni) {
      const c = store.clientes.find((x) => x.dni === dni) ?? null;
      return c ? clone(c) : null;
    },
    async create(input) {
      const c: Cliente = { ...input, id: makeId('cli'), saldo: 0, creado_en: now() };
      store.clientes.push(c);
      return clone(c);
    },
    async update(id, patch) {
      const idx = store.clientes.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Cliente', id);
      store.clientes[idx] = { ...store.clientes[idx]!, ...patch, id };
      return clone(store.clientes[idx]!);
    },
    async delete(id) {
      store.clientes = store.clientes.filter((c) => c.id !== id);
    },
    async suspender(id, suspendido) {
      const idx = store.clientes.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Cliente', id);
      store.clientes[idx] = { ...store.clientes[idx]!, suspendido };
      return clone(store.clientes[idx]!);
    },
  };
}
