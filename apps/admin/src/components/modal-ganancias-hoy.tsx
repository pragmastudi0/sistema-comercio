'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Dialog, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';

type PeriodoPreset = 'hoy' | 'semana' | 'mes' | 'anio' | 'custom';

const PRESETS: { key: PeriodoPreset; label: string; dias: number | null }[] = [
  { key: 'hoy', label: 'Hoy', dias: 0 },
  { key: 'semana', label: 'Última semana', dias: 7 },
  { key: 'mes', label: 'Último mes', dias: 30 },
  { key: 'anio', label: 'Último año', dias: 365 },
  { key: 'custom', label: 'Rango personalizado', dias: null },
];

function formatDateInput(d: Date): string {
  // YYYY-MM-DD para inputs type=date
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Modal "Ganancias" — vista de facturado / ganancia / costos / margen
 * con filtro de período. Default: hoy. Selector con presets (Hoy /
 * semana / mes / año) o rango personalizado (desde/hasta).
 *
 * Solo cuenta ventas en estado 'completada'. Refresca cada 30s mientras
 * está abierto.
 */
export function ModalGananciasHoy({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const db = getDb();

  // Estado del selector de período. Default: "hoy".
  const [preset, setPreset] = useState<PeriodoPreset>('hoy');
  // Rango custom (solo se usa si preset === 'custom').
  const hoyTxt = formatDateInput(new Date());
  const hace30 = new Date();
  hace30.setDate(hace30.getDate() - 30);
  const [desdeTxt, setDesdeTxt] = useState(formatDateInput(hace30));
  const [hastaTxt, setHastaTxt] = useState(hoyTxt);

  // Calcular rango efectivo según el preset.
  const { desde, hasta, etiquetaPeriodo } = useMemo(() => {
    if (preset === 'custom') {
      return {
        desde: new Date(`${desdeTxt}T00:00:00`).toISOString(),
        hasta: new Date(`${hastaTxt}T23:59:59`).toISOString(),
        etiquetaPeriodo: `del ${desdeTxt} al ${hastaTxt}`,
      };
    }
    const p = PRESETS.find((x) => x.key === preset)!;
    const ahora = new Date();
    const d = new Date();
    if (p.dias === 0) {
      d.setHours(0, 0, 0, 0);
    } else {
      d.setDate(d.getDate() - (p.dias ?? 0));
      d.setHours(0, 0, 0, 0);
    }
    return {
      desde: d.toISOString(),
      hasta: ahora.toISOString(),
      etiquetaPeriodo: p.label.toLowerCase(),
    };
  }, [preset, desdeTxt, hastaTxt]);

  const ventasQ = useQuery({
    queryKey: ['admin-ganancias-ventas', desde, hasta],
    queryFn: () => db.ventas.list({ desde, hasta }),
    refetchInterval: open ? 30_000 : false,
    enabled: open,
  });

  const productosQ = useQuery({
    queryKey: ['admin-ganancias-productos'],
    queryFn: () => db.productos.list(),
    enabled: open,
  });

  const localesQ = useQuery({
    queryKey: ['admin-ganancias-locales'],
    queryFn: () => db.locales.list(),
    enabled: open,
  });

  // Filtro de local: 'todos' = suma agregada + desglose por local.
  // Si elegís un local específico, solo se muestran sus números.
  const [localFiltro, setLocalFiltro] = useState<'todos' | string>('todos');

  type Agregado = {
    tickets: number;
    bruto: number;
    cobrado: number;
    ganancia: number;
    costoTotal: number;
    efectivo: number;
    otros: number;
  };
  function vacio(): Agregado {
    return { tickets: 0, bruto: 0, cobrado: 0, ganancia: 0, costoTotal: 0, efectivo: 0, otros: 0 };
  }
  function calcular(ventas: typeof ventasQ.data extends (infer T)[] | undefined ? T[] : never): Agregado {
    const costoPorProd = new Map<string, number>();
    for (const p of productosQ.data ?? []) costoPorProd.set(p.id, p.costo);
    const acc = vacio();
    for (const v of ventas ?? []) {
      acc.tickets += 1;
      acc.bruto += v.subtotal;
      acc.cobrado += v.total;
      for (const it of v.items) {
        const costo = costoPorProd.get(it.producto_id) ?? 0;
        acc.ganancia += (it.precio_unitario - costo) * it.cantidad;
        acc.costoTotal += costo * it.cantidad;
      }
      for (const p of v.pagos) {
        // Agrupación consistente con el dashboard (iteración 1):
        // - efectivo + transferencia → "Efectivo" (plata que entra a caja
        //   o a la cuenta directamente, sin comisiones ni retenciones).
        // - débito + crédito + QR → "Otros" (medios electrónicos con
        //   comisión). Cta cte queda fuera de ambos porque no entra plata.
        if (p.metodo === 'efectivo' || p.metodo === 'transferencia') {
          acc.efectivo += p.monto;
        } else if (p.metodo !== 'cta_cte') {
          acc.otros += p.monto;
        }
      }
    }
    return acc;
  }

  const { total, porLocal } = useMemo(() => {
    const completadas = (ventasQ.data ?? []).filter((v) => v.estado === 'completada');
    const filtradas = localFiltro === 'todos'
      ? completadas
      : completadas.filter((v) => v.local_id === localFiltro);
    const porLocal = new Map<string, Agregado>();
    for (const loc of localesQ.data ?? []) {
      const ventasLoc = completadas.filter((v) => v.local_id === loc.id);
      porLocal.set(loc.id, calcular(ventasLoc));
    }
    return { total: calcular(filtradas), porLocal };
  }, [ventasQ.data, productosQ.data, localesQ.data, localFiltro]);
  const margen = total.bruto > 0 ? (total.ganancia / total.bruto) * 100 : 0;

  const cargando = ventasQ.isLoading || productosQ.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-700" />
            Ganancias
            {ventasQ.isFetching && !ventasQ.isLoading && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </span>
        </DialogTitle>
      </DialogHeader>

      {/* Selector de período */}
      <div className="mb-3 space-y-2 rounded-md border border-slate-300 bg-slate-50 p-2">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={`rounded-sm border px-2 py-1.5 text-xs font-medium transition ${
                preset === p.key
                  ? 'border-blue-600 bg-blue-100 text-blue-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                Desde
              </Label>
              <Input
                type="date"
                value={desdeTxt}
                onChange={(e) => setDesdeTxt(e.target.value)}
                max={hastaTxt}
                className="h-7 text-sm"
              />
            </div>
            <div>
              <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                Hasta
              </Label>
              <Input
                type="date"
                value={hastaTxt}
                onChange={(e) => setHastaTxt(e.target.value)}
                min={desdeTxt}
                max={hoyTxt}
                className="h-7 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Selector de local: 'todos' suma + muestra desglose. Específico
          filtra solo a ese local. */}
      {(localesQ.data?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-slate-700">Local:</span>
          <button
            type="button"
            onClick={() => setLocalFiltro('todos')}
            className={`rounded-sm border px-2 py-1 font-medium transition ${
              localFiltro === 'todos'
                ? 'border-blue-600 bg-blue-100 text-blue-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            Todos
          </button>
          {(localesQ.data ?? []).map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => setLocalFiltro(loc.id)}
              className={`rounded-sm border px-2 py-1 font-medium transition ${
                localFiltro === loc.id
                  ? 'border-blue-600 bg-blue-100 text-blue-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {loc.nombre}
            </button>
          ))}
        </div>
      )}

      {cargando ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-3">
          {/* KPI principal: ganancia */}
          <div className="rounded-md border border-blue-300 bg-blue-50 p-4 text-center">
            <div className="text-xs font-medium uppercase tracking-wider text-blue-700">
              Ganancia bruta — {etiquetaPeriodo}
              {localFiltro !== 'todos' && (
                <> · {(localesQ.data ?? []).find((l) => l.id === localFiltro)?.nombre}</>
              )}
            </div>
            <div className="mt-1 text-4xl font-bold tabular-nums text-blue-900">
              {formatCurrency(Math.round(total.ganancia))}
            </div>
            <div className="mt-1 text-xs text-blue-700">
              Margen {margen.toFixed(1)}% sobre {formatCurrency(Math.round(total.bruto))} facturado
              · {total.tickets} {total.tickets === 1 ? 'venta' : 'ventas'}
            </div>
          </div>

          {/* Desglose por local (solo si 'todos' y hay más de un local). */}
          {localFiltro === 'todos' && (localesQ.data?.length ?? 0) > 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(localesQ.data ?? []).map((loc) => {
                const ag = porLocal.get(loc.id) ?? vacio();
                return (
                  <div
                    key={loc.id}
                    className="rounded-md border border-slate-300 bg-white p-3"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-slate-600">
                      {loc.nombre}
                    </div>
                    <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
                      {formatCurrency(Math.round(ag.ganancia))}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {ag.tickets} {ag.tickets === 1 ? 'venta' : 'ventas'} · facturado{' '}
                      {formatCurrency(Math.round(ag.bruto))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Desglose: bruto / costos / cobrado */}
          <div className="grid grid-cols-3 gap-2">
            <KpiBox label="Facturado bruto" valor={total.bruto} colorAccento="text-foreground" />
            <KpiBox label="Costo mercadería" valor={total.costoTotal} colorAccento="text-orange-700" />
            <KpiBox label="Cobrado total" valor={total.cobrado} colorAccento="text-emerald-700" />
          </div>

          {/* Cobrado por tipo de pago */}
          <div className="rounded-md border border-slate-300 bg-white p-3">
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Cobrado por tipo de pago
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border bg-slate-50 p-2 text-center">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Efectivo + transferencia
                </div>
                <div className="text-lg font-semibold tabular-nums text-emerald-700">
                  {formatCurrency(total.efectivo)}
                </div>
              </div>
              <div className="rounded border bg-slate-50 p-2 text-center">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Débito, crédito y QR
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatCurrency(total.otros)}
                </div>
              </div>
            </div>
          </div>

          {total.tickets === 0 && (
            <div className="rounded-md border bg-muted/30 py-4 text-center text-sm text-muted-foreground">
              No hay ventas en el período seleccionado.
            </div>
          )}
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

function KpiBox({
  label,
  valor,
  colorAccento,
}: {
  label: string;
  valor: number;
  colorAccento: string;
}) {
  return (
    <div className="rounded-md border border-slate-300 bg-white p-2 text-center">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${colorAccento}`}>
        {formatCurrency(Math.round(valor))}
      </div>
    </div>
  );
}
