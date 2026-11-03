import type { ConfiguracionRepo } from '../../repos/configuracion.repo';
import type { Store } from '../store';
import { clone } from '../utils';

export function makeConfiguracionRepo(store: Store): ConfiguracionRepo {
  return {
    async get(_empresaId) {
      return clone(store.configuracion);
    },
    async update(_empresaId, patch) {
      store.configuracion = { ...store.configuracion, ...patch };
      return clone(store.configuracion);
    },
  };
}
