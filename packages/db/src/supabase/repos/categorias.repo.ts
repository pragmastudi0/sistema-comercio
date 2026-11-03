import type { SupabaseClient } from '@supabase/supabase-js';
import type { CategoriasRepo } from '../../repos/categorias.repo';
import type { Categoria } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makeCategoriasRepo(sb: SupabaseClient): CategoriasRepo {
  return {
    async list() {
      return okList<Categoria>(
        await sb.from('categorias').select('*').order('nombre'),
        'categorias.list',
      );
    },
    async get(id) {
      return okMaybe<Categoria>(
        await sb.from('categorias').select('*').eq('id', id).maybeSingle(),
        'categorias.get',
      );
    },
    async create(input) {
      return ok<Categoria>(
        await sb.from('categorias').insert(input).select('*').single(),
        'categorias.create',
      );
    },
    async update(id, patch) {
      return ok<Categoria>(
        await sb.from('categorias').update(patch).eq('id', id).select('*').single(),
        'categorias.update',
      );
    },
    async delete(id) {
      const { error } = await sb.from('categorias').delete().eq('id', id);
      if (error) throw new Error(`categorias.delete: ${error.message}`);
    },
  };
}
