import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalesRepo } from '../../repos/locales.repo';
import type { Local } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makeLocalesRepo(sb: SupabaseClient): LocalesRepo {
  return {
    async list() {
      return okList<Local>(
        await sb.from('locales').select('*').order('nombre'),
        'locales.list',
      );
    },
    async get(id) {
      return okMaybe<Local>(
        await sb.from('locales').select('*').eq('id', id).maybeSingle(),
        'locales.get',
      );
    },
    async create(input) {
      return ok<Local>(
        await sb.from('locales').insert(input).select('*').single(),
        'locales.create',
      );
    },
    async update(id, patch) {
      return ok<Local>(
        await sb.from('locales').update(patch).eq('id', id).select('*').single(),
        'locales.update',
      );
    },
    async delete(id) {
      const { error } = await sb.from('locales').delete().eq('id', id);
      if (error) throw new Error(`locales.delete: ${error.message}`);
    },
  };
}
