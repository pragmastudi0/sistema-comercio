import type { SupabaseClient } from '@supabase/supabase-js';
import type { CtaCteRepo } from '../../repos/ctacte.repo';
import type { MovimientoCtaCte } from '../../types';
import { ok, okList } from '../helpers';

async function aplicarSaldoDelta(sb: SupabaseClient, clienteId: string, delta: number) {
  // Lectura + escritura (no es atómico, pero no es crítico — la app de pos
  // genera estos movimientos dentro de la RPC rpc_crear_venta cuando es venta).
  const { data, error } = await sb
    .from('clientes')
    .select('saldo')
    .eq('id', clienteId)
    .single();
  if (error) throw new Error(`ctacte.aplicarSaldoDelta: ${error.message}`);
  const nuevo = (data?.saldo ?? 0) + delta;
  const { error: e2 } = await sb.from('clientes').update({ saldo: nuevo }).eq('id', clienteId);
  if (e2) throw new Error(`ctacte.aplicarSaldoDelta: ${e2.message}`);
}

export function makeCtaCteRepo(sb: SupabaseClient): CtaCteRepo {
  return {
    async movimientosDeCliente(clienteId) {
      return okList<MovimientoCtaCte>(
        await sb
          .from('movimientos_ctacte')
          .select('*')
          .eq('cliente_id', clienteId)
          .order('fecha', { ascending: false }),
        'ctacte.movimientosDeCliente',
      );
    },
    async registrarPago(input) {
      const mov = ok<MovimientoCtaCte>(
        await sb
          .from('movimientos_ctacte')
          .insert({ ...input, tipo: 'pago' })
          .select('*')
          .single(),
        'ctacte.registrarPago',
      );
      await aplicarSaldoDelta(sb, mov.cliente_id, -mov.monto);
      return mov;
    },
    async registrarCargo(input) {
      const mov = ok<MovimientoCtaCte>(
        await sb
          .from('movimientos_ctacte')
          .insert({ ...input, tipo: 'cargo' })
          .select('*')
          .single(),
        'ctacte.registrarCargo',
      );
      await aplicarSaldoDelta(sb, mov.cliente_id, mov.monto);
      return mov;
    },
    async condonar(clienteId, monto, empleadoId, nota) {
      const mov = ok<MovimientoCtaCte>(
        await sb
          .from('movimientos_ctacte')
          .insert({
            cliente_id: clienteId,
            tipo: 'condonacion',
            monto,
            empleado_id: empleadoId,
            nota,
          })
          .select('*')
          .single(),
        'ctacte.condonar',
      );
      await aplicarSaldoDelta(sb, clienteId, -monto);
      return mov;
    },
  };
}
