import type { SupabaseClient } from '@supabase/supabase-js';
import type { VentasRepo } from '../../repos/ventas.repo';
import type { Venta } from '../../types';
import { ok, okMaybe, paginarTodo } from '../helpers';
import { aplicarDeltaStock } from './stock.repo';
import { esDemoMode, logDemo, randomUuid } from '../../demo-mode';

export function makeVentasRepo(sb: SupabaseClient): VentasRepo {
  return {
    async list(filtro = {}) {
      // PostgREST corta silenciosamente a 1000 filas si no se paginan.
      // Con go-live tempranero + volumen real, el admin veía "1000
      // ventas" y creía que era el total. Ver helpers.paginarTodo.
      return paginarTodo<Venta>((from, to) => {
        let q = sb.from('ventas').select('*').order('fecha', { ascending: false });
        if (filtro.local_id) q = q.eq('local_id', filtro.local_id);
        if (filtro.caja_id) q = q.eq('caja_id', filtro.caja_id);
        if (filtro.sesion_caja_id)
          q = q.eq('sesion_caja_id', filtro.sesion_caja_id);
        if (filtro.empleado_id) q = q.eq('empleado_id', filtro.empleado_id);
        if (filtro.cliente_id) q = q.eq('cliente_id', filtro.cliente_id);
        if (filtro.estado) q = q.eq('estado', filtro.estado);
        if (filtro.desde) q = q.gte('fecha', filtro.desde);
        if (filtro.hasta) q = q.lte('fecha', filtro.hasta);
        return q.range(from, to);
      }, 'ventas.list');
    },
    async get(id) {
      return okMaybe<Venta>(
        await sb.from('ventas').select('*').eq('id', id).maybeSingle(),
        'ventas.get',
      );
    },
    async crear(input) {
      if (esDemoMode()) {
        logDemo('ventas.crear', { local: input.local_id, total: input.total });
        const now = new Date().toISOString();
        return {
          id: randomUuid(),
          numero: `DEMO-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`,
          caja_id: input.caja_id,
          sesion_caja_id: input.sesion_caja_id,
          local_id: input.local_id,
          deposito_id: input.deposito_id,
          empleado_id: input.empleado_id,
          cliente_id: input.cliente_id,
          items: input.items,
          pagos: input.pagos,
          subtotal: input.subtotal,
          descuento_total: input.descuento_total ?? 0,
          recargo_total: input.recargo_total ?? 0,
          total: input.total,
          estado: 'completada',
          fecha: now,
        } as Venta;
      }
      // Llama la RPC atómica que: numera, valida y descuenta stock, inserta
      // venta, registra movimientos de caja y carga cta cte si corresponde.
      const params = {
        p_caja_id: input.caja_id,
        p_sesion_caja_id: input.sesion_caja_id,
        p_local_id: input.local_id,
        p_deposito_id: input.deposito_id,
        p_empleado_id: input.empleado_id,
        p_cliente_id: input.cliente_id ?? null,
        p_items: input.items,
        p_pagos: input.pagos,
        p_subtotal: input.subtotal,
        p_descuento_total: input.descuento_total,
        p_recargo_total: input.recargo_total,
        p_total: input.total,
      };
      // Log temporal para diagnosticar el bug del UUID "1" en producción.
      // Si vemos qué campo es "1", lo identificamos y arreglamos.
      // eslint-disable-next-line no-console
      console.log('[ventas.crear v2] params →', JSON.stringify(params, null, 2));
      const { data, error } = await sb.rpc('rpc_crear_venta', params);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[ventas.crear v2] error →', error, 'params:', params);
        throw new Error(`ventas.crear (v2): ${error.message}`);
      }
      return data as Venta;
    },
    async anular(id, empleadoId, motivo) {
      if (esDemoMode()) {
        logDemo('ventas.anular', { id, motivo });
        return {
          id,
          numero: `DEMO-0000`,
          caja_id: randomUuid(),
          sesion_caja_id: randomUuid(),
          local_id: randomUuid(),
          deposito_id: randomUuid(),
          empleado_id: empleadoId,
          cliente_id: undefined,
          items: [],
          pagos: [],
          subtotal: 0,
          descuento_total: 0,
          recargo_total: 0,
          total: 0,
          estado: 'anulada',
          anulada_por: empleadoId,
          anulada_en: new Date().toISOString(),
          motivo_anulacion: motivo,
          fecha: new Date().toISOString(),
        } as Venta;
      }
      // NOTA: idealmente esto debería ser una RPC atómica (devuelve
      // stock + registra movs + revierte caja en una sola TX). Hoy
      // son 3 pasos sueltos — si falla a la mitad, el resto no se
      // revierte. Pendiente: migrar a `rpc_anular_venta`. Mientras
      // tanto, cada paso tiene su try/catch claro para que un error
      // diga DÓNDE falló, no un mensaje genérico.

      // 1) Marcar la venta como anulada
      const venta = ok<Venta>(
        await sb
          .from('ventas')
          .update({
            estado: 'anulada',
            anulada_por: empleadoId,
            anulada_en: new Date().toISOString(),
            motivo_anulacion: motivo,
          })
          .eq('id', id)
          .eq('estado', 'completada')
          .select('*')
          .single(),
        'ventas.anular',
      );

      // 2) Devolver stock + registrar movimientos. Usamos
      //    `aplicarDeltaStock` para evitar el bug del upsert con
      //    unique parcial (ver stock.repo.ts).
      for (const it of venta.items) {
        try {
          await aplicarDeltaStock(sb, {
            producto_id: it.producto_id,
            variante_id: it.variante_id ?? null,
            deposito_id: venta.deposito_id,
            delta: it.cantidad,
          });
        } catch (e) {
          throw new Error(
            `ventas.anular (stock prod=${it.producto_id}): ${(e as Error).message}`,
          );
        }
        const { error: movErr } = await sb.from('movimientos_stock').insert({
          producto_id: it.producto_id,
          variante_id: it.variante_id ?? null,
          deposito_id: venta.deposito_id,
          tipo: 'devolucion',
          cantidad: it.cantidad,
          referencia_id: venta.id,
          empleado_id: empleadoId,
          motivo,
        });
        if (movErr) {
          throw new Error(
            `ventas.anular (movimiento stock prod=${it.producto_id}): ${movErr.message}`,
          );
        }
      }

      // 3) Revertir movimientos de caja (uno por método de pago original).
      for (const pago of venta.pagos) {
        const { error: cajaErr } = await sb.from('movimientos_caja').insert({
          sesion_caja_id: venta.sesion_caja_id,
          tipo: 'anulacion',
          metodo: pago.metodo,
          monto: pago.monto,
          venta_id: venta.id,
          empleado_id: empleadoId,
        });
        if (cajaErr) {
          throw new Error(
            `ventas.anular (movimiento caja método=${pago.metodo}): ${cajaErr.message}`,
          );
        }
      }

      return venta;
    },
    async presupuesto(input) {
      // Para presupuestos: insertar sin RPC (no descuenta stock).
      return ok<Venta>(
        await sb
          .from('ventas')
          .insert({
            ...input,
            numero: `PRES-${Date.now()}`,
            estado: 'presupuesto',
            cliente_id: input.cliente_id ?? null,
          })
          .select('*')
          .single(),
        'ventas.presupuesto',
      );
    },
    async cancelar(input) {
      // Para ventas canceladas: insert directo sin RPC. No descuenta stock,
      // no genera movimientos de caja, pagos vacíos. Solo queda como
      // registro auditable.
      //
      // El número usa un sufijo UUID en lugar de Date.now() para evitar
      // colisiones si dos canceladas se generan en el mismo ms (red lenta
      // + cajero apretando Cancelar varias veces).
      const sufijo =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
      return ok<Venta>(
        await sb
          .from('ventas')
          .insert({
            ...input,
            pagos: [],
            numero: `CAN-${sufijo}`,
            estado: 'cancelada',
            cliente_id: input.cliente_id ?? null,
          })
          .select('*')
          .single(),
        'ventas.cancelar',
      );
    },
  };
}
