import type { SupabaseClient } from '@supabase/supabase-js';
import type { StockRepo } from '../../repos/stock.repo';
import type { MovimientoStock, StockItem } from '../../types';
import { ok, okList, okMaybe } from '../helpers';
import { esDemoMode, logDemo, randomUuid } from '../../demo-mode';

/**
 * Aplica un DELTA al stock de (producto, variante, depósito).
 *
 * Por qué este helper en vez de .upsert():
 * El upsert de supabase-js NO funciona acá. La tabla tiene un unique
 * parcial `stock_items_unique_sin_variante` (producto_id, deposito_id)
 * WHERE variante_id IS NULL. PostgreSQL no acepta ON CONFLICT con unique
 * parcial sin que se especifique el WHERE, y supabase-js no lo expone.
 * Resultado: cuando el upsert "sin variante" choca con una fila ya
 * existente, falla con:
 *   duplicate key value violates unique constraint
 *   "stock_items_unique_sin_variante"
 *
 * Workaround: leer con filtro EXACTO por variante (.is null cuando es
 * null, .eq cuando tiene valor) y decidir UPDATE/INSERT. Antes el SELECT
 * no filtraba por variante → si la tabla tenía residuo de otra variante
 * para el mismo (producto, depósito), maybeSingle podía fallar
 * silenciosamente con multiple-rows y caíamos al INSERT que chocaba.
 *
 * Devuelve la cantidad ANTERIOR (útil para validaciones del caller).
 * No es atómico — para venta concurrente real usamos rpc_crear_venta,
 * que sí es atómica vía SELECT…FOR UPDATE.
 *
 * Si `validar` devuelve un Error, abortamos sin escribir (caller decide
 * mensaje).
 */
export async function aplicarDeltaStock(
  sb: SupabaseClient,
  opts: {
    producto_id: string;
    variante_id: string | null;
    deposito_id: string;
    delta: number;
    /** Si es false y el resultado quedaría negativo, la RPC aborta
     *  con error. Default true — el sistema permite negativos porque
     *  hay stock físico no cargado. Solo `descontarPorVenta` lo pisa
     *  a false cuando el producto no tiene el flag "vender sin stock". */
    permitirNegativo?: boolean;
  },
): Promise<{ cantidadAnterior: number; cantidadNueva: number }> {
  // Wrapper de la RPC rpc_aplicar_delta_stock (migración
  // scripts/migrations-stock-atomico.sql).
  //
  // Por qué RPC en vez de SELECT+UPDATE desde JS: el helper viejo hacía
  // los 3 pasos en el cliente sin garantía de atomicidad. Si dos
  // operaciones (ventas / transferencias) tocaban el mismo (producto,
  // depósito) simultáneamente, ambas leían el mismo valor viejo y
  // pisaban una a la otra ("lost update"). La RPC usa SELECT ... FOR
  // UPDATE dentro de una transacción implícita → la segunda espera a
  // la primera y siempre lee el valor actualizado.
  const { data, error } = await sb.rpc('rpc_aplicar_delta_stock', {
    p_producto_id: opts.producto_id,
    p_variante_id: opts.variante_id,
    p_deposito_id: opts.deposito_id,
    p_delta: opts.delta,
    p_permitir_negativo: opts.permitirNegativo ?? true,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    cantidadAnterior: Number(row?.cantidad_anterior ?? 0),
    cantidadNueva: Number(row?.cantidad_nueva ?? 0),
  };
}

export function makeStockRepo(sb: SupabaseClient): StockRepo {
  return {
    async porProducto(productoId) {
      return okList<StockItem>(
        await sb.from('stock_items').select('*').eq('producto_id', productoId),
        'stock.porProducto',
      );
    },
    async porDeposito(depositoId) {
      return okList<StockItem>(
        await sb.from('stock_items').select('*').eq('deposito_id', depositoId),
        'stock.porDeposito',
      );
    },
    async cantidad(productoId, depositoId, varianteId) {
      let q = sb
        .from('stock_items')
        .select('cantidad')
        .eq('producto_id', productoId)
        .eq('deposito_id', depositoId);
      if (varianteId) q = q.eq('variante_id', varianteId);
      else q = q.is('variante_id', null);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(`stock.cantidad: ${error.message}`);
      return Number(data?.cantidad ?? 0);
    },
    async consolidado(filtro = {}) {
      // Paginar internamente para sortear el límite de 1000 filas del REST.
      const CHUNK = 1000;
      const acumulado: StockItem[] = [];
      let from = 0;
      while (true) {
        let q = sb.from('stock_items').select('*').range(from, from + CHUNK - 1);
        if (filtro.producto_id) q = q.eq('producto_id', filtro.producto_id);
        if (filtro.deposito_id) q = q.eq('deposito_id', filtro.deposito_id);
        const chunk = okList<StockItem>(await q, 'stock.consolidado');
        acumulado.push(...chunk);
        if (chunk.length < CHUNK) break;
        from += CHUNK;
      }
      return filtro.sin_stock ? acumulado.filter((r) => r.cantidad <= 0) : acumulado;
    },
    async totalesDeMuchos(productoIds, depositoId) {
      const map = new Map<string, number>();
      if (productoIds.length === 0) return map;
      // PostgREST tiene un límite práctico en el largo del IN; chunkeo de 200.
      const CHUNK = 200;
      for (let i = 0; i < productoIds.length; i += CHUNK) {
        const slice = productoIds.slice(i, i + CHUNK);
        let q = sb
          .from('stock_items')
          .select('producto_id, cantidad')
          .in('producto_id', slice);
        if (depositoId) q = q.eq('deposito_id', depositoId);
        const { data, error } = await q;
        if (error) throw new Error(`stock.totalesDeMuchos: ${error.message}`);
        for (const r of data ?? []) {
          map.set(r.producto_id, (map.get(r.producto_id) ?? 0) + Number(r.cantidad));
        }
      }
      // Productos sin filas en stock_items quedan en 0.
      for (const id of productoIds) if (!map.has(id)) map.set(id, 0);
      return map;
    },
    async ajustar(input) {
      if (esDemoMode()) {
        logDemo('stock.ajustar', input);
        return {
          id: randomUuid(),
          producto_id: input.producto_id,
          variante_id: input.variante_id ?? undefined,
          deposito_id: input.deposito_id,
          tipo: 'ajuste',
          cantidad: input.cantidad,
          motivo: input.motivo,
          empleado_id: input.empleado_id,
          fecha: new Date().toISOString(),
        } as MovimientoStock;
      }
      const { producto_id, variante_id, deposito_id, cantidad, motivo, empleado_id } = input;
      try {
        await aplicarDeltaStock(sb, {
          producto_id,
          variante_id: variante_id ?? null,
          deposito_id,
          delta: cantidad,
        });
      } catch (e) {
        throw new Error(`stock.ajustar: ${(e as Error).message}`);
      }
      return ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id, variante_id, deposito_id,
            tipo: 'ajuste',
            // Guardamos el signo REAL (no Math.abs). Antes se perdía
            // el signo y no había forma de saber si un ajuste sumó
            // o restó viendo la BD — solo el motivo lo insinuaba y
            // muchos motivos son ambiguos ("pase al depo", etc).
            // Preservar el signo hace que /admin/movimientos-stock,
            // modal Estadísticas y backup XLSX muestren el delta real.
            cantidad,
            motivo, empleado_id,
          })
          .select('*')
          .single(),
        'stock.ajustar (mov)',
      );
    },
    async registrarMerma(input) {
      const { producto_id, variante_id, deposito_id, cantidad, motivo, empleado_id } = input;
      try {
        await aplicarDeltaStock(sb, {
          producto_id,
          variante_id: variante_id ?? null,
          deposito_id,
          delta: -cantidad,
        });
      } catch (e) {
        throw new Error(`stock.registrarMerma: ${(e as Error).message}`);
      }
      return ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id, variante_id, deposito_id,
            tipo: 'merma', cantidad, motivo, empleado_id,
          })
          .select('*')
          .single(),
        'stock.registrarMerma (mov)',
      );
    },
    async descontarPorVenta(input) {
      // Esta operación se hace dentro de rpc_crear_venta. Si alguien la llama
      // directo (no debería), hacemos el descuento manual — ahora atómico
      // gracias a aplicarDeltaStock (RPC). La validación "sin stock" ya no
      // se hace desde JS: se pasa como flag a la RPC y Postgres decide.
      const { producto_id, variante_id, deposito_id, cantidad, venta_id, empleado_id, permitirSinStock } = input;
      try {
        await aplicarDeltaStock(sb, {
          producto_id,
          variante_id: variante_id ?? null,
          deposito_id,
          delta: -cantidad,
          permitirNegativo: permitirSinStock,
        });
      } catch (e) {
        throw new Error(`stock.descontarPorVenta: ${(e as Error).message}`);
      }
      return ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id, variante_id, deposito_id,
            tipo: 'venta', cantidad, referencia_id: venta_id, empleado_id,
          })
          .select('*')
          .single(),
        'stock.descontarPorVenta (mov)',
      );
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
      if (esDemoMode()) {
        logDemo('stock.transferenciaInmediata', {
          producto_id,
          deposito_origen_id,
          deposito_destino_id,
          cantidad,
        });
        const fechaPar = new Date().toISOString();
        const mock = (deposito_id: string, tipo: 'transferencia_salida' | 'transferencia_entrada'): MovimientoStock => ({
          id: randomUuid(),
          producto_id,
          variante_id: variante_id ?? undefined,
          deposito_id,
          tipo,
          cantidad,
          motivo,
          empleado_id,
          fecha: fechaPar,
        }) as MovimientoStock;
        return {
          salida: mock(deposito_origen_id, 'transferencia_salida'),
          entrada: mock(deposito_destino_id, 'transferencia_entrada'),
        };
      }
      // No usamos transacción real (Supabase JS no expone BEGIN/COMMIT).
      // Hacemos los pasos en orden y si algo falla, intentamos compensar:
      //   1. Bajamos stock origen
      //   2. Subimos stock destino  (si falla → revertir 1)
      //   3. Insertamos los 2 movimientos
      // Es la mejor garantía sin RPC. Si llega a haber inconsistencias
      // raras, el admin tiene movimientos_stock para auditar.
      try {
        await aplicarDeltaStock(sb, {
          producto_id,
          variante_id: variante_id ?? null,
          deposito_id: deposito_origen_id,
          delta: -cantidad,
        });
      } catch (e) {
        throw new Error(`stock.transferenciaInmediata (origen): ${(e as Error).message}`);
      }
      try {
        await aplicarDeltaStock(sb, {
          producto_id,
          variante_id: variante_id ?? null,
          deposito_id: deposito_destino_id,
          delta: cantidad,
        });
      } catch (e) {
        // Revertir el descuento del origen
        await aplicarDeltaStock(sb, {
          producto_id,
          variante_id: variante_id ?? null,
          deposito_id: deposito_origen_id,
          delta: cantidad,
        }).catch(() => {});
        throw new Error(`stock.transferenciaInmediata (destino): ${(e as Error).message}`);
      }
      // Compartimos EL MISMO timestamp para los dos movimientos del par
      // (salida + entrada). Antes cada INSERT tomaba su propio default
      // now() de Postgres y quedaban con fechas distintas en microsegundos.
      // El listado de /admin/movimientos-stock arma pares por
      // (producto_id + cantidad + fecha exacta) — como las fechas no
      // matcheaban, los pares nunca se formaban y las transferencias no
      // aparecían en el listado. Bug real reportado por el cliente.
      const fechaPar = new Date().toISOString();
      const salida = ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id,
            variante_id,
            deposito_id: deposito_origen_id,
            tipo: 'transferencia_salida',
            cantidad,
            motivo,
            empleado_id,
            fecha: fechaPar,
          })
          .select('*')
          .single(),
        'stock.transferenciaInmediata (mov salida)',
      );
      const entrada = ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id,
            variante_id,
            deposito_id: deposito_destino_id,
            tipo: 'transferencia_entrada',
            cantidad,
            motivo,
            empleado_id,
            fecha: fechaPar,
          })
          .select('*')
          .single(),
        'stock.transferenciaInmediata (mov entrada)',
      );
      return { salida, entrada };
    },
    async anularTransferenciaInmediata({ movimiento_id, empleado_id }) {
      if (esDemoMode()) {
        logDemo('stock.anularTransferenciaInmediata', { movimiento_id });
        const fechaPar = new Date().toISOString();
        const mock = (tipo: 'transferencia_salida' | 'transferencia_entrada'): MovimientoStock => ({
          id: randomUuid(),
          producto_id: randomUuid(),
          deposito_id: randomUuid(),
          tipo,
          cantidad: 1,
          motivo: 'Anulación de transferencia (demo)',
          empleado_id,
          fecha: fechaPar,
        }) as MovimientoStock;
        return {
          salida: mock('transferencia_salida'),
          entrada: mock('transferencia_entrada'),
        };
      }
      // 1. Cargar el movimiento original.
      const original = okMaybe<MovimientoStock>(
        await sb.from('movimientos_stock').select('*').eq('id', movimiento_id).maybeSingle(),
        'stock.anularTransferencia (original)',
      );
      if (!original) throw new Error('Movimiento no encontrado');
      if (
        original.tipo !== 'transferencia_salida' &&
        original.tipo !== 'transferencia_entrada'
      ) {
        throw new Error('Solo se pueden anular transferencias');
      }

      // 2. Buscar el par (mismo producto, misma cantidad, misma fecha exacta,
      //    distinto depósito, tipo opuesto). transferenciaInmediata inserta
      //    ambos movs con el mismo timestamp.
      const tipoPar =
        original.tipo === 'transferencia_salida'
          ? 'transferencia_entrada'
          : 'transferencia_salida';
      const par = okMaybe<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .select('*')
          .eq('producto_id', original.producto_id)
          .eq('cantidad', original.cantidad)
          .eq('fecha', original.fecha)
          .eq('tipo', tipoPar)
          .neq('deposito_id', original.deposito_id)
          .maybeSingle(),
        'stock.anularTransferencia (par)',
      );
      if (!par) throw new Error('No se encontró el par de la transferencia');

      // 3. Check de idempotencia: ya hay un mov con motivo de anulación
      //    apuntando a este id?
      const refMotivo = `Anulación de transferencia ${movimiento_id}`;
      const yaAnuladaList = okList<MovimientoStock>(
        await sb.from('movimientos_stock').select('*').eq('motivo', refMotivo).limit(1),
        'stock.anularTransferencia (check)',
      );
      if (yaAnuladaList.length > 0) {
        throw new Error('Esta transferencia ya fue anulada');
      }

      const origenId =
        original.tipo === 'transferencia_salida' ? original.deposito_id : par.deposito_id;
      const destinoId =
        original.tipo === 'transferencia_salida' ? par.deposito_id : original.deposito_id;

      // 4. Mover stock al revés: +al origen, -al destino. Si falla el segundo,
      //    revertir el primero. Mismo patrón que transferenciaInmediata.
      try {
        await aplicarDeltaStock(sb, {
          producto_id: original.producto_id,
          variante_id: original.variante_id ?? null,
          deposito_id: origenId,
          delta: original.cantidad,
        });
      } catch (e) {
        throw new Error(`stock.anularTransferencia (origen): ${(e as Error).message}`);
      }
      try {
        await aplicarDeltaStock(sb, {
          producto_id: original.producto_id,
          variante_id: original.variante_id ?? null,
          deposito_id: destinoId,
          delta: -original.cantidad,
        });
      } catch (e) {
        await aplicarDeltaStock(sb, {
          producto_id: original.producto_id,
          variante_id: original.variante_id ?? null,
          deposito_id: origenId,
          delta: -original.cantidad,
        }).catch(() => {});
        throw new Error(`stock.anularTransferencia (destino): ${(e as Error).message}`);
      }

      // Mismo timestamp para los 2 movs — ver comentario en
      // transferenciaInmediata: sin esto los pares no se agrupan bien
      // en el listado del admin.
      const fechaPar = new Date().toISOString();
      const salida = ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id: original.producto_id,
            variante_id: original.variante_id,
            deposito_id: destinoId,
            tipo: 'transferencia_salida',
            cantidad: original.cantidad,
            motivo: refMotivo,
            empleado_id,
            fecha: fechaPar,
          })
          .select('*')
          .single(),
        'stock.anularTransferencia (mov salida)',
      );
      const entrada = ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id: original.producto_id,
            variante_id: original.variante_id,
            deposito_id: origenId,
            tipo: 'transferencia_entrada',
            cantidad: original.cantidad,
            motivo: refMotivo,
            empleado_id,
            fecha: fechaPar,
          })
          .select('*')
          .single(),
        'stock.anularTransferencia (mov entrada)',
      );
      return { salida, entrada };
    },
    async anularAjuste({ movimiento_id, empleado_id }) {
      if (esDemoMode()) {
        logDemo('stock.anularAjuste', { movimiento_id });
        return {
          id: randomUuid(),
          producto_id: randomUuid(),
          deposito_id: randomUuid(),
          tipo: 'ajuste',
          cantidad: 1,
          motivo: 'Anulación de ajuste (demo)',
          empleado_id,
          fecha: new Date().toISOString(),
        } as MovimientoStock;
      }
      // 1. Traer el ajuste original.
      const original = okMaybe<MovimientoStock>(
        await sb.from('movimientos_stock').select('*').eq('id', movimiento_id).maybeSingle(),
        'stock.anularAjuste (original)',
      );
      if (!original) throw new Error('Movimiento no encontrado');
      if (original.tipo !== 'ajuste') {
        throw new Error('Solo se pueden anular ajustes de stock');
      }
      if (original.cantidad === 0) {
        throw new Error('El ajuste original es 0, no hay nada que revertir');
      }

      // 2. Check de idempotencia.
      const refMotivo = `Anulación de ajuste ${movimiento_id}`;
      const yaAnuladaList = okList<MovimientoStock>(
        await sb.from('movimientos_stock').select('*').eq('motivo', refMotivo).limit(1),
        'stock.anularAjuste (check)',
      );
      if (yaAnuladaList.length > 0) {
        throw new Error('Este ajuste ya fue anulado');
      }

      // 3. Aplicar el delta INVERSO al stock. Si el original fue +3, hacemos -3.
      //    Si fue -3, hacemos +3.
      try {
        await aplicarDeltaStock(sb, {
          producto_id: original.producto_id,
          variante_id: original.variante_id ?? null,
          deposito_id: original.deposito_id,
          delta: -original.cantidad,
        });
      } catch (e) {
        throw new Error(`stock.anularAjuste (delta): ${(e as Error).message}`);
      }

      // 4. Insertar el movimiento de anulación con la cantidad INVERSA.
      //    Ejemplo: original = +3 con motivo "Test", anulación = -3 con
      //    motivo "Anulación de ajuste {id}". Efecto neto sobre stock = 0.
      return ok<MovimientoStock>(
        await sb
          .from('movimientos_stock')
          .insert({
            producto_id: original.producto_id,
            variante_id: original.variante_id,
            deposito_id: original.deposito_id,
            tipo: 'ajuste',
            cantidad: -original.cantidad,
            motivo: refMotivo,
            empleado_id,
          })
          .select('*')
          .single(),
        'stock.anularAjuste (mov)',
      );
    },
    async movimientos(filtro = {}) {
      let q = sb.from('movimientos_stock').select('*').order('fecha', { ascending: false });
      if (filtro.producto_id) q = q.eq('producto_id', filtro.producto_id);
      if (filtro.deposito_id) q = q.eq('deposito_id', filtro.deposito_id);
      if (filtro.desde) q = q.gte('fecha', filtro.desde);
      if (filtro.hasta) q = q.lte('fecha', filtro.hasta);
      return okList<MovimientoStock>(await q, 'stock.movimientos');
    },
  };
}
