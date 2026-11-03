import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClientesRepo } from '../../repos/clientes.repo';
import type { Cliente } from '../../types';
import { ok, okList, okMaybe } from '../helpers';
import { esDemoMode, logDemo, randomUuid } from '../../demo-mode';

export function makeClientesRepo(sb: SupabaseClient): ClientesRepo {
  return {
    async list(filtro = {}) {
      let q = sb.from('clientes').select('*').order('apellido');
      if (filtro.activo !== undefined) q = q.eq('activo', filtro.activo);
      if (filtro.suspendido !== undefined) q = q.eq('suspendido', filtro.suspendido);
      if (filtro.con_deuda) q = q.gt('saldo', 0);
      if (filtro.texto) {
        const p = `%${filtro.texto}%`;
        q = q.or(`nombre.ilike.${p},apellido.ilike.${p},dni.ilike.${p}`);
      }
      return okList<Cliente>(await q, 'clientes.list');
    },
    async get(id) {
      return okMaybe<Cliente>(
        await sb.from('clientes').select('*').eq('id', id).maybeSingle(),
        'clientes.get',
      );
    },
    async buscarPorDni(dni) {
      return okMaybe<Cliente>(
        await sb.from('clientes').select('*').eq('dni', dni).maybeSingle(),
        'clientes.buscarPorDni',
      );
    },
    async create(input) {
      if (esDemoMode()) {
        logDemo('clientes.create', input);
        return {
          id: randomUuid(),
          ...input,
          saldo: 0,
        } as Cliente;
      }
      return ok<Cliente>(
        await sb
          .from('clientes')
          .insert({ ...input, saldo: 0 })
          .select('*')
          .single(),
        'clientes.create',
      );
    },
    async update(id, patch) {
      if (esDemoMode()) {
        logDemo('clientes.update', { id, ...patch });
        return { id, ...patch, saldo: 0 } as Cliente;
      }
      return ok<Cliente>(
        await sb.from('clientes').update(patch).eq('id', id).select('*').single(),
        'clientes.update',
      );
    },
    async delete(id) {
      if (esDemoMode()) {
        logDemo('clientes.delete', { id });
        return;
      }
      const { error } = await sb.from('clientes').delete().eq('id', id);
      if (error) throw new Error(`clientes.delete: ${error.message}`);
    },
    async suspender(id, suspendido) {
      if (esDemoMode()) {
        logDemo('clientes.suspender', { id, suspendido });
        return { id, suspendido, saldo: 0 } as Cliente;
      }
      return ok<Cliente>(
        await sb.from('clientes').update({ suspendido }).eq('id', id).select('*').single(),
        'clientes.suspender',
      );
    },
  };
}
