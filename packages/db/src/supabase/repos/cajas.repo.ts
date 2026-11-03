import type { SupabaseClient } from '@supabase/supabase-js';
import type { CajasRepo } from '../../repos/cajas.repo';
import type { Caja } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makeCajasRepo(sb: SupabaseClient): CajasRepo {
  return {
    async list(localId) {
      let q = sb.from('cajas').select('*').order('nombre');
      if (localId) q = q.eq('local_id', localId);
      return okList<Caja>(await q, 'cajas.list');
    },
    async get(id) {
      return okMaybe<Caja>(
        await sb.from('cajas').select('*').eq('id', id).maybeSingle(),
        'cajas.get',
      );
    },
    async create(input) {
      return ok<Caja>(
        await sb.from('cajas').insert(input).select('*').single(),
        'cajas.create',
      );
    },
    async update(id, patch) {
      return ok<Caja>(
        await sb.from('cajas').update(patch).eq('id', id).select('*').single(),
        'cajas.update',
      );
    },
  };
}
