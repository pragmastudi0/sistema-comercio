import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDb } from '@/lib/db';
import { useVenta } from '@/stores/venta';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Input } from '@comercio/ui/input';
import { Button } from '@comercio/ui/button';
import { Badge } from '@comercio/ui/badge';
import { formatCurrency } from '@comercio/ui/utils';

export function ModalCliente({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const db = getDb();
  const [q, setQ] = useState('');
  const setCliente = useVenta((s) => s.setCliente);
  const clienteIdActual = useVenta((s) => s.clienteId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQ('');
    }
  }, [open]);

  const clientesQ = useQuery({
    queryKey: ['clientes-pos', q],
    queryFn: () => db.clientes.list({ texto: q, activo: true }),
    enabled: open,
  });

  function elegir(id: string | null) {
    setCliente(id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Identificar cliente</DialogTitle>
      </DialogHeader>
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre, apellido o DNI"
        className="mb-3"
      />
      <div className="max-h-80 overflow-y-auto">
        {(clientesQ.data ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => elegir(c.id)}
            className={`flex w-full items-center justify-between border-b px-3 py-3 text-left last:border-0 hover:bg-accent ${
              c.id === clienteIdActual ? 'bg-primary/5' : ''
            }`}
          >
            <div>
              <div className="font-medium">
                {c.nombre} {c.apellido}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.dni ? `DNI ${c.dni}` : 'Sin DNI'}
                {c.suspendido && (
                  <Badge variant="destructive" className="ml-2">
                    suspendido
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right text-xs">
              {c.saldo > 0 && (
                <Badge variant="destructive">debe {formatCurrency(c.saldo)}</Badge>
              )}
              {c.saldo < 0 && (
                <Badge variant="secondary">
                  a favor {formatCurrency(Math.abs(c.saldo))}
                </Badge>
              )}
            </div>
          </button>
        ))}
        {(clientesQ.data ?? []).length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Sin resultados. (Crear cliente nuevo se hace desde el admin.)
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => elegir(null)}>
          Sin identificar (consumidor final)
        </Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cerrar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
