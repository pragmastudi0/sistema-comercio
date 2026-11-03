'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  TrendingUp,
  Package,
  AlertTriangle,
  Wallet,
  ArrowRight,
  Banknote,
  CreditCard,
  PiggyBank,
  Warehouse,
  Tag,
} from 'lucide-react';
import { PRESET_IDS } from '@comercio/db';
import { getDb } from '@/lib/db';
import { PaginaProtegida } from '@/lib/permisos';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Skeleton } from '@comercio/ui/skeleton';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { formatCurrency } from '@comercio/ui/utils';

type Rango = 'hoy' | 'semana' | 'mes' | 'anio' | 'custom';

const LABEL_RANGO: Record<Rango, string> = {
  hoy: 'Hoy',
  semana: 'Últimos 7 días',
  mes: 'Este mes',
  anio: 'Este año',
  custom: 'Rango personalizado',
};

function calcularRango(rango: Rango, custom?: { desde: string; hasta: string }) {
  const ahora = new Date();
  let desde = new Date(ahora);
  desde.setHours(0, 0, 0, 0);
  let hasta = new Date(ahora);
  if (rango === 'semana') {
    desde.setDate(desde.getDate() - 6);
  } else if (rango === 'mes') {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  } else if (rango === 'anio') {
    desde = new Date(ahora.getFullYear(), 0, 1);
  } else if (rango === 'custom' && custom?.desde && custom?.hasta) {
    desde = new Date(`${custom.desde}T00:00:00`);
    hasta = new Date(`${custom.hasta}T23:59:59`);
  }
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

function formatHoyAR(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DashboardPage() {
  return (
    <PaginaProtegida modulo="reportes" accion="ver_local_propio" redirectTo="/productos">
      <DashboardInner />
    </PaginaProtegida>
  );
}

function DashboardInner() {
  const db = getDb();
  const [rango, setRango] = useState<Rango>('hoy');
  const [customDesde, setCustomDesde] = useState(formatHoyAR());
  const [customHasta, setCustomHasta] = useState(formatHoyAR());

  const { desde, hasta } = useMemo(
    () => calcularRango(rango, { desde: customDesde, hasta: customHasta }),
    [rango, customDesde, customHasta],
  );

  // Solo refrescar automáticamente cuando estamos viendo "hoy" — para el resto
  // es info estable.
  const refetchInterval = rango === 'hoy' ? 10_000 : false;

  const ventasQ = useQuery({
    queryKey: ['dashboard-ventas', desde, hasta],
    queryFn: () => db.ventas.list({ desde, hasta, estado: 'completada' }),
    refetchInterval,
  });
  // "Últimas ventas" es un feed independiente del rango elegido — siempre
  // trae las últimas ventas del sistema, sin importar si el dashboard
  // está mostrando "hoy", "semana" o "mes". Refresh cada 5s para que se
  // vea la venta apenas la cobra el cajero. Traemos 30 días como techo
  // (el .slice(0, 8) del render decide cuántas mostrar) para no bajar
  // toda la historia.
  const ultimasVentasQ = useQuery({
    queryKey: ['dashboard-ultimas-ventas'],
    queryFn: () => {
      const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return db.ventas.list({ desde: hace30, estado: 'completada' });
    },
    refetchInterval: 5_000,
  });
  const ultimasVentas = ultimasVentasQ.data ?? [];
  const productosQ = useQuery({
    queryKey: ['dashboard-sin-stock'],
    queryFn: () => db.productos.list({ activo: true, sin_stock: true }),
  });
  const sesionesQ = useQuery({
    queryKey: ['dashboard-sesiones-abiertas'],
    queryFn: () => db.sesionesCaja.list(),
  });
  // Necesitamos el catálogo para calcular ganancia (precio - costo).
  const productosLookupQ = useQuery({
    queryKey: ['productos-list'],
    queryFn: () => db.productos.list(),
  });
  // Saldo inicial cargado por el admin para arranques a mitad de mes.
  // Usamos el MISMO queryKey que /admin/configuracion para que al guardar
  // se invalide y el dashboard refleje el cambio sin esperar el cache.
  const configQ = useQuery({
    queryKey: ['config'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });

  // Valuación de mercadería (independiente del rango — es snapshot al
  // momento). Se actualiza cada 5 min porque no cambia tanto como las
  // ventas y trae muchas filas.
  const stockTotalQ = useQuery({
    queryKey: ['dashboard-stock-consolidado'],
    queryFn: () => db.stock.consolidado(),
    staleTime: 5 * 60_000,
  });
  const preciosCFQ = useQuery({
    queryKey: ['dashboard-precios-cf'],
    queryFn: () =>
      db.productos.preciosDeLista(PRESET_IDS.listas.consumidorFinal),
    staleTime: 5 * 60_000,
  });
  // Depósitos para poder desglosar la valuación por local. Cambia muy
  // poco (~3 filas) — cache largo.
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
    staleTime: 10 * 60_000,
  });

  const valuacion = useMemo(() => {
    // Total consolidado (todos los depósitos) — para el número grande de arriba.
    const stockPorProducto = new Map<string, number>();
    for (const s of stockTotalQ.data ?? []) {
      const cant = Number(s.cantidad);
      if (cant <= 0) continue; // stock negativo no se valúa
      stockPorProducto.set(
        s.producto_id,
        (stockPorProducto.get(s.producto_id) ?? 0) + cant,
      );
    }
    const precioCFPorProducto = new Map<string, number>();
    for (const r of preciosCFQ.data ?? []) {
      // Tomamos el precio base (escala mínima, "desde 1u").
      const esc = [...r.escalas].sort((a, b) => a.desde - b.desde)[0];
      if (esc) precioCFPorProducto.set(r.producto_id, esc.precio);
    }
    const costoPorProducto = new Map<string, number>();
    for (const p of productosLookupQ.data ?? []) {
      costoPorProducto.set(p.id, p.costo ?? 0);
    }
    let totalCosto = 0;
    let totalPrecio = 0;
    let unidades = 0;
    for (const p of productosLookupQ.data ?? []) {
      const cant = stockPorProducto.get(p.id) ?? 0;
      if (cant <= 0) continue;
      unidades += cant;
      totalCosto += cant * (p.costo ?? 0);
      totalPrecio += cant * (precioCFPorProducto.get(p.id) ?? 0);
    }

    // Desglose por depósito — para saber cuánto capital hay parado en
    // cada local por separado (pedido de Agus).
    const porDeposito = (depositosQ.data ?? []).map((d) => {
      let costo = 0;
      let precio = 0;
      let unis = 0;
      for (const s of stockTotalQ.data ?? []) {
        if (s.deposito_id !== d.id) continue;
        const cant = Number(s.cantidad);
        if (cant <= 0) continue;
        unis += cant;
        costo += cant * (costoPorProducto.get(s.producto_id) ?? 0);
        precio += cant * (precioCFPorProducto.get(s.producto_id) ?? 0);
      }
      return { id: d.id, nombre: d.nombre, tipo: d.tipo, costo, precio, unidades: unis };
    });

    return { totalCosto, totalPrecio, unidades, porDeposito };
  }, [stockTotalQ.data, preciosCFQ.data, productosLookupQ.data, depositosQ.data]);
  const valuacionCargando =
    stockTotalQ.isLoading ||
    preciosCFQ.isLoading ||
    productosLookupQ.isLoading ||
    depositosQ.isLoading;

  const ventasRango = ventasQ.data ?? [];
  const totalRangoSistema = ventasRango.reduce((acc, v) => acc + v.total, 0);
  const sesionesAbiertas = (sesionesQ.data ?? []).filter((s) => s.estado === 'abierta').length;

  // Saldo inicial (cargado en /admin/configuracion) — se suma a los KPIs
  // del dashboard cuando el rango arranca igual o antes de la fecha
  // indicada. Sirve para no partir los reportes mensuales cuando el
  // sistema se empieza a usar a mitad de mes. Cada valor se suma al
  // KPI correspondiente (facturado, ganancia, efectivo, otros, tickets).
  const arranque = configQ.data?.arranque;
  const saldoInicialAplica = !!(
    arranque?.desde_fecha &&
    new Date(desde).getTime() <=
      new Date(`${arranque.desde_fecha}T23:59:59`).getTime()
  );
  const arranqueFact = saldoInicialAplica
    ? arranque?.facturacion_acumulada ?? 0
    : 0;
  const arranqueTickets = saldoInicialAplica
    ? arranque?.ventas_acumuladas ?? 0
    : 0;
  const arranqueGanancia = saldoInicialAplica
    ? arranque?.ganancia_acumulada ?? 0
    : 0;
  const arranqueEfectivo = saldoInicialAplica
    ? arranque?.cobrado_efectivo_acumulado ?? 0
    : 0;
  const arranqueOtros = saldoInicialAplica
    ? arranque?.cobrado_otros_acumulado ?? 0
    : 0;
  const totalRango = totalRangoSistema + arranqueFact;
  const ticketsRango = ventasRango.length + arranqueTickets;

  // Indicadores financieros del día.
  const indicadores = useMemo(() => {
    const costoPorProducto = new Map<string, number>();
    for (const p of productosLookupQ.data ?? []) {
      costoPorProducto.set(p.id, p.costo);
    }
    let bruto = 0; // suma de subtotales (precio lista × cantidad)
    let ganancia = 0; // suma de (precio_unitario − costo) × cantidad
    // Agrupación de cobros pedida por Agus: el efectivo viene con
    // transferencia (plata "real" que entra), y la tarjeta con QR (cobros
    // electrónicos). Cta cte queda fuera de la división porque no es
    // efectivamente cobrado todavía.
    let efectivoTransf = 0;
    let tarjetaQr = 0;
    for (const v of ventasRango) {
      bruto += v.subtotal;
      for (const it of v.items) {
        const costo = costoPorProducto.get(it.producto_id) ?? 0;
        ganancia += (it.precio_unitario - costo) * it.cantidad;
      }
      for (const p of v.pagos) {
        if (p.metodo === 'efectivo' || p.metodo === 'transferencia') {
          efectivoTransf += p.monto;
        } else if (p.metodo === 'debito' || p.metodo === 'credito' || p.metodo === 'qr') {
          tarjetaQr += p.monto;
        }
        // cta_cte se excluye intencionalmente.
      }
    }
    return { bruto, ganancia, efectivoTransf, tarjetaQr };
  }, [ventasRango, productosLookupQ.data]);

  // Top productos del día
  const topMap = new Map<string, { id: string; cantidad: number; monto: number }>();
  for (const v of ventasRango) {
    for (const it of v.items) {
      const prev = topMap.get(it.producto_id) ?? { id: it.producto_id, cantidad: 0, monto: 0 };
      prev.cantidad += it.cantidad;
      prev.monto += it.subtotal;
      topMap.set(it.producto_id, prev);
    }
  }
  const topProductos = Array.from(topMap.values())
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  const nombreProd = (id: string) => {
    if (productosLookupQ.isLoading) return '…';
    const p = productosLookupQ.data?.find((x) => x.id === id);
    if (p) return p.nombre;
    // Producto borrado (la venta sigue en historial). Mostrar etiqueta clara
    // en vez del UUID crudo, conservando los primeros 8 chars para identificar.
    return `Producto eliminado (${id.slice(0, 8)}…)`;
  };

  const subRango = rango === 'hoy' ? 'Actualiza cada 10s' : LABEL_RANGO[rango];

  // Valores animados de las tarjetas financieras. Cada uno anima de 0 al
  // target en ~900ms con ease-out cuando cambia el rango → da un feel de
  // "loader" tipo Google sin agregar libs. Para las tarjetas operativas
  // (cajas abiertas / sin stock) lo dejamos estático, porque son enteros
  // chicos y el efecto no aporta.
  // Cada animación de KPI incluye el saldo inicial del arranque
  // (cuando aplica al rango seleccionado). Antes solo Facturado lo
  // sumaba; ahora también ganancia, efectivo y otros si el admin los
  // cargó en /configuracion.
  const totalRangoAnim = useCountUp(totalRango);
  const gananciaAnim = useCountUp(indicadores.ganancia + arranqueGanancia);
  const efectivoAnim = useCountUp(indicadores.efectivoTransf + arranqueEfectivo);
  const otrosAnim = useCountUp(indicadores.tarjetaQr + arranqueOtros);
  const valuacionCostoAnim = useCountUp(valuacion.totalCosto);
  const valuacionPrecioAnim = useCountUp(valuacion.totalPrecio);

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-700">
          Resumen · {subRango.toLowerCase()}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/ventas">
            Ver ventas <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>

      {/* Selector de rango — define qué período toman las tarjetas financieras. */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {(['hoy', 'semana', 'mes', 'anio', 'custom'] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={rango === r ? 'default' : 'outline'}
            onClick={() => setRango(r)}
          >
            {LABEL_RANGO[r]}
          </Button>
        ))}
        {rango === 'custom' && (
          <div className="flex items-end gap-2 rounded-md border bg-card px-3 py-2">
            <div>
              <label className="block text-[10px] uppercase text-muted-foreground">
                Desde
              </label>
              <Input
                type="date"
                value={customDesde}
                onChange={(e) => setCustomDesde(e.target.value)}
                className="h-8 w-[150px] text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-muted-foreground">
                Hasta
              </label>
              <Input
                type="date"
                value={customHasta}
                onChange={(e) => setCustomHasta(e.target.value)}
                className="h-8 w-[150px] text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Sección financiera del rango — los 4 números que más importan. */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/ventas" className="block">
          <KpiCard
            titulo={`Facturado ${LABEL_RANGO[rango].toLowerCase()}`}
            valor={formatCurrency(Math.round(totalRangoAnim))}
            sub={
              saldoInicialAplica
                ? `${ticketsRango} tickets · incluye ${formatCurrency(arranqueFact)} previo al sistema`
                : `${ticketsRango} tickets · ver historial`
            }
            icon={TrendingUp}
            loading={ventasQ.isLoading}
            destacado
          />
        </Link>
        <KpiCard
          titulo="Ganancia bruta"
          valor={formatCurrency(Math.round(gananciaAnim))}
          sub={
            arranqueGanancia > 0
              ? `Incluye ${formatCurrency(arranqueGanancia)} previo al sistema`
              : `Bruto (s/desc.): ${formatCurrency(indicadores.bruto)}`
          }
          icon={PiggyBank}
          loading={ventasQ.isLoading || productosLookupQ.isLoading}
        />
        <KpiCard
          titulo="Efectivo + transferencia"
          valor={formatCurrency(Math.round(efectivoAnim))}
          sub={
            arranqueEfectivo > 0
              ? `Incluye ${formatCurrency(arranqueEfectivo)} previo al sistema`
              : `${pctTexto(indicadores.efectivoTransf + arranqueEfectivo, totalRango)} del total`
          }
          icon={Banknote}
          loading={ventasQ.isLoading}
        />
        <KpiCard
          titulo="Tarjeta + QR"
          valor={formatCurrency(Math.round(otrosAnim))}
          sub={
            arranqueOtros > 0
              ? `Incluye ${formatCurrency(arranqueOtros)} previo al sistema`
              : 'Débito · Crédito · QR'
          }
          icon={CreditCard}
          loading={ventasQ.isLoading}
        />
      </div>

      {/* Distribución de cobros — efectivo vs el resto, en donut chart.
          Respeta el rango seleccionado (toma `indicadores` + arranque,
          igual que los KPIs de arriba). Si no hubo cobros en el período
          ni acumulado del arranque, muestra vacío. */}
      <div className="mb-4">
        <DonutCobros
          efectivo={indicadores.efectivoTransf + arranqueEfectivo}
          otros={indicadores.tarjetaQr + arranqueOtros}
          loading={ventasQ.isLoading}
        />
      </div>

      {/* Sección operativa — alertas y estado de cajas. */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Link href="/caja" className="block">
          <KpiCard
            titulo="Cajas abiertas"
            valor={String(sesionesAbiertas)}
            sub="Sesiones en curso · ver detalle"
            icon={Wallet}
            loading={sesionesQ.isLoading}
          />
        </Link>
        <Link href="/productos?stock=sin" className="block">
          <KpiCard
            titulo="Sin stock"
            valor={String(productosQ.data?.length ?? 0)}
            sub="Click para ver el listado"
            icon={AlertTriangle}
            loading={productosQ.isLoading}
            variant={productosQ.data && productosQ.data.length > 0 ? 'warn' : undefined}
          />
        </Link>
      </div>

      {/* Valuación de mercadería — snapshot del momento, no depende del rango.
          Cada card muestra el total grande arriba + desglose por depósito
          abajo. Ordenamos por valor descendente (el depósito más "gordo"
          primero) para que se lea de un vistazo. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ValuacionCard
          titulo="Mercadería al costo"
          valor={formatCurrency(Math.round(valuacionCostoAnim))}
          sub={`${valuacion.unidades.toLocaleString('es-AR')} unidades en stock`}
          icon={Warehouse}
          loading={valuacionCargando}
          desglose={[...valuacion.porDeposito]
            .filter((d) => d.unidades > 0)
            .sort((a, b) => b.costo - a.costo)
            .map((d) => ({
              nombre: d.nombre,
              monto: d.costo,
              unidades: d.unidades,
            }))}
        />
        <ValuacionCard
          titulo="Valor de venta (consumidor final)"
          valor={formatCurrency(Math.round(valuacionPrecioAnim))}
          sub={`Potencial si se vende todo el stock`}
          icon={Tag}
          loading={valuacionCargando}
          desglose={[...valuacion.porDeposito]
            .filter((d) => d.unidades > 0)
            .sort((a, b) => b.precio - a.precio)
            .map((d) => ({
              nombre: d.nombre,
              monto: d.precio,
              unidades: d.unidades,
            }))}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top productos · {LABEL_RANGO[rango].toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ventasQ.isLoading ? (
              <Skeleton className="h-40" />
            ) : topProductos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
            ) : (
              <div className="space-y-2">
                {topProductos.map((t, i) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Package className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">#{i + 1}</span>
                      <span>{nombreProd(t.id)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {t.cantidad} u · {formatCurrency(t.monto)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas ventas</CardTitle>
          </CardHeader>
          <CardContent>
            {ultimasVentasQ.isLoading ? (
              <Skeleton className="h-40" />
            ) : ultimasVentas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
            ) : (
              <div className="space-y-1">
                {/* ultimasVentas viene ordenado fecha DESC del repo. Es
                    independiente del rango elegido en el dashboard: acá
                    siempre son las últimas del sistema. */}
                {ultimasVentas.slice(0, 8).map((v) => {
                  // Texto resumen de los productos de la venta: si es 1
                  // solo, muestro el nombre; si son varios, primer nombre
                  // + "+N más". Más útil que el número de ticket para el
                  // dueño (pedido del cliente).
                  const productoLookup = (id: string) =>
                    productosLookupQ.data?.find((p) => p.id === id)?.nombre ?? 'Producto';
                  const nombres = v.items.map((it) => productoLookup(it.producto_id));
                  const primero = nombres[0] ?? '—';
                  const extra = nombres.length > 1 ? ` +${nombres.length - 1} más` : '';
                  return (
                    <div
                      key={v.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-xs text-foreground" title={nombres.join(', ')}>
                        {primero}
                        {extra && (
                          <span className="text-muted-foreground">{extra}</span>
                        )}
                      </span>
                      <span className="tabular-nums">{formatCurrency(v.total)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Devuelve un porcentaje legible (`45%`) o un guión si el total es 0. */
function pctTexto(parte: number, total: number): string {
  if (!total || total <= 0) return '—';
  return `${Math.round((parte / total) * 100)}%`;
}

/**
 * Anima un valor de 0 a `target` en `durationMs` con ease-out cubic,
 * actualizando vía `requestAnimationFrame` (sin libs). Re-dispara cuando
 * el target cambia → al cambiar el rango del dashboard los números se
 * "rellenan" de nuevo (efecto Google-style cargando).
 *
 * Si `target` baja por una nueva carga (p.ej. de mes con mucho a hoy con
 * poco), arrancamos de 0 igual — es lo que pidió el cliente: que en cada
 * cambio se sienta como un loader.
 */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  // El frame se cancela en cleanup; ref evita stale closures.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    // Cualquier animación previa la cortamos antes de empezar la nueva.
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (target === 0) {
      setValue(0);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setValue(target * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);
  return value;
}

/**
 * Donut de "cómo cobramos" en el período. Solo 2 slices: efectivo vs el
 * resto. Inline SVG con `pathLength=100` para que el dasharray sea el
 * porcentaje directo — sin lib externa.
 *
 * Animación: `useCountUp` anima efectivo y otros de 0 al target en sync.
 * Como el donut deriva los porcentajes de esos valores animados, se
 * "rellena" solo. Además aplicamos un fade-in suave la primera vez que
 * los datos están disponibles.
 */
function DonutCobros({
  efectivo,
  otros,
  loading,
}: {
  efectivo: number;
  otros: number;
  loading?: boolean;
}) {
  // Valores animados (cuentan de 0 al target con ease-out). Usamos
  // duraciones idénticas → quedan en sync sin que tengamos que combinarlos
  // en un único rAF.
  const efectivoAnim = useCountUp(efectivo);
  const otrosAnim = useCountUp(otros);

  // Fade-in la primera vez que `loading` pasa de true → false. Después se
  // queda visible; los cambios de rango se sienten vía el count-up.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (loading) return undefined;
    // Un tick para que el navegador pinte opacity-0 antes del transition.
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [loading]);

  const total = efectivo + otros;
  const totalAnim = efectivoAnim + otrosAnim;
  const pctEfectivoAnim = total > 0 ? (efectivoAnim / total) * 100 : 0;
  const pctOtrosAnim = total > 0 ? (otrosAnim / total) * 100 : 0;
  // Target del slice efectivo: lo usamos como offset del slice "otros" para
  // que su posición de arranque NO se mueva durante la animación.
  const pctEfectivoTarget = total > 0 ? (efectivo / total) * 100 : 0;

  // Tailwind no resuelve clases interpoladas → uso colores hex directos
  // tomados de la paleta del proyecto (verde-600 efectivo, índigo-500 otros).
  const COLOR_EFECTIVO = '#16a34a';
  const COLOR_OTROS = '#6366f1';
  const COLOR_VACIO = 'rgb(229 231 235)'; // gris claro (placeholder)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Cobros por método</CardTitle>
        <p className="text-xs text-muted-foreground">
          Distribución del período seleccionado · efectivo y transferencia
          de un lado, tarjeta y QR del otro.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-44" />
        ) : (
          <div
            className={`flex flex-col items-center gap-6 transition-opacity duration-700 ease-out sm:flex-row sm:items-center sm:gap-8 ${
              visible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* SVG donut.
                Usamos pathLength=100 → el strokeDasharray se expresa
                directamente como porcentaje. Las longitudes se animan
                con un transition CSS para que el "fill" del donut sea
                suave incluso si el count-up va a 60fps. */}
            <div className="relative h-44 w-44 shrink-0">
              <svg viewBox="0 0 100 100" className="-rotate-90">
                {/* Track de fondo gris — referencia visual cuando todavía
                    está rellenando o cuando no hay cobros. */}
                <circle
                  cx={50}
                  cy={50}
                  r={42}
                  fill="none"
                  stroke={COLOR_VACIO}
                  strokeWidth={14}
                />
                {total > 0 && (
                  <>
                    {/* Slice 1 — efectivo (verde) */}
                    <circle
                      cx={50}
                      cy={50}
                      r={42}
                      fill="none"
                      stroke={COLOR_EFECTIVO}
                      strokeWidth={14}
                      pathLength={100}
                      strokeDasharray={`${pctEfectivoAnim} ${100 - pctEfectivoAnim}`}
                      strokeDashoffset={0}
                      strokeLinecap="butt"
                    />
                    {/* Slice 2 — otros (índigo), empieza donde termina el
                        efectivo (target, no animado — para que no se "corra"
                        a medida que el efectivo crece). */}
                    <circle
                      cx={50}
                      cy={50}
                      r={42}
                      fill="none"
                      stroke={COLOR_OTROS}
                      strokeWidth={14}
                      pathLength={100}
                      strokeDasharray={`${pctOtrosAnim} ${100 - pctOtrosAnim}`}
                      strokeDashoffset={-pctEfectivoTarget}
                      strokeLinecap="butt"
                    />
                  </>
                )}
              </svg>
              {/* Centro: total cobrado del período (animado). */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total cobrado
                </span>
                <span className="text-lg font-bold tabular-nums">
                  {formatCurrency(Math.round(totalAnim))}
                </span>
              </div>
            </div>

            {/* Leyenda con monto + porcentaje por slice (también animados). */}
            <div className="flex-1 space-y-3 text-sm">
              <LeyendaSlice
                color={COLOR_EFECTIVO}
                etiqueta="Efectivo + transferencia"
                montoAnim={efectivoAnim}
                pctAnim={pctEfectivoAnim}
                total={total}
              />
              <LeyendaSlice
                color={COLOR_OTROS}
                etiqueta="Tarjeta + QR"
                montoAnim={otrosAnim}
                pctAnim={pctOtrosAnim}
                total={total}
              />
              {total === 0 && (
                <p className="text-xs italic text-muted-foreground">
                  Sin cobros registrados en el período.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LeyendaSlice({
  color,
  etiqueta,
  montoAnim,
  pctAnim,
  total,
}: {
  color: string;
  etiqueta: string;
  montoAnim: number;
  pctAnim: number;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-card/40 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="truncate text-sm">{etiqueta}</span>
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums">
          {formatCurrency(Math.round(montoAnim))}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {total > 0 ? `${pctAnim.toFixed(1)}%` : '—'}
        </div>
      </div>
    </div>
  );
}

/**
 * Variante del KpiCard que además del número grande muestra una tabla
 * chica con el desglose por depósito. Se usa para "Mercadería al costo"
 * y "Valor de venta" en el dashboard — Agus necesita ver cuánto capital
 * hay parado en cada local por separado.
 */
function ValuacionCard({
  titulo,
  valor,
  sub,
  icon: Icon,
  loading,
  desglose,
}: {
  titulo: string;
  valor: string;
  sub: string;
  icon: typeof TrendingUp;
  loading?: boolean;
  desglose: { nombre: string; monto: number; unidades: number }[];
}) {
  const nf = new Intl.NumberFormat('es-AR');
  return (
    <Card className="h-full transition hover:border-foreground/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {titulo}
          </CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="text-2xl font-bold tabular-nums">{valor}</div>
        )}
        <p className="text-xs text-muted-foreground">{sub}</p>

        {!loading && desglose.length > 0 && (
          <div className="mt-3 space-y-1 border-t pt-2">
            {desglose.map((d) => (
              <div
                key={d.nombre}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="truncate text-muted-foreground">{d.nombre}</span>
                <span className="shrink-0 text-right">
                  <span className="font-medium tabular-nums">
                    {formatCurrency(d.monto)}
                  </span>{' '}
                  <span className="text-muted-foreground tabular-nums">
                    · {nf.format(d.unidades)} u
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({
  titulo,
  valor,
  sub,
  icon: Icon,
  loading,
  variant,
  destacado,
}: {
  titulo: string;
  valor: string;
  sub: string;
  icon: typeof TrendingUp;
  loading?: boolean;
  variant?: 'warn';
  /** Marca esta tarjeta como la más importante visualmente. */
  destacado?: boolean;
}) {
  return (
    <Card
      className={`h-full transition hover:border-foreground/30 ${
        destacado ? 'border-primary/30 bg-primary/5' : ''
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
          <Icon
            className={`h-4 w-4 ${variant === 'warn' ? 'text-orange-500' : 'text-muted-foreground'}`}
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div
            // El "fade-in" del valor lo logramos vía el count-up de los
            // hooks `useCountUp` aplicados arriba: el número sube desde 0
            // al target con ease-out, así que la aparición ya se siente
            // dinámica sin necesidad de una animación de opacidad extra.
            className={`font-bold tabular-nums ${
              destacado ? 'text-3xl' : 'text-2xl'
            }`}
          >
            {valor}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
