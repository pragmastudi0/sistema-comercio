import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PRESET_IDS } from '@comercio/db';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comercio/ui/dialog';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency, formatDate } from '@comercio/ui/utils';
import { Printer, ArrowLeft, Ban, RefreshCw } from 'lucide-react';
import { ModalCambio } from '@/components/ModalCambio';

const LABEL_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
  cta_cte: 'Cuenta corriente',
};

export function Ticket() {
  const { id } = useParams();
  const navigate = useNavigate();
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  const [cambioOpen, setCambioOpen] = useState(false);
  const [anularOpen, setAnularOpen] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState('');

  const ventaQ = useQuery({
    queryKey: ['venta', id],
    queryFn: () => (id ? db.ventas.get(id) : Promise.resolve(null)),
    enabled: !!id,
  });

  const anularMut = useMutation({
    mutationFn: async () => {
      if (!id || !empleado) throw new Error('Sesión inválida');
      const m = motivoAnular.trim();
      if (m.length < 3) throw new Error('Indicá un motivo (mínimo 3 caracteres).');
      return db.ventas.anular(id, empleado.id, m);
    },
    onSuccess: () => {
      toast.success('Venta anulada. El stock vuelve al local.');
      setAnularOpen(false);
      setMotivoAnular('');
      qc.invalidateQueries({ queryKey: ['venta', id] });
      qc.invalidateQueries({ queryKey: ['ventas-sesion'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const productosQ = useQuery({ queryKey: ['productos-all'], queryFn: () => db.productos.list() });
  const configQ = useQuery({
    queryKey: ['config-ticket'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });
  const empleadosQ = useQuery({ queryKey: ['empleados-ticket'], queryFn: () => db.empleados.list() });

  // Logs de auditoría `cambio_venta` de los últimos 30 días, para
  // detectar si ESTA venta participó de un cambio (como original o
  // como nueva) y mostrar el detalle abajo. Antes del PR, el cajero
  // abría el ticket y solo veía la venta base — no había forma de
  // saber que había habido un cambio ni qué se devolvió/llevó.
  const desdeAudit = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  })();
  const auditoriaCambiosQ = useQuery({
    queryKey: ['pos-ticket-auditoria-cambios', desdeAudit],
    queryFn: () =>
      db.auditoria.list({ entidad: 'venta', desde: desdeAudit }),
  });
  type CambioInfo = {
    venta_original_id: string;
    nc_id: string | null;
    nc_numero: string | null;
    venta_nueva_id: string | null;
    venta_nueva_numero: string | null;
    total_devuelto: number;
    total_nuevo: number;
    diferencia_cobrada: number;
    metodo_diferencia: string | null;
    fecha: string;
  };
  const { cambioComoOriginal, cambioComoNueva } = (() => {
    let original: CambioInfo | null = null;
    let nueva: CambioInfo | null = null;
    for (const log of auditoriaCambiosQ.data ?? []) {
      if (log.accion !== 'cambio_venta' || !log.entidad_id) continue;
      const d = (log.detalle ?? {}) as Record<string, unknown>;
      const info: CambioInfo = {
        venta_original_id: log.entidad_id,
        nc_id: (d.nc_id as string | null) ?? null,
        nc_numero: (d.nc_numero as string | null) ?? null,
        venta_nueva_id: (d.venta_nueva_id as string | null) ?? null,
        venta_nueva_numero: (d.venta_nueva_numero as string | null) ?? null,
        total_devuelto:
          typeof d.total_devuelto === 'number' ? d.total_devuelto : 0,
        total_nuevo: typeof d.total_nuevo === 'number' ? d.total_nuevo : 0,
        diferencia_cobrada:
          typeof d.diferencia_cobrada === 'number' ? d.diferencia_cobrada : 0,
        metodo_diferencia: (d.metodo_diferencia as string | null) ?? null,
        fecha: log.fecha,
      };
      if (log.entidad_id === id) original = info;
      if (info.venta_nueva_id === id) nueva = info;
    }
    return { cambioComoOriginal: original, cambioComoNueva: nueva };
  })();

  // Detalles de las ventas/NC relacionadas por el cambio. Los mostramos
  // en los banners ámbar (qué se devolvió, qué se llevó).
  const ncQ = useQuery({
    queryKey: ['pos-ticket-nc', cambioComoOriginal?.nc_id],
    queryFn: () =>
      cambioComoOriginal?.nc_id
        ? db.notasCredito.get(cambioComoOriginal.nc_id)
        : Promise.resolve(null),
    enabled: !!cambioComoOriginal?.nc_id,
  });
  const ventaNuevaQ = useQuery({
    queryKey: ['pos-ticket-venta-nueva', cambioComoOriginal?.venta_nueva_id],
    queryFn: () =>
      cambioComoOriginal?.venta_nueva_id
        ? db.ventas.get(cambioComoOriginal.venta_nueva_id)
        : Promise.resolve(null),
    enabled: !!cambioComoOriginal?.venta_nueva_id,
  });
  const ventaOrigQ = useQuery({
    queryKey: ['pos-ticket-venta-orig', cambioComoNueva?.venta_original_id],
    queryFn: () =>
      cambioComoNueva?.venta_original_id
        ? db.ventas.get(cambioComoNueva.venta_original_id)
        : Promise.resolve(null),
    enabled: !!cambioComoNueva?.venta_original_id,
  });
  const ncNuevaQ = useQuery({
    queryKey: ['pos-ticket-nc-nueva', cambioComoNueva?.nc_id],
    queryFn: () =>
      cambioComoNueva?.nc_id
        ? db.notasCredito.get(cambioComoNueva.nc_id)
        : Promise.resolve(null),
    enabled: !!cambioComoNueva?.nc_id,
  });

  // El auto-print al cobrar fue removido a pedido del cliente: el cajero
  // imprime SOLO si lo necesita, apretando el botón "Imprimir" en el
  // header. Evita el popup molesto en cada venta.

  if (ventaQ.isLoading) {
    return (
      <main className="container mx-auto max-w-xl p-6">
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }
  const venta = ventaQ.data;
  if (!venta) {
    return (
      <main className="container mx-auto max-w-xl p-6">
        <p>Venta no encontrada.</p>
        <Link to="/caja" className="underline">
          Volver
        </Link>
      </main>
    );
  }

  const nombre = (productoId: string) =>
    productosQ.data?.find((p) => p.id === productoId)?.nombre ?? '—';
  const codigo = (productoId: string) =>
    productosQ.data?.find((p) => p.id === productoId)?.codigo_interno ?? '—';

  // El cajero puede anular CUALQUIER venta del día del sistema. Antes se
  // requería que la venta fuera "propia" (venta.empleado_id === empleado.id),
  // pero en la práctica todos operan sobre la sesión que quedó logueada
  // en el PoS, así que las ventas quedan atribuidas al usuario logueado
  // aunque físicamente las haya cobrado otro cajero. Con la regla vieja,
  // si Andrés llega y quiere anular una venta que en el sistema figura
  // hecha por Susana (aunque él la haya cobrado), no podía. Ahora sí.
  // La anulación queda registrada en auditoría con el empleado que la
  // anuló, así que hay trazabilidad completa.
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);
  const esAnulableHoy =
    !!empleado &&
    venta.estado === 'completada' &&
    new Date(venta.fecha) >= inicioDelDia;

  // El cambio está habilitado si la venta es de los últimos 2 días y está
  // completada. Política Turisteando: 2 días de garantía para cambios por
  // rotura/falla. NO requiere que sea del mismo cajero — cualquier cajero
  // del local puede atender el cambio.
  const haceDosDias = new Date();
  haceDosDias.setHours(0, 0, 0, 0);
  haceDosDias.setDate(haceDosDias.getDate() - 1);
  const esCambiable =
    venta.estado === 'completada' && new Date(venta.fecha) >= haceDosDias;

  return (
    <>
      <header className="no-print border-b bg-background">
        <div className="container mx-auto flex h-14 items-center justify-between gap-2 px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/caja')}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Nueva venta
          </Button>
          <div className="flex gap-2">
            {esCambiable && (
              <Button
                variant="outline"
                size="sm"
                className="border-primary/40"
                onClick={() => setCambioOpen(true)}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Cambio
              </Button>
            )}
            {esAnulableHoy && (
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setAnularOpen(true)}
              >
                <Ban className="mr-1 h-4 w-4" />
                Anular
              </Button>
            )}
            <Button onClick={() => window.print()} size="sm">
              <Printer className="mr-1 h-4 w-4" />
              Imprimir
            </Button>
          </div>
        </div>
      </header>

      <ModalCambio
        venta={venta}
        open={cambioOpen}
        onOpenChange={setCambioOpen}
      />

      <Dialog open={anularOpen} onOpenChange={setAnularOpen}>
        <DialogHeader>
          <DialogTitle>¿Anular venta {venta.numero}?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Se devuelve el stock al local y se registra un contramovimiento
            por <b>{formatCurrency(venta.total)}</b> en la caja. Queda en el
            historial con tu nombre y el motivo. <b>No se puede deshacer.</b>
          </p>
        </DialogHeader>
        <div>
          <Label htmlFor="motivo-anular">Motivo</Label>
          <Input
            id="motivo-anular"
            value={motivoAnular}
            onChange={(e) => setMotivoAnular(e.target.value)}
            placeholder="Ej: cliente se arrepintió, ítem mal cobrado"
            className="mt-1"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setAnularOpen(false)}
            disabled={anularMut.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => anularMut.mutate()}
            disabled={anularMut.isPending || motivoAnular.trim().length < 3}
          >
            {anularMut.isPending ? 'Anulando…' : 'Sí, anular venta'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Detalle de venta — pasamos del estilo "ticket de papel" a una
          vista limpia con tabla, según pedido del cliente. El cajero rara
          vez imprime: lo que necesita es ver los productos vendidos para
          atender un cambio o decidir anular. El botón "Imprimir" sigue
          arriba por si lo necesitan en algún caso. */}
      <main className="container mx-auto max-w-3xl px-4 py-6 print:max-w-none print:p-2">
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          {/* Header: venta # + fecha + cajero + estado */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Venta</div>
              <div className="text-lg font-semibold tabular-nums">{venta.numero}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatDate(venta.fecha)}
                {(() => {
                  const emp = empleadosQ.data?.find((e) => e.id === venta.empleado_id);
                  return emp ? ` · Cajero: ${emp.nombre} ${emp.apellido}` : '';
                })()}
              </div>
            </div>
            {venta.estado === 'anulada' && (
              <div className="rounded border-2 border-destructive px-3 py-1 text-sm font-bold uppercase tracking-wider text-destructive">
                Anulada
              </div>
            )}
            {venta.estado === 'presupuesto' && (
              <div className="rounded border-2 border-amber-500 px-3 py-1 text-sm font-bold uppercase tracking-wider text-amber-700">
                Presupuesto
              </div>
            )}
          </div>

          {/* Banner de cambio — esta venta es la ORIGINAL que tuvo un
              cambio. Muestra qué NC se emitió, qué venta nueva se hizo
              y con qué método se cobró la diferencia, más las tablas
              de productos devueltos y llevados. */}
          {cambioComoOriginal && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">
                Esta venta tuvo un cambio el {formatDate(cambioComoOriginal.fecha)}
              </div>
              <div className="mt-1.5 grid gap-0.5 text-xs">
                <div>
                  <span className="text-amber-700">Se devolvió:</span>{' '}
                  <span className="font-medium tabular-nums">
                    {formatCurrency(cambioComoOriginal.total_devuelto)}
                  </span>
                  {cambioComoOriginal.nc_numero && (
                    <>
                      {' '}vía NC{' '}
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
                          <Link
                            to={`/ticket/${cambioComoOriginal.venta_nueva_id}`}
                            className="font-mono underline hover:text-amber-950"
                          >
                            #{cambioComoOriginal.venta_nueva_numero}
                          </Link>
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
                              {LABEL_METODO[cambioComoOriginal.metodo_diferencia] ??
                                cambioComoOriginal.metodo_diferencia}
                            </span>
                          </>
                        )}
                      </div>
                    ) : cambioComoOriginal.total_nuevo <
                      cambioComoOriginal.total_devuelto ? (
                      <div className="italic text-amber-700">
                        Quedó saldo a favor del cliente (política Turisteando:
                        no se devuelve plata).
                      </div>
                    ) : (
                      <div className="italic text-amber-700">Cambio exacto.</div>
                    )}
                  </>
                ) : (
                  <div className="italic text-amber-700">
                    Devolución sin reemplazo.
                  </div>
                )}
              </div>
              {ncQ.data && ncQ.data.items.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Productos devueltos
                  </div>
                  <TablaItemsMin
                    items={ncQ.data.items}
                    productoInfo={(pid) => ({
                      codigo: codigo(pid),
                      nombre: nombre(pid),
                    })}
                  />
                </div>
              )}
              {ventaNuevaQ.data && ventaNuevaQ.data.items.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Productos llevados (venta #
                    {cambioComoOriginal.venta_nueva_numero ?? ''})
                  </div>
                  <TablaItemsMin
                    items={ventaNuevaQ.data.items}
                    productoInfo={(pid) => ({
                      codigo: codigo(pid),
                      nombre: nombre(pid),
                    })}
                  />
                </div>
              )}
            </div>
          )}

          {/* Banner de cambio — esta venta es la NUEVA (la diferencia
              cobrada tras un cambio). Le decimos al cajero que no es
              un ingreso normal. */}
          {cambioComoNueva && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">
                Esta venta es la diferencia de un cambio
                {ventaOrigQ.data && (
                  <>
                    {' '}sobre la venta{' '}
                    <Link
                      to={`/ticket/${cambioComoNueva.venta_original_id}`}
                      className="font-mono underline hover:text-amber-950"
                    >
                      #{ventaOrigQ.data.numero}
                    </Link>
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
                . Acá se registra sólo la diferencia.
              </div>
              {ventaOrigQ.data && ventaOrigQ.data.items.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Compra original ({formatDate(ventaOrigQ.data.fecha)})
                  </div>
                  <TablaItemsMin
                    items={ventaOrigQ.data.items}
                    productoInfo={(pid) => ({
                      codigo: codigo(pid),
                      nombre: nombre(pid),
                    })}
                  />
                </div>
              )}
              {ncNuevaQ.data && ncNuevaQ.data.items.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Productos devueltos
                  </div>
                  <TablaItemsMin
                    items={ncNuevaQ.data.items}
                    productoInfo={(pid) => ({
                      codigo: codigo(pid),
                      nombre: nombre(pid),
                    })}
                  />
                </div>
              )}
            </div>
          )}

          {/* Tabla de productos vendidos */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((it, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">
                      {codigo(it.producto_id)}
                    </td>
                    <td className="px-3 py-2">{nombre(it.producto_id)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {it.cantidad}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(it.precio_unitario)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(it.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Resumen + pagos en columnas paralelas en pantallas medianas+ */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 text-sm">
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Resumen
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(venta.subtotal)}</span>
              </div>
              {venta.descuento_total > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Descuento</span>
                  <span className="tabular-nums">
                    -{formatCurrency(venta.descuento_total)}
                  </span>
                </div>
              )}
              {venta.recargo_total > 0 && (
                <div className="flex justify-between text-orange-700">
                  <span>Recargo</span>
                  <span className="tabular-nums">
                    +{formatCurrency(venta.recargo_total)}
                  </span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(venta.total)}</span>
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Pagos
              </div>
              {venta.pagos.map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {LABEL_METODO[p.metodo] ?? p.metodo}
                    {p.cuotas ? ` (${p.cuotas} cuotas)` : ''}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(p.monto)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </>
  );
}

/**
 * Mini-tabla reutilizable para los banners de "cambio": productos
 * devueltos, compra original, productos llevados. Compacta y sin
 * overflow horizontal — dentro del banner ámbar, no debería crecer
 * horizontalmente aunque haya nombres largos.
 */
function TablaItemsMin({
  items,
  productoInfo,
}: {
  items: Array<{ producto_id: string; cantidad: number; precio_unitario: number; subtotal?: number }>;
  productoInfo: (pid: string) => { codigo: string; nombre: string };
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-amber-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-amber-100/60 text-[10px] uppercase text-amber-800">
          <tr>
            <th className="px-2 py-1 text-left">Código</th>
            <th className="px-2 py-1 text-left">Producto</th>
            <th className="px-2 py-1 text-right">Cant.</th>
            <th className="px-2 py-1 text-right">Precio</th>
            <th className="px-2 py-1 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const info = productoInfo(it.producto_id);
            const subtotal = it.subtotal ?? it.cantidad * it.precio_unitario;
            return (
              <tr key={i} className="border-t border-amber-100">
                <td className="px-2 py-1 font-mono text-[10px] text-slate-600">
                  {info.codigo}
                </td>
                <td className="px-2 py-1">{info.nombre}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {it.cantidad}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatCurrency(it.precio_unitario)}
                </td>
                <td className="px-2 py-1 text-right font-medium tabular-nums">
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
