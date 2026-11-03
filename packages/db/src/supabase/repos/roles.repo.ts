import type { SupabaseClient } from '@supabase/supabase-js';
import type { RolesRepo } from '../../repos/roles.repo';
import type { Rol } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makeRolesRepo(sb: SupabaseClient): RolesRepo {
  return {
    async list() {
      return okList<Rol>(
        await sb.from('roles').select('*').order('nombre'),
        'roles.list',
      );
    },
    async get(id) {
      return okMaybe<Rol>(
        await sb.from('roles').select('*').eq('id', id).maybeSingle(),
        'roles.get',
      );
    },
    async create(input) {
      return ok<Rol>(
        await sb.from('roles').insert({ ...input, preset: false }).select('*').single(),
        'roles.create',
      );
    },
    async update(id, patch) {
      return ok<Rol>(
        await sb.from('roles').update(patch).eq('id', id).select('*').single(),
        'roles.update',
      );
    },
    async delete(id) {
      // Validar que no haya empleados asignados
      const { count, error: cErr } = await sb
        .from('empleados')
        .select('id', { count: 'exact', head: true })
        .eq('rol_id', id);
      if (cErr) throw new Error(`roles.delete: ${cErr.message}`);
      if ((count ?? 0) > 0) {
        throw new Error('No se puede eliminar un rol asignado a empleados');
      }
      const { error } = await sb.from('roles').delete().eq('id', id);
      if (error) throw new Error(`roles.delete: ${error.message}`);
    },
  };
}
