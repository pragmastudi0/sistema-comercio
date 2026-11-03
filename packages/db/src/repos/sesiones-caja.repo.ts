import type { ID, MovimientoCaja, SesionCaja } from '../types';

export type SesionesCajaRepo = {
  abrir(input: { caja_id: ID; empleado_id: ID; saldo_inicial: number }): Promise<SesionCaja>;
  cerrar(id: ID, saldoFinalDeclarado: number): Promise<SesionCaja>;
  sesionActivaDe(empleadoId: ID, cajaId: ID): Promise<SesionCaja | null>;
  list(filtro?: { caja_id?: ID; local_id?: ID; empleado_id?: ID; desde?: string; hasta?: string }): Promise<SesionCaja[]>;
  get(id: ID): Promise<SesionCaja | null>;
  movimientos(sesionId: ID): Promise<MovimientoCaja[]>;
  registrarMovimiento(input: Omit<MovimientoCaja, 'id' | 'fecha'>): Promise<MovimientoCaja>;
  /**
   * Corrige el saldo inicial de una sesión ya abierta. Útil cuando el
   * cajero declaró un monto erróneo al abrir y quiere ajustarlo sin
   * cerrar/reabrir la caja. Devuelve la sesión actualizada.
   */
  actualizarSaldoInicial?(id: ID, nuevoSaldoInicial: number): Promise<SesionCaja>;
  /**
   * Cambia el empleado responsable ACTUAL de una sesión abierta (feature
   * "Cambiar usuario" del PoS: dos cajeros comparten la misma caja durante
   * un cambio de turno, sin cerrarla y reabrirla). NO toca empleado_id
   * original — ese queda como referencia histórica de quién abrió. Cada
   * venta sigue apuntando al empleado que efectivamente la cobró.
   */
  cambiarResponsable?(id: ID, nuevoEmpleadoId: ID): Promise<SesionCaja>;
  /**
   * Cierra todas las OTRAS sesiones abiertas en la misma caja física,
   * excepto la especificada. Se usa después de cerrar la sesión activa
   * para consolidar el cierre cuando había multi-sesión (feature iter-2):
   * si dos cajeros compartieron una caja durante un cambio de turno,
   * cerrar UNA no cerraba las otras y quedaban sesiones fantasma.
   *
   * Las otras sesiones se cierran con saldo_final_declarado = null
   * (nadie declaró explícitamente su cierre — quedó implícito). Devuelve
   * la cantidad de sesiones que efectivamente se cerraron.
   */
  cerrarOtrasSesionesEnCaja?(cajaId: ID, exceptoSesionId: ID): Promise<number>;
  /**
   * Corrige metadata de una sesión — solo lo usa el dev de Pragma para
   * arreglar sesiones que se abrieron con datos equivocados (empleado
   * mal elegido, caja del local incorrecto). Los saldos y movimientos
   * NO se tocan acá — para eso está actualizarSaldoInicial. Devuelve
   * la sesión ya actualizada.
   */
  editarSesion?(
    id: ID,
    patch: {
      empleado_id?: ID;
      empleado_actual_id?: ID;
      caja_id?: ID;
      saldo_inicial?: number;
      saldo_final_declarado?: number | null;
    },
  ): Promise<SesionCaja>;
  /**
   * Cierra una sesión que quedó abierta sin arqueo (el cajero se fue
   * sin apretar Cerrar). No exige saldo declarado — queda null y en el
   * arqueo posterior se ve como "sin declarar". Solo lo usa el dev de
   * Pragma. Devuelve la sesión ya cerrada.
   */
  forzarCierre?(id: ID, cerradaEn?: string): Promise<SesionCaja>;
  /**
   * Elimina una sesión de caja Y todos sus registros asociados
   * (movimientos_caja, ventas de la sesión, movimientos_stock de esas
   * ventas). Reservado al dev de Pragma para limpiar sesiones de prueba.
   * OPERACIÓN IRREVERSIBLE — no hay soft delete. Recomendable exportar
   * un backup antes si hay data real.
   */
  eliminar?(id: ID): Promise<{ ventas: number; movimientos_caja: number }>;
};
