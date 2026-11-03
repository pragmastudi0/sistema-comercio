import type { TransferenciasRepo } from '../../repos/transferencias.repo';
import type { Transferencia } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';

export function makeTransferenciasRepo(store: Store): TransferenciasRepo {
  return {
    async list(filtro) {
      return clone(
        store.transferencias.filter((t) => {
          if (filtro?.estado && t.estado !== filtro.estado) return false;
          if (filtro?.deposito_id && t.deposito_origen_id !== filtro.deposito_id && t.deposito_destino_id !== filtro.deposito_id) return false;
          return true;
        }),
      );
    },
    async get(id) {
      const t = store.transferencias.find((x) => x.id === id);
      return t ? clone(t) : null;
    },
    async crearBorrador(input) {
      const t: Transferencia = { ...input, id: makeId('trf'), estado: 'borrador', creada_en: now() };
      store.transferencias.push(t);
      return clone(t);
    },
    async actualizarBorrador(id, patch) {
      const idx = store.transferencias.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Transferencia', id);
      const t = store.transferencias[idx]!;
      if (t.estado !== 'borrador') {
        throw new Error('Solo se puede editar una transferencia en borrador');
      }
      store.transferencias[idx] = { ...t, ...patch };
      return clone(store.transferencias[idx]!);
    },
    async delete(id) {
      const idx = store.transferencias.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Transferencia', id);
      const t = store.transferencias[idx]!;
      if (t.estado !== 'borrador' && t.estado !== 'anulada') {
        throw new Error('Solo se puede borrar una transferencia en borrador o anulada');
      }
      store.transferencias.splice(idx, 1);
    },
    async emitir(id, empleadoId) {
      const idx = store.transferencias.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Transferencia', id);
      const t = store.transferencias[idx]!;
      if (t.estado !== 'borrador') throw new Error('Solo se puede emitir desde borrador');
      // Descuenta stock del origen
      for (const it of t.items) {
        const item = store.stock.find(
          (s) => s.producto_id === it.producto_id && s.deposito_id === t.deposito_origen_id && s.variante_id === it.variante_id,
        );
        if (!item || item.cantidad < it.cantidad) {
          throw new Error(`Stock insuficiente en origen para ${it.producto_id}`);
        }
        item.cantidad -= it.cantidad;
        store.movimientosStock.push({
          id: makeId('mov_st'),
          producto_id: it.producto_id,
          variante_id: it.variante_id,
          deposito_id: t.deposito_origen_id,
          tipo: 'transferencia_salida',
          cantidad: it.cantidad,
          referencia_id: t.id,
          empleado_id: empleadoId,
          fecha: now(),
        });
      }
      store.transferencias[idx] = { ...t, estado: 'emitida', emitida_por: empleadoId, emitida_en: now() };
      return clone(store.transferencias[idx]!);
    },
    async recibir(id, empleadoId) {
      const idx = store.transferencias.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Transferencia', id);
      const t = store.transferencias[idx]!;
      if (t.estado !== 'emitida') throw new Error('Solo se puede recibir una transferencia emitida');
      for (const it of t.items) {
        let item = store.stock.find(
          (s) => s.producto_id === it.producto_id && s.deposito_id === t.deposito_destino_id && s.variante_id === it.variante_id,
        );
        if (!item) {
          item = { producto_id: it.producto_id, deposito_id: t.deposito_destino_id, variante_id: it.variante_id, cantidad: 0 };
          store.stock.push(item);
        }
        item.cantidad += it.cantidad;
        store.movimientosStock.push({
          id: makeId('mov_st'),
          producto_id: it.producto_id,
          variante_id: it.variante_id,
          deposito_id: t.deposito_destino_id,
          tipo: 'transferencia_entrada',
          cantidad: it.cantidad,
          referencia_id: t.id,
          empleado_id: empleadoId,
          fecha: now(),
        });
      }
      store.transferencias[idx] = { ...t, estado: 'recibida', recibida_por: empleadoId, recibida_en: now() };
      return clone(store.transferencias[idx]!);
    },
    async anular(id, _empleadoId, _motivo) {
      const idx = store.transferencias.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Transferencia', id);
      const t = store.transferencias[idx]!;
      if (t.estado === 'recibida') throw new Error('No se puede anular una transferencia ya recibida');
      // Si estaba emitida, devolver stock al origen
      if (t.estado === 'emitida') {
        for (const it of t.items) {
          const item = store.stock.find(
            (s) => s.producto_id === it.producto_id && s.deposito_id === t.deposito_origen_id && s.variante_id === it.variante_id,
          );
          if (item) item.cantidad += it.cantidad;
        }
      }
      store.transferencias[idx] = { ...t, estado: 'anulada' };
      return clone(store.transferencias[idx]!);
    },
  };
}
