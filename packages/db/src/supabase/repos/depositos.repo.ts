import type { SupabaseClient } from '@supabase/supabase-js';
import type { DepositosRepo } from '../../repos/depositos.repo';
import type { Deposito } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makeDepositosRepo(sb: SupabaseClient): DepositosRepo {
  return {
    async list() {
      return okList<Deposito>(
        await sb.from('depositos').select('*').order('nombre'),
        'depositos.list',
      );
    },
    async get(id) {
      return okMaybe<Deposito>(
        await sb.from('depositos').select('*').eq('id', id).maybeSingle(),
        'depositos.get',
      );
    },
    async create(input) {
      return ok<Deposito>(
        await sb.from('depositos').insert(input).select('*').single(),
        'depositos.create',
      );
    },
    async update(id, patch) {
      return ok<Deposito>(
        await sb.from('depositos').update(patch).eq('id', id).select('*').single(),
        'depositos.update',
      );
    },
    async delete(id) {
      const { error } = await sb.from('depositos').delete().eq('id', id);
      if (error) throw new Error(`depositos.delete: ${error.message}`);
    },
  };
}
