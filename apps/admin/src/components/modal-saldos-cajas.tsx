'use client';

import { useQuery } from '@tanstack/react-query';
import { Wallet, RefreshCw } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Dialog, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';
import type { MetodoPago } from '@comercio/db';

const METODOS: { key: MetodoPago; label: string }[] = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'debito', label: 'Débito' },
  { key: 'credito', label: 'Crédito' },
  { key: 'transferencia', label: 'Transferencia' },
  { key: 'qr', label: 'QR' },
];

/**
 * Modal "Saldos de cajas" — lo que Agus mira todo el tiempo.
 * Muestra cada caja activa con su saldo total y el desglose por método
 * de pago. Refresca cada 10s automáticamente para que el dueño vea las
 * ventas entrar al toque sin recargar.
 */
export function ModalSaldosCajas({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const db = getDb();

  // Sesiones de caja abiertas + cajas + empleados (para mostrar nombres).
  const sesionesQ = useQuery({
    queryKey: ['admin-saldos-sesiones'],
    queryFn: () => db.sesionesCaja.list(),
    refetchInterval: open ? 10_000 : false,
    enabled: open,
  });
  const cajasQ = useQuery({
    queryKey: ['admin-saldos-cajas'],
    queryFn: () => db.cajas.list(),
    enabled: open,
  });
  const empleadosQ = useQuery({
    queryKey: ['admin-saldos-empleados'],
    queryFn: () => db.empleados.list(),
    enabled: open,
  });

  const abiertas = (sesionesQ.data ?? []).filter((s) => s.estado === 'abierta');

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-700" />
            Saldos de cajas activas
            {sesionesQ.isFetching && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </span>
        </DialogTitle>
      </DialogHeader>

      {sesionesQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : abiertas.length === 0 ? (
        <div className="rounded-md border bg-muted/30 py-8 text-center text-sm text-muted-foreground">
          No hay cajas abiertas en este momento.
        </div>
      ) : (
        <div className="space-y-3">
          {abiertas.map((s) => (
            <SaldoCajaRow
              key={s.id}
              sesion={s}
              cajaNombre={cajasQ.data?.find((c) => c.id === s.caja_id)?.nombre ?? '—'}
              empleadoNombre={(() => {
                // Preferir empleado_actual_id (se actualiza con "Cambiar
                // usuario" del PoS). Si no está (sesión vieja), caer al
                // empleado que abrió.
                const idActual = s.empleado_actual_id ?? s.empleado_id;
                const e = empleadosQ.data?.find((x) => x.id === idActual);
                return e ? `${e.nombre} ${e.apellido}` : '—';
              })()}
            />
          ))}
        </div>
      )}

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

function SaldoCajaRow({
  sesion,
  cajaNombre,
  empleadoNombre,
}: {
  sesion: { id: string; saldo_inicial: number };
  cajaNombre: string;
  empleadoNombre: string;
}) {
  const db = getDb();
  const movsQ = useQuery({
    queryKey: ['admin-saldos-movs', sesion.id],
    queryFn: () => db.sesionesCaja.movimientos(sesion.id),
    refetchInterval: 10_000,
  });
  // Tickets del turno: cantidad de ventas completadas de esta sesión.
  const ventasQ = useQuery({
    queryKey: ['admin-saldos-ventas-count', sesion.id],
    queryFn: () => db.ventas.list({ sesion_caja_id: sesion.id }),
    refetchInterval: 10_000,
  });
  const ticketsCompletados = (ventasQ.data ?? []).filter(
    (v) => v.estado === 'completada',
  ).length;

  // Sumar por método: signo positivo en ingresos/ventas, negativo en
  // egresos/retiros/anulaciones.
  const totales: Record<MetodoPago, number> = {
    efectivo: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
    qr: 0,
    cta_cte: 0,
  };
  for (const m of movsQ.data ?? []) {
    const signo =
      m.tipo === 'egreso' || m.tipo === 'retiro' || m.tipo === 'anulacion' ? -1 : 1;
    totales[m.metodo] += signo * m.monto;
  }
  const efectivoEnCaja = sesion.saldo_inicial + totales.efectivo;
  const totalMovido = METODOS.reduce((acc, m) => acc + totales[m.key], 0);
  const totalGeneral = sesion.saldo_inicial + totalMovido;

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <div className="font-semibold">{cajaNombre}</div>
          <div className="text-xs text-muted-foreground">{empleadoNombre}</div>
          <div className="mt-0.5 text-xs">
            <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800">
              {ticketsCompletados}{' '}
              {ticketsCompletados === 1 ? 'ticket' : 'tickets'}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-muted-foreground">Total en caja</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-700">
            {formatCurrency(totalGeneral)}
          </div>
        </div>
      </div>

      {movsQ.isLoading ? (
        <Skeleton className="h-12" />
      ) : (
        <div className="grid grid-cols-3 gap-2 border-t pt-2 sm:grid-cols-5">
          {METODOS.map((m) => (
            <div
              key={m.key}
              className="rounded border bg-background px-2 py-1.5 text-center"
            >
              <div className="text-[10px] uppercase text-muted-foreground">{m.label}</div>
              <div className="text-sm font-semibold tabular-nums">
                {formatCurrency(totales[m.key])}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          Apertura:{' '}
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(sesion.saldo_inicial)}
          </span>
        </div>
        <div className="text-right">
          Efectivo esperado:{' '}
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(efectivoEnCaja)}
          </span>
        </div>
      </div>
    </div>
  );
}
