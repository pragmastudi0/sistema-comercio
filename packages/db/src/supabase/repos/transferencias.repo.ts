import type { SupabaseClient } from '@supabase/supabase-js';
import type { TransferenciasRepo } from '../../repos/transferencias.repo';
import type { Transferencia } from '../../types';
import { ok, okList, okMaybe, paginarTodo } from '../helpers';

export function makeTransferenciasRepo(sb: SupabaseClient): TransferenciasRepo {
  return {
    async list(filtro = {}) {
      return paginarTodo<Transferencia>((from, to) => {
        let q = sb.from('transferencias').select('*').order('creada_en', { ascending: false });
        if (filtro.estado) q = q.eq('estado', filtro.estado);
        if (filtro.deposito_id) {
          q = q.or(
            `deposito_origen_id.eq.${filtro.deposito_id},deposito_destino_id.eq.${filtro.deposito_id}`,
          );
        }
        return q.range(from, to);
      }, 'transferencias.list');
    },
    async get(id) {
      return okMaybe<Transferencia>(
        await sb.from('transferencias').select('*').eq('id', id).maybeSingle(),
        'transferencias.get',
      );
    },
    async crearBorrador(input) {
      return ok<Transferencia>(
        await sb
          .from('transferencias')
          .insert({ ...input, estado: 'borrador' })
          .select('*')
          .single(),
        'transferencias.crearBorrador',
      );
    },
    async actualizarBorrador(id, patch) {
      const { data: t, error } = await sb
        .from('transferencias')
        .select('estado')
        .eq('id', id)
        .single();
      if (error) throw new Error(`transferencias.actualizarBorrador: ${error.message}`);
      if (t.estado !== 'borrador') {
        throw new Error('Solo se puede editar una transferencia en borrador');
      }
      return ok<Transferencia>(
        await sb
          .from('transferencias')
          .update(patch)
          .eq('id', id)
          .select('*')
          .single(),
        'transferencias.actualizarBorrador (update)',
      );
    },
    async delete(id) {
      const { data: t, error } = await sb
        .from('transferencias')
        .select('estado')
        .eq('id', id)
        .single();
      if (error) throw new Error(`transferencias.delete: ${error.message}`);
      if (t.estado !== 'borrador' && t.estado !== 'anulada') {
        throw new Error('Solo se puede borrar una transferencia en borrador o anulada');
      }
      const { error: delError } = await sb.from('transferencias').delete().eq('id', id);
      if (delError) throw new Error(`transferencias.delete: ${delError.message}`);
    },
    async emitir(id, empleadoId) {
      const { data: t, error } = await sb
        .from('transferencias')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw new Error(`transferencias.emitir: ${error.message}`);
      if (t.estado !== 'borrador') throw new Error('Solo se puede emitir desde borrador');

      // Descontar stock del origen y registrar movimientos
      for (const it of t.items as Array<{ producto_id: string; cantidad: number; variante_id?: string }>) {
        const { data: existente } = await sb
          .from('stock_items')
          .select('cantidad')
          .eq('producto_id', it.producto_id)
          .eq('deposito_id', t.deposito_origen_id)
          .maybeSingle();
        const actual = Number(existente?.cantidad ?? 0);
        if (actual < it.cantidad) {
          throw new Error(`Stock insuficiente en origen para ${it.producto_id}`);
        }
        await sb.from('stock_items').upsert({
          producto_id: it.producto_id,
          variante_id: it.variante_id ?? null,
          deposito_id: t.deposito_origen_id,
          cantidad: actual - it.cantidad,
        });
        await sb.from('movimientos_stock').insert({
          producto_id: it.producto_id,
          deposito_id: t.deposito_origen_id,
          tipo: 'transferencia_salida',
          cantidad: it.cantidad,
          referencia_id: id,
          empleado_id: empleadoId,
        });
      }

      return ok<Transferencia>(
        await sb
          .from('transferencias')
          .update({
            estado: 'emitida',
            emitida_por: empleadoId,
            emitida_en: new Date().toISOString(),
          })
          .eq('id', id)
          .select('*')
          .single(),
        'transferencias.emitir (update)',
      );
    },
    async recibir(id, empleadoId) {
      const { data: t, error } = await sb
        .from('transferencias')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw new Error(`transferencias.recibir: ${error.message}`);
      if (t.estado !== 'emitida') throw new Error('Solo se puede recibir una emitida');

      for (const it of t.items as Array<{ producto_id: string; cantidad: number; variante_id?: string }>) {
        const { data: existente } = await sb
          .from('stock_items')
          .select('cantidad')
          .eq('producto_id', it.producto_id)
          .eq('deposito_id', t.deposito_destino_id)
          .maybeSingle();
        const actual = Number(existente?.cantidad ?? 0);
        await sb.from('stock_items').upsert({
          producto_id: it.producto_id,
          variante_id: it.variante_id ?? null,
          deposito_id: t.deposito_destino_id,
          cantidad: actual + it.cantidad,
        });
        await sb.from('movimientos_stock').insert({
          producto_id: it.producto_id,
          deposito_id: t.deposito_destino_id,
          tipo: 'transferencia_entrada',
          cantidad: it.cantidad,
          referencia_id: id,
          empleado_id: empleadoId,
        });
      }

      return ok<Transferencia>(
        await sb
          .from('transferencias')
          .update({
            estado: 'recibida',
            recibida_por: empleadoId,
            recibida_en: new Date().toISOString(),
          })
          .eq('id', id)
          .select('*')
          .single(),
        'transferencias.recibir (update)',
      );
    },
    async anular(id, _empleadoId, _motivo) {
      const { data: t, error } = await sb
        .from('transferencias')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw new Error(`transferencias.anular: ${error.message}`);
      if (t.estado === 'recibida') throw new Error('No se puede anular una recibida');

      // Si estaba emitida, devolver stock al origen
      if (t.estado === 'emitida') {
        for (const it of t.items as Array<{ producto_id: string; cantidad: number; variante_id?: string }>) {
          const { data: existente } = await sb
            .from('stock_items')
            .select('cantidad')
            .eq('producto_id', it.producto_id)
            .eq('deposito_id', t.deposito_origen_id)
            .maybeSingle();
          const actual = Number(existente?.cantidad ?? 0);
          await sb.from('stock_items').upsert({
            producto_id: it.producto_id,
            variante_id: it.variante_id ?? null,
            deposito_id: t.deposito_origen_id,
            cantidad: actual + it.cantidad,
          });
        }
      }

      return ok<Transferencia>(
        await sb
          .from('transferencias')
          .update({ estado: 'anulada' })
          .eq('id', id)
          .select('*')
          .single(),
        'transferencias.anular (update)',
      );
    },
  };
}
