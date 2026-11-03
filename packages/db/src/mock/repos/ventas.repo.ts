import type { VentasRepo } from '../../repos/ventas.repo';
import type { Venta } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';
import { makeStockRepo } from './stock.repo';
import { makeSesionesCajaRepo } from './sesiones-caja.repo';
import { makeCtaCteRepo } from './ctacte.repo';

export function makeVentasRepo(store: Store): VentasRepo {
  const stockRepo = makeStockRepo(store);
  const sesionesRepo = makeSesionesCajaRepo(store);
  const ctaCteRepo = makeCtaCteRepo(store);

  function nextNumero(): string {
    store.contadorVentas += 1;
    return `0001-${store.contadorVentas.toString().padStart(8, '0')}`;
  }

  return {
    async list(filtro) {
      return clone(
        store.ventas.filter((v) => {
          if (filtro?.local_id && v.local_id !== filtro.local_id) return false;
          if (filtro?.caja_id && v.caja_id !== filtro.caja_id) return false;
          if (filtro?.sesion_caja_id && v.sesion_caja_id !== filtro.sesion_caja_id) return false;
          if (filtro?.empleado_id && v.empleado_id !== filtro.empleado_id) return false;
          if (filtro?.cliente_id && v.cliente_id !== filtro.cliente_id) return false;
          if (filtro?.estado && v.estado !== filtro.estado) return false;
          if (filtro?.desde && v.fecha < filtro.desde) return false;
          if (filtro?.hasta && v.fecha > filtro.hasta) return false;
          return true;
        }),
      );
    },
    async get(id) {
      const v = store.ventas.find((x) => x.id === id);
      return v ? clone(v) : null;
    },
    async crear(input) {
      const venta: Venta = {
        ...input,
        id: makeId('vta'),
        numero: nextNumero(),
        estado: 'completada',
        fecha: now(),
      };

      // 1) Descontar stock por cada ítem
      for (const it of venta.items) {
        await stockRepo.descontarPorVenta({
          producto_id: it.producto_id,
          variante_id: it.variante_id,
          deposito_id: venta.deposito_id,
          cantidad: it.cantidad,
          venta_id: venta.id,
          empleado_id: venta.empleado_id,
          permitirSinStock: false,
        });
      }

      // 2) Registrar pagos como movimientos de caja en la sesión activa
      for (const pago of venta.pagos) {
        await sesionesRepo.registrarMovimiento({
          sesion_caja_id: venta.sesion_caja_id,
          tipo: 'venta',
          metodo: pago.metodo,
          monto: pago.monto,
          venta_id: venta.id,
          empleado_id: venta.empleado_id,
        });
        // Si parte se paga en cta cte, generar cargo
        if (pago.metodo === 'cta_cte' && venta.cliente_id) {
          await ctaCteRepo.registrarCargo({
            cliente_id: venta.cliente_id,
            monto: pago.monto,
            empleado_id: venta.empleado_id,
            venta_id: venta.id,
            nota: `Venta ${venta.numero}`,
          });
        }
      }

      store.ventas.push(venta);
      return clone(venta);
    },
    async anular(id, empleadoId, motivo) {
      const idx = store.ventas.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Venta', id);
      const v = store.ventas[idx]!;
      if (v.estado === 'anulada') throw new Error('Venta ya anulada');

      // Devolver stock
      for (const it of v.items) {
        const item = store.stock.find(
          (s) => s.producto_id === it.producto_id && s.deposito_id === v.deposito_id && s.variante_id === it.variante_id,
        );
        if (item) item.cantidad += it.cantidad;
        store.movimientosStock.push({
          id: makeId('mov_st'),
          producto_id: it.producto_id,
          variante_id: it.variante_id,
          deposito_id: v.deposito_id,
          tipo: 'devolucion',
          cantidad: it.cantidad,
          referencia_id: v.id,
          empleado_id: empleadoId,
          fecha: now(),
          motivo,
        });
      }

      // Revertir movimientos de caja (anulación con monto negativo lógico)
      for (const pago of v.pagos) {
        await sesionesRepo.registrarMovimiento({
          sesion_caja_id: v.sesion_caja_id,
          tipo: 'anulacion',
          metodo: pago.metodo,
          monto: pago.monto,
          venta_id: v.id,
          empleado_id: empleadoId,
        });
        if (pago.metodo === 'cta_cte' && v.cliente_id) {
          // Compensar con un movimiento opuesto en cta cte
          await ctaCteRepo.registrarPago({
            cliente_id: v.cliente_id,
            monto: pago.monto,
            empleado_id: empleadoId,
            venta_id: v.id,
            nota: `Anulación venta ${v.numero}: ${motivo}`,
          });
        }
      }

      store.ventas[idx] = {
        ...v,
        estado: 'anulada',
        anulada_por: empleadoId,
        anulada_en: now(),
        motivo_anulacion: motivo,
      };
      return clone(store.ventas[idx]!);
    },
    async presupuesto(input) {
      const v: Venta = {
        ...input,
        id: makeId('pre'),
        numero: `PRES-${nextNumero()}`,
        estado: 'presupuesto',
        fecha: now(),
      };
      store.ventas.push(v);
      return clone(v);
    },
    async cancelar(input) {
      const v: Venta = {
        ...input,
        pagos: [],
        id: makeId('canc'),
        numero: `CAN-${nextNumero()}`,
        estado: 'cancelada',
        fecha: now(),
      };
      store.ventas.push(v);
      return clone(v);
    },
  };
}
