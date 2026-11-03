'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Search,
  Printer,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { getDb } from '@/lib/db';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@comercio/ui/table';
import { Badge } from '@comercio/ui/badge';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@comercio/ui/dialog';
import { formatCurrency, formatDate } from '@comercio/ui/utils';
import type { MetodoPago, Venta } from '@comercio/db';
import { PaginaProtegida } from '@/lib/permisos';

const LABEL_METODO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
  cta_cte: 'Cta corriente',
};

function VentasPageInner() {
  const db = getDb();
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const hace7 = format(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

  const [desde, setDesde] = useState(hace7);
  const [hasta, setHasta] = useState(hoy);
  const [empleadoId, setEmpleadoId] = useState<string>('');
  const [localId, setLocalId] = useState<string>('');
  const [metodo, setMetodo] = useState<string>('');
  const [estado, setEstado] = useState<string>('');
  // Filtro por turno: '' = todos, 'manana' = 7-15hs, 'tarde' = 15-23hs.
  // Se aplica client-side sobre la hora de cada venta. Madrugada cae en
  // tarde para no crear un tercer grupo.
  const [turno, setTurno] = useState<'' | 'manana' | 'tarde'>('');
  // Filtro por código o nombre de producto. Filtra las ventas que tienen
  // al menos un ítem con un producto cuyo código/nombre matchee.
  // Aplicado en memoria sobre las ventas ya traídas (no hace round-trip).
  const [textoProducto, setTextoProducto] = useState('');
  // Venta seleccionada para ver el detalle en el popup.
  const [ventaDetalle, setVentaDetalle] = useState<Venta | null>(null);
  // Orden por fecha. Default desc (más nueva arriba) — lo más útil para
  // el dueño que abre la pantalla a chequear lo del momento.
  const [ordenDesc, setOrdenDesc] = useState(true);
  // Paginación client-side. Con el fix del cap de PostgREST empezamos a
  // traer 1900+ ventas del mes — la tabla quedaba interminable. Default
  // 100 por página; el dueño elige "Todas" si quiere ver un dump completo.
  // `porPagina = 0` significa "todas". La página se resetea a 0 cada vez
  // que cambia un filtro (ver efecto abajo).
  const [porPagina, setPorPagina] = useState<number>(100);
  const [pagina, setPagina] = useState<number>(0);

  const ventasQ = useQuery({
    queryKey: ['ventas-admin', desde, hasta, empleadoId, localId],
    queryFn: () =>
      db.ventas.list({
        desde: new Date(`${desde}T00:00:00`).toISOString(),
        hasta: new Date(`${hasta}T23:59:59`).toISOString(),
        empleado_id: empleadoId || undefined,
        local_id: localId || undefined,
      }),
  });
  const empleadosQ = useQuery({ queryKey: ['empleados'], queryFn: () => db.empleados.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });
  // Catálogo de productos — necesario para mostrar nombre + código en cada
  // fila (vista producto×producto) y para el filtro por texto. Se carga
  // siempre, no lazy: el render principal ya lo usa.
  const productosQ = useQuery({
    queryKey: ['productos-all'],
    queryFn: () => db.productos.list(),
  });

  // Logs de descuento manual del rango. El motivo del descuento global se
  // guarda en auditoría (no como columna de la venta), así que cruzamos
  // venta_id → motivo desde acá. Es 1 query extra por rango.
  const descuentosQ = useQuery({
    queryKey: ['ventas-admin-descuentos', desde, hasta],
    queryFn: () =>
      db.auditoria.list({
        entidad: 'venta',
        desde: new Date(`${desde}T00:00:00`).toISOString(),
        hasta: new Date(`${hasta}T23:59:59`).toISOString(),
      }),
  });
  // Map ventaId → { motivo, monto } (solo entries de descuento_manual).
  const descuentoPorVenta = (() => {
    const map = new Map<string, { motivo: string | null; monto: number }>();
    for (const log of descuentosQ.data ?? []) {
      if (log.accion !== 'descuento_manual' || !log.entidad_id) continue;
      const d = log.detalle ?? {};
      map.set(log.entidad_id, {
        motivo: (d.motivo as string | null) ?? null,
        monto: typeof d.monto === 'number' ? d.monto : 0,
      });
    }
    return map;
  })();

  // Cambios (devoluciones + venta nueva) registrados en auditoría desde el PoS.
  // Construimos DOS mapas porque un cambio toca DOS ventas:
  //   - ventaId ORIGINAL → resumen del cambio (qué NC, qué venta nueva, etc.)
  //   - ventaId NUEVA    → link a la original ("esta venta es la diferencia
  //     cobrada en el cambio de la venta XXXX")
  // Sin esto el admin ve la venta nueva como un ingreso "normal" y no
  // entiende por qué hay también una NC ese día.
  type CambioInfo = {
    venta_original_id: string;
    venta_original_numero: string | null;
    nc_id: string | null;
    nc_numero: string | null;
    venta_nueva_id: string | null;
    venta_nueva_numero: string | null;
    total_devuelto: number;
    total_nuevo: number;
    diferencia_cobrada: number;
    metodo_diferencia: MetodoPago | null;
    fecha: string;
  };
  const { cambioComoOriginal, cambioComoNueva } = (() => {
    const original = new Map<string, CambioInfo>();
    const nueva = new Map<string, CambioInfo>();
    for (const log of descuentosQ.data ?? []) {
      if (log.accion !== 'cambio_venta' || !log.entidad_id) continue;
      const d = log.detalle ?? {};
      // El número de la venta original no se guardó en detalle (sólo el id),
      // pero el `entidad_id` SÍ es esa venta — el `numero` lo resolvemos al
      // renderizar usando la lista de ventas del rango.
      const info: CambioInfo = {
        venta_original_id: log.entidad_id,
        venta_original_numero: null,
        nc_id: (d.nc_id as string | null) ?? null,
        nc_numero: (d.nc_numero as string | null) ?? null,
        venta_nueva_id: (d.venta_nueva_id as string | null) ?? null,
        venta_nueva_numero: (d.venta_nueva_numero as string | null) ?? null,
        total_devuelto:
          typeof d.total_devuelto === 'number' ? d.total_devuelto : 0,
        total_nuevo: typeof d.total_nuevo === 'number' ? d.total_nuevo : 0,
        diferencia_cobrada:
          typeof d.diferencia_cobrada === 'number' ? d.diferencia_cobrada : 0,
        metodo_diferencia:
          (d.metodo_diferencia as MetodoPago | null) ?? null,
        fecha: log.fecha,
      };
      original.set(log.entidad_id, info);
      if (info.venta_nueva_id) nueva.set(info.venta_nueva_id, info);
    }
    return { cambioComoOriginal: original, cambioComoNueva: nueva };
  })();

  // Map ventaId → [logs de precio_editado / descuento_linea]. Lo arma
  // el popup de detalle para listar los motivos al lado de cada producto.
  type LogLinea = {
    accion: 'precio_editado' | 'descuento_linea';
    detalle: Record<string, unknown>;
  };
  const motivosLineaPorVenta = (() => {
    const map = new Map<string, LogLinea[]>();
    for (const log of descuentosQ.data ?? []) {
      if (
        (log.accion !== 'precio_editado' && log.accion !== 'descuento_linea') ||
        !log.entidad_id
      )
        continue;
      const arr = map.get(log.entidad_id) ?? [];
      arr.push({
        accion: log.accion,
        detalle: (log.detalle ?? {}) as Record<string, unknown>,
      });
      map.set(log.entidad_id, arr);
    }
    return map;
  })();

  // Set de "venta::producto" con precio editado. Permite resaltar
  // visualmente la celda de precio en el historial.
  const itemsConPrecioEditado = (() => {
    const set = new Set<string>();
    for (const log of descuentosQ.data ?? []) {
      if (log.accion !== 'precio_editado' || !log.entidad_id) continue;
      const productoId = (log.detalle as { producto_id?: string } | null)?.producto_id;
      if (productoId) set.add(`${log.entidad_id}::${productoId}`);
    }
    return set;
  })();

  let ventas = ventasQ.data ?? [];
  if (turno) {
    ventas = ventas.filter((v) => {
      const h = new Date(v.fecha).getHours();
      const esManana = h >= 7 && h < 15;
      return turno === 'manana' ? esManana : !esManana;
    });
  }
  if (metodo) ventas = ventas.filter((v) => v.pagos.some((p) => p.metodo === metodo));
  if (estado) {
    if (estado === 'con_cambio') {
      // Filtro virtual: ventas que aparecen en algún log cambio_venta,
      // ya sea como original o como nueva.
      ventas = ventas.filter(
        (v) => cambioComoOriginal.has(v.id) || cambioComoNueva.has(v.id),
      );
    } else {
      ventas = ventas.filter((v) => v.estado === estado);
    }
  }
  // Filtro por código/nombre de producto. Si la query es solo dígitos, match
  // EXACTO al código; con letras, match parcial al nombre (case-insensitive).
  if (textoProducto.trim()) {
    const q = textoProducto.trim().toLowerCase();
    const esNumerico = /^\d+$/.test(q);
    const productosLookup = productosQ.data ?? [];
    const idsMatch = new Set(
      productosLookup
        .filter((p) =>
          esNumerico
            ? p.codigo_interno === q
            : p.nombre.toLowerCase().includes(q),
        )
        .map((p) => p.id),
    );
    ventas = ventas.filter((v) => v.items.some((it) => idsMatch.has(it.producto_id)));
  }

  // Ventas ordenadas — mismo criterio que la tabla — para poder cortar la
  // página SIN cambiar el orden visible. Antes el sort vivía dentro del
  // .flatMap del render.
  const ventasOrdenadas = [...ventas].sort((a, b) => {
    const cmp = a.fecha.localeCompare(b.fecha);
    return ordenDesc ? -cmp : cmp;
  });
  const paginaSize = porPagina === 0 ? ventasOrdenadas.length : porPagina;
  const totalPaginas = paginaSize > 0
    ? Math.max(1, Math.ceil(ventasOrdenadas.length / paginaSize))
    : 1;
  const paginaActual = Math.min(pagina, totalPaginas - 1);
  const ventasPagina = ventasOrdenadas.slice(
    paginaActual * paginaSize,
    paginaActual * paginaSize + paginaSize,
  );
  // Cuando cambia cualquier filtro / orden / tamaño de página, volver a la
  // primera página. Sin esto, si estabas en la página 15 y filtrás algo
  // que solo tiene 3, la tabla se ve vacía.
  useEffect(() => {
    setPagina(0);
  }, [
    desde,
    hasta,
    empleadoId,
    localId,
    metodo,
    estado,
    turno,
    textoProducto,
    ordenDesc,
    porPagina,
  ]);

  const total = ventas
    .filter((v) => v.estado === 'completada')
    .reduce((acc, v) => acc + v.total, 0);
  // KPI rápido de descuentos en el rango filtrado.
  const ventasConDescuento = ventas.filter(
    (v) => v.estado === 'completada' && (v.descuento_total ?? 0) > 0,
  );
  const totalDescuentos = ventasConDescuento.reduce(
    (acc, v) => acc + (v.descuento_total ?? 0),
    0,
  );
  // KPI rápido de anulaciones en el rango filtrado.
  const ventasAnuladas = ventas.filter((v) => v.estado === 'anulada');
  const totalAnulado = ventasAnuladas.reduce((acc, v) => acc + v.total, 0);

  const empleadoNombre = (id: string) => {
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido}` : '—';
  };
  // En la tabla y en el detalle solo queremos la sigla del local (ej.
  // "B12", "C11") — el nombre completo en DB es "#Turisteando B12" pero
  // ese prefijo es redundante porque el admin ya es de Turisteando.
  // Sacamos el "#turisteando" del principio en cualquier capitalización.
  const localNombre = (id: string) => {
    const nombre = localesQ.data?.find((l) => l.id === id)?.nombre;
    if (!nombre) return '—';
    return nombre.replace(/^#?\s*turisteando\s*/i, '').trim() || nombre;
  };

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold sm:text-2xl">Ventas</h1>
        <p className="text-sm text-muted-foreground">Historial de ventas con filtros.</p>
      </div>

      {/* Estilo Office: divs con border-slate-300 + headers bg-slate-50.
          Reemplaza los Card del UI para tener la misma estética que
          /productos (más "sistema viejo / ERP de escritorio"). */}
      <div className="mb-4 rounded border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase text-slate-700">
          Filtros
        </div>
        <div className="p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <Label className="mb-1 block text-xs">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Cajero</Label>
              <select
                value={empleadoId}
                onChange={(e) => setEmpleadoId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {(empleadosQ.data ?? []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nombre} {emp.apellido}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Local</Label>
              <select
                value={localId}
                onChange={(e) => setLocalId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {(localesQ.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Método de pago</Label>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {/* Cta corriente queda fuera del PoS — no se ofrece como
                    medio de pago. Excluida del filtro. */}
                {Object.entries(LABEL_METODO)
                  .filter(([k]) => k !== 'cta_cte')
                  .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Estado</Label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="completada">Completadas</option>
                <option value="con_cambio">Con cambio</option>
                <option value="anulada">Anuladas</option>
                <option value="cancelada">Canceladas</option>
                <option value="presupuesto">Presupuestos</option>
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Turno</Label>
              <select
                value={turno}
                onChange={(e) => setTurno(e.target.value as '' | 'manana' | 'tarde')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="manana">Mañana (7-15)</option>
                <option value="tarde">Tarde (15-23)</option>
              </select>
            </div>
            {/* Filtro por producto: código exacto si es numérico, parcial
                por nombre si tiene letras. Mismo patrón que /productos. */}
            <div className="md:col-span-3 lg:col-span-6">
              <Label className="mb-1 block text-xs">Producto (código o nombre)</Label>
              <Input
                value={textoProducto}
                onChange={(e) => setTextoProducto(e.target.value)}
                placeholder="Ej: 1234 (código exacto) o 'lapicera' (parcial por nombre)"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-col items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="text-xs font-semibold uppercase text-slate-700">
              {ventas.length} ventas · Total: {formatCurrency(total)}
            </div>
            {/* Selector de tamaño de página. "0" = mostrar todas. */}
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <span>Por página</span>
              <select
                value={porPagina}
                onChange={(e) => setPorPagina(Number(e.target.value))}
                className="h-6 rounded border border-slate-300 bg-white px-1 text-xs"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={0}>Todas</option>
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:items-end">
            {ventasConDescuento.length > 0 && (
              <span>
                {ventasConDescuento.length} con descuento ·{' '}
                <span className="text-green-700">
                  -{formatCurrency(totalDescuentos)}
                </span>
              </span>
            )}
            {ventasAnuladas.length > 0 && (
              <span>
                {ventasAnuladas.length} anulada(s) ·{' '}
                <span className="text-red-700">
                  -{formatCurrency(totalAnulado)}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="p-3">
          {ventasQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : ventas.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Search className="mx-auto mb-2 h-6 w-6 opacity-40" />
              No hay ventas en el rango seleccionado.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cant.</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => setOrdenDesc((v) => !v)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      title={
                        ordenDesc
                          ? 'Más nueva arriba (click para invertir)'
                          : 'Más vieja arriba (click para invertir)'
                      }
                    >
                      Fecha
                      {ordenDesc ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronUp className="h-3 w-3" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>Cajero</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Vista PRODUCTO × PRODUCTO: una fila por ítem vendido.
                    Items de la misma venta se ven con bandeo alternado
                    (color de fondo) + borde superior más grueso en la
                    primera fila para que se distinga claramente. Pedido
                    del cliente, igual que el patrón de la historia del PoS.
                    Iteramos SOLO sobre la página actual (ventasPagina);
                    el orden ya viene aplicado desde arriba. */}
                {ventasPagina.flatMap((v, vIdx) => {
                    const anulada = v.estado === 'anulada';
                    const cancelada = v.estado === 'cancelada';
                    const banda = vIdx % 2 === 0 ? '' : 'bg-slate-50/70';
                    const tieneCambio =
                      cambioComoOriginal.has(v.id) || cambioComoNueva.has(v.id);
                    const metodos = Array.from(new Set(v.pagos.map((p) => p.metodo)));
                    const metodoTxt =
                      metodos.length > 1 ? 'Mixto' : LABEL_METODO[metodos[0]!] ?? '—';
                    return v.items.map((it, idx) => {
                      const p = productosQ.data?.find((x) => x.id === it.producto_id);
                      const esPrimera = idx === 0;
                      const subtotal =
                        it.subtotal ?? it.precio_unitario * it.cantidad;
                      const precioEditado = itemsConPrecioEditado.has(
                        `${v.id}::${it.producto_id}`,
                      );
                      return (
                        <TableRow
                          key={`${v.id}-${idx}`}
                          onClick={() => setVentaDetalle(v)}
                          className={`cursor-pointer ${banda} ${
                            esPrimera ? 'border-t-2 border-t-slate-300' : ''
                          } ${anulada ? 'opacity-60' : ''} ${
                            cancelada ? 'opacity-50' : ''
                          } hover:bg-blue-50/50`}
                        >
                          <TableCell className="font-mono text-xs">
                            {p?.codigo_interno ?? '—'}
                          </TableCell>
                          <TableCell
                            className={anulada || cancelada ? 'line-through' : ''}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {p?.nombre ?? 'Producto borrado'}
                              {esPrimera && anulada && (
                                <Badge variant="destructive">Anulada</Badge>
                              )}
                              {esPrimera && cancelada && (
                                <Badge variant="outline">Cancelada</Badge>
                              )}
                              {esPrimera && tieneCambio && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 text-amber-700"
                                >
                                  Cambio
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.cantidad}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              precioEditado
                                ? 'bg-orange-50 font-semibold text-orange-700'
                                : ''
                            }`}
                            title={
                              precioEditado
                                ? 'Precio modificado en esta venta — ver detalle'
                                : undefined
                            }
                          >
                            {formatCurrency(it.precio_unitario)}
                            {precioEditado && <span className="ml-1 text-[10px]">●</span>}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {cancelada ? '—' : formatCurrency(subtotal)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {cancelada ? '—' : metodoTxt}
                          </TableCell>
                          <TableCell className="text-xs">
                            {esPrimera ? localNombre(v.local_id) : ''}
                          </TableCell>
                          <TableCell className="text-xs">
                            {esPrimera ? formatDate(v.fecha) : ''}
                          </TableCell>
                          <TableCell className="text-xs">
                            {esPrimera ? empleadoNombre(v.empleado_id) : ''}
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })}
              </TableBody>
            </Table>
          )}
          {/* Nav de paginación. Se esconde si todo entra en una página
              (ej. usuario eligió "Todas" o hay ≤ porPagina ventas). */}
          {ventasOrdenadas.length > paginaSize && paginaSize > 0 && (
            <div className="mt-3 flex flex-col items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600 sm:flex-row">
              <div>
                Mostrando {paginaActual * paginaSize + 1}
                {'–'}
                {Math.min(
                  (paginaActual + 1) * paginaSize,
                  ventasOrdenadas.length,
                )}{' '}
                de {ventasOrdenadas.length} ventas
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={paginaActual === 0}
                  onClick={() => setPagina(0)}
                  className="h-7 px-2"
                  title="Primera página"
                >
                  <ChevronsLeft className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={paginaActual === 0}
                  onClick={() => setPagina((p) => Math.max(0, p - 1))}
                  className="h-7 px-2"
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="min-w-[80px] text-center tabular-nums">
                  Página {paginaActual + 1} de {totalPaginas}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={paginaActual >= totalPaginas - 1}
                  onClick={() =>
                    setPagina((p) => Math.min(totalPaginas - 1, p + 1))
                  }
                  className="h-7 px-2"
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={paginaActual >= totalPaginas - 1}
                  onClick={() => setPagina(totalPaginas - 1)}
                  className="h-7 px-2"
                  title="Última página"
                >
                  <ChevronsRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detalle de venta en popup. */}
      <Dialog
        open={!!ventaDetalle}
        onOpenChange={(v) => !v && setVentaDetalle(null)}
        className="max-w-2xl"
      >
        {ventaDetalle && (() => {
          // Resolvemos el "número" de la venta original a partir de la lista
          // ya cargada del rango (auditoría sólo guarda el id).
          const enrich = (c: CambioInfo | undefined): CambioInfo | null => {
            if (!c) return null;
            if (c.venta_original_numero) return c;
            const orig = ventas.find((v) => v.id === c.venta_original_id);
            return { ...c, venta_original_numero: orig?.numero ?? null };
          };
          return (
            <DetalleVenta
              venta={ventaDetalle}
              empleadoNombre={empleadoNombre}
              localNombre={localNombre}
              motivoDescuento={
                descuentoPorVenta.get(ventaDetalle.id)?.motivo ?? null
              }
              cambioComoOriginal={enrich(
                cambioComoOriginal.get(ventaDetalle.id),
              )}
              cambioComoNueva={enrich(cambioComoNueva.get(ventaDetalle.id))}
              productosCache={productosQ.data ?? []}
              motivosLinea={motivosLineaPorVenta.get(ventaDetalle.id) ?? []}
            />
          );
        })()}
        <DialogFooter>
          <Button variant="outline" onClick={() => setVentaDetalle(null)}>
            Cerrar
          </Button>
          {ventaDetalle && (
            <Button asChild>
              <Link href={`/ventas/${ventaDetalle.id}/ticket`}>
                <Printer className="mr-1 h-4 w-4" />
                Ver ticket impreso
              </Link>
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  );
}

type CambioInfoView = {
  venta_original_id: string;
  venta_original_numero: string | null;
  nc_id: string | null;
  nc_numero: string | null;
  venta_nueva_id: string | null;
  venta_nueva_numero: string | null;
  total_devuelto: number;
  total_nuevo: number;
  diferencia_cobrada: number;
  metodo_diferencia: MetodoPago | null;
  fecha: string;
};

function DetalleVenta({
  venta,
  empleadoNombre,
  localNombre,
  motivoDescuento,
  cambioComoOriginal,
  cambioComoNueva,
  productosCache,
  motivosLinea,
}: {
  venta: Venta;
  empleadoNombre: (id: string) => string;
  localNombre: (id: string) => string;
  motivoDescuento: string | null;
  cambioComoOriginal: CambioInfoView | null;
  cambioComoNueva: CambioInfoView | null;
  productosCache: { id: string; codigo_interno: string; nombre: string }[];
  motivosLinea: {
    accion: 'precio_editado' | 'descuento_linea';
    detalle: Record<string, unknown>;
  }[];
}) {
  const db = getDb();
  const productoInfo = (id: string) =>
    productosCache.find((p) => p.id === id);

  // Si esta venta es la ORIGINAL del cambio: traemos la NC para ver
  // qué se devolvió y la venta nueva para ver qué se llevó.
  const ncId = cambioComoOriginal?.nc_id ?? null;
  const ventaNuevaIdOrig = cambioComoOriginal?.venta_nueva_id ?? null;
  const ncQ = useQuery({
    queryKey: ['detalle-venta-nc', ncId],
    queryFn: () => (ncId ? db.notasCredito.get(ncId) : Promise.resolve(null)),
    enabled: !!ncId,
  });
  const ventaNuevaQ = useQuery({
    queryKey: ['detalle-venta-nueva', ventaNuevaIdOrig],
    queryFn: () =>
      ventaNuevaIdOrig ? db.ventas.get(ventaNuevaIdOrig) : Promise.resolve(null),
    enabled: !!ventaNuevaIdOrig,
  });

  // Si esta venta es la NUEVA del cambio: traemos la venta original
  // (qué se compró antes) + la NC asociada (qué se devolvió).
  const ventaOrigId = cambioComoNueva?.venta_original_id ?? null;
  const ncNuevaId = cambioComoNueva?.nc_id ?? null;
  const ventaOrigQ = useQuery({
    queryKey: ['detalle-venta-orig', ventaOrigId],
    queryFn: () =>
      ventaOrigId ? db.ventas.get(ventaOrigId) : Promise.resolve(null),
    enabled: !!ventaOrigId,
  });
  const ncNuevaQ = useQuery({
    queryKey: ['detalle-venta-nc-nueva', ncNuevaId],
    queryFn: () =>
      ncNuevaId ? db.notasCredito.get(ncNuevaId) : Promise.resolve(null),
    enabled: !!ncNuevaId,
  });

  // Tabla compacta de items, reusable para "se devolvió" y "se llevó".
  function TablaItems({
    items,
  }: {
    items: { producto_id: string; cantidad: number; precio_unitario: number; subtotal?: number }[];
  }) {
    return (
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Código</th>
              <th className="px-2 py-1.5 text-left">Producto</th>
              <th className="px-2 py-1.5 text-right">Cant.</th>
              <th className="px-2 py-1.5 text-right">Precio</th>
              <th className="px-2 py-1.5 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const p = productoInfo(it.producto_id);
              const subtotal = it.subtotal ?? it.cantidad * it.precio_unitario;
              return (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {p?.codigo_interno ?? '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {p?.nombre ?? '(eliminado)'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {it.cantidad}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatCurrency(it.precio_unitario)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatCurrency(subtotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Venta {venta.numero} ·{' '}
          <span className="text-muted-foreground">{formatDate(venta.fecha)}</span>
        </DialogTitle>
      </DialogHeader>

      {/* Cabecera de la venta */}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Cajero</div>
          <div className="font-medium">{empleadoNombre(venta.empleado_id)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Local</div>
          <div className="font-medium">{localNombre(venta.local_id)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Estado</div>
          <div className="font-medium">
            {venta.estado === 'anulada' ? (
              <Badge variant="destructive">Anulada</Badge>
            ) : venta.estado === 'cancelada' ? (
              <Badge variant="outline">Cancelada</Badge>
            ) : venta.estado === 'completada' ? (
              <Badge variant="secondary">Completada</Badge>
            ) : (
              <Badge>Presupuesto</Badge>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Items</div>
          <div className="font-medium">
            {venta.items.reduce((a, i) => a + i.cantidad, 0)} unidad(es)
          </div>
        </div>
      </div>

      {/* Banner de cambio — esta venta es la ORIGINAL que tuvo un cambio.
          Le decimos al admin qué NC se emitió, si hubo venta nueva, cuánto
          se devolvió y cuánto se cobró de diferencia (y con qué método).
          Sin esto, en la lista ve "la venta de $X" y al lado, en NC, ve la
          devolución, sin saber que están relacionadas. */}
      {cambioComoOriginal && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">
            Esta venta tuvo un cambio el {formatDate(cambioComoOriginal.fecha)}
          </div>
          <div className="mt-2 grid gap-1 text-xs">
            <div>
              <span className="text-amber-700">Se devolvió:</span>{' '}
              <span className="font-medium tabular-nums">
                {formatCurrency(cambioComoOriginal.total_devuelto)}
              </span>
              {cambioComoOriginal.nc_numero && (
                <>
                  {' '}vía nota de crédito{' '}
                  <span className="font-mono">
                    #{cambioComoOriginal.nc_numero}
                  </span>
                </>
              )}
            </div>
            {cambioComoOriginal.venta_nueva_id ? (
              <>
                <div>
                  <span className="text-amber-700">Se llevó:</span>{' '}
                  <span className="font-medium tabular-nums">
                    {formatCurrency(cambioComoOriginal.total_nuevo)}
                  </span>
                  {cambioComoOriginal.venta_nueva_numero && (
                    <>
                      {' '}en venta{' '}
                      <span className="font-mono">
                        #{cambioComoOriginal.venta_nueva_numero}
                      </span>
                    </>
                  )}
                </div>
                {cambioComoOriginal.diferencia_cobrada > 0 ? (
                  <div>
                    <span className="text-amber-700">Cobró diferencia:</span>{' '}
                    <span className="font-medium tabular-nums">
                      {formatCurrency(cambioComoOriginal.diferencia_cobrada)}
                    </span>
                    {cambioComoOriginal.metodo_diferencia && (
                      <>
                        {' '}en{' '}
                        <span className="font-medium">
                          {LABEL_METODO[cambioComoOriginal.metodo_diferencia]}
                        </span>
                      </>
                    )}
                  </div>
                ) : cambioComoOriginal.total_nuevo <
                  cambioComoOriginal.total_devuelto ? (
                  <div className="italic text-amber-700">
                    Quedó saldo a favor del cliente (no se devolvió plata —
                    política Turisteando).
                  </div>
                ) : (
                  <div className="italic text-amber-700">Cambio exacto.</div>
                )}
              </>
            ) : (
              <div className="italic text-amber-700">
                Devolución sin reemplazo (no se llevó otro producto).
              </div>
            )}
          </div>

          {/* Detalle de productos del cambio (esta venta = original). */}
          {ncQ.data && ncQ.data.items.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                Productos devueltos
              </div>
              <TablaItems items={ncQ.data.items} />
            </div>
          )}
          {ventaNuevaQ.data && ventaNuevaQ.data.items.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                Productos llevados (venta nueva #
                {cambioComoOriginal.venta_nueva_numero ?? ''})
              </div>
              <TablaItems items={ventaNuevaQ.data.items} />
            </div>
          )}
        </div>
      )}

      {/* Banner de cambio — esta venta NO es la original sino la "venta nueva"
          generada por la diferencia del cambio. Sirve para que el admin no
          piense que es un ingreso normal. */}
      {cambioComoNueva && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">
            Esta venta es la diferencia de un cambio
            {cambioComoNueva.venta_original_numero && (
              <>
                {' '}sobre la venta original{' '}
                <span className="font-mono">
                  #{cambioComoNueva.venta_original_numero}
                </span>
              </>
            )}
          </div>
          <div className="mt-1 text-xs text-amber-800">
            El cliente devolvió{' '}
            <span className="font-medium tabular-nums">
              {formatCurrency(cambioComoNueva.total_devuelto)}
            </span>{' '}
            (NC{' '}
            {cambioComoNueva.nc_numero ? (
              <span className="font-mono">#{cambioComoNueva.nc_numero}</span>
            ) : (
              '—'
            )}
            ) y se llevó productos por{' '}
            <span className="font-medium tabular-nums">
              {formatCurrency(cambioComoNueva.total_nuevo)}
            </span>
            . Acá se registra sólo la diferencia cobrada
            {cambioComoNueva.metodo_diferencia && (
              <>
                {' '}en{' '}
                <span className="font-medium">
                  {LABEL_METODO[cambioComoNueva.metodo_diferencia]}
                </span>
              </>
            )}
            .
          </div>

          {/* Detalle: qué compró originalmente + qué devolvió.
              Esta venta = la "venta nueva" del cambio. */}
          {ventaOrigQ.data && ventaOrigQ.data.items.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                Compra original (
                {formatDate(ventaOrigQ.data.fecha)})
              </div>
              <TablaItems items={ventaOrigQ.data.items} />
            </div>
          )}
          {ncNuevaQ.data && ncNuevaQ.data.items.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                Productos devueltos
              </div>
              <TablaItems items={ncNuevaQ.data.items} />
            </div>
          )}
        </div>
      )}

      {/* Items */}
      <div className="mt-3">
        <div className="mb-2 text-sm font-medium">Productos vendidos</div>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Código</th>
                <th className="px-2 py-1.5 text-left">Producto</th>
                <th className="px-2 py-1.5 text-right">Cant.</th>
                <th className="px-2 py-1.5 text-right">Precio</th>
                <th className="px-2 py-1.5 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {venta.items.map((it, i) => {
                const p = productoInfo(it.producto_id);
                return (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1.5 font-mono text-xs">
                      {p?.codigo_interno ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      {p?.nombre ?? (
                        <span className="text-xs text-muted-foreground">
                          Producto eliminado
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {it.cantidad}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(it.precio_unitario)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(it.subtotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cómo se cobró */}
      <div className="mt-3">
        <div className="mb-2 text-sm font-medium">Forma de cobro</div>
        <div className="rounded-md border">
          {venta.pagos.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-t px-3 py-2 text-sm first:border-t-0"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {LABEL_METODO[p.metodo] ?? p.metodo}
                </span>
                {p.cuotas && (
                  <span className="text-xs text-muted-foreground">
                    en {p.cuotas} cuota(s)
                  </span>
                )}
                {p.recargo_pct ? (
                  <span className="text-xs text-orange-700">
                    +{p.recargo_pct}% recargo
                  </span>
                ) : null}
              </div>
              <span className="font-medium tabular-nums">
                {formatCurrency(p.monto)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Totales */}
      <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatCurrency(venta.subtotal)}</span>
        </div>
        {(venta.descuento_total ?? 0) > 0 && (
          <div className="flex justify-between text-green-700">
            <span>
              Descuento
              {motivoDescuento && (
                <span className="ml-1 text-xs text-muted-foreground">
                  · {motivoDescuento}
                </span>
              )}
            </span>
            <span className="tabular-nums">
              -{formatCurrency(venta.descuento_total)}
            </span>
          </div>
        )}
        {(venta.recargo_total ?? 0) > 0 && (
          <div className="flex justify-between text-orange-700">
            <span>Recargo (cuotas)</span>
            <span className="tabular-nums">
              +{formatCurrency(venta.recargo_total)}
            </span>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t pt-1 text-base font-semibold">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatCurrency(venta.total)}</span>
        </div>
      </div>

      {/* Motivos por línea (precios editados y descuentos por línea).
          Cada uno guardado en auditoría desde el PoS al momento del cobro. */}
      {motivosLinea.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-amber-800">
            Cambios manuales en esta venta
          </div>
          <ul className="space-y-1.5 text-xs">
            {motivosLinea.map((log, i) => {
              const d = log.detalle;
              const nombre = (d.producto_nombre as string) ?? '—';
              const codigo = (d.codigo_interno as string) ?? '—';
              const motivo = (d.motivo as string | null) ?? null;
              if (log.accion === 'precio_editado') {
                const base = Number(d.precio_base ?? 0);
                const nuevo = Number(d.precio_nuevo ?? 0);
                const diff = nuevo - base;
                return (
                  <li
                    key={i}
                    className="rounded border border-orange-200 bg-white p-2"
                  >
                    <div className="font-medium text-orange-900">
                      <span className="font-mono text-[10px] text-slate-500">
                        #{codigo}
                      </span>{' '}
                      {nombre} — precio editado
                    </div>
                    <div className="text-[11px] text-slate-700">
                      Base {formatCurrency(base)} → Cobrado{' '}
                      <b>{formatCurrency(nuevo)}</b>{' '}
                      <span
                        className={diff < 0 ? 'text-green-700' : 'text-orange-700'}
                      >
                        ({diff > 0 ? '+' : ''}
                        {formatCurrency(diff)})
                      </span>
                    </div>
                    {motivo && (
                      <div className="mt-0.5 text-[11px] italic text-slate-600">
                        Motivo: {motivo}
                      </div>
                    )}
                  </li>
                );
              }
              // descuento_linea
              const pct = Number(d.porcentaje ?? 0);
              return (
                <li
                  key={i}
                  className="rounded border border-green-200 bg-white p-2"
                >
                  <div className="font-medium text-green-900">
                    <span className="font-mono text-[10px] text-slate-500">
                      #{codigo}
                    </span>{' '}
                    {nombre} — descuento {pct}%
                  </div>
                  {motivo && (
                    <div className="mt-0.5 text-[11px] italic text-slate-600">
                      Motivo: {motivo}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Anulación, si aplica */}
      {venta.estado === 'anulada' && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-medium">Esta venta fue anulada</div>
          {venta.motivo_anulacion && (
            <div className="mt-1">
              <span className="text-xs">Motivo:</span> {venta.motivo_anulacion}
            </div>
          )}
          <div className="mt-1 text-xs text-red-700">
            {venta.anulada_por && `Por ${empleadoNombre(venta.anulada_por)}`}
            {venta.anulada_en && ` · ${formatDate(venta.anulada_en)}`}
          </div>
        </div>
      )}

      {/* Venta cancelada — carrito armado pero nunca cobrado. */}
      {venta.estado === 'cancelada' && (
        <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">Esta venta fue cancelada</div>
          <div className="mt-1">
            El cajero armó el carrito pero NO se llegó a cobrar. No hay
            descuento de stock ni movimiento de caja. Queda registrada para
            auditoría.
          </div>
        </div>
      )}
    </>
  );
}

export default function VentasPage() {
  return (
    <PaginaProtegida modulo="reportes" accion="ver_local_propio">
      <VentasPageInner />
    </PaginaProtegida>
  );
}
