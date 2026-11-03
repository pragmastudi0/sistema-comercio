'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  LineChart,
  RefreshCw,
  ArrowRight,
  Undo2,
  ShoppingCart,
  RotateCcw,
  Sliders,
  AlertTriangle,
  ArrowLeftRight,
  PackagePlus,
  PackageMinus,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react';
import { MOTIVOS_INGRESO_STOCK, MOTIVOS_EGRESO_STOCK, esPragmaDev } from '@comercio/business';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import {
  motivoLegible,
  origenDeMovimiento,
} from '@/lib/movimientos-stock-helpers';
import { Dialog, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';

/**
 * Fecha del deploy que empezó a guardar el signo REAL en
 * movimientos_stock.cantidad para ajustes (fix rpc_aplicar_delta_stock).
 * Movimientos con fecha >= a esto usan el signo directo de la BD;
 * los anteriores mantienen la inferencia por motivo. Ajustar si se
 * hace un deploy posterior que cambie el comportamiento.
 */
const FIX_SIGNO_AJUSTES = new Date('2026-08-10T20:00:00Z');

const LABEL_TIPO_MOV: Record<string, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  ajuste: 'Ajuste',
  merma: 'Merma',
  transferencia_salida: 'Transferencia salida',
  transferencia_entrada: 'Transferencia entrada',
};

/** Icono + color por tipo de movimiento (rojo=egreso, verde=ingreso,
 *  celeste=transferencia, naranja=merma, violeta=ajuste). Usado en la
 *  celda "Qué pasó" del historial para que Agus reconozca de un vistazo
 *  qué clase de movimiento fue. */
type PresentacionTipo = {
  Icon: LucideIcon;
  label: string;
  /** Clases tailwind para el chip: bg + text + border. */
  chip: string;
};
function presentacionTipo(
  tipo: string,
  motivo?: string | null,
  cantidad?: number,
): PresentacionTipo {
  if (tipo === 'venta') {
    return {
      Icon: ShoppingCart,
      label: 'Venta',
      chip: 'bg-red-50 text-red-700 border-red-200',
    };
  }
  if (tipo === 'devolucion') {
    return {
      Icon: RotateCcw,
      label: 'Devolución',
      chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  if (tipo === 'merma') {
    return {
      Icon: AlertTriangle,
      label: 'Merma',
      chip: 'bg-orange-50 text-orange-700 border-orange-200',
    };
  }
  if (tipo === 'transferencia_salida' || tipo === 'transferencia_entrada') {
    return {
      Icon: ArrowLeftRight,
      label: 'Transferencia',
      chip: 'bg-sky-50 text-sky-700 border-sky-200',
    };
  }
  // Ajustes: distinguir ingreso vs egreso vs correción por el signo/motivo.
  if (tipo === 'ajuste') {
    const m = (motivo ?? '').toLowerCase();
    // Compra a proveedor / ingreso claro
    if (m.includes('compra') || m.includes('proveedor') || m.includes('ingreso')) {
      return {
        Icon: PackagePlus,
        label: 'Ingreso',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    }
    // Egresos con motivos conocidos
    if (
      m.includes('rotura') ||
      m.includes('robo') ||
      m.includes('vencido') ||
      m.includes('uso interno') ||
      m.includes('vale')
    ) {
      return {
        Icon: PackageMinus,
        label: 'Egreso',
        chip: 'bg-rose-50 text-rose-700 border-rose-200',
      };
    }
    // Corrección de inventario / recuento
    if (
      m.includes('correccion') ||
      m.includes('corrección') ||
      m.includes('recuento') ||
      m.includes('inventario')
    ) {
      return {
        Icon: Sliders,
        label: 'Corrección',
        chip: 'bg-violet-50 text-violet-700 border-violet-200',
      };
    }
    // Fallback: usar el signo — positivo = ingreso, negativo = egreso.
    if (typeof cantidad === 'number' && cantidad > 0) {
      return {
        Icon: PackagePlus,
        label: 'Ingreso',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    }
    return {
      Icon: Sliders,
      label: 'Ajuste',
      chip: 'bg-violet-50 text-violet-700 border-violet-200',
    };
  }
  return {
    Icon: Sliders,
    label: LABEL_TIPO_MOV[tipo] ?? tipo,
    chip: 'bg-slate-50 text-slate-700 border-slate-200',
  };
}

/**
 * Normaliza un motivo para poder comparar tolerando variaciones históricas:
 * mayúsculas ≠ minúsculas, tildes vs sin tildes, espacios sobrantes.
 * Ejemplo: "Corrección de inventario" y "correccion inventario" quedan
 * ambas como "correccion de inventario" (bueno, "correccion inventario"
 * queda igual). Ideal para matchear contra las listas preset.
 */
function normalizarMotivo(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras "vacías" que ignoramos al comparar motivos por palabras
// significativas. Motivos como "correccion inventario" (tipeado por un
// cajero apurado sin la "de") tienen que matchear "Corrección de
// inventario" del preset — la diferencia son solo conectores.
const STOPWORDS_MOTIVO = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'a',
  'al',
  'en',
  'por',
  'para',
]);

/** Tokens significativos de un motivo ya normalizado. Un Set para poder
 *  comparar como conjunto (no importa el orden). */
function palabrasClave(motivoNorm: string): Set<string> {
  const out = new Set<string>();
  for (const w of motivoNorm.split(' ')) {
    if (w && !STOPWORDS_MOTIVO.has(w)) out.add(w);
  }
  return out;
}

/** Dos motivos matchean si sus palabras clave coinciden como conjunto.
 *  "correccion inventario" ≡ "corrección de inventario" (ambos {correccion, inventario}).
 *  "compra proveedor" ≡ "Compra a proveedor" (ambos {compra, proveedor}). */
function mismoMotivo(a: string, b: string): boolean {
  const A = palabrasClave(normalizarMotivo(a));
  const B = palabrasClave(normalizarMotivo(b));
  if (A.size !== B.size || A.size === 0) return false;
  for (const w of A) if (!B.has(w)) return false;
  return true;
}

/**
 * Modal con estadísticas básicas de un producto:
 *  - Última venta (fecha + cajero)
 *  - Cantidad vendida total en los últimos 90 días
 *  - Facturado en los últimos 90 días
 *  - Rotación (cantidad / día promedio)
 *  - Días desde la última venta
 *
 * Trae las ventas de los últimos 90 días y filtra en memoria por
 * producto_id. Si el dueño necesita un reporte más completo (top
 * fechas, rotación por mes, etc.) lo haremos en /reportes después.
 */
export function ModalEstadisticasProducto({
  open,
  onOpenChange,
  productoId,
  productoNombre,
  productoCodigo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productoId: string;
  productoNombre: string;
  productoCodigo: string;
}) {
  const db = getDb();

  const desde = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const ventasQ = useQuery({
    queryKey: ['estad-producto-ventas', productoId, desde],
    queryFn: () => db.ventas.list({ desde }),
    enabled: open,
  });
  const empleadosQ = useQuery({
    queryKey: ['empleados'],
    queryFn: () => db.empleados.list(),
    enabled: open,
  });
  // Movimientos de stock del producto (últimos 90 días). Se pintan agrupados
  // en la sección "Historial de movimientos" abajo, con motivo + origen para
  // que se vea qué canal originó cada uno (PoS vs admin).
  const movsQ = useQuery({
    queryKey: ['estad-producto-movs', productoId, desde],
    queryFn: () => db.stock.movimientos({ producto_id: productoId, desde }),
    enabled: open,
  });
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
    enabled: open,
  });
  // Stock actual por depósito — punto de partida para reconstruir "cómo
  // quedó el stock" después de cada movimiento en el historial.
  const stockActualQ = useQuery({
    queryKey: ['estad-producto-stock-actual', productoId],
    queryFn: () => db.stock.porProducto(productoId),
    enabled: open,
    staleTime: 5_000,
  });


  const datos = useMemo(() => {
    const ventas = (ventasQ.data ?? []).filter(
      (v) => v.estado === 'completada' && v.items.some((it) => it.producto_id === productoId),
    );
    let cantidadTotal = 0;
    let facturadoTotal = 0;
    let ventas7d = 0;
    let cantidad7d = 0;
    let ventas30d = 0;
    let cantidad30d = 0;
    let ultima: { fecha: string; empleado_id: string; cantidad: number } | null = null;
    const hace7 = new Date();
    hace7.setDate(hace7.getDate() - 7);
    const hace30 = new Date();
    hace30.setDate(hace30.getDate() - 30);

    for (const v of ventas) {
      const items = v.items.filter((it) => it.producto_id === productoId);
      const cantEnVenta = items.reduce((a, it) => a + it.cantidad, 0);
      const factEnVenta = items.reduce(
        (a, it) => a + (it.subtotal ?? it.precio_unitario * it.cantidad),
        0,
      );
      cantidadTotal += cantEnVenta;
      facturadoTotal += factEnVenta;
      const fechaV = new Date(v.fecha);
      if (fechaV >= hace7) {
        ventas7d += 1;
        cantidad7d += cantEnVenta;
      }
      if (fechaV >= hace30) {
        ventas30d += 1;
        cantidad30d += cantEnVenta;
      }
      if (!ultima || fechaV > new Date(ultima.fecha)) {
        ultima = { fecha: v.fecha, empleado_id: v.empleado_id, cantidad: cantEnVenta };
      }
    }

    // Rotación: cantidad promedio por día en los últimos 30 días.
    const rotacion30d = cantidad30d / 30;

    const diasDesdeUltima = ultima
      ? Math.floor(
          (Date.now() - new Date(ultima.fecha).getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    return {
      ventas: ventas.length,
      cantidadTotal,
      facturadoTotal,
      ventas7d,
      cantidad7d,
      ventas30d,
      cantidad30d,
      rotacion30d,
      ultima,
      diasDesdeUltima,
    };
  }, [ventasQ.data, productoId]);

  const empleadoNombre = (id: string) => {
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido}` : '—';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-6xl">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <LineChart className="h-5 w-5 text-blue-700" />
            Estadísticas del producto
            {ventasQ.isFetching && !ventasQ.isLoading && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div className="mb-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <div className="font-medium text-slate-800">{productoNombre}</div>
        <div className="font-mono text-xs text-slate-500">#{productoCodigo}</div>
      </div>

      {ventasQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : datos.ventas === 0 ? (
        <div className="rounded-md border bg-muted/30 py-6 text-center text-sm text-muted-foreground">
          Este producto no se vendió en los últimos 90 días.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Última venta */}
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-emerald-700">
              Última venta
            </div>
            {datos.ultima ? (
              <>
                <div className="mt-1 text-base font-semibold text-emerald-900">
                  {new Date(datos.ultima.fecha).toLocaleString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="text-xs text-emerald-700">
                  Cajero: {empleadoNombre(datos.ultima.empleado_id)} ·{' '}
                  {datos.ultima.cantidad} u · hace{' '}
                  {datos.diasDesdeUltima === 0 ? 'menos de 1 día' : `${datos.diasDesdeUltima} día(s)`}
                </div>
              </>
            ) : (
              <div className="text-xs text-emerald-700">Sin ventas previas.</div>
            )}
          </div>

          {/* KPIs compactados en una sola fila (5 tarjetas). Con el modal
              más ancho entra todo en un vistazo. */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat
              label="Vendidos 7 días"
              valor={datos.cantidad7d}
              sub={`${datos.ventas7d} venta(s)`}
            />
            <Stat
              label="Vendidos 30 días"
              valor={datos.cantidad30d}
              sub={`${datos.ventas30d} venta(s)`}
            />
            <Stat
              label="Vendidos 90 días"
              valor={datos.cantidadTotal}
              sub={`${datos.ventas} venta(s)`}
            />
            <div className="rounded-md border border-slate-300 bg-white p-2 text-center">
              <div className="text-[10px] uppercase text-muted-foreground">
                Rotación 30d
              </div>
              <div className="text-xl font-semibold tabular-nums">
                {datos.rotacion30d.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">u/día</div>
            </div>
            <div className="rounded-md border border-slate-300 bg-emerald-50 p-2 text-center">
              <div className="text-[10px] uppercase text-emerald-800">
                Facturado 90d
              </div>
              <div className="text-lg font-semibold tabular-nums text-emerald-800">
                {formatCurrency(datos.facturadoTotal)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historial de movimientos de stock (últimos 90 días).
          Se muestra siempre — incluso si no hubo ventas, puede haber
          transferencias/ajustes que interesa auditar. */}
      <HistorialMovimientos
        productoId={productoId}
        movs={movsQ.data ?? []}
        ventas={ventasQ.data ?? []}
        depositos={depositosQ.data ?? []}
        empleados={empleadosQ.data ?? []}
        stockActual={stockActualQ.data ?? []}
        cargando={movsQ.isLoading}
      />

      <div className="mt-4 flex justify-end border-t pt-3">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded-md border bg-background px-4 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}

function Stat({ label, valor, sub }: { label: string; valor: number; sub: string }) {
  return (
    <div className="rounded-md border border-slate-300 bg-white p-2 text-center">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{valor}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

/**
 * Tabla compacta con los últimos movimientos de stock del producto.
 * Muestra fecha, tipo, cantidad (con signo), local, motivo, origen (badge
 * PoS o Admin) y empleado. Para transferencias también muestra el par
 * "origen → destino" en la columna local.
 *
 * Se agrupan pares de transferencia (salida+entrada con misma fecha) en
 * una sola fila estilo "De → A" — misma lógica que /admin/movimientos-stock,
 * pero acá aparecen también ventas, ajustes y mermas (todo el historial
 * de stock del producto).
 */
function HistorialMovimientos({
  productoId,
  movs,
  ventas,
  depositos,
  empleados,
  stockActual,
  cargando,
}: {
  productoId: string;
  movs: Array<{
    id: string;
    tipo: string;
    cantidad: number;
    deposito_id: string;
    empleado_id: string;
    motivo?: string;
    fecha: string;
    producto_id: string;
    referencia_id?: string;
  }>;
  /** Ventas del rango — se usan para mostrar precio/ticket en el expand
   *  de movimientos tipo venta/devolución. Vienen cacheadas del parent. */
  ventas: Array<{
    id: string;
    numero: string;
    total: number;
    items: Array<{
      producto_id: string;
      cantidad: number;
      precio_unitario: number;
      descuento_pct?: number;
      subtotal: number;
    }>;
  }>;
  depositos: Array<{ id: string; nombre: string }>;
  empleados: Array<{ id: string; nombre: string; apellido: string }>;
  /** Stock actual por depósito — se usa como punto de partida para
   *  reconstruir cómo quedaba el stock después de cada movimiento. */
  stockActual: Array<{ deposito_id: string; cantidad: number | string }>;
  cargando: boolean;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  const puedeAnular = esPragmaDev(empleado);
  // Invalidación común de queries afectadas por cualquier revert de
  // movimiento de stock (ajuste o transferencia).
  const invalidarStock = () => {
    qc.invalidateQueries({ queryKey: ['estad-producto-movs', productoId] });
    qc.invalidateQueries({ queryKey: ['estad-producto-stock-actual', productoId] });
    qc.invalidateQueries({ queryKey: ['productos-admin'] });
    qc.invalidateQueries({ queryKey: ['producto-stock-detalle', productoId] });
  };

  // Mutation para anular un ajuste (solo pragma dev). Genera un ajuste
  // inverso, no borra el original — auditable.
  const anularAjusteMut = useMutation({
    mutationFn: async (movimientoId: string) => {
      if (!empleado) throw new Error('No hay empleado logueado');
      if (!db.stock.anularAjuste) {
        throw new Error('La operación no está disponible en este cliente');
      }
      return db.stock.anularAjuste({
        movimiento_id: movimientoId,
        empleado_id: empleado.id,
      });
    },
    onSuccess: () => {
      toast.success('Ajuste anulado. El stock volvió a su estado anterior.');
      invalidarStock();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  // Mutation para anular una transferencia (par salida+entrada). Genera
  // los 2 movimientos inversos con motivo "Anulación de transferencia".
  const anularTransfMut = useMutation({
    mutationFn: async (movimientoId: string) => {
      if (!empleado) throw new Error('No hay empleado logueado');
      if (!db.stock.anularTransferenciaInmediata) {
        throw new Error('La operación no está disponible en este cliente');
      }
      return db.stock.anularTransferenciaInmediata({
        movimiento_id: movimientoId,
        empleado_id: empleado.id,
      });
    },
    onSuccess: () => {
      toast.success('Transferencia anulada. El stock volvió al depósito de origen.');
      invalidarStock();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const depPorId = useMemo(
    () => new Map(depositos.map((d) => [d.id, d.nombre])),
    [depositos],
  );
  const empPorId = useMemo(
    () => new Map(empleados.map((e) => [e.id, `${e.nombre} ${e.apellido ?? ''}`.trim()])),
    [empleados],
  );

  // Agrupar transferencias en pares (salida+entrada con misma fecha+cant).
  // Cada par = 1 fila "De → A". El resto (ventas/ajustes/mermas) queda como
  // filas individuales.
  type Fila =
    | {
        kind: 'transferencia';
        keyPar: string;
        fecha: string;
        cantidad: number;
        origen_id: string;
        destino_id: string;
        empleado_id: string;
        motivo?: string;
        anulada: boolean;
        esAnulacionDe?: string;
      }
    | {
        kind: 'simple';
        id: string;
        fecha: string;
        tipo: string;
        cantidad: number;
        deposito_id: string;
        empleado_id: string;
        motivo?: string;
        /** Para movs tipo 'venta'/'devolucion' apunta a `ventas.id` — se
         *  usa en el expand para mostrar el precio al que se vendió. */
        referencia_id?: string;
      };

  const filas = useMemo<Fila[]>(() => {
    const transf = movs.filter(
      (m) => m.tipo === 'transferencia_salida' || m.tipo === 'transferencia_entrada',
    );
    const otras = movs.filter(
      (m) => m.tipo !== 'transferencia_salida' && m.tipo !== 'transferencia_entrada',
    );
    // Pares por (cantidad + fecha redondeada al segundo) — antes usaba
    // la fecha exacta, pero los transferenciaInmediata históricos
    // guardaban 2 movs con timestamps que diferían en microsegundos.
    // Con el redondeo, los pares se agrupan bien tanto los nuevos como
    // los históricos.
    const grupos = new Map<string, { salida?: typeof movs[number]; entrada?: typeof movs[number] }>();
    for (const m of transf) {
      const fechaSeg = m.fecha.slice(0, 19);
      const key = `${m.cantidad}|${fechaSeg}`;
      const g = grupos.get(key) ?? {};
      if (m.tipo === 'transferencia_salida') g.salida = m;
      else g.entrada = m;
      grupos.set(key, g);
    }
    const anuladasIds = new Set<string>();
    const pares: Fila[] = [];
    for (const [, g] of grupos) {
      if (!g.salida || !g.entrada) continue;
      const motivo = g.salida.motivo ?? '';
      const matchAnul = /^Anulaci[óo]n de transferencia (\S+)/.exec(motivo);
      pares.push({
        kind: 'transferencia',
        keyPar: g.salida.id,
        fecha: g.salida.fecha,
        cantidad: g.salida.cantidad,
        origen_id: g.salida.deposito_id,
        destino_id: g.entrada.deposito_id,
        empleado_id: g.salida.empleado_id,
        motivo: g.salida.motivo,
        anulada: false,
        esAnulacionDe: matchAnul?.[1],
      });
      if (matchAnul) anuladasIds.add(matchAnul[1]!);
    }
    for (const p of pares) {
      if (p.kind === 'transferencia' && anuladasIds.has(p.keyPar)) p.anulada = true;
    }
    const simples: Fila[] = otras.map((m) => ({
      kind: 'simple',
      id: m.id,
      fecha: m.fecha,
      tipo: m.tipo,
      cantidad: m.cantidad,
      deposito_id: m.deposito_id,
      empleado_id: m.empleado_id,
      motivo: m.motivo,
      referencia_id: m.referencia_id,
    }));
    return [...pares, ...simples].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [movs]);

  // Calculamos el "stock después" de cada movimiento reconstruyendo hacia
  // atrás desde el stock actual. Estrategia: para cada fila (ordenadas
  // desc por fecha), el saldo "después" del movimiento es el puntero
  // actual; después ajustamos el puntero restando el delta para tener el
  // estado ANTES del mov (que es el "después" del siguiente hacia atrás).
  //
  // Cuidado con los ajustes: en la BD guardamos cantidad=|delta| y perdemos
  // el signo del delta original. Para esos movs el "stock después" queda
  // como el actual del puntero, pero no ajustamos hacia atrás (marcado con
  // '?' visualmente). Es una limitación conocida del schema; se puede
  // resolver con una columna nueva en BD si molesta.
  type FilaConSaldo = Fila & {
    /** Snapshot COMPLETO de stock por depósito DESPUÉS de este mov.
     *  Incluye todos los depósitos que aparecen en el stock actual, no
     *  solo los que este mov tocó — para que la tabla tenga una columna
     *  fija por depósito y se lea todo el estado del producto en cada
     *  línea del historial. */
    saldoPorDeposito: Map<string, number>;
    /** Suma de stock del producto en todos los depósitos después de este mov. */
    saldoTotal: number;
    /** true si es un ajuste y no podemos calcular el delta con certeza. */
    saldoIncierto?: boolean;
  };
  const filasConSaldo = useMemo<FilaConSaldo[]>(() => {
    // Punteros de stock actual por depósito.
    const punteros = new Map<string, number>();
    for (const s of stockActual ?? []) {
      punteros.set(s.deposito_id, Number(s.cantidad));
    }
    let totalActual = 0;
    for (const v of punteros.values()) totalActual += v;

    const out: FilaConSaldo[] = [];
    for (const f of filas) {
      // Snapshot DESPUÉS del mov = estado actual de los punteros ANTES
      // de retroceder. Clonamos el Map completo y también capturamos el
      // total en este momento para que quede coherente con las columnas
      // (bug histórico: antes guardábamos el total DESPUÉS de restar el
      // delta, entonces la columna Total mostraba el saldo previo al
      // mov mientras las columnas por depósito mostraban el saldo
      // posterior — no coincidían).
      const saldoPorDeposito = new Map(punteros);
      const saldoTotalSnapshot = totalActual;
      let saldoIncierto = false;

      if (f.kind === 'transferencia') {
        // Retroceder: antes del mov, origen tenía +cant y destino -cant.
        // Total neto = 0.
        const dOr = punteros.get(f.origen_id) ?? 0;
        const dDe = punteros.get(f.destino_id) ?? 0;
        punteros.set(f.origen_id, dOr + f.cantidad);
        punteros.set(f.destino_id, dDe - f.cantidad);
      } else {
        // Simple: afecta un depósito.
        const d = punteros.get(f.deposito_id) ?? 0;
        let delta = 0;
        if (
          f.tipo === 'venta' ||
          f.tipo === 'merma'
        ) {
          delta = -f.cantidad;
        } else if (f.tipo === 'devolucion') {
          delta = f.cantidad;
        } else if (f.tipo === 'ajuste') {
          // Desde el deploy del 2026-08-10 los ajustes guardan el signo
          // REAL en cantidad (fix rpc_aplicar_delta_stock). Antes se
          // guardaba en abs y había que inferir el signo del motivo.
          //
          // Estrategia:
          //   A) Movimientos POST-fix (>= FIX_SIGNO_AJUSTES): confiamos
          //      en el signo directo de cantidad. Nunca "incierto".
          //   B) Movimientos PRE-fix (< FIX_SIGNO_AJUSTES): seguimos
          //      infiriendo por motivo — mismo comportamiento que antes:
          //        1) Auto-transfer desde / a → +/- respectivamente.
          //        2) Motivos preset (INGRESO / EGRESO_STOCK) matcheados
          //           sin tildes/case.
          //        3) Nada matchea → saldoIncierto = mostramos "?".
          const esPostFix = new Date(f.fecha) >= FIX_SIGNO_AJUSTES;
          if (esPostFix) {
            // Signo real preservado en la BD — usar tal cual.
            delta = f.cantidad;
          } else if (f.cantidad === 0) {
            delta = 0;
          } else {
            const m = f.motivo ?? '';
            const mNorm = normalizarMotivo(m);
            if (mNorm.startsWith('auto-transfer desde')) {
              delta = f.cantidad;
            } else if (mNorm.startsWith('auto-transfer a ')) {
              delta = -f.cantidad;
            } else if (
              (MOTIVOS_INGRESO_STOCK as readonly string[]).some((x) =>
                mismoMotivo(x, m),
              )
            ) {
              delta = f.cantidad;
            } else if (
              (MOTIVOS_EGRESO_STOCK as readonly string[]).some((x) =>
                mismoMotivo(x, m),
              )
            ) {
              delta = -f.cantidad;
            } else {
              // Movimiento viejo (abs) con motivo no reconocido → no
              // podemos inferir signo. Mostramos "?" en el snapshot.
              saldoIncierto = true;
            }
          }
        }
        if (delta !== 0) {
          punteros.set(f.deposito_id, d - delta);
          totalActual -= delta;
        }
      }
      out.push({
        ...f,
        saldoPorDeposito,
        saldoTotal: saldoTotalSnapshot,
        saldoIncierto,
      });
    }
    return out;
  }, [filas, stockActual]);

  // Lista de depósitos a renderizar como columnas fijas. Mostramos TODOS
  // los depósitos del sistema — no solo los que tienen fila en
  // stock_items para este producto — porque cuando el dueño está
  // corrigiendo inventario necesita ver la columna aunque el producto
  // no haya tenido stock en ese depósito nunca (para poder darse
  // cuenta de que le falta cargar ahí).
  //
  // Además incluimos "huérfanos": depósitos que aparecen en stockActual
  // pero no están en la lista principal — no debería pasar, pero si
  // sucede queremos verlos igual.
  const depositosVisibles = useMemo(() => {
    const yaInclidos = new Set(depositos.map((d) => d.id));
    const idsEnStock = new Set(
      (stockActual ?? []).map((s) => s.deposito_id),
    );
    const huerfanos = [...idsEnStock]
      .filter((id) => !yaInclidos.has(id))
      .map((id) => ({ id, nombre: '—' }));
    return [...depositos, ...huerfanos];
  }, [depositos, stockActual]);

  function fmtFecha(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Signo visual de la cantidad según tipo:
  //   'venta' | 'merma' | 'transferencia_salida' → -N (rojo)
  //   'devolucion' | 'transferencia_entrada'     → +N (verde)
  //   'ajuste' → +N o -N según valor real (el signo se guarda perdido en
  //             la BD: cantidad es siempre positivo, el "delta real" del
  //             ajuste solo se conoce en el motivo). Marcamos como neutro.
  function signoTipo(tipo: string): 'positivo' | 'negativo' | 'neutro' {
    if (
      tipo === 'venta' ||
      tipo === 'merma' ||
      tipo === 'transferencia_salida'
    )
      return 'negativo';
    if (tipo === 'devolucion' || tipo === 'transferencia_entrada')
      return 'positivo';
    return 'neutro';
  }

  // Toggle: vista simple (default) vs detalle por depósito. Agus casi
  // siempre mira solo "qué pasó y cómo quedó el total" — el desglose
  // por depósito lo consulta ocasionalmente. Persiste en localStorage
  // para respetar la última preferencia del usuario.
  const [mostrarDetalleDeposito, setMostrarDetalleDeposito] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('mov-stock-detalle-dep') === '1';
    } catch {
      return false;
    }
  });
  function toggleDetalleDep() {
    setMostrarDetalleDeposito((v) => {
      const nuevo = !v;
      try {
        window.localStorage.setItem('mov-stock-detalle-dep', nuevo ? '1' : '0');
      } catch {
        // ignore
      }
      return nuevo;
    });
  }

  // Estado local: qué fila está expandida (mostrando desglose completo
  // por depósito + motivo full + empleado). Una a la vez.
  const [filaExpandidaId, setFilaExpandidaId] = useState<string | null>(null);

  // Colores por depósito — misma paleta consistente en cards de arriba
  // y badges de cada fila. Ayuda a Agus a ubicar visualmente "esto
  // afectó a B12" con un color familiar.
  function coloresDeposito(nombre: string): { chip: string; card: string } {
    const n = nombre.toLowerCase();
    if (n.includes('b12'))
      return {
        chip: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        card: 'border-emerald-300 bg-emerald-50',
      };
    if (n.includes('c11'))
      return {
        chip: 'bg-amber-100 text-amber-800 border-amber-300',
        card: 'border-amber-300 bg-amber-50',
      };
    if (n.includes('central'))
      return {
        chip: 'bg-indigo-100 text-indigo-800 border-indigo-300',
        card: 'border-indigo-300 bg-indigo-50',
      };
    return {
      chip: 'bg-slate-100 text-slate-800 border-slate-300',
      card: 'border-slate-300 bg-slate-50',
    };
  }

  // Stock actual por depósito para la card de arriba. Suma huerfanos también.
  const stockPorDep = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stockActual ?? []) {
      map.set(s.deposito_id, (map.get(s.deposito_id) ?? 0) + Number(s.cantidad));
    }
    return map;
  }, [stockActual]);
  const stockTotalActual = useMemo(
    () =>
      (stockActual ?? []).reduce((acc, s) => acc + Number(s.cantidad), 0),
    [stockActual],
  );

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Historial de movimientos de stock (90 días)
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleDetalleDep}
            className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
            title={
              mostrarDetalleDeposito
                ? 'Ocultar detalle por depósito (Central / B12 / C11)'
                : 'Ver detalle por depósito (Central / B12 / C11)'
            }
          >
            {mostrarDetalleDeposito ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Ocultar detalle por depósito
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Ver detalle por depósito
              </>
            )}
          </button>
          <div className="text-[10px] text-muted-foreground">{filas.length} en total</div>
        </div>
      </div>

      {/* Panel "Stock actual por depósito" — lo que Agus necesita ver al
          toque para ubicar la mercadería, sin ir a rastrear entre movs.
          Cards con el mismo color que los badges de las filas de abajo. */}
      {depositosVisibles.length > 0 && (
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Stock actual por depósito
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {depositosVisibles.map((d) => {
              const c = coloresDeposito(d.nombre);
              const cant = stockPorDep.get(d.id) ?? 0;
              return (
                <div
                  key={d.id}
                  className={`flex items-center justify-between rounded border p-2 ${c.card}`}
                >
                  <span className="text-xs font-medium">{d.nombre}</span>
                  <span className="text-lg font-bold tabular-nums">{cant}u</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between rounded border border-slate-400 bg-white p-2">
              <span className="text-xs font-semibold">Total</span>
              <span className="text-lg font-bold tabular-nums">
                {stockTotalActual}u
              </span>
            </div>
          </div>
        </div>
      )}

      {cargando ? (
        <Skeleton className="h-24" />
      ) : filas.length === 0 ? (
        <p className="rounded border border-dashed py-3 text-center text-xs text-muted-foreground">
          No hubo movimientos de este producto en los últimos 90 días.
        </p>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted/60 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Fecha</th>
                <th className="px-2 py-1 text-left">Qué pasó</th>
                <th className="px-2 py-1 text-left">Depósito</th>
                <th
                  className="px-2 py-1 text-right"
                  title="Cantidad movida en este movimiento (con signo según tipo)"
                >
                  Movimiento
                </th>
                {mostrarDetalleDeposito && (
                  <>
                    {/* Una columna por depósito: cómo quedó el stock del
                        producto en ESE depósito después del mov. */}
                    {depositosVisibles.map((d) => (
                      <th
                        key={d.id}
                        className="whitespace-nowrap px-2 py-1 text-right"
                        title={`Stock en ${d.nombre} después de este movimiento`}
                      >
                        {d.nombre}
                      </th>
                    ))}
                  </>
                )}
                <th
                  className={`px-2 py-1 text-right font-semibold ${
                    mostrarDetalleDeposito ? 'border-l' : ''
                  }`}
                  title="Cómo quedó el stock del depósito afectado después de este movimiento"
                >
                  Cómo quedó
                </th>
                <th className="px-2 py-1 text-left">Motivo</th>
                <th className="px-2 py-1"></th>
                {puedeAnular && <th className="px-2 py-1"></th>}
              </tr>
            </thead>
            <tbody>
              {filasConSaldo.map((f) => {
                const empNombre = empPorId.get(f.empleado_id) ?? '—';
                if (f.kind === 'transferencia') {
                  const opac = f.anulada || f.esAnulacionDe ? 'opacity-60' : '';
                  const p = presentacionTipo('transferencia_salida', f.motivo, f.cantidad);
                  const nomOrigen = depPorId.get(f.origen_id) ?? '—';
                  const nomDestino = depPorId.get(f.destino_id) ?? '—';
                  const cOrigen = coloresDeposito(nomOrigen);
                  const cDestino = coloresDeposito(nomDestino);
                  const expTr = filaExpandidaId === f.keyPar;
                  return (
                    <>
                    <tr
                      key={f.keyPar}
                      className={`cursor-pointer border-t border-border/50 hover:bg-slate-50 ${opac}`}
                      onClick={() => setFilaExpandidaId(expTr ? null : f.keyPar)}
                    >
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                        {fmtFecha(f.fecha)}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${p.chip}`}
                        >
                          <p.Icon className="h-3 w-3" />
                          {p.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1">
                        <span
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cOrigen.chip}`}
                        >
                          {nomOrigen}
                        </span>
                        <ArrowRight className="mx-0.5 inline h-3 w-3 text-muted-foreground" />
                        <span
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cDestino.chip}`}
                        >
                          {nomDestino}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-sky-700">
                        {f.cantidad}
                      </td>
                      {mostrarDetalleDeposito && (
                        <>
                          {depositosVisibles.map((d) => {
                            const val = f.saldoPorDeposito.get(d.id) ?? 0;
                            const esOrigenODestino =
                              d.id === f.origen_id || d.id === f.destino_id;
                            return (
                              <td
                                key={d.id}
                                className={`px-2 py-1 text-right tabular-nums ${
                                  esOrigenODestino
                                    ? 'bg-blue-200 font-semibold text-blue-900'
                                    : ''
                                }`}
                              >
                                {val}
                              </td>
                            );
                          })}
                        </>
                      )}
                      <td
                        className={`px-2 py-1 text-right font-semibold tabular-nums ${
                          mostrarDetalleDeposito ? 'border-l' : ''
                        }`}
                      >
                        {f.saldoTotal}u
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {motivoLegible(f.motivo)}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-400">
                        {expTr ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </td>
                      {puedeAnular && (
                        <td className="px-2 py-1">
                          {/* Anular transferencia: keyPar es el id del mov
                              de salida (ver armado en filasConSaldo).
                              anularTransferenciaInmediata resuelve el par. */}
                          {!f.anulada && !f.esAnulacionDe && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  confirm(
                                    `¿Anular esta transferencia (${f.cantidad} unidad(es))?\n\n` +
                                      `Se van a crear 2 movimientos inversos para dejar el ` +
                                      `stock como estaba (vuelve al depósito de origen). ` +
                                      `Los movimientos originales quedan en el historial para ` +
                                      `auditoría.`,
                                  )
                                ) {
                                  anularTransfMut.mutate(f.keyPar);
                                }
                              }}
                              disabled={anularTransfMut.isPending}
                              title="Anular transferencia (revierte el stock)"
                              className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {expTr && (
                      <tr className="bg-slate-50">
                        <td
                          colSpan={
                            7 +
                            (mostrarDetalleDeposito ? depositosVisibles.length : 0) +
                            (puedeAnular ? 1 : 0)
                          }
                          className="border-l-4 border-l-sky-400 px-4 py-2"
                        >
                          <div className="grid gap-3 text-xs sm:grid-cols-3">
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-500">
                                Motivo completo
                              </div>
                              <div className="mt-0.5">
                                {motivoLegible(f.motivo) || (
                                  <span className="text-slate-400">Sin motivo</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-500">
                                Empleado
                              </div>
                              <div className="mt-0.5">{empNombre}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-500">
                                Origen
                              </div>
                              <div className="mt-0.5">
                                <OrigenBadge origen={origenDeMovimiento(f.motivo)} />
                              </div>
                            </div>
                            <div className="sm:col-span-3">
                              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                                Cómo quedó cada depósito después de esta transferencia
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {depositosVisibles.map((d) => {
                                  const val = f.saldoPorDeposito.get(d.id) ?? 0;
                                  const esOrigenODestino =
                                    d.id === f.origen_id || d.id === f.destino_id;
                                  const cd = coloresDeposito(d.nombre);
                                  return (
                                    <span
                                      key={d.id}
                                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] tabular-nums ${
                                        esOrigenODestino
                                          ? `${cd.chip} font-semibold ring-2 ring-offset-1 ring-slate-400`
                                          : cd.chip
                                      }`}
                                    >
                                      {d.nombre}: {val}u
                                    </span>
                                  );
                                })}
                                <span className="inline-flex items-center gap-1 rounded border border-slate-400 bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                                  Total: {f.saldoTotal}u
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
                  );
                }
                const signo = signoTipo(f.tipo);
                const pres = presentacionTipo(f.tipo, f.motivo, f.cantidad);
                const depNombre = depPorId.get(f.deposito_id) ?? '—';
                const depColores = coloresDeposito(depNombre);
                const saldoDepAfectado = f.saldoPorDeposito.get(f.deposito_id) ?? 0;
                const expandida = filaExpandidaId === f.id;
                return (
                  <>
                    <tr
                      key={f.id}
                      className="cursor-pointer border-t border-border/50 hover:bg-slate-50"
                      onClick={() => setFilaExpandidaId(expandida ? null : f.id)}
                    >
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                        {fmtFecha(f.fecha)}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${pres.chip}`}
                        >
                          <pres.Icon className="h-3 w-3" />
                          {pres.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1">
                        <span
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${depColores.chip}`}
                        >
                          {depNombre}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-semibold tabular-nums ${
                          signo === 'positivo'
                            ? 'text-emerald-700'
                            : signo === 'negativo'
                              ? 'text-destructive'
                              : ''
                        }`}
                      >
                        {signo === 'positivo' ? '+' : signo === 'negativo' ? '−' : ''}
                        {f.cantidad}
                      </td>
                      {mostrarDetalleDeposito && (
                        <>
                          {depositosVisibles.map((d) => {
                            const val = f.saldoPorDeposito.get(d.id) ?? 0;
                            const esAfectado = d.id === f.deposito_id;
                            return (
                              <td
                                key={d.id}
                                className={`px-2 py-1 text-right tabular-nums ${
                                  esAfectado ? 'bg-blue-200 font-semibold text-blue-900' : ''
                                }`}
                                title={
                                  f.saldoIncierto && esAfectado
                                    ? 'No podemos calcular el saldo previo con certeza (ajuste con motivo libre).'
                                    : undefined
                                }
                              >
                                {f.saldoIncierto && esAfectado ? `${val} ?` : val}
                              </td>
                            );
                          })}
                        </>
                      )}
                      <td
                        className={`px-2 py-1 text-right font-semibold tabular-nums ${
                          mostrarDetalleDeposito ? 'border-l' : ''
                        }`}
                        title={`Stock en ${depNombre} después de este movimiento`}
                      >
                        {f.saldoIncierto ? `${saldoDepAfectado} ?` : saldoDepAfectado}u
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {motivoLegible(f.motivo)}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-400">
                        {expandida ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </td>
                    {puedeAnular && (
                      <td className="px-2 py-1">
                        {/* Solo se puede anular un ajuste POST-fix (signo real
                            en BD) y que no sea ya una anulación previa. */}
                        {f.tipo === 'ajuste' &&
                          new Date(f.fecha) >= FIX_SIGNO_AJUSTES &&
                          !(f.motivo ?? '').startsWith('Anulación de ajuste') && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const signo = f.cantidad > 0 ? '+' : '';
                                if (
                                  confirm(
                                    `¿Anular este ajuste (${signo}${f.cantidad})?\n\n` +
                                      `Se va a crear un movimiento inverso para dejar el ` +
                                      `stock como estaba. El ajuste original queda en el ` +
                                      `historial para auditoría.`,
                                  )
                                ) {
                                  anularAjusteMut.mutate(f.id);
                                }
                              }}
                              disabled={anularAjusteMut.isPending}
                              title="Anular ajuste (revierte el stock)"
                              className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                      </td>
                    )}
                    </tr>
                    {expandida && (() => {
                      // Lookup del precio: para movimientos tipo venta /
                      // devolución, buscamos la venta en el cache y el item
                      // de este producto. Así Agus ve a qué precio se
                      // vendió desde el historial del producto, sin tener
                      // que ir a /admin/ventas (feedback 2026-10-30).
                      const esVentaOAnulacion =
                        (f.tipo === 'venta' || f.tipo === 'devolucion') && !!f.referencia_id;
                      const ventaDelMov = esVentaOAnulacion
                        ? ventas.find((v) => v.id === f.referencia_id)
                        : null;
                      const itemDelMov = ventaDelMov?.items?.find(
                        (it) => it.producto_id === productoId,
                      );
                      return (
                      <tr className="bg-slate-50">
                        <td
                          colSpan={
                            /* Fecha + Qué + Depósito + Movimiento + N depósitos (si toggle) + Cómo quedó + Motivo + Chevron */
                            7 +
                            (mostrarDetalleDeposito ? depositosVisibles.length : 0) +
                            (puedeAnular ? 1 : 0)
                          }
                          className="border-l-4 border-l-blue-400 px-4 py-2"
                        >
                          <div className="grid gap-3 text-xs sm:grid-cols-3">
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-500">
                                Motivo completo
                              </div>
                              <div className="mt-0.5">
                                {motivoLegible(f.motivo) || (
                                  <span className="text-slate-400">Sin motivo</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-500">
                                Empleado
                              </div>
                              <div className="mt-0.5">{empNombre}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-500">
                                Origen
                              </div>
                              <div className="mt-0.5">
                                <OrigenBadge
                                  origen={origenDeMovimiento(f.motivo, f.tipo)}
                                />
                              </div>
                            </div>
                            {itemDelMov && ventaDelMov && (
                              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 sm:col-span-3">
                                <div className="mb-1 text-[10px] font-semibold uppercase text-emerald-800">
                                  {f.tipo === 'devolucion'
                                    ? 'Precio al que se había vendido'
                                    : 'Precio al que se vendió'}
                                </div>
                                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                  <span>
                                    <span className="text-slate-500">Ticket </span>
                                    <span className="font-mono font-semibold">
                                      {ventaDelMov.numero}
                                    </span>
                                  </span>
                                  <span>
                                    <span className="text-slate-500">Precio unitario </span>
                                    <span className="font-semibold tabular-nums">
                                      {formatCurrency(itemDelMov.precio_unitario)}
                                    </span>
                                  </span>
                                  <span>
                                    <span className="text-slate-500">Cantidad </span>
                                    <span className="font-semibold tabular-nums">
                                      {itemDelMov.cantidad}
                                    </span>
                                  </span>
                                  {itemDelMov.descuento_pct ? (
                                    <span>
                                      <span className="text-slate-500">Descuento </span>
                                      <span className="font-semibold tabular-nums text-amber-700">
                                        −{itemDelMov.descuento_pct}%
                                      </span>
                                    </span>
                                  ) : null}
                                  <span>
                                    <span className="text-slate-500">Subtotal </span>
                                    <span className="font-bold tabular-nums text-emerald-800">
                                      {formatCurrency(itemDelMov.subtotal)}
                                    </span>
                                  </span>
                                  <span className="ml-auto text-slate-500">
                                    Total del ticket{' '}
                                    <span className="font-semibold tabular-nums text-slate-700">
                                      {formatCurrency(ventaDelMov.total)}
                                    </span>
                                  </span>
                                </div>
                              </div>
                            )}
                            <div className="sm:col-span-3">
                              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                                Cómo quedó cada depósito después de este movimiento
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {depositosVisibles.map((d) => {
                                  const val = f.saldoPorDeposito.get(d.id) ?? 0;
                                  const esAfectado = d.id === f.deposito_id;
                                  const cd = coloresDeposito(d.nombre);
                                  return (
                                    <span
                                      key={d.id}
                                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] tabular-nums ${
                                        esAfectado
                                          ? `${cd.chip} font-semibold ring-2 ring-offset-1 ring-slate-400`
                                          : cd.chip
                                      }`}
                                    >
                                      {d.nombre}: {val}u
                                    </span>
                                  );
                                })}
                                <span className="inline-flex items-center gap-1 rounded border border-slate-400 bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                                  Total: {f.saldoTotal}u
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                      );
                    })()}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrigenBadge({ origen }: { origen: 'pos' | 'admin' }) {
  if (origen === 'pos') {
    return (
      <Badge
        variant="outline"
        className="border-blue-300 bg-blue-50 text-blue-800"
        title="Cargado por un cajero desde el botón Stock del PoS"
      >
        PoS
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-purple-300 bg-purple-50 text-purple-800"
      title="Cargado desde el admin (encargado o dueño)"
    >
      Admin
    </Badge>
  );
}
