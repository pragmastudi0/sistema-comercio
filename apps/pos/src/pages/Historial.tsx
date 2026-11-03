import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, Receipt, RefreshCw } from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Skeleton } from '@comercio/ui/skeleton';
import { Badge } from '@comercio/ui/badge';
import { formatCurrency } from '@comercio/ui/utils';

// Turnos del local — mañana 7-15, tarde 15-23. Fuera de ese rango
// (madrugada) lo metemos en "tarde" del día anterior para no crear
// un tercer grupo "noche" que confunde.
function turnoDe(fecha: Date): 'mañana' | 'tarde' {
  const h = fecha.getHours();
  return h >= 7 && h < 15 ? 'mañana' : 'tarde';
}
function labelTurno(turno: 'mañana' | 'tarde', fecha: Date): string {
  const dia = fecha.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
  return `Turno ${turno} · ${dia}`;
}

const LABEL_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
  cta_cte: 'Cta corriente',
};

/**
 * Historial de ventas de las últimas 48 horas del LOCAL del cajero.
 * Sirve para hacer cambios (Turisteando maneja 2 días de garantía).
 * No filtra por cajero — todos los cajeros del mismo local ven todas
 * las ventas para poder atender un cambio aunque otro cajero la haya
 * registrado.
 */
export function Historial() {
  const navigate = useNavigate();
  const db = getDb();
  const caja = useSesion((s) => s.caja);
  const [filtro, setFiltro] = useState('');

  const desde = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1); // ayer 00:00
    return d.toISOString();
  }, []);

  const ventasQ = useQuery({
    queryKey: ['pos-historial-48h', caja?.local_id, desde],
    queryFn: () =>
      caja
        ? db.ventas.list({ local_id: caja.local_id, desde })
        : Promise.resolve([]),
    enabled: !!caja,
    // 60s en vez de 30s. El Sheet suele estar CERRADO la mayor parte
    // del turno — no hace falta mantener el histórico de 48h fresco
    // cada 30s. Al abrir el Sheet queda expuesto y se puede refrescar
    // con el pull-to-refresh nativo si Agus lo necesita al instante.
    refetchInterval: 60_000,
  });

  const empleadosQ = useQuery({ queryKey: ['empleados'], queryFn: () => db.empleados.list() });

  // Logs de auditoría para detectar ventas con cambio en el rango. Misma
  // lógica que en /admin/ventas: cualquier venta que aparezca como original
  // o como nueva en un log `cambio_venta` queda marcada con badge "Cambio"
  // para que la cajera sepa que esa venta ya tuvo movimiento.
  const auditoriaQ = useQuery({
    queryKey: ['pos-historial-auditoria-cambios', desde],
    queryFn: () =>
      db.auditoria.list({
        entidad: 'venta',
        desde,
      }),
    enabled: !!caja,
  });
  const ventasConCambio = useMemo(() => {
    const set = new Set<string>();
    for (const log of auditoriaQ.data ?? []) {
      if (log.accion !== 'cambio_venta') continue;
      // entidad_id = venta original; detalle.venta_nueva_id = venta de la diferencia.
      if (log.entidad_id) set.add(log.entidad_id);
      const nueva = (log.detalle as { venta_nueva_id?: string } | null)?.venta_nueva_id;
      if (nueva) set.add(nueva);
    }
    return set;
  }, [auditoriaQ.data]);
  // Items con precio editado por el cajero (logs `precio_editado`).
  // Sirve para resaltar el precio en color en el historial.
  const itemsConPrecioEditado = useMemo(() => {
    const set = new Set<string>();
    for (const log of auditoriaQ.data ?? []) {
      if (log.accion !== 'precio_editado' || !log.entidad_id) continue;
      const productoId = (log.detalle as { producto_id?: string } | null)?.producto_id;
      if (productoId) set.add(`${log.entidad_id}::${productoId}`);
    }
    return set;
  }, [auditoriaQ.data]);
  const empleadoNombre = (id: string) => {
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido}` : '—';
  };

  // Catálogo de productos (para buscar por código y mostrar nombre en cada
  // venta). Tener todo en memoria es OK porque ya está cacheado.
  const productosQ = useQuery({
    queryKey: ['productos-all'],
    queryFn: () => db.productos.list(),
  });
  const productoPorId = (id: string) =>
    productosQ.data?.find((p) => p.id === id);

  // Orden y filtro en memoria. La búsqueda mira número de ticket, cajero
  // y código/nombre de cualquier producto incluido en la venta — así el
  // cajero puede encontrar la venta de "tal producto" sin recordar el
  // número. La lista llega de Supabase ya DESC (más reciente primero),
  // no la invertimos.
  const ventas = useMemo(() => {
    const lista = ventasQ.data ?? [];
    const q = filtro.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((v) => {
      if (v.numero.toLowerCase().includes(q)) return true;
      if (empleadoNombre(v.empleado_id).toLowerCase().includes(q)) return true;
      // Buscar por código o nombre de cualquier producto vendido.
      for (const it of v.items) {
        const p = productoPorId(it.producto_id);
        if (!p) continue;
        if (p.codigo_interno.toLowerCase().includes(q)) return true;
        if (p.nombre.toLowerCase().includes(q)) return true;
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventasQ.data, filtro, empleadosQ.data, productosQ.data]);

  if (!caja) {
    navigate('/abrir-caja');
    return null;
  }

  return (
    <main className="container mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/caja')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver
        </Button>
        <h1 className="text-lg font-semibold sm:text-xl">Historial de 48 horas</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => ventasQ.refetch()}
          title="Refrescar"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </header>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Número de ticket, cajero, código o nombre de producto"
            className="h-11 pl-10 text-base"
            autoFocus
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Ventas del local <b>{caja.nombre}</b> de los últimos 2 días. Sirve
          para atender devoluciones y cambios.
        </p>
      </div>

      {ventasQ.isLoading ? (
        <Skeleton className="h-64" />
      ) : ventas.length === 0 ? (
        <div className="rounded-md border bg-muted/30 py-16 text-center text-muted-foreground">
          <Receipt className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>Sin ventas en el rango.</p>
        </div>
      ) : (
        // Vista producto × producto: una fila por ítem, agrupada
        // visualmente por venta. Filas alternan banda gris/blanca por
        // venta para que se vea que pertenecen al mismo ticket. Click
        // en cualquier fila lleva al detalle del ticket (cambios/anular).
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2 text-left">Pago</th>
                <th className="px-3 py-2 text-left">Hora</th>
                <th className="px-3 py-2 text-left">Cajero</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v, vIdx) => {
                const fecha = new Date(v.fecha);
                const horaTxt = fecha.toLocaleString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const metodos = Array.from(new Set(v.pagos.map((p) => p.metodo)))
                  .map((m) => LABEL_METODO[m] ?? m)
                  .join(' + ');
                const anulada = v.estado === 'anulada';
                const tuvoCambio = ventasConCambio.has(v.id);

                // Separador de turno: cada vez que cambia día o turno
                // mostramos una fila grande tipo "Turno mañana · lunes 30/06".
                // El historial viene ordenado por fecha (desc por default),
                // así que comparamos contra la venta anterior del map.
                const turno = turnoDe(fecha);
                const grupo = `${fecha.toDateString()}-${turno}`;
                const fechaPrev = vIdx > 0 ? new Date(ventas[vIdx - 1]!.fecha) : null;
                const grupoPrev = fechaPrev
                  ? `${fechaPrev.toDateString()}-${turnoDe(fechaPrev)}`
                  : null;
                const cambioDeTurno = grupo !== grupoPrev;
                // Bandeo alternado por venta: ventas pares un color,
                // impares otro, así el cajero ve qué filas son la misma.
                // Si tuvo cambio, banda ámbar para distinguirla a la vista.
                const bandColor = tuvoCambio
                  ? 'bg-amber-50'
                  : vIdx % 2 === 0
                    ? 'bg-card'
                    : 'bg-muted/30';
                return (
                <Fragment key={`grupo-${v.id}`}>
                {cambioDeTurno && (
                  <tr>
                    <td
                      colSpan={7}
                      className="border-y-2 border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary"
                    >
                      {labelTurno(turno, fecha)}
                    </td>
                  </tr>
                )}
                {v.items.map((it, idx) => {
                  const p = productoPorId(it.producto_id);
                  const esPrimera = idx === 0;
                  const precioEditado = itemsConPrecioEditado.has(
                    `${v.id}::${it.producto_id}`,
                  );
                  return (
                    <tr
                      key={`${v.id}-${idx}`}
                      onClick={() => navigate(`/ticket/${v.id}`)}
                      className={`cursor-pointer border-b border-border/50 hover:bg-accent/40 ${bandColor} ${
                        anulada ? 'opacity-50' : ''
                      } ${esPrimera ? 'border-t-2 border-t-foreground/20' : ''}`}
                      title={
                        tuvoCambio
                          ? 'Esta venta tuvo un cambio. Click: ver detalle.'
                          : 'Click: ver ticket completo / cambios / anular'
                      }
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {p?.codigo_interno ?? '—'}
                      </td>
                      <td className={`px-3 py-2 ${anulada ? 'line-through' : ''}`}>
                        <span className="inline-flex items-center gap-1">
                          {p?.nombre ?? 'Producto borrado'}
                          {esPrimera && anulada && (
                            <Badge variant="destructive">Anul.</Badge>
                          )}
                          {esPrimera && tuvoCambio && (
                            <Badge
                              variant="outline"
                              className="border-amber-400 bg-amber-100 text-amber-800"
                            >
                              Cambio
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {it.cantidad}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          precioEditado
                            ? 'font-semibold text-orange-700 bg-orange-50'
                            : ''
                        }`}
                        title={precioEditado ? 'Precio modificado en la venta' : undefined}
                      >
                        {formatCurrency(it.precio_unitario)}
                        {precioEditado && <span className="ml-1 text-[10px]">●</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {esPrimera ? metodos : ''}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {esPrimera ? horaTxt : ''}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {esPrimera ? empleadoNombre(v.empleado_id) : ''}
                      </td>
                    </tr>
                  );
                })}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
