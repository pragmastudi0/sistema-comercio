'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Plus, Send, CheckCircle2, X, Trash2, Pencil } from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { PaginaProtegida, RequierePermiso } from '@/lib/permisos';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { formatDate } from '@comercio/ui/utils';
import type { Transferencia } from '@comercio/db';

const ESTADO_COLOR: Record<Transferencia['estado'], 'default' | 'secondary' | 'destructive'> = {
  borrador: 'secondary',
  emitida: 'default',
  recibida: 'secondary',
  anulada: 'destructive',
};

function TransferenciasPageInner() {
  const db = getDb();
  const qc = useQueryClient();
  const empleadoId = useSesion((s) => s.empleado?.id) ?? '';
  const transferenciasQ = useQuery({
    queryKey: ['transferencias'],
    queryFn: () => db.transferencias.list(),
  });
  const depositosQ = useQuery({ queryKey: ['depositos'], queryFn: () => db.depositos.list() });
  const productosQ = useQuery({ queryKey: ['productos-all'], queryFn: () => db.productos.list() });

  const [openNueva, setOpenNueva] = useState(false);
  const [editando, setEditando] = useState<Transferencia | null>(null);

  const emitirMut = useMutation({
    mutationFn: (id: string) => db.transferencias.emitir(id, empleadoId),
    onSuccess: () => {
      toast.success('Transferencia emitida');
      qc.invalidateQueries({ queryKey: ['transferencias'] });
      qc.invalidateQueries({ queryKey: ['stock-consolidado'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const recibirMut = useMutation({
    mutationFn: (id: string) => db.transferencias.recibir(id, empleadoId),
    onSuccess: () => {
      toast.success('Transferencia recibida');
      qc.invalidateQueries({ queryKey: ['transferencias'] });
      qc.invalidateQueries({ queryKey: ['stock-consolidado'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const anularMut = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      db.transferencias.anular(id, empleadoId, motivo),
    onSuccess: () => {
      toast.success('Transferencia anulada');
      qc.invalidateQueries({ queryKey: ['transferencias'] });
      qc.invalidateQueries({ queryKey: ['stock-consolidado'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const borrarMut = useMutation({
    mutationFn: (id: string) => db.transferencias.delete(id),
    onSuccess: () => {
      toast.success('Transferencia eliminada');
      qc.invalidateQueries({ queryKey: ['transferencias'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const depNombre = (id: string) =>
    depositosQ.data?.find((d) => d.id === id)?.nombre ?? id;
  const prodNombre = (id: string) =>
    productosQ.data?.find((p) => p.id === id)?.nombre ?? id;

  const transferencias = (transferenciasQ.data ?? []).slice().reverse();

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Transferencias</h1>
          <p className="text-sm text-muted-foreground">
            Movimiento de stock entre locales. Flujo: borrador → emitida (descuenta de origen) →
            recibida (suma en destino).
          </p>
        </div>
        <RequierePermiso modulo="stock" accion="transferir">
          <Button onClick={() => setOpenNueva(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Nueva transferencia
          </Button>
        </RequierePermiso>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {transferenciasQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : transferencias.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay transferencias registradas. Creá la primera con el botón de arriba.
            </p>
          ) : (
            <div className="space-y-3">
              {transferencias.map((t) => (
                <div key={t.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{depNombre(t.deposito_origen_id)}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{depNombre(t.deposito_destino_id)}</span>
                      <Badge variant={ESTADO_COLOR[t.estado]}>{t.estado}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(t.creada_en)} · #{t.id.slice(-6)}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t.items.map((it, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        {it.cantidad}× {prodNombre(it.producto_id)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    {t.estado === 'borrador' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => emitirMut.mutate(t.id)}
                          disabled={emitirMut.isPending}
                        >
                          <Send className="mr-1 h-3 w-3" />
                          Emitir (descuenta origen)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditando(t)}
                          title="Editar borrador"
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Editar
                        </Button>
                      </>
                    )}
                    {t.estado === 'emitida' && (
                      <Button
                        size="sm"
                        onClick={() => recibirMut.mutate(t.id)}
                        disabled={recibirMut.isPending}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Recibir (suma destino)
                      </Button>
                    )}
                    {(t.estado === 'borrador' || t.estado === 'emitida') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const motivo = prompt('Motivo de anulación:');
                          if (motivo) anularMut.mutate({ id: t.id, motivo });
                        }}
                        disabled={anularMut.isPending}
                        className="text-destructive"
                      >
                        <X className="mr-1 h-3 w-3" />
                        Anular
                      </Button>
                    )}
                    {(t.estado === 'borrador' || t.estado === 'anulada') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (
                            confirm(
                              `¿Borrar definitivamente esta transferencia (${t.estado})?`,
                            )
                          ) {
                            borrarMut.mutate(t.id);
                          }
                        }}
                        disabled={borrarMut.isPending}
                        className="text-destructive"
                        title="Borrar transferencia"
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Borrar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TransferenciaDialog
        open={openNueva || !!editando}
        onClose={() => {
          setOpenNueva(false);
          setEditando(null);
        }}
        transferencia={editando}
      />
    </div>
  );
}

function TransferenciaDialog({
  open,
  onClose,
  transferencia,
}: {
  open: boolean;
  onClose: () => void;
  /** Si se pasa, el dialog edita ese borrador. Si no, crea uno nuevo. */
  transferencia?: Transferencia | null;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const depositosQ = useQuery({ queryKey: ['depositos'], queryFn: () => db.depositos.list() });
  const productosQ = useQuery({
    queryKey: ['productos-all'],
    queryFn: () => db.productos.list({ activo: true }),
  });

  const editando = !!transferencia;

  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [items, setItems] = useState<{ producto_id: string; cantidad: number }[]>([
    { producto_id: '', cantidad: 1 },
  ]);

  // Precargar valores al abrir en modo edición.
  useEffect(() => {
    if (open) {
      if (transferencia) {
        setOrigenId(transferencia.deposito_origen_id);
        setDestinoId(transferencia.deposito_destino_id);
        setItems(
          transferencia.items.length
            ? transferencia.items.map((it) => ({
                producto_id: it.producto_id,
                cantidad: it.cantidad,
              }))
            : [{ producto_id: '', cantidad: 1 }],
        );
      } else {
        setOrigenId('');
        setDestinoId('');
        setItems([{ producto_id: '', cantidad: 1 }]);
      }
    }
  }, [open, transferencia]);

  const guardarMut = useMutation({
    mutationFn: () => {
      if (!origenId || !destinoId) throw new Error('Elegí origen y destino');
      if (origenId === destinoId) throw new Error('Origen y destino deben ser distintos');
      const validos = items.filter((i) => i.producto_id && i.cantidad > 0);
      if (validos.length === 0) throw new Error('Agregá al menos un producto');
      if (editando && transferencia) {
        return db.transferencias.actualizarBorrador(transferencia.id, {
          deposito_origen_id: origenId,
          deposito_destino_id: destinoId,
          items: validos,
        });
      }
      return db.transferencias.crearBorrador({
        deposito_origen_id: origenId,
        deposito_destino_id: destinoId,
        items: validos,
      });
    },
    onSuccess: () => {
      toast.success(editando ? 'Cambios guardados' : 'Transferencia creada como borrador');
      qc.invalidateQueries({ queryKey: ['transferencias'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function actualizarItem(idx: number, patch: Partial<{ producto_id: string; cantidad: number }>) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  return (
    <Dialog open={open} onOpenChange={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editando ? 'Editar transferencia' : 'Nueva transferencia'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1 block">Origen</Label>
            <select
              value={origenId}
              onChange={(e) => setOrigenId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Elegir —</option>
              {(depositosQ.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-1 block">Destino</Label>
            <select
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Elegir —</option>
              {(depositosQ.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label className="mb-1 block">Productos a transferir</Label>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_100px_auto] gap-2">
                <select
                  value={item.producto_id}
                  onChange={(e) => actualizarItem(idx, { producto_id: e.target.value })}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Elegir producto —</option>
                  {(productosQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo_interno} · {p.nombre}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="1"
                  value={item.cantidad}
                  onChange={(e) => actualizarItem(idx, { cantidad: parseInt(e.target.value) || 1 })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setItems([...items, { producto_id: '', cantidad: 1 }])}
          >
            <Plus className="mr-1 h-3 w-3" />
            Agregar producto
          </Button>
        </div>

        <p className="rounded bg-muted/30 p-2 text-xs text-muted-foreground">
          Se crea como borrador. Después podés emitirla (descuenta de origen) y luego
          recibirla en destino.
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => guardarMut.mutate()} disabled={guardarMut.isPending}>
          {guardarMut.isPending
            ? editando
              ? 'Guardando…'
              : 'Creando…'
            : editando
              ? 'Guardar cambios'
              : 'Crear borrador'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default function TransferenciasPage() {
  return (
    <PaginaProtegida modulo="stock" accion="transferir">
      <TransferenciasPageInner />
    </PaginaProtegida>
  );
}
