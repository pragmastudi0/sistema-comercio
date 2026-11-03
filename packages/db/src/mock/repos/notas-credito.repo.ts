import type { NotasCreditoRepo } from '../../repos/notas-credito.repo';
import type { NotaCredito } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';

export function makeNotasCreditoRepo(store: Store): NotasCreditoRepo {
  return {
    async list(filtro = {}) {
      return clone(
        store.notasCredito.filter((nc) => {
          if (filtro.venta_id && nc.venta_id !== filtro.venta_id) return false;
          if (filtro.desde && nc.fecha < filtro.desde) return false;
          if (filtro.hasta && nc.fecha > filtro.hasta) return false;
          return true;
        }),
      );
    },
    async get(id) {
      const nc = store.notasCredito.find((x) => x.id === id);
      return nc ? clone(nc) : null;
    },
    async emitir({ venta_id, empleado_id, motivo, items }) {
      const venta = store.ventas.find((v) => v.id === venta_id);
      if (!venta) throw notFound('Venta', venta_id);

      // Validar que las cantidades a devolver sean <= a las vendidas
      for (const it of items) {
        const enVenta = venta.items.find((x) => x.producto_id === it.producto_id);
        if (!enVenta) throw new Error(`Producto ${it.producto_id} no estaba en la venta original`);
        if (it.cantidad <= 0) throw new Error('Cantidad inválida');
        if (it.cantidad > enVenta.cantidad) {
          throw new Error(
            `Cantidad a devolver (${it.cantidad}) supera la vendida (${enVenta.cantidad})`,
          );
        }
      }

      // Devolver stock al depósito de la venta
      for (const it of items) {
        const item = store.stock.find(
          (s) => s.producto_id === it.producto_id && s.deposito_id === venta.deposito_id,
        );
        if (item) item.cantidad += it.cantidad;
        store.movimientosStock.push({
          id: makeId('mov_st'),
          producto_id: it.producto_id,
          deposito_id: venta.deposito_id,
          tipo: 'devolucion',
          cantidad: it.cantidad,
          referencia_id: venta.id,
          empleado_id,
          fecha: now(),
          motivo,
        });
      }

      const itemsConSubtotal = items.map((it) => ({
        ...it,
        subtotal: it.cantidad * it.precio_unitario,
      }));
      const monto_total = itemsConSubtotal.reduce((acc, it) => acc + it.subtotal, 0);
      store.contadorNotasCredito += 1;
      const nc: NotaCredito = {
        id: makeId('nc'),
        numero: `NC-${store.contadorNotasCredito.toString().padStart(8, '0')}`,
        venta_id,
        empleado_id,
        motivo,
        items: itemsConSubtotal,
        monto_total,
        fecha: now(),
      };
      store.notasCredito.push(nc);
      return clone(nc);
    },
  };
}
