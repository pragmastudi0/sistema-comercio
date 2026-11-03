import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProveedoresRepo } from '../../repos/proveedores.repo';
import type { Proveedor } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makeProveedoresRepo(sb: SupabaseClient): ProveedoresRepo {
  return {
    async list(filtro) {
      let q = sb.from('proveedores').select('*').order('nombre');
      if (filtro?.activo !== undefined) q = q.eq('activo', filtro.activo);
      if (filtro?.texto) q = q.ilike('nombre', `%${filtro.texto}%`);
      return okList<Proveedor>(await q, 'proveedores.list');
    },
    async get(id) {
      return okMaybe<Proveedor>(
        await sb.from('proveedores').select('*').eq('id', id).maybeSingle(),
        'proveedores.get',
      );
    },
    async create(input) {
      return ok<Proveedor>(
        await sb.from('proveedores').insert(input).select('*').single(),
        'proveedores.create',
      );
    },
    async update(id, patch) {
      return ok<Proveedor>(
        await sb.from('proveedores').update(patch).eq('id', id).select('*').single(),
        'proveedores.update',
      );
    },
    async delete(id) {
      const { error } = await sb.from('proveedores').delete().eq('id', id);
      if (error) throw new Error(`proveedores.delete: ${error.message}`);
    },
  };
}
