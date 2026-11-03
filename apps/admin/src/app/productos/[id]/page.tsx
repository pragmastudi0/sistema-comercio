'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Button } from '@comercio/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';
import {
  PreciosFields,
  ProductoFormFields,
  productoToForm,
  type ProductoFormValues,
} from '@/components/producto-form';
import { ImagenesProducto } from '@/components/imagenes-producto';

export default function EditarProductoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const db = getDb();
  const router = useRouter();
  const qc = useQueryClient();

  const prodQ = useQuery({ queryKey: ['producto', id], queryFn: () => db.productos.get(id) });
  const categoriasQ = useQuery({ queryKey: ['categorias'], queryFn: () => db.categorias.list() });
  const proveedoresQ = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => db.proveedores.list({ activo: true }),
  });
  const listasQ = useQuery({ queryKey: ['listas-precio'], queryFn: () => db.listasPrecio.list() });
  const preciosActQ = useQuery({
    queryKey: ['precios-de', id],
    queryFn: () => db.productos.preciosDe(id),
  });
  const stockQ = useQuery({
    queryKey: ['stock-prod', id],
    queryFn: () => db.stock.porProducto(id),
  });
  const depositosQ = useQuery({ queryKey: ['depositos'], queryFn: () => db.depositos.list() });
  // Histórico de movimientos para mostrar estadísticas del producto.
  const movsQ = useQuery({
    queryKey: ['movs-prod', id],
    queryFn: () => db.stock.movimientos({ producto_id: id }),
  });

  const [values, setValues] = useState<ProductoFormValues | null>(null);
  const [precios, setPrecios] = useState<
    { listaId: string; escalas: { desde: number; precio: number }[] }[]
  >([]);

  useEffect(() => {
    if (prodQ.data && !values) {
      setValues(productoToForm(prodQ.data));
    }
  }, [prodQ.data, values]);

  useEffect(() => {
    if (listasQ.data && preciosActQ.data && precios.length === 0) {
      const arr = listasQ.data.map((l) => {
        const x = preciosActQ.data!.find((p) => p.lista_precio_id === l.id);
        return {
          listaId: l.id,
          escalas: x?.escalas.length ? x.escalas : [{ desde: 1, precio: 0 }],
        };
      });
      setPrecios(arr);
    }
  }, [listasQ.data, preciosActQ.data, precios.length]);

  const guardarMut = useMutation({
    mutationFn: async () => {
      if (!values) return;
      await db.productos.update(id, {
        codigo_interno: values.codigo_interno,
        nombre: values.nombre,
        descripcion: values.descripcion || undefined,
        descripcion_larga: values.descripcion_larga || undefined,
        // null explícito para que "— Ninguna —" / "— Ninguno —" borren
        // el valor asignado. Con undefined PostgREST omite la columna
        // y el valor viejo persiste.
        categoria_id: values.categoria_id || null,
        proveedor_id: values.proveedor_id || null,
        costo: values.costo,
        publicado_web: values.publicado_web,
        activo: values.activo,
        solo_por_bulto: values.solo_por_bulto,
        cantidad_minima_web: values.cantidad_minima_web || undefined,
        incremento_web: values.incremento_web > 1 ? values.incremento_web : undefined,
        atributos: Object.keys(values.atributos).length > 0 ? values.atributos : undefined,
      });
      for (const x of precios) {
        await db.productos.setPrecio(id, x.listaId, x.escalas);
      }
    },
    onSuccess: async () => {
      toast.success('Cambios guardados');
      await qc.invalidateQueries({ queryKey: ['productos-admin'] });
      await qc.invalidateQueries({ queryKey: ['producto', id] });
      await qc.invalidateQueries({ queryKey: ['precios-cf'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: () => db.productos.delete(id),
    onSuccess: async () => {
      toast.success('Producto eliminado');
      await qc.invalidateQueries({ queryKey: ['productos-admin'] });
      router.push('/productos');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (prodQ.isLoading || !values) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!prodQ.data) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <p>Producto no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/productos">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver
        </Link>
      </Button>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">{prodQ.data.nombre}</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (confirm(`¿Eliminar "${prodQ.data!.nombre}"? Esta acción no se puede deshacer.`))
                eliminarMut.mutate();
            }}
            className="text-destructive"
          >
            Eliminar
          </Button>
          <Button onClick={() => guardarMut.mutate()} disabled={guardarMut.isPending}>
            {guardarMut.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <ProductoFormFields
          values={values}
          onChange={setValues}
          categorias={categoriasQ.data ?? []}
          proveedores={proveedoresQ.data ?? []}
          costoActualizadoEn={prodQ.data.costo_actualizado_en ?? null}
        />
        <PreciosFields
          precios={precios}
          onChange={setPrecios}
          listas={listasQ.data ?? []}
          costo={values.costo}
          ultimaActualizacionPorLista={Object.fromEntries(
            (preciosActQ.data ?? []).map((p) => [
              p.lista_precio_id,
              p.actualizado_en,
            ]),
          )}
        />

        <ImagenesProducto productoId={id} />

        <EstadisticasProducto
          stocks={stockQ.data ?? []}
          movimientos={movsQ.data ?? []}
          depositos={depositosQ.data ?? []}
          costo={prodQ.data.costo}
          loading={stockQ.isLoading || movsQ.isLoading}
        />
      </div>
    </div>
  );
}

function EstadisticasProducto({
  stocks,
  movimientos,
  depositos,
  costo,
  loading,
}: {
  stocks: { deposito_id: string; cantidad: number }[];
  movimientos: { tipo: string; cantidad: number; fecha: string; deposito_id: string }[];
  depositos: { id: string; nombre: string }[];
  costo: number;
  loading: boolean;
}) {
  const stockTotal = stocks.reduce((acc, s) => acc + Number(s.cantidad), 0);
  // Movimientos por tipo. "Reposición" = todo lo que SUMA stock:
  // devolución por NC, transferencia entrante o ajuste positivo (asumimos
  // los ajustes con motivo de compra/reposición son entradas).
  const movsVenta = movimientos.filter((m) => m.tipo === 'venta');
  const movsReposicion = movimientos.filter(
    (m) =>
      m.tipo === 'devolucion' ||
      m.tipo === 'transferencia_entrada' ||
      (m.tipo === 'ajuste' && Number(m.cantidad) > 0),
  );
  const movsMerma = movimientos.filter((m) => m.tipo === 'merma');
  const unidadesVendidas = movsVenta.reduce((acc, m) => acc + Number(m.cantidad), 0);
  const unidadesReposicion = movsReposicion.reduce((acc, m) => acc + Number(m.cantidad), 0);
  const unidadesMerma = movsMerma.reduce((acc, m) => acc + Number(m.cantidad), 0);

  const fmtFecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  const fmtFechaCorta = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

  // Ventas filtradas por rango (de los últimos N días). Se usa para
  // calcular promedio diario y proyección de días de stock.
  const ahora = Date.now();
  const DIA = 24 * 60 * 60 * 1000;
  function ventasUltimos(dias: number): number {
    const desde = ahora - dias * DIA;
    return movsVenta
      .filter((m) => new Date(m.fecha).getTime() >= desde)
      .reduce((acc, m) => acc + Number(m.cantidad), 0);
  }
  const ventas7d = ventasUltimos(7);
  const ventas30d = ventasUltimos(30);
  const ventas90d = ventasUltimos(90);
  // Promedio diario sobre los últimos 30 días — un periodo lo
  // suficientemente largo para amortiguar días sin ventas, lo
  // suficientemente corto para reflejar la temporada actual.
  const promedioDiario = ventas30d / 30;
  // Días estimados hasta agotar el stock al ritmo actual de venta.
  // Si no hubo ventas en 30 días, no podemos proyectar.
  const diasStockProyectado =
    promedioDiario > 0 ? Math.floor(stockTotal / promedioDiario) : null;

  // Última venta y última reposición (objetos completos).
  const ultimaVentaMov = movsVenta.length
    ? movsVenta.reduce((a, b) => (a.fecha > b.fecha ? a : b))
    : null;
  const ultimaReposicionMov = movsReposicion.length
    ? movsReposicion.reduce((a, b) => (a.fecha > b.fecha ? a : b))
    : null;

  // Frecuencia de reposición = días promedio entre cargas. Solo si hay
  // al menos 2 reposiciones (sino no se puede promediar).
  let diasEntreReposiciones: number | null = null;
  if (movsReposicion.length >= 2) {
    const fechas = movsReposicion
      .map((m) => new Date(m.fecha).getTime())
      .sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < fechas.length; i++) {
      diffs.push((fechas[i]! - fechas[i - 1]!) / DIA);
    }
    diasEntreReposiciones =
      diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  // Próxima reposición estimada: última reposición + frecuencia promedio.
  let proximaReposicionEstimada: Date | null = null;
  if (ultimaReposicionMov && diasEntreReposiciones) {
    proximaReposicionEstimada = new Date(
      new Date(ultimaReposicionMov.fecha).getTime() +
        diasEntreReposiciones * DIA,
    );
  }

  // Timeline: últimos 8 movimientos por fecha desc para mostrar como
  // historial visual.
  const ultimosMovs = [...movimientos]
    .sort((a, b) => (a.fecha > b.fecha ? -1 : 1))
    .slice(0, 8);
  const LABEL_TIPO_MOV: Record<string, string> = {
    venta: 'Venta',
    devolucion: 'Devolución',
    ajuste: 'Ajuste',
    merma: 'Merma',
    transferencia_salida: 'Transf. salida',
    transferencia_entrada: 'Transf. entrada',
  };
  const COLOR_TIPO_MOV: Record<string, string> = {
    venta: 'text-blue-700 bg-blue-50',
    devolucion: 'text-green-700 bg-green-50',
    ajuste: 'text-muted-foreground bg-muted',
    merma: 'text-destructive bg-destructive/10',
    transferencia_salida: 'text-orange-700 bg-orange-50',
    transferencia_entrada: 'text-green-700 bg-green-50',
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Stock por local</CardTitle>
          <p className="text-sm text-muted-foreground">
            Para ajustar stock manualmente, ir a la sección Stock por local.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20" />
          ) : (
            <div className="space-y-1 text-sm">
              {depositos.map((d) => {
                const item = stocks.find((s) => s.deposito_id === d.id);
                const cantidad = Number(item?.cantidad ?? 0);
                return (
                  <div key={d.id} className="flex justify-between">
                    <span>{d.nombre}</span>
                    <span
                      className={`tabular-nums ${
                        cantidad <= 0
                          ? 'font-semibold text-destructive'
                          : cantidad < 5
                            ? 'text-orange-600'
                            : ''
                      }`}
                    >
                      {cantidad}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span
                  className={`tabular-nums ${
                    stockTotal <= 0 ? 'text-destructive' : ''
                  }`}
                >
                  {stockTotal}
                </span>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                Costo total estimado: {formatCurrency(stockTotal * costo)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ventas por período + proyección. */}
      <Card>
        <CardHeader>
          <CardTitle>Rotación y proyección</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cómo se mueve este producto últimamente y cuándo va a faltar.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Mini titulo="Vendidas · 7 días" valor={`${ventas7d} u`} />
                <Mini
                  titulo="Vendidas · 30 días"
                  valor={`${ventas30d} u`}
                  sub={`${promedioDiario.toFixed(1)} por día (promedio)`}
                />
                <Mini titulo="Vendidas · 90 días" valor={`${ventas90d} u`} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div
                  className={`rounded-md border p-3 ${
                    diasStockProyectado === null
                      ? 'bg-muted/30'
                      : diasStockProyectado <= 3
                        ? 'border-destructive/40 bg-destructive/5'
                        : diasStockProyectado <= 7
                          ? 'border-orange-300 bg-orange-50'
                          : 'bg-muted/30'
                  }`}
                >
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Días de stock proyectado
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {diasStockProyectado === null
                      ? '—'
                      : `${diasStockProyectado} días`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {diasStockProyectado === null
                      ? 'Sin ventas en 30 días para proyectar'
                      : `Al ritmo de ${promedioDiario.toFixed(1)} u/día`}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Total histórico
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {unidadesVendidas} u
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {movsVenta.length} venta{movsVenta.length === 1 ? '' : 's'}{' '}
                    desde alta del producto
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Reposiciones y frecuencia. */}
      <Card>
        <CardHeader>
          <CardTitle>Reposiciones</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cuándo y con qué frecuencia se carga stock de este producto.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Mini
                titulo="Última reposición"
                valor={
                  ultimaReposicionMov
                    ? fmtFecha(ultimaReposicionMov.fecha)
                    : '—'
                }
                sub={
                  ultimaReposicionMov
                    ? `${ultimaReposicionMov.cantidad} unidad(es)`
                    : 'Nunca se cargó stock'
                }
              />
              <Mini
                titulo="Última venta"
                valor={
                  ultimaVentaMov ? fmtFecha(ultimaVentaMov.fecha) : '—'
                }
                sub={
                  ultimaVentaMov ? 'Última vez que salió del stock' : 'Sin ventas todavía'
                }
              />
              <Mini
                titulo="Frecuencia de reposición"
                valor={
                  diasEntreReposiciones === null
                    ? '—'
                    : `~${Math.round(diasEntreReposiciones)} días`
                }
                sub={
                  diasEntreReposiciones === null
                    ? 'Necesita al menos 2 reposiciones'
                    : `Cada cuánto se pide en promedio`
                }
              />
              <Mini
                titulo="Próxima reposición estimada"
                valor={
                  proximaReposicionEstimada
                    ? fmtFecha(proximaReposicionEstimada.toISOString())
                    : '—'
                }
                sub={
                  proximaReposicionEstimada
                    ? 'Basado en frecuencia histórica'
                    : 'Datos insuficientes para estimar'
                }
              />
              <Mini
                titulo="Total repuesto"
                valor={`${unidadesReposicion} u`}
                sub={`${movsReposicion.length} reposición(es) registradas`}
              />
              {unidadesMerma > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <div className="text-xs uppercase tracking-wider text-destructive">
                    Mermas / roturas
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-destructive">
                    {unidadesMerma} u
                  </div>
                  <div className="text-xs text-destructive/80">
                    {movsMerma.length} ajuste(s) por rotura o pérdida
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline de movimientos recientes. */}
      <Card>
        <CardHeader>
          <CardTitle>Últimos movimientos</CardTitle>
          <p className="text-sm text-muted-foreground">
            Las 8 operaciones más recientes que afectaron el stock.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40" />
          ) : ultimosMovs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin movimientos todavía.
            </p>
          ) : (
            <div className="space-y-1.5">
              {ultimosMovs.map((m, idx) => {
                const dep = depositos.find((d) => d.id === m.deposito_id);
                const color =
                  COLOR_TIPO_MOV[m.tipo] ?? 'text-muted-foreground bg-muted';
                const label = LABEL_TIPO_MOV[m.tipo] ?? m.tipo;
                const motivo = (m as { motivo?: string }).motivo;
                return (
                  <div
                    key={`${m.fecha}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${color}`}
                      >
                        {label}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs">
                          {dep?.nombre ?? 'depósito desconocido'}
                          {motivo && (
                            <span className="text-muted-foreground"> · {motivo}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {fmtFechaCorta(m.fecha)}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {m.tipo === 'venta' ||
                      m.tipo === 'merma' ||
                      m.tipo === 'transferencia_salida'
                        ? '−'
                        : '+'}
                      {m.cantidad}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Mini({
  titulo,
  valor,
  sub,
}: {
  titulo: string;
  valor: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
