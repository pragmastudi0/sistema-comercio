import type { ID, Empresa } from '../types';

/** Acceso a la tabla raíz de inquilinos. La tienda web pública resuelve el
 *  tenant por subdominio; admin/pos leen la empresa del empleado logueado. */
export type EmpresasRepo = {
  get(id: ID): Promise<Empresa | null>;
  /** Resuelve la empresa por su subdominio (tienda web). null si no existe o inactiva. */
  getBySubdominio(subdominio: string): Promise<Empresa | null>;
  update(id: ID, patch: Partial<Empresa>): Promise<Empresa>;
};
