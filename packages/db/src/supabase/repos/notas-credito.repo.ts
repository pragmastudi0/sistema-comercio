import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotasCreditoRepo } from '../../repos/notas-credito.repo';
import type { NotaCredito } from '../../types';
import { okMaybe, paginarTodo } from '../helpers';

export function makeNotasCreditoRepo(sb: SupabaseClient): NotasCreditoRepo {
  return {
    async list(filtro = {}) {
      return paginarTodo<NotaCredito>((from, to) => {
        let q = sb.from('notas_credito').select('*').order('fecha', { ascending: false });
        if (filtro.venta_id) q = q.eq('venta_id', filtro.venta_id);
        if (filtro.desde) q = q.gte('fecha', filtro.desde);
        if (filtro.hasta) q = q.lte('fecha', filtro.hasta);
        return q.range(from, to);
      }, 'notas_credito.list');
    },
    async get(id) {
      return okMaybe<NotaCredito>(
        await sb.from('notas_credito').select('*').eq('id', id).maybeSingle(),
        'notas_credito.get',
      );
    },
    async emitir({ venta_id, empleado_id, motivo, items }) {
      const { data, error } = await sb.rpc('rpc_emitir_nota_credito', {
        p_venta_id: venta_id,
        p_empleado_id: empleado_id,
        p_motivo: motivo,
        p_items: items,
      });
      if (error) throw new Error(`notas_credito.emitir: ${error.message}`);
      return data as NotaCredito;
    },
  };
}
