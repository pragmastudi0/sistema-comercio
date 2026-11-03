import type { ConfiguracionEmpresa, ID } from '../types';

export type ConfiguracionRepo = {
  get(empresaId: ID): Promise<ConfiguracionEmpresa>;
  update(empresaId: ID, patch: Partial<ConfiguracionEmpresa>): Promise<ConfiguracionEmpresa>;
};
