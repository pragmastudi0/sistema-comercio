import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Receipt } from 'lucide-react';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { formatCurrency } from '@comercio/ui/utils';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import type { Venta } from '@comercio/db';

export function ModalNotaCredito({
  venta,
  open,
  onOpenChange,
  onEmitida,
}: {
  venta: Venta | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEmitida?: (notaId: string) => void;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);

  const productosQ = useQuery({
    queryKey: ['productos-nc'],
    queryFn: () => db.productos.list(),
  });

  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (open && venta) {
      // Por default, todos los items con cantidad 0 (cajero elige cuáles devolver)
      const init: Record<string, number> = {};
      for (const it of venta.items) init[it.producto_id] = 0;
      setCantidades(init);
      setMotivo('');
    }
  }, [open, venta]);

  const itemsConCantidad = venta
    ? venta.items.filter((it) => (cantidades[it.producto_id] ?? 0) > 0)
    : [];
  const monto = itemsConCantidad.reduce(
    (acc, it) => acc + (cantidades[it.producto_id] ?? 0) * it.precio_unitario,
    0,
  );

  const emitirMut = useMutation({
    mutationFn: () => {
      if (!venta) throw new Error('Sin venta');
      if (!empleado) throw new Error('Sin sesión');
      if (!motivo.trim()) throw new Error('Indicá el motivo');
      if (itemsConCantidad.length === 0) throw new Error('Elegí al menos un producto');
      return db.notasCredito.emitir({
        venta_id: venta.id,
        empleado_id: empleado.id,
        motivo: motivo.trim(),
        items: itemsConCantidad.map((it) => ({
          producto_id: it.producto_id,
          cantidad: cantidades[it.producto_id]!,
          precio_unitario: it.precio_unitario,
        })),
      });
    },
    onSuccess: (nc) => {
      toast.success(`Nota de crédito ${nc.numero} emitida por ${formatCurrency(nc.monto_total)}`);
      qc.invalidateQueries({ queryKey: ['notas-credito'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onEmitida?.(nc.id);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function nombreProd(id: string) {
    return productosQ.data?.find((p) => p.id === id)?.nombre ?? id;
  }
  function codigoProd(id: string) {
    return productosQ.data?.find((p) => p.id === id)?.codigo_interno ?? '—';
  }
  function setCant(productoId: string, cant: number, max: number) {
    setCantidades((s) => ({ ...s, [productoId]: Math.max(0, Math.min(max, cant)) }));
  }

  if (!open || !venta) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Nota de crédito · Venta {venta.numero}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Indicá qué productos se devuelven y por qué motivo. La NC vuelve el stock al
          local y queda registrada.
        </p>

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Vendido</th>
                <th className="px-3 py-2 text-right">Precio unit.</th>
                <th className="px-3 py-2 text-center">A devolver</th>
                <th className="px-3 py-2 text-right">Subtotal NC</th>
              </tr>
            </thead>
            <tbody>
              {venta.items.map((it) => {
                const cant = cantidades[it.producto_id] ?? 0;
                const sub = cant * it.precio_unitario;
                return (
                  <tr key={it.producto_id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-muted-foreground">
                        {codigoProd(it.producto_id)}
                      </div>
                      <div className="font-medium">{nombreProd(it.producto_id)}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{it.cantidad}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(it.precio_unitario)}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={it.cantidad}
                        value={cant}
                        onChange={(e) =>
                          setCant(it.producto_id, parseInt(e.target.value) || 0, it.cantidad)
                        }
                        className="h-8 w-16 text-center"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {sub > 0 ? formatCurrency(sub) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <Label className="mb-1 block text-sm">Motivo *</Label>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: producto defectuoso, cambio por talle, error de cobro"
          />
        </div>

        <div className="flex items-end justify-between border-t pt-3">
          <div className="text-xs text-muted-foreground">Monto total de la NC</div>
          <div className="text-2xl font-bold tabular-nums">{formatCurrency(monto)}</div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={emitirMut.isPending}>
          Cancelar
        </Button>
        <Button
          onClick={() => emitirMut.mutate()}
          disabled={emitirMut.isPending || itemsConCantidad.length === 0 || !motivo.trim()}
        >
          {emitirMut.isPending ? 'Emitiendo…' : 'Emitir nota de crédito'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
