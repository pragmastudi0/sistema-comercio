import type { AuditoriaRepo } from '../../repos/auditoria.repo';
import type { LogAuditoria } from '../../types';
import type { Store } from '../store';
import { clone, makeId, now } from '../utils';

export function makeAuditoriaRepo(store: Store): AuditoriaRepo {
  return {
    async log(input) {
      const entry: LogAuditoria = { ...input, id: makeId('aud'), fecha: now() };
      store.auditoria.push(entry);
      return clone(entry);
    },
    async list(filtro = {}) {
      return clone(
        store.auditoria.filter((l) => {
          if (filtro.empleado_id && l.empleado_id !== filtro.empleado_id) return false;
          if (filtro.entidad && l.entidad !== filtro.entidad) return false;
          if (filtro.desde && l.fecha < filtro.desde) return false;
          if (filtro.hasta && l.fecha > filtro.hasta) return false;
          return true;
        }),
      );
    },
  };
}
