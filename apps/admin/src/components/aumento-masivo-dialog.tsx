'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import type { ListaPrecio } from '@comercio/db';

export function AumentoMasivoDialog({
  lista,
  open,
  onOpenChange,
}: {
  lista: ListaPrecio | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const db = getDb();
  const qc = useQueryClient();

  const [porcentaje, setPorcentaje] = useState(0);
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');

  const categoriasQ = useQuery({ queryKey: ['categorias'], queryFn: () => db.categorias.list() });
  const proveedoresQ = useQuery({
    queryKey: ['proveedores-all'],
    queryFn: () => db.proveedores.list({ activo: true }),
  });
  // Preview de cuántos productos van a tocarse
  const previewQ = useQuery({
    queryKey: ['preview-aumento', categoriaId, proveedorId, open],
    queryFn: () =>
      db.productos.list({
        activo: true,
        categoria_id: categoriaId || undefined,
        proveedor_id: proveedorId || undefined,
      }),
    enabled: open,
  });

  const aumentarMut = useMutation({
    mutationFn: async () => {
      if (!lista) throw new Error('Sin lista');
      if (Math.abs(porcentaje) < 0.01) throw new Error('Indicá un porcentaje distinto de 0');
      return db.productos.aumentoMasivo(
        {
          activo: true,
          categoria_id: categoriaId || undefined,
          proveedor_id: proveedorId || undefined,
        },
        porcentaje,
        lista.id,
      );
    },
    onSuccess: (cant) => {
      toast.success(
        `Aumento ${porcentaje > 0 ? '+' : ''}${porcentaje}% aplicado a ${cant} producto(s) en lista "${lista?.nombre}"`,
      );
      qc.invalidateQueries({ queryKey: ['precios-cf'] });
      qc.invalidateQueries({ queryKey: ['precios-web'] });
      qc.invalidateQueries({ queryKey: ['precios-de'] });
      onOpenChange(false);
      setPorcentaje(0);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!lista) return null;
  const cant = previewQ.data?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Aumento masivo · {lista.nombre}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label className="mb-1 block">Porcentaje a aplicar</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="-90"
              max="500"
              step="0.5"
              value={porcentaje}
              onChange={(e) => setPorcentaje(parseFloat(e.target.value) || 0)}
              className="text-lg"
              autoFocus
            />
            <span className="text-2xl font-bold text-muted-foreground">%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Positivo aumenta, negativo descuenta. Ej: 15 = +15%, -5 = -5%.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1 block text-xs">Categoría</Label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todas</option>
              {(categoriasQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Proveedor</Label>
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {(proveedoresQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="text-muted-foreground">Productos a actualizar</div>
          <div className="text-2xl font-bold tabular-nums">{cant}</div>
          {cant > 0 && Math.abs(porcentaje) >= 0.01 && (
            <div className="mt-2 flex items-start gap-1 text-xs text-orange-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>
                Los precios de {cant} producto(s) de la lista <strong>{lista.nombre}</strong> se
                modificarán {porcentaje > 0 ? '+' : ''}
                {porcentaje}%. Esta acción no se puede deshacer.
              </span>
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          onClick={() => aumentarMut.mutate()}
          disabled={aumentarMut.isPending || cant === 0 || Math.abs(porcentaje) < 0.01}
        >
          {aumentarMut.isPending ? 'Aplicando…' : `Aplicar a ${cant} producto(s)`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
