import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListasPrecioRepo } from '../../repos/listas-precio.repo';
import type { ListaPrecio } from '../../types';
import { okList } from '../helpers';

type DbRow = { id: string; nombre: string; es_default: boolean; activa: boolean };

function fromDb(r: DbRow): ListaPrecio {
  return { id: r.id, nombre: r.nombre, default: r.es_default, activa: r.activa };
}
function toDb(input: Partial<ListaPrecio>): Partial<DbRow> {
  const out: Partial<DbRow> = {};
  if (input.id !== undefined) out.id = input.id;
  if (input.nombre !== undefined) out.nombre = input.nombre;
  if (input.default !== undefined) out.es_default = input.default;
  if (input.activa !== undefined) out.activa = input.activa;
  return out;
}

export function makeListasPrecioRepo(sb: SupabaseClient): ListasPrecioRepo {
  return {
    async list() {
      const rows = okList<DbRow>(
        await sb.from('listas_precio').select('*').order('nombre'),
        'listas_precio.list',
      );
      return rows.map(fromDb);
    },
    async get(id) {
      const { data, error } = await sb
        .from('listas_precio')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`listas_precio.get: ${error.message}`);
      return data ? fromDb(data as DbRow) : null;
    },
    async create(input) {
      const { data, error } = await sb
        .from('listas_precio')
        .insert(toDb(input))
        .select('*')
        .single();
      if (error) throw new Error(`listas_precio.create: ${error.message}`);
      return fromDb(data as DbRow);
    },
    async update(id, patch) {
      const { data, error } = await sb
        .from('listas_precio')
        .update(toDb(patch))
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(`listas_precio.update: ${error.message}`);
      return fromDb(data as DbRow);
    },
    async delete(id) {
      const { error } = await sb.from('listas_precio').delete().eq('id', id);
      if (error) throw new Error(`listas_precio.delete: ${error.message}`);
    },
  };
}
