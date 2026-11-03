import type { CtaCteRepo } from '../../repos/ctacte.repo';
import type { MovimientoCtaCte } from '../../types';
import type { Store } from '../store';
import { clone, makeId, now } from '../utils';

export function makeCtaCteRepo(store: Store): CtaCteRepo {
  function aplicarSaldo(clienteId: string, delta: number) {
    const cli = store.clientes.find((c) => c.id === clienteId);
    if (cli) cli.saldo += delta;
  }

  return {
    async movimientosDeCliente(clienteId) {
      return clone(store.movimientosCtaCte.filter((m) => m.cliente_id === clienteId));
    },
    async registrarPago(input) {
      const mov: MovimientoCtaCte = { ...input, tipo: 'pago', id: makeId('mov_cc'), fecha: now() };
      store.movimientosCtaCte.push(mov);
      aplicarSaldo(mov.cliente_id, -mov.monto);
      return clone(mov);
    },
    async registrarCargo(input) {
      const mov: MovimientoCtaCte = { ...input, tipo: 'cargo', id: makeId('mov_cc'), fecha: now() };
      store.movimientosCtaCte.push(mov);
      aplicarSaldo(mov.cliente_id, mov.monto);
      return clone(mov);
    },
    async condonar(clienteId, monto, empleadoId, nota) {
      const mov: MovimientoCtaCte = {
        id: makeId('mov_cc'),
        cliente_id: clienteId,
        tipo: 'condonacion',
        monto,
        empleado_id: empleadoId,
        fecha: now(),
        nota,
      };
      store.movimientosCtaCte.push(mov);
      aplicarSaldo(clienteId, -monto);
      return clone(mov);
    },
  };
}
