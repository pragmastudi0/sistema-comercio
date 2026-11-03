import type { EmpleadosRepo } from '../../repos/empleados.repo';
import type { Empleado } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';

export function makeEmpleadosRepo(store: Store): EmpleadosRepo {
  return {
    async list(filtro) {
      return clone(
        store.empleados.filter((e) => {
          if (filtro?.activo !== undefined && e.activo !== filtro.activo) return false;
          if (filtro?.rol_id && e.rol_id !== filtro.rol_id) return false;
          if (filtro?.local_id && e.local_id !== filtro.local_id) return false;
          if (filtro?.deposito_id && e.deposito_id !== filtro.deposito_id) return false;
          if (filtro?.texto) {
            const q = filtro.texto.toLowerCase();
            const full = `${e.nombre} ${e.apellido} ${e.email}`.toLowerCase();
            if (!full.includes(q)) return false;
          }
          return true;
        }),
      );
    },
    async get(id) {
      const e = store.empleados.find((x) => x.id === id);
      return e ? clone(e) : null;
    },
    async create(input, password) {
      const e: Empleado = { ...input, id: makeId('emp'), creado_en: now() };
      store.empleados.push(e);
      store.passwords[e.id] = password;
      return clone(e);
    },
    async update(id, patch) {
      const idx = store.empleados.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Empleado', id);
      store.empleados[idx] = { ...store.empleados[idx]!, ...patch, id };
      return clone(store.empleados[idx]!);
    },
    async delete(id) {
      // Soft delete (paridad con el repo de Supabase, ver comentario allá):
      // marcar inactivo en vez de borrar para preservar el historial.
      const idx = store.empleados.findIndex((e) => e.id === id);
      if (idx === -1) return;
      store.empleados[idx] = { ...store.empleados[idx]!, activo: false };
    },
    async setOverridePermisos(id, override) {
      const idx = store.empleados.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Empleado', id);
      store.empleados[idx] = { ...store.empleados[idx]!, permisos_override: override };
      return clone(store.empleados[idx]!);
    },
    async cambiarRol(id, rolId) {
      const idx = store.empleados.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Empleado', id);
      store.empleados[idx] = { ...store.empleados[idx]!, rol_id: rolId };
      return clone(store.empleados[idx]!);
    },
    async setPassword(id, password) {
      const exists = store.empleados.find((e) => e.id === id);
      if (!exists) throw notFound('Empleado', id);
      store.passwords[id] = password;
    },
    async autenticar(email, password) {
      const empleado = store.empleados.find(
        (e) => e.email.toLowerCase() === email.toLowerCase() && e.activo,
      );
      if (!empleado) return null;
      if (store.passwords[empleado.id] !== password) return null;
      return clone(empleado);
    },
  };
}
