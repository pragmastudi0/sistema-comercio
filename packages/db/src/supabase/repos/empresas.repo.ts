import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmpresasRepo } from '../../repos/empresas.repo';
import type { Empresa } from '../../types';
import { ok, okMaybe } from '../helpers';

export function makeEmpresasRepo(sb: SupabaseClient): EmpresasRepo {
  return {
    async get(id) {
      return okMaybe<Empresa>(
        await sb.from('empresas').select('*').eq('id', id).maybeSingle(),
        'empresas.get',
      );
    },
    async getBySubdominio(subdominio) {
      return okMaybe<Empresa>(
        await sb
          .from('empresas')
          .select('*')
          .eq('subdominio', subdominio)
          .eq('activa', true)
          .maybeSingle(),
        'empresas.getBySubdominio',
      );
    },
    async update(id, patch) {
      return ok<Empresa>(
        await sb.from('empresas').update(patch).eq('id', id).select('*').single(),
        'empresas.update',
      );
    },
  };
}
