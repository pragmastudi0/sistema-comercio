import type { StockRepo } from '../../repos/stock.repo';
import type { MovimientoStock, StockItem } from '../../types';
import type { Store } from '../store';
import { clone, makeId, now } from '../utils';

export function makeStockRepo(store: Store): StockRepo {
  function findOrCreate(productoId: string, depositoId: string, varianteId?: string): StockItem {
    let item = store.stock.find(
      (s) => s.producto_id === productoId && s.deposito_id === depositoId && s.variante_id === varianteId,
    );
    if (!item) {
      item = { producto_id: productoId, deposito_id: depositoId, variante_id: varianteId, cantidad: 0 };
      store.stock.push(item);
    }
    return item;
  }

  return {
    async porProducto(productoId) {
      return clone(store.stock.filter((s) => s.producto_id === productoId));
    },
    async porDeposito(depositoId) {
      return clone(store.stock.filter((s) => s.deposito_id === depositoId));
    },
    async cantidad(productoId, depositoId, varianteId) {
      const item = store.stock.find(
        (s) => s.producto_id === productoId && s.deposito_id === depositoId && s.variante_id === varianteId,
      );
      return item?.cantidad ?? 0;
    },
    async consolidado(filtro = {}) {
      return clone(
        store.stock.filter((s) => {
          if (filtro.producto_id && s.producto_id !== filtro.producto_id) return false;
          if (filtro.deposito_id && s.deposito_id !== filtro.deposito_id) return false;
          if (filtro.sin_stock && s.cantidad > 0) return false;
          return true;
        }),
      );
    },
    async totalesDeMuchos(productoIds, depositoId) {
      const set = new Set(productoIds);
      const map = new Map<string, number>();
      for (const id of productoIds) map.set(id, 0);
      for (const s of store.stock) {
        if (!set.has(s.producto_id)) continue;
        if (depositoId && s.deposito_id !== depositoId) continue;
        map.set(s.producto_id, (map.get(s.producto_id) ?? 0) + s.cantidad);
      }
      return map;
    },
    async ajustar({ producto_id, variante_id, deposito_id, cantidad, motivo, empleado_id }) {
      const item = findOrCreate(producto_id, deposito_id, variante_id);
      item.cantidad += cantidad;
      const mov: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id,
        variante_id,
        deposito_id,
        tipo: 'ajuste',
        // Guardamos el signo real (no Math.abs) para poder auditar
        // desde /admin/movimientos-stock si un ajuste sumó o restó.
        // Consistente con el repo Supabase.
        cantidad,
        motivo,
        empleado_id,
        fecha: now(),
      };
      store.movimientosStock.push(mov);
      return clone(mov);
    },
    async registrarMerma({ producto_id, variante_id, deposito_id, cantidad, motivo, empleado_id }) {
      const item = findOrCreate(producto_id, deposito_id, variante_id);
      item.cantidad -= cantidad;
      const mov: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id,
        variante_id,
        deposito_id,
        tipo: 'merma',
        cantidad,
        motivo,
        empleado_id,
        fecha: now(),
      };
      store.movimientosStock.push(mov);
      return clone(mov);
    },
    async descontarPorVenta({ producto_id, variante_id, deposito_id, cantidad, venta_id, empleado_id, permitirSinStock }) {
      const item = findOrCreate(producto_id, deposito_id, variante_id);
      if (!permitirSinStock && item.cantidad < cantidad) {
        throw new Error(`Stock insuficiente para producto ${producto_id} en depósito ${deposito_id}`);
      }
      item.cantidad -= cantidad;
      const mov: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id,
        variante_id,
        deposito_id,
        tipo: 'venta',
        cantidad,
        referencia_id: venta_id,
        empleado_id,
        fecha: now(),
      };
      store.movimientosStock.push(mov);
      return clone(mov);
    },
    async transferenciaInmediata({
      producto_id,
      variante_id,
      deposito_origen_id,
      deposito_destino_id,
      cantidad,
      motivo,
      empleado_id,
    }) {
      if (cantidad <= 0) throw new Error('La cantidad debe ser mayor a 0');
      if (deposito_origen_id === deposito_destino_id) {
        throw new Error('Origen y destino no pueden ser el mismo depósito');
      }
      const origen = findOrCreate(producto_id, deposito_origen_id, variante_id);
      const destino = findOrCreate(producto_id, deposito_destino_id, variante_id);
      // Política Turisteando: NO bloqueamos por stock insuficiente — el
      // cajero asienta lo que físicamente ya pasó. Si quedó en negativo
      // se ve en el admin y se ajusta.
      origen.cantidad -= cantidad;
      destino.cantidad += cantidad;
      const fecha = now();
      const salida: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id,
        variante_id,
        deposito_id: deposito_origen_id,
        tipo: 'transferencia_salida',
        cantidad,
        motivo,
        empleado_id,
        fecha,
      };
      const entrada: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id,
        variante_id,
        deposito_id: deposito_destino_id,
        tipo: 'transferencia_entrada',
        cantidad,
        motivo,
        empleado_id,
        fecha,
      };
      store.movimientosStock.push(salida, entrada);
      return { salida: clone(salida), entrada: clone(entrada) };
    },
    async anularTransferenciaInmediata({ movimiento_id, empleado_id }) {
      const original = store.movimientosStock.find((m) => m.id === movimiento_id);
      if (!original) throw new Error('Movimiento no encontrado');
      if (
        original.tipo !== 'transferencia_salida' &&
        original.tipo !== 'transferencia_entrada'
      ) {
        throw new Error('Solo se pueden anular transferencias');
      }
      // Buscar el par: misma fecha + mismo producto + cantidad. El otro
      // tipo (si éste es salida, el par es entrada y viceversa).
      const tipoPar =
        original.tipo === 'transferencia_salida'
          ? 'transferencia_entrada'
          : 'transferencia_salida';
      const par = store.movimientosStock.find(
        (m) =>
          m.tipo === tipoPar &&
          m.producto_id === original.producto_id &&
          m.cantidad === original.cantidad &&
          m.fecha === original.fecha &&
          m.deposito_id !== original.deposito_id,
      );
      if (!par) throw new Error('No se encontró el par de la transferencia');

      // Detectar ya anulada: si hay 2 movs (entrada+salida) con motivo
      // que referencia el id original, ya fue anulada.
      const refMotivo = `Anulación de transferencia ${movimiento_id}`;
      const yaAnulada = store.movimientosStock.some((m) => m.motivo === refMotivo);
      if (yaAnulada) throw new Error('Esta transferencia ya fue anulada');

      const origenId =
        original.tipo === 'transferencia_salida' ? original.deposito_id : par.deposito_id;
      const destinoId =
        original.tipo === 'transferencia_salida' ? par.deposito_id : original.deposito_id;

      // Crear par inverso: el origen recupera, el destino pierde.
      const origenItem = findOrCreate(original.producto_id, origenId, original.variante_id);
      const destinoItem = findOrCreate(original.producto_id, destinoId, original.variante_id);
      origenItem.cantidad += original.cantidad;
      destinoItem.cantidad -= original.cantidad;

      const fecha = now();
      const salidaInversa: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id: original.producto_id,
        variante_id: original.variante_id,
        deposito_id: destinoId,
        tipo: 'transferencia_salida',
        cantidad: original.cantidad,
        motivo: refMotivo,
        empleado_id,
        fecha,
      };
      const entradaInversa: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id: original.producto_id,
        variante_id: original.variante_id,
        deposito_id: origenId,
        tipo: 'transferencia_entrada',
        cantidad: original.cantidad,
        motivo: refMotivo,
        empleado_id,
        fecha,
      };
      store.movimientosStock.push(salidaInversa, entradaInversa);
      return { salida: clone(salidaInversa), entrada: clone(entradaInversa) };
    },
    async anularAjuste({ movimiento_id, empleado_id }) {
      const original = store.movimientosStock.find((m) => m.id === movimiento_id);
      if (!original) throw new Error('Movimiento no encontrado');
      if (original.tipo !== 'ajuste') {
        throw new Error('Solo se pueden anular ajustes de stock');
      }
      if (original.cantidad === 0) {
        throw new Error('El ajuste original es 0, no hay nada que revertir');
      }
      const refMotivo = `Anulación de ajuste ${movimiento_id}`;
      const yaAnulada = store.movimientosStock.find((m) => m.motivo === refMotivo);
      if (yaAnulada) {
        throw new Error('Este ajuste ya fue anulado');
      }
      const item = findOrCreate(
        original.producto_id,
        original.deposito_id,
        original.variante_id,
      );
      item.cantidad += -original.cantidad;
      const mov: MovimientoStock = {
        id: makeId('mov_st'),
        producto_id: original.producto_id,
        variante_id: original.variante_id,
        deposito_id: original.deposito_id,
        tipo: 'ajuste',
        cantidad: -original.cantidad,
        motivo: refMotivo,
        empleado_id,
        fecha: now(),
      };
      store.movimientosStock.push(mov);
      return clone(mov);
    },
    async movimientos(filtro = {}) {
      return clone(
        store.movimientosStock.filter((m) => {
          if (filtro.producto_id && m.producto_id !== filtro.producto_id) return false;
          if (filtro.deposito_id && m.deposito_id !== filtro.deposito_id) return false;
          if (filtro.desde && m.fecha < filtro.desde) return false;
          if (filtro.hasta && m.fecha > filtro.hasta) return false;
          return true;
        }),
      );
    },
  };
}
