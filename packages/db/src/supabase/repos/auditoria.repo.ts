import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditoriaRepo } from '../../repos/auditoria.repo';
import type { LogAuditoria } from '../../types';
import { ok, paginarTodo } from '../helpers';

export function makeAuditoriaRepo(sb: SupabaseClient): AuditoriaRepo {
  return {
    async log(input) {
      return ok<LogAuditoria>(
        await sb.from('logs_auditoria').insert(input).select('*').single(),
        'auditoria.log',
      );
    },
    async list(filtro = {}) {
      return paginarTodo<LogAuditoria>((from, to) => {
        let q = sb.from('logs_auditoria').select('*').order('fecha', { ascending: false });
        if (filtro.empleado_id) q = q.eq('empleado_id', filtro.empleado_id);
        if (filtro.entidad) q = q.eq('entidad', filtro.entidad);
        if (filtro.desde) q = q.gte('fecha', filtro.desde);
        if (filtro.hasta) q = q.lte('fecha', filtro.hasta);
        return q.range(from, to);
      }, 'auditoria.list');
    },
  };
}
