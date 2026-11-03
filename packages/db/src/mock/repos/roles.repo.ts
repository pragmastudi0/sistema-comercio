import type { RolesRepo } from '../../repos/roles.repo';
import type { Rol } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound } from '../utils';

export function makeRolesRepo(store: Store): RolesRepo {
  return {
    async list() {
      return clone(store.roles);
    },
    async get(id) {
      const r = store.roles.find((x) => x.id === id);
      return r ? clone(r) : null;
    },
    async create(input) {
      const r: Rol = { ...input, id: makeId('rol') };
      store.roles.push(r);
      return clone(r);
    },
    async update(id, patch) {
      const idx = store.roles.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Rol', id);
      store.roles[idx] = { ...store.roles[idx]!, ...patch, id };
      return clone(store.roles[idx]!);
    },
    async delete(id) {
      const rol = store.roles.find((x) => x.id === id);
      if (!rol) throw notFound('Rol', id);
      if (rol.preset) throw new Error('No se pueden eliminar roles preset del sistema');
      const enUso = store.empleados.some((e) => e.rol_id === id);
      if (enUso) throw new Error('No se puede eliminar un rol asignado a empleados');
      store.roles = store.roles.filter((r) => r.id !== id);
    },
  };
}
