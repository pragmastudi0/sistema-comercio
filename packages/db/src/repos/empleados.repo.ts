import type { Empleado, ID } from '../types';
import type { PermisosConfig } from '@comercio/business/permisos';

export type FiltroEmpleados = {
  texto?: string;
  rol_id?: ID;
  local_id?: ID;
  deposito_id?: ID;
  activo?: boolean;
};

export type EmpleadosRepo = {
  list(filtro?: FiltroEmpleados): Promise<Empleado[]>;
  get(id: ID): Promise<Empleado | null>;
  /** Crear empleado. El password queda guardado en la capa de auth (mock o Supabase). */
  create(input: Omit<Empleado, 'id' | 'creado_en'>, password: string): Promise<Empleado>;
  update(id: ID, patch: Partial<Empleado>): Promise<Empleado>;
  delete(id: ID): Promise<void>;
  setOverridePermisos(id: ID, override?: PermisosConfig): Promise<Empleado>;
  cambiarRol(id: ID, rolId: ID): Promise<Empleado>;
  setPassword(id: ID, password: string): Promise<void>;
  autenticar(email: string, password: string): Promise<Empleado | null>;
  /**
   * Inicia sesión a partir de un par de tokens Supabase ya emitidos en
   * otra app (típicamente: el admin pasa la sesión al PoS por URL para
   * que el usuario no tenga que volver a tipear su contraseña). Setea
   * la sesión en el cliente local y devuelve el empleado correspondiente.
   * Devuelve null si los tokens están vencidos / inválidos.
   */
  hidratarSesion?(accessToken: string, refreshToken: string): Promise<Empleado | null>;
};
