'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShoppingBag,
  Search,
  Check,
  X,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { PRESET_IDS, type PedidoWeb } from '@comercio/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comercio/ui/dialog';
import { formatCurrency } from '@comercio/ui/utils';
import { PaginaProtegida } from '@/lib/permisos';

type Estado = PedidoWeb['estado'] | 'todos';

const LABEL_ESTADO: Record<PedidoWeb['estado'], string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  anulado: 'Anulado',
};

function VentasMayoristasPageInner() {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  const [estadoFiltro, setEstadoFiltro] = useState<Estado>('todos');
  const [texto, setTexto] = useState('');
  const [pedidoSel, setPedidoSel] = useState<PedidoWeb | null>(null);

  const pedidosQ = useQuery({
    queryKey: ['pedidos-web', estadoFiltro],
    queryFn: () =>
      db.pedidosWeb.list({
        estado: estadoFiltro === 'todos' ? undefined : estadoFiltro,
      }),
    // Refetch cada 30s para levantar pedidos nuevos sin recargar.
    refetchInterval: 30_000,
  });

  const pedidos = useMemo(() => {
    let rows = pedidosQ.data ?? [];
    if (texto.trim()) {
      const t = texto.toLowerCase();
      rows = rows.filter((p) => {
        const c = p.cliente_datos;
        return (
          (c.razon_social ?? '').toLowerCase().includes(t) ||
          (c.contacto ?? '').toLowerCase().includes(t) ||
          (c.telefono ?? '').includes(t) ||
          String(p.numero).includes(t)
        );
      });
    }
    return rows;
  }, [pedidosQ.data, texto]);

  const pendientes = pedidos.filter((p) => p.estado === 'pendiente').length;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
            <ShoppingBag className="h-5 w-5 text-cyan-600" />
            Ventas mayoristas
            {pendientes > 0 && (
              <Badge className="bg-red-500 text-white hover:bg-red-500">
                {pendientes} pendiente{pendientes === 1 ? '' : 's'}
              </Badge>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">
            Pedidos que llegan desde la tienda web mayorista. Revisá,
            aprobá o rechazá cada uno.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ['pedidos-web'] })}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Refrescar
        </Button>
      </div>

      {/* Toolbar filtros */}
      <Card className="mb-4">
        <CardContent className="grid gap-3 p-3 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Buscar por N°, razón social, contacto o teléfono"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-8 pl-7 text-sm"
            />
          </div>
          <div className="flex gap-1 rounded-md border border-slate-300 bg-white p-0.5 text-xs">
            {(['todos', 'pendiente', 'aprobado', 'rechazado'] as const).map((e) => {
              const cant =
                e === 'todos'
                  ? pedidosQ.data?.length
                  : pedidosQ.data?.filter((p) => p.estado === e).length;
              return (
                <button
                  key={e}
                  onClick={() => setEstadoFiltro(e)}
                  className={`rounded px-2 py-0.5 ${
                    estadoFiltro === e
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {e === 'todos'
                    ? 'Todos'
                    : e === 'pendiente'
                      ? 'Pendientes'
                      : e === 'aprobado'
                        ? 'Aprobados'
                        : 'Rechazados'}
                  {cant != null && ` (${cant})`}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Listado */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {pedidos.length} pedido{pedidos.length === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pedidosQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : pedidos.length === 0 ? (
            <p className="rounded border bg-slate-50 py-8 text-center text-sm text-slate-500">
              No hay pedidos con esos filtros.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
                <tr>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">N°</th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">Fecha</th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">Cliente</th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-right">Ítems</th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-right">Total</th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">Estado</th>
                  <th className="border-b border-slate-300 px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const esNuevo = p.estado === 'pendiente';
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setPedidoSel(p)}
                      className={`cursor-pointer border-b border-slate-200 ${
                        esNuevo
                          ? 'bg-amber-50 font-medium hover:bg-amber-100'
                          : 'hover:bg-blue-50/50'
                      }`}
                    >
                      <td className="border-r border-slate-200 px-2 py-1 font-mono">
                        {esNuevo && (
                          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
                        )}
                        #{String(p.numero).padStart(4, '0')}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1 tabular-nums">
                        {new Date(p.creado_en).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1">
                        <div className="font-medium">{p.cliente_datos.razon_social}</div>
                        <div className="text-[10px] text-slate-500">
                          {p.cliente_datos.contacto ?? '—'} · {p.cliente_datos.telefono}
                        </div>
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums">
                        {p.items.length}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1 text-right font-semibold tabular-nums">
                        {formatCurrency(p.total)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1">
                        <EstadoBadge estado={p.estado} />
                      </td>
                      <td className="px-2 py-1 text-right text-[10px] text-slate-500">
                        Ver detalle →
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {pedidoSel && (
        <DetallePedidoDialog
          pedido={pedidoSel}
          onClose={() => setPedidoSel(null)}
          empleadoId={empleado?.id ?? ''}
          onProcesado={() => {
            qc.invalidateQueries({ queryKey: ['pedidos-web'] });
            qc.invalidateQueries({ queryKey: ['pedidos-web-pendientes'] });
          }}
        />
      )}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: PedidoWeb['estado'] }) {
  const map: Record<PedidoWeb['estado'], string> = {
    pendiente: 'border-amber-300 bg-amber-100 text-amber-800',
    aprobado: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    rechazado: 'border-red-300 bg-red-100 text-red-800',
    anulado: 'border-slate-300 bg-slate-100 text-slate-600',
  };
  return (
    <Badge variant="outline" className={map[estado]}>
      {LABEL_ESTADO[estado]}
    </Badge>
  );
}

function DetallePedidoDialog({
  pedido,
  onClose,
  empleadoId,
  onProcesado,
}: {
  pedido: PedidoWeb;
  onClose: () => void;
  empleadoId: string;
  onProcesado: () => void;
}) {
  const db = getDb();
  const [modoRechazar, setModoRechazar] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState('');

  // Para aprobar solo necesitamos el depósito de dónde descontar el
  // stock. NO se crea venta en el PoS ni se necesita caja abierta —
  // los pedidos mayoristas viven en su propio universo (pedidos_web)
  // separado del historial del mostrador. Ver comentario en el repo.
  const depositosQ = useQuery({
    queryKey: ['depositos-para-aprobar'],
    queryFn: () => db.depositos.list(),
    enabled: pedido.estado === 'pendiente',
  });
  const [depositoId, setDepositoId] = useState('');

  // Al cargar, auto-seleccionar el depósito Web (o Central si no hay Web).
  useMemo(() => {
    if (!depositoId && depositosQ.data && depositosQ.data.length > 0) {
      const web = depositosQ.data.find((d) => d.tipo === 'web');
      const central = depositosQ.data.find((d) => d.tipo === 'central');
      setDepositoId(web?.id ?? central?.id ?? depositosQ.data[0]!.id);
    }
  }, [depositosQ.data, depositoId]);

  const aprobarMut = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error('No hay empleado logueado');
      if (!depositoId) throw new Error('Elegí un depósito de dónde descontar');
      await db.pedidosWeb.aprobar({
        pedido_id: pedido.id,
        empleado_id: empleadoId,
        deposito_id: depositoId,
      });
    },
    onSuccess: () => {
      toast.success('Pedido aprobado. Stock descontado.');
      onProcesado();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rechazarMut = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error('No hay empleado logueado');
      if (!motivoRechazo.trim()) throw new Error('Ingresá un motivo de rechazo');
      await db.pedidosWeb.rechazar({
        pedido_id: pedido.id,
        empleado_id: empleadoId,
        motivo: motivoRechazo.trim(),
      });
    },
    onSuccess: () => {
      toast.info('Pedido rechazado.');
      onProcesado();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const puedeActuar = pedido.estado === 'pendiente';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          Pedido #{String(pedido.numero).padStart(4, '0')} ·{' '}
          <EstadoBadge estado={pedido.estado} />
        </DialogTitle>
      </DialogHeader>

      <div className="max-h-[65vh] space-y-3 overflow-y-auto p-2 text-sm">
        {/* Cliente */}
        <div className="rounded border bg-slate-50/60 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase text-slate-600">
            Cliente
          </div>
          <div className="font-semibold">{pedido.cliente_datos.razon_social}</div>
          <div className="mt-0.5 text-xs text-slate-700">
            {pedido.cliente_datos.contacto && (
              <>Contacto: {pedido.cliente_datos.contacto} · </>
            )}
            Tel: {pedido.cliente_datos.telefono}
          </div>
          {pedido.cliente_datos.email && (
            <div className="text-xs text-slate-700">Email: {pedido.cliente_datos.email}</div>
          )}
          {pedido.cliente_datos.cuit && (
            <div className="text-xs text-slate-700">CUIT: {pedido.cliente_datos.cuit}</div>
          )}
          {pedido.cliente_datos.direccion && (
            <div className="text-xs text-slate-700">Dirección: {pedido.cliente_datos.direccion}</div>
          )}
        </div>

        {/* Ítems */}
        <div className="rounded border">
          <div className="border-b bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
            Productos ({pedido.items.length})
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 text-[10px] uppercase text-slate-600">
                <th className="px-2 py-1 text-left">Código</th>
                <th className="px-2 py-1 text-left">Producto</th>
                <th className="px-2 py-1 text-right">Cant.</th>
                <th className="px-2 py-1 text-right">Precio</th>
                <th className="px-2 py-1 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {pedido.items.map((it, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-2 py-1 font-mono">{it.codigo}</td>
                  <td className="px-2 py-1">{it.nombre}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{it.cantidad}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {formatCurrency(it.precio_unitario)}
                  </td>
                  <td className="px-2 py-1 text-right font-medium tabular-nums">
                    {formatCurrency(it.subtotal)}
                  </td>
                </tr>
              ))}
              <tr className="bg-emerald-50 font-bold">
                <td colSpan={4} className="px-2 py-1.5 text-right uppercase text-emerald-800">
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">
                  {formatCurrency(pedido.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Método / entrega / notas */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded border bg-slate-50/60 p-2">
            <div className="text-[10px] uppercase text-slate-600">Método de pago</div>
            <div className="text-sm">{pedido.metodo_pago ?? '—'}</div>
          </div>
          <div className="rounded border bg-slate-50/60 p-2">
            <div className="text-[10px] uppercase text-slate-600">Forma de entrega</div>
            <div className="text-sm">{pedido.forma_entrega ?? '—'}</div>
          </div>
          <div className="rounded border bg-slate-50/60 p-2">
            <div className="text-[10px] uppercase text-slate-600">Notas</div>
            <div className="text-sm">{pedido.notas || '—'}</div>
          </div>
        </div>

        {/* Info si ya está procesado */}
        {pedido.estado === 'aprobado' && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="font-semibold text-emerald-800">
              Pedido aprobado ✓
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              El stock se descontó del depósito elegido. Los movimientos
              quedan en el historial con motivo "Aprobación pedido web
              #{String(pedido.numero).padStart(4, '0')}".
            </div>
          </div>
        )}
        {pedido.estado === 'rechazado' && pedido.motivo_rechazo && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm">
            <div className="font-semibold text-red-800">Pedido rechazado ✗</div>
            <div className="mt-1 text-xs text-red-700">
              Motivo: {pedido.motivo_rechazo}
            </div>
          </div>
        )}

        {/* Acciones (solo si pendiente) */}
        {puedeActuar && !modoRechazar && (
          <div className="rounded border border-slate-300 bg-white p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase text-slate-600">
              Aprobar: crear venta y descontar stock
            </div>
            <div>
              <Label className="mb-1 block text-xs">Descontar stock de</Label>
              <select
                value={depositoId}
                onChange={(e) => setDepositoId(e.target.value)}
                className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm"
              >
                {(depositosQ.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-slate-500">
                Se descuenta el stock del depósito elegido y queda registrado
                como movimiento con motivo "Aprobación pedido web #N".
                No genera venta en el PoS ni requiere caja abierta.
              </p>
            </div>
          </div>
        )}

        {puedeActuar && modoRechazar && (
          <div className="rounded border border-red-300 bg-red-50 p-3">
            <Label className="mb-1 block text-xs uppercase text-red-800">
              Motivo del rechazo
            </Label>
            <Input
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
              placeholder="Ej: sin stock disponible, cliente no responde, etc."
              autoFocus
            />
          </div>
        )}
      </div>

      <DialogFooter>
        {puedeActuar ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cerrar
            </Button>
            {modoRechazar ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModoRechazar(false)}
                >
                  Volver
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => rechazarMut.mutate()}
                  disabled={rechazarMut.isPending || !motivoRechazo.trim()}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Confirmar rechazo
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModoRechazar(true)}
                  className="text-red-700 hover:bg-red-50"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Rechazar
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (
                      confirm(
                        `¿Aprobar este pedido?\n\nSe va a crear una venta por ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(pedido.total)} y descontar ${pedido.items.length} producto(s) del stock del depósito elegido.`,
                      )
                    ) {
                      aprobarMut.mutate();
                    }
                  }}
                  disabled={aprobarMut.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Aprobar
                </Button>
              </>
            )}
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

export default function VentasMayoristasPage() {
  return (
    <PaginaProtegida modulo="reportes" accion="ver_local_propio">
      <VentasMayoristasPageInner />
    </PaginaProtegida>
  );
}

// PRESET_IDS import for consistency
void PRESET_IDS;
