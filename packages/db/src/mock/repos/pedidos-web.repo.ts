import type { PedidosWebRepo } from '../../repos/pedidos-web.repo';
import type { PedidoWeb } from '../../types';
import type { Store } from '../store';
import { clone, makeId, now } from '../utils';

export function makePedidosWebRepo(store: Store): PedidosWebRepo {
  return {
    async list(filtro = {}) {
      let rows = [...(store.pedidosWeb ?? [])];
      if (filtro.estado && filtro.estado !== 'todos') {
        rows = rows.filter((p) => p.estado === filtro.estado);
      }
      if (filtro.desde) rows = rows.filter((p) => p.creado_en >= filtro.desde!);
      if (filtro.hasta) rows = rows.filter((p) => p.creado_en <= filtro.hasta!);
      if (filtro.texto) {
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
      return clone(rows.sort((a, b) => b.creado_en.localeCompare(a.creado_en)));
    },
    async get(id) {
      const p = (store.pedidosWeb ?? []).find((x) => x.id === id);
      return p ? clone(p) : null;
    },
    async contarPendientes() {
      return (store.pedidosWeb ?? []).filter((p) => p.estado === 'pendiente').length;
    },
    async crear(input) {
      if (!store.pedidosWeb) store.pedidosWeb = [];
      const numero = (store.pedidosWeb.length ?? 0) + 1;
      const p: PedidoWeb = {
        id: makeId('ped_web'),
        numero,
        cliente_datos: input.cliente_datos,
        items: input.items,
        subtotal: input.subtotal,
        descuento_total: input.descuento_total,
        total: input.total,
        metodo_pago: input.metodo_pago,
        forma_entrega: input.forma_entrega,
        notas: input.notas,
        estado: 'pendiente',
        creado_en: now(),
      };
      store.pedidosWeb.push(p);
      return clone(p);
    },
    async aprobar({ pedido_id, empleado_id, deposito_id }) {
      const p = (store.pedidosWeb ?? []).find((x) => x.id === pedido_id);
      if (!p) throw new Error('Pedido no encontrado');
      if (p.estado !== 'pendiente') {
        throw new Error('El pedido ya no estaba pendiente');
      }
      const refMotivo = `Aprobación pedido web #${String(p.numero).padStart(4, '0')} — ${p.cliente_datos.razon_social}`;
      // Descontar stock de cada ítem + registrar movimiento_stock.
      for (const it of p.items) {
        const item = store.stock.find(
          (s) => s.producto_id === it.producto_id && s.deposito_id === deposito_id,
        );
        if (item) {
          item.cantidad -= it.cantidad;
        } else {
          store.stock.push({
            producto_id: it.producto_id,
            deposito_id,
            cantidad: -it.cantidad,
          });
        }
        store.movimientosStock.push({
          id: makeId('mov_st'),
          producto_id: it.producto_id,
          deposito_id,
          tipo: 'venta',
          cantidad: it.cantidad,
          motivo: refMotivo,
          empleado_id,
          fecha: now(),
        });
      }
      p.estado = 'aprobado';
      p.procesado_por = empleado_id;
      p.procesado_en = now();
      return clone(p);
    },
    async rechazar({ pedido_id, empleado_id, motivo }) {
      const p = (store.pedidosWeb ?? []).find((x) => x.id === pedido_id);
      if (!p) throw new Error('Pedido no encontrado');
      if (p.estado !== 'pendiente') {
        throw new Error('El pedido ya no estaba pendiente');
      }
      p.estado = 'rechazado';
      p.motivo_rechazo = motivo;
      p.procesado_por = empleado_id;
      p.procesado_en = now();
      return clone(p);
    },
  };
}
