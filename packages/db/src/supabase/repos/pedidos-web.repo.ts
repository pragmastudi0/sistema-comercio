import type { SupabaseClient } from '@supabase/supabase-js';
import type { PedidosWebRepo } from '../../repos/pedidos-web.repo';
import type { PedidoWeb } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

export function makePedidosWebRepo(sb: SupabaseClient): PedidosWebRepo {
  return {
    async list(filtro = {}) {
      let q = sb
        .from('pedidos_web')
        .select('*')
        .order('creado_en', { ascending: false });
      if (filtro.estado && filtro.estado !== 'todos') {
        q = q.eq('estado', filtro.estado);
      }
      if (filtro.desde) q = q.gte('creado_en', filtro.desde);
      if (filtro.hasta) q = q.lte('creado_en', filtro.hasta);
      let rows = okList<PedidoWeb>(await q, 'pedidosWeb.list');
      if (filtro.texto) {
        // Búsqueda en memoria — la razón social y contacto están dentro
        // del jsonb `cliente_datos` y no son indexables trivialmente.
        // Con volumen bajo (pedidos web mayoristas) sobra.
        const t = filtro.texto.toLowerCase();
        rows = rows.filter((p) => {
          const c = p.cliente_datos ?? {};
          return (
            (c.razon_social ?? '').toLowerCase().includes(t) ||
            (c.contacto ?? '').toLowerCase().includes(t) ||
            (c.telefono ?? '').toLowerCase().includes(t)
          );
        });
      }
      return rows;
    },
    async get(id) {
      return okMaybe<PedidoWeb>(
        await sb.from('pedidos_web').select('*').eq('id', id).maybeSingle(),
        'pedidosWeb.get',
      );
    },
    async contarPendientes() {
      const { count, error } = await sb
        .from('pedidos_web')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'pendiente');
      if (error) throw new Error(`pedidosWeb.contarPendientes: ${error.message}`);
      return count ?? 0;
    },
    async crear(input) {
      // Vía RPC SECURITY DEFINER — un INSERT directo desde anon con
      // `.select().single()` falla con "row violates RLS policy" porque
      // el RETURNING requiere policy SELECT y anon no la tiene (por
      // diseño: no debe leer pedidos ajenos). La RPC bypasea RLS,
      // inserta y devuelve la fila; anon solo tiene GRANT EXECUTE.
      const { data, error } = await sb.rpc('rpc_crear_pedido_web', {
        p_cliente_datos: input.cliente_datos,
        p_items: input.items,
        p_subtotal: input.subtotal,
        p_descuento_total: input.descuento_total,
        p_total: input.total,
        p_metodo_pago: input.metodo_pago,
        p_forma_entrega: input.forma_entrega,
        p_notas: input.notas ?? null,
      });
      if (error) throw new Error(`pedidosWeb.crear: ${error.message}`);
      return data as PedidoWeb;
    },
    async aprobar({ pedido_id, empleado_id, deposito_id }) {
      // 1) Traer el pedido para tener los ítems que hay que descontar.
      const pedido = okMaybe<PedidoWeb>(
        await sb.from('pedidos_web').select('*').eq('id', pedido_id).maybeSingle(),
        'pedidosWeb.aprobar (get)',
      );
      if (!pedido) throw new Error('Pedido no encontrado');
      if (pedido.estado !== 'pendiente') {
        throw new Error(`El pedido ya fue ${pedido.estado}. No se puede aprobar dos veces.`);
      }

      // 2) Descontar stock de cada ítem via la RPC atómica de stock.
      //    Motivo formato "Aprobación pedido web #N — <razón social>" para
      //    que quede identificable en /admin/movimientos-stock y modal
      //    Estadísticas.
      const refMotivo = `Aprobación pedido web #${String(pedido.numero).padStart(4, '0')} — ${pedido.cliente_datos.razon_social}`;
      for (const it of pedido.items) {
        const { data, error } = await sb.rpc('rpc_aplicar_delta_stock', {
          p_producto_id: it.producto_id,
          p_variante_id: null,
          p_deposito_id: deposito_id,
          p_delta: -it.cantidad,
          // Permitir negativo — política Turisteando: no bloquear por
          // stock insuficiente (el dueño decide corregir después).
          p_permitir_negativo: true,
        });
        if (error) {
          throw new Error(
            `pedidosWeb.aprobar (stock de "${it.nombre}"): ${error.message}`,
          );
        }
        // Registrar movimiento_stock para auditoría.
        void data;
        const movErr = await sb.from('movimientos_stock').insert({
          producto_id: it.producto_id,
          deposito_id,
          tipo: 'venta',
          cantidad: it.cantidad,
          motivo: refMotivo,
          empleado_id,
        });
        if (movErr.error) {
          // Si falla el movimiento (auditoría), el stock ya se descontó.
          // Logueamos y seguimos — es mejor perder la auditoría de una
          // línea que dejar el pedido a medio procesar.
          // eslint-disable-next-line no-console
          console.warn(
            `[pedidosWeb.aprobar] stock descontado pero movimiento no registrado:`,
            movErr.error,
          );
        }
      }

      // 3) Marcar el pedido como aprobado. Filtro estado='pendiente'
      //    para no permitir aprobar dos veces (belt-and-suspenders al
      //    check inicial).
      const { data: filas, error } = await sb
        .from('pedidos_web')
        .update({
          estado: 'aprobado',
          procesado_por: empleado_id,
          procesado_en: new Date().toISOString(),
        })
        .eq('id', pedido_id)
        .eq('estado', 'pendiente')
        .select('*');
      if (error) throw new Error(`pedidosWeb.aprobar (update): ${error.message}`);
      if (!filas || filas.length === 0) {
        throw new Error('El pedido ya no estaba pendiente. Recargá el listado.');
      }
      return filas[0] as PedidoWeb;
    },
    async rechazar({ pedido_id, empleado_id, motivo }) {
      return ok<PedidoWeb>(
        await sb
          .from('pedidos_web')
          .update({
            estado: 'rechazado',
            motivo_rechazo: motivo,
            procesado_por: empleado_id,
            procesado_en: new Date().toISOString(),
          })
          .eq('id', pedido_id)
          .eq('estado', 'pendiente')
          .select('*')
          .single(),
        'pedidosWeb.rechazar',
      );
    },
  };
}
