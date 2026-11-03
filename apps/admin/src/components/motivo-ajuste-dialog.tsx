'use client';

import { useEffect, useState } from 'react';
import {
  MOTIVOS_INGRESO_STOCK,
  MOTIVOS_EGRESO_STOCK,
  MOTIVO_OTROS,
} from '@comercio/business';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';

/**
 * Dialog que pide un motivo por cada ajuste de stock pendiente antes de
 * aplicar. Cada delta puede ser positivo (ingreso — opciones tipo "Compra
 * a proveedor") o negativo (egreso — "Extravío", "Mal estado", etc.).
 *
 * Se usa en:
 *   1. StockPorLocal (panel /productos): botón +/- por local → 1 delta.
 *   2. guardarMut del panel: al confirmar cambios, si hay N deltas
 *      pendientes, se abre con todos y pide un motivo por cada uno.
 *
 * onConfirm recibe un array PARALELO al `deltas` de entrada con el motivo
 * final resuelto (si eligieron "Otros", ya trae el texto libre).
 */

export type DeltaAjuste = {
  key: string; // único para el key de React (ej. deposito_id)
  depositoNombre: string;
  delta: number; // positivo o negativo, distinto de 0
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deltas: DeltaAjuste[];
  onConfirm: (motivos: string[]) => void;
  productoNombre?: string;
};

export function MotivoAjusteDialog({
  open,
  onOpenChange,
  deltas,
  onConfirm,
  productoNombre,
}: Props) {
  // Estado paralelo: para cada delta, qué opción eligió el usuario y qué
  // texto libre (si eligió "Otros"). Se resetea cada vez que se abre.
  const [opciones, setOpciones] = useState<string[]>([]);
  const [otros, setOtros] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setOpciones(Array(deltas.length).fill(''));
      setOtros(Array(deltas.length).fill(''));
    }
  }, [open, deltas.length]);

  function motivoResuelto(i: number): string {
    const op = opciones[i] ?? '';
    if (op === MOTIVO_OTROS) return (otros[i] ?? '').trim();
    return op;
  }

  const todosCompletos = deltas.every((_, i) => motivoResuelto(i).length > 0);

  function confirmar() {
    if (!todosCompletos) return;
    onConfirm(deltas.map((_, i) => motivoResuelto(i)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Motivo del ajuste de stock</DialogTitle>
        <p className="text-xs text-muted-foreground">
          {productoNombre ? (
            <>
              Producto: <b>{productoNombre}</b>.{' '}
            </>
          ) : null}
          Elegí por qué se está{' '}
          {deltas.length === 1
            ? deltas[0]!.delta > 0
              ? 'cargando'
              : 'descontando'
            : 'ajustando'}{' '}
          el stock. Queda registrado en el historial del producto.
        </p>
      </DialogHeader>

      <div className="max-h-[50vh] space-y-3 overflow-y-auto">
        {deltas.map((d, i) => {
          const esIngreso = d.delta > 0;
          const opciones_ = esIngreso ? MOTIVOS_INGRESO_STOCK : MOTIVOS_EGRESO_STOCK;
          const op = opciones[i] ?? '';
          return (
            <div key={d.key} className="rounded-md border bg-card p-2.5">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium">{d.depositoNombre}</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    esIngreso ? 'text-emerald-700' : 'text-orange-700'
                  }`}
                >
                  {esIngreso ? '+' : ''}
                  {d.delta} · {esIngreso ? 'ingreso' : 'egreso'}
                </span>
              </div>
              <select
                value={op}
                onChange={(e) =>
                  setOpciones((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">— Elegí un motivo —</option>
                {opciones_.map((op_) => (
                  <option key={op_} value={op_}>
                    {op_}
                  </option>
                ))}
                <option value={MOTIVO_OTROS}>{MOTIVO_OTROS} (escribir)…</option>
              </select>
              {op === MOTIVO_OTROS && (
                <>
                  <Input
                    value={otros[i] ?? ''}
                    onChange={(e) =>
                      setOtros((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    placeholder="Escribí el motivo"
                    className="mt-2"
                    autoFocus
                  />
                  {/* Aviso cuando el motivo es libre: recordá al usuario
                      que el signo del delta tiene que ser explícito porque
                      no hay un motivo preset que lo aclare. Esto evita el
                      error clásico "puse 5 pensando en restar y sumó 5". */}
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
                    <b>Verificá el signo:</b> este ajuste va a{' '}
                    {esIngreso ? (
                      <>
                        <b>SUMAR {d.delta}</b> unidades al stock. Si querías
                        restar, cancelá y volvé a tipear el número con signo
                        menos adelante (ej: <code>-{d.delta}</code>).
                      </>
                    ) : (
                      <>
                        <b>RESTAR {Math.abs(d.delta)}</b> unidades del stock. Si
                        querías sumar, cancelá y tipeá el número sin el signo
                        menos.
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button disabled={!todosCompletos} onClick={confirmar}>
          Confirmar ajuste
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
