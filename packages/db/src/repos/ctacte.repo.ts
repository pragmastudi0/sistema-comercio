import type { ID, MovimientoCtaCte } from '../types';

export type CtaCteRepo = {
  movimientosDeCliente(clienteId: ID): Promise<MovimientoCtaCte[]>;
  registrarPago(input: Omit<MovimientoCtaCte, 'id' | 'fecha' | 'tipo'> & { tipo?: 'pago' }): Promise<MovimientoCtaCte>;
  registrarCargo(input: Omit<MovimientoCtaCte, 'id' | 'fecha' | 'tipo'> & { tipo?: 'cargo' }): Promise<MovimientoCtaCte>;
  condonar(clienteId: ID, monto: number, empleadoId: ID, nota?: string): Promise<MovimientoCtaCte>;
};
