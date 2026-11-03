import type { ID, LogAuditoria } from '../types';

export type AuditoriaRepo = {
  log(input: Omit<LogAuditoria, 'id' | 'fecha'>): Promise<LogAuditoria>;
  list(filtro?: { empleado_id?: ID; entidad?: string; desde?: string; hasta?: string }): Promise<LogAuditoria[]>;
};
