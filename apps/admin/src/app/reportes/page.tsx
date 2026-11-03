'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BarChart3, TrendingUp, Users, Trophy, Warehouse } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import { Badge } from '@comercio/ui/badge';
import { formatCurrency } from '@comercio/ui/utils';
import type { MetodoPago } from '@comercio/db';
import { PaginaProtegida, usePermiso } from '@/lib/permisos';

// Cta corriente queda fuera del PoS — no se usa como medio de pago.
// La excluimos del gráfico/tabla de "métodos" para que no aparezca
// siempre en 0 confundiendo al dueño.
const METODOS: MetodoPago[] = ['efectivo', 'transferencia', 'debito', 'credito', 'qr'];
const LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transf.',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
  cta_cte: 'Cta cte',
};

function ReportesPageInner() {
  const db = getDb();
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const hace7 = format(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

  const [desde, setDesde] = useState(hace7);
  const [hasta, setHasta] = useState(hoy);
  // '' = ambos locales (default). Cuando hay un local específico
  // seleccionado, todas las tarjetas se filtran en memoria por él.
  const [localId, setLocalId] = useState<string>('');

  const ventasQ = useQuery({
    queryKey: ['reportes-ventas', desde, hasta],
    queryFn: () =>
      db.ventas.list({
        desde: new Date(`${desde}T00:00:00`).toISOString(),
        hasta: new Date(`${hasta}T23:59:59`).toISOString(),
        estado: 'completada',
      }),
  });
  const empleadosQ = useQuery({ queryKey: ['empleados'], queryFn: () => db.empleados.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });
  const verCosto = usePermiso('productos', 'ver_costo');
  // Valuación de mercadería — snapshot del momento, independiente del rango.
  // Sirve para saber cuánto capital hay parado en cada depósito por separado.
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
    staleTime: 10 * 60_000,
  });
  const stockConsolidadoQ = useQuery({
    queryKey: ['reportes-stock-consolidado'],
    queryFn: () => db.stock.consolidado(),
    staleTime: 5 * 60_000,
  });
  const productosLookupQ = useQuery({
    queryKey: ['reportes-productos-lookup'],
    queryFn: () => db.productos.list(),
    staleTime: 5 * 60_000,
  });
  // Traemos productos SOLO para mapear producto_id → código + nombre en
  // el ranking. `list({activo: true})` puede ser lento con 1900 productos
  // — cacheo agresivo porque el catálogo cambia poco durante el día.
  const productosQ = useQuery({
    queryKey: ['reportes-productos'],
    queryFn: () => db.productos.list({ activo: true }),
    staleTime: 5 * 60_000,
  });

  // Filtramos por local en memoria — evita re-fetch al cambiar el
  // selector. El rango de fechas sí re-fetchea (nueva query key).
  const ventas = (ventasQ.data ?? []).filter(
    (v) => !localId || v.local_id === localId,
  );
  const totalRango = ventas.reduce((acc, v) => acc + v.total, 0);
  const cantidadRango = ventas.length;

  // Totales por método (suma del monto de cada pago)
  const totalesMetodo = METODOS.reduce(
    (acc, m) => ({ ...acc, [m]: 0 }),
    {} as Record<MetodoPago, number>,
  );
  for (const v of ventas) {
    for (const p of v.pagos) totalesMetodo[p.metodo] += p.monto;
  }

  // Por cajero
  const porCajero = new Map<string, { ventas: number; total: number }>();
  for (const v of ventas) {
    const prev = porCajero.get(v.empleado_id) ?? { ventas: 0, total: 0 };
    prev.ventas += 1;
    prev.total += v.total;
    porCajero.set(v.empleado_id, prev);
  }
  const rankingCajeros = [...porCajero.entries()].sort((a, b) => b[1].total - a[1].total);

  // Por local
  const porLocal = new Map<string, { ventas: number; total: number }>();
  for (const v of ventas) {
    const prev = porLocal.get(v.local_id) ?? { ventas: 0, total: 0 };
    prev.ventas += 1;
    prev.total += v.total;
    porLocal.set(v.local_id, prev);
  }
  const rankingLocales = [...porLocal.entries()].sort((a, b) => b[1].total - a[1].total);

  // Ventas por día (línea simple)
  const porDia = new Map<string, number>();
  for (const v of ventas) {
    const dia = v.fecha.slice(0, 10);
    porDia.set(dia, (porDia.get(dia) ?? 0) + v.total);
  }
  const dias = [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const maxDia = Math.max(0.01, ...dias.map(([, v]) => v));

  // Top productos por rotación en el rango. Feedback de Agus:
  // quería un ranking top 10 para ver qué se está moviendo más.
  // Ordenable por unidades vendidas (default, más útil para reponer)
  // o por facturado (más útil para saber qué genera plata).
  const [rankingOrden, setRankingOrden] = useState<'unidades' | 'facturado'>('unidades');
  const topProductos = useMemo(() => {
    type Agg = { producto_id: string; unidades: number; facturado: number; tickets: Set<string> };
    const agg = new Map<string, Agg>();
    for (const v of ventas) {
      for (const it of v.items ?? []) {
        const prev = agg.get(it.producto_id) ?? {
          producto_id: it.producto_id,
          unidades: 0,
          facturado: 0,
          tickets: new Set<string>(),
        };
        prev.unidades += Number(it.cantidad) || 0;
        prev.facturado += Number(it.subtotal) || 0;
        prev.tickets.add(v.id);
        agg.set(it.producto_id, prev);
      }
    }
    const arr = [...agg.values()].map((a) => ({
      producto_id: a.producto_id,
      unidades: a.unidades,
      facturado: a.facturado,
      tickets: a.tickets.size,
    }));
    arr.sort((a, b) =>
      rankingOrden === 'unidades' ? b.unidades - a.unidades : b.facturado - a.facturado,
    );
    return arr.slice(0, 10);
  }, [ventas, rankingOrden]);

  const productoPorId = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string }>();
    for (const p of productosQ.data ?? []) {
      m.set(p.id, { codigo: p.codigo_interno, nombre: p.nombre });
    }
    return m;
  }, [productosQ.data]);

  const empleadoNombre = (id: string) => {
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido}` : '—';
  };
  const localNombre = (id: string) =>
    localesQ.data?.find((l) => l.id === id)?.nombre ?? '—';

  // Valuación de mercadería por depósito — snapshot del stock actual, no
  // depende del rango. Suma stock actual × costo unitario por depósito.
  const valuacionPorDeposito = useMemo(() => {
    const costoPorProducto = new Map<string, number>();
    for (const p of productosLookupQ.data ?? []) {
      costoPorProducto.set(p.id, p.costo ?? 0);
    }
    return (depositosQ.data ?? []).map((d) => {
      let costo = 0;
      let unidades = 0;
      for (const s of stockConsolidadoQ.data ?? []) {
        if (s.deposito_id !== d.id) continue;
        const cant = Number(s.cantidad);
        if (cant <= 0) continue;
        unidades += cant;
        costo += cant * (costoPorProducto.get(s.producto_id) ?? 0);
      }
      return { id: d.id, nombre: d.nombre, tipo: d.tipo, costo, unidades };
    });
  }, [depositosQ.data, stockConsolidadoQ.data, productosLookupQ.data]);
  const valuacionTotal = valuacionPorDeposito.reduce((a, r) => a + r.costo, 0);
  const valuacionUnidades = valuacionPorDeposito.reduce((a, r) => a + r.unidades, 0);
  const valuacionCargando =
    depositosQ.isLoading || stockConsolidadoQ.isLoading || productosLookupQ.isLoading;
  const nfEs = new Intl.NumberFormat('es-AR');

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold sm:text-2xl">Reportes</h1>
        <p className="text-sm text-muted-foreground">Datos del período seleccionado.</p>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div>
            <Label className="mb-1 block text-xs">Desde</Label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Hasta</Label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Local</Label>
            <select
              value={localId}
              onChange={(e) => setLocalId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Ambos locales</option>
              {(localesQ.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Valuación de mercadería — snapshot del stock actual (no depende
          del rango). Se muestra solo si el rol tiene productos.ver_costo. */}
      {verCosto && (
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Valor de mercadería a costo</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              Stock actual × costo unitario. Cada depósito por separado, más el total general.
              Snapshot del momento — no depende del rango de fechas.
            </p>
          </CardHeader>
          <CardContent>
            {valuacionCargando ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {valuacionPorDeposito
                  .filter((r) => r.unidades > 0)
                  .sort((a, b) => b.costo - a.costo)
                  .map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border bg-muted/30 p-3"
                    >
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                        <span className="truncate">{r.nombre}</span>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {r.tipo}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xl font-bold tabular-nums">
                        {formatCurrency(r.costo)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {nfEs.format(r.unidades)} u
                      </div>
                    </div>
                  ))}
                <div className="rounded-lg border-2 border-foreground bg-foreground/5 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide">
                    Total general
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums">
                    {formatCurrency(valuacionTotal)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {nfEs.format(valuacionUnidades)} u
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {ventasQ.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              titulo="Total facturado"
              valor={formatCurrency(totalRango)}
              icon={TrendingUp}
            />
            <KpiCard titulo="Tickets" valor={String(cantidadRango)} icon={BarChart3} />
            <KpiCard
              titulo="Ticket promedio"
              valor={formatCurrency(cantidadRango > 0 ? totalRango / cantidadRango : 0)}
              icon={Users}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ventas por día</CardTitle>
              </CardHeader>
              <CardContent>
                {dias.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin ventas en el rango.</p>
                ) : (
                  <div className="space-y-2">
                    {dias.map(([d, v]) => (
                      <div key={d} className="flex items-center gap-2 text-sm">
                        <span className="w-24 font-mono text-xs text-muted-foreground">{d}</span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${(v / maxDia) * 100}%` }}
                          />
                        </div>
                        <span className="w-24 text-right tabular-nums">{formatCurrency(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por método de pago</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {METODOS.map((m) => (
                    <div key={m} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{LABEL[m]}</span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(totalesMetodo[m])}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ranking por cajero</CardTitle>
              </CardHeader>
              <CardContent>
                {rankingCajeros.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <div className="space-y-2">
                    {rankingCajeros.map(([id, st], i) => (
                      <div key={id} className="flex items-center justify-between text-sm">
                        <span>
                          <span className="font-mono text-xs text-muted-foreground">
                            #{i + 1}
                          </span>{' '}
                          {empleadoNombre(id)}
                        </span>
                        <span className="text-muted-foreground">
                          {st.ventas} ventas ·{' '}
                          <span className="font-medium tabular-nums">
                            {formatCurrency(st.total)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por local</CardTitle>
              </CardHeader>
              <CardContent>
                {rankingLocales.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <div className="space-y-2">
                    {rankingLocales.map(([id, st]) => (
                      <div key={id} className="flex items-center justify-between text-sm">
                        <span>{localNombre(id)}</span>
                        <span className="text-muted-foreground">
                          {st.ventas} ventas ·{' '}
                          <span className="font-medium tabular-nums">
                            {formatCurrency(st.total)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top 10 productos por rotación — ocupa las 2 columnas. */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy className="h-4 w-4 text-amber-600" />
                    Top 10 productos {rankingOrden === 'unidades' ? 'más vendidos' : 'que más facturaron'}
                  </CardTitle>
                  <div className="flex gap-1 rounded-md border border-slate-300 bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setRankingOrden('unidades')}
                      className={`rounded px-2 py-0.5 ${
                        rankingOrden === 'unidades'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Por unidades
                    </button>
                    <button
                      type="button"
                      onClick={() => setRankingOrden('facturado')}
                      className={`rounded px-2 py-0.5 ${
                        rankingOrden === 'facturado'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Por facturado
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {topProductos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin ventas en el rango.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr className="border-b">
                          <th className="w-10 py-1.5 text-left">#</th>
                          <th className="py-1.5 text-left">Producto</th>
                          <th className="py-1.5 text-right">Unidades</th>
                          <th className="py-1.5 text-right">Facturado</th>
                          <th className="py-1.5 text-right">Tickets</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topProductos.map((tp, i) => {
                          const p = productoPorId.get(tp.producto_id);
                          const nombre = p?.nombre ?? '(producto eliminado)';
                          const codigo = p?.codigo ?? '—';
                          const destacadaCol =
                            rankingOrden === 'unidades'
                              ? 'font-semibold text-emerald-700'
                              : 'font-semibold text-emerald-700';
                          return (
                            <tr key={tp.producto_id} className="border-b border-border/40">
                              <td className="py-1.5 text-left">
                                <span
                                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                                    i === 0
                                      ? 'bg-amber-100 text-amber-800'
                                      : i === 1
                                        ? 'bg-slate-200 text-slate-700'
                                        : i === 2
                                          ? 'bg-orange-100 text-orange-800'
                                          : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {i + 1}
                                </span>
                              </td>
                              <td className="py-1.5 text-left">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {codigo}
                                </span>{' '}
                                <span>{nombre}</span>
                              </td>
                              <td
                                className={`py-1.5 text-right tabular-nums ${
                                  rankingOrden === 'unidades' ? destacadaCol : ''
                                }`}
                              >
                                {tp.unidades}u
                              </td>
                              <td
                                className={`py-1.5 text-right tabular-nums ${
                                  rankingOrden === 'facturado' ? destacadaCol : ''
                                }`}
                              >
                                {formatCurrency(tp.facturado)}
                              </td>
                              <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                                {tp.tickets}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  titulo,
  valor,
  icon: Icon,
}: {
  titulo: string;
  valor: string;
  icon: typeof TrendingUp;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{valor}</div>
      </CardContent>
    </Card>
  );
}

export default function ReportesPage() {
  return (
    <PaginaProtegida modulo="reportes" accion="ver_local_propio">
      <ReportesPageInner />
    </PaginaProtegida>
  );
}
