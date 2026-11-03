'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Globe,
  Search,
  ExternalLink,
  Pencil,
  Eye,
  EyeOff,
  Percent,
  Layers,
  Save,
  Trash2,
  Plus,
  FileDown,
} from 'lucide-react';
import { generarCatalogoPdf } from '@/lib/pdf-catalogo';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { formatCurrency } from '@comercio/ui/utils';
import {
  PRESET_IDS,
  type EscalaMayorista,
  type FiltroProductos,
  type Producto,
} from '@comercio/db';
import { calcularPrecioMayorista } from '@comercio/business';
import { ImagenesProducto } from '@/components/imagenes-producto';
import { InfoTip } from '@/components/info-tip';
import { PaginaProtegida, usePermiso } from '@/lib/permisos';

// Sin fallback hardcodeado: si no está la env var, se ocultan los links al sitio.
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? '';
const PAGE_SIZE = 100;
// Los productos importados desde Excel al arrancar quedaron con la lista
// legacy 'lp_cf'; los nuevos usan el UUID. Buscamos por ambos para no
// perder precios de productos viejos.
const LISTA_CF_IDS = [PRESET_IDS.listas.consumidorFinal, 'lp_cf'];

function WebPageInner() {
  const db = getDb();
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'publicados' | 'ocultos'>('todos');
  const [page, setPage] = useState(0);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const filaSeleccionadaRef = useRef<HTMLTableRowElement | null>(null);
  const puedeEditar = usePermiso('productos', 'publicar_ecommerce');

  useEffect(() => {
    setPage(0);
  }, [texto, filtro]);

  const productosQ = useQuery({
    queryKey: ['productos-web-admin'],
    queryFn: () => db.productos.list({ activo: true }),
  });
  const categoriasQ = useQuery({
    queryKey: ['categorias'],
    queryFn: () => db.categorias.list(),
  });
  const proveedoresQ = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => db.proveedores.list(),
  });
  const configQ = useQuery({
    queryKey: ['config'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });
  // Precio CF por producto — base sobre la que se calcula el mayorista.
  // Traemos TODAS las escalas de las listas CF en queries paginadas, en
  // vez de hacer 1 query por producto (eran ~3 minutos con 1907 productos).
  //
  // Usamos Promise.allSettled porque `lista_precio_id` es de tipo uuid en
  // Postgres, y el id legacy 'lp_cf' del mock rompe el WHERE con error
  // "invalid input syntax for type uuid". Si Promise.all fallara por eso,
  // perderíamos también los precios del UUID canónico → todos aparecerían
  // en $0.
  const preciosCfQ = useQuery({
    queryKey: ['precios-cf-web-admin'],
    queryFn: async () => {
      const resultados = await Promise.allSettled(
        LISTA_CF_IDS.map((id) => db.productos.preciosDeLista(id)),
      );
      const map = new Map<string, number>();
      for (const r of resultados) {
        if (r.status !== 'fulfilled') continue;
        for (const lp of r.value) {
          if (map.has(lp.producto_id)) continue;
          const escs = [...(lp.escalas ?? [])].sort((a, b) => a.desde - b.desde);
          map.set(lp.producto_id, escs[0]?.precio ?? 0);
        }
      }
      return map;
    },
    staleTime: 60_000,
  });

  const togglePublicarMut = useMutation({
    mutationFn: ({ id, publicar }: { id: string; publicar: boolean }) =>
      db.productos.update(id, { publicado_web: publicar }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productos-web-admin'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publicarTodosMut = useMutation({
    mutationFn: async (publicar: boolean) => {
      const todos = productosQ.data ?? [];
      let cambios = 0;
      for (const p of todos) {
        if (p.publicado_web !== publicar) {
          await db.productos.update(p.id, { publicado_web: publicar });
          cambios += 1;
        }
      }
      return cambios;
    },
    onSuccess: (cambios) => {
      toast.success(`${cambios} producto(s) actualizado(s)`);
      qc.invalidateQueries({ queryKey: ['productos-web-admin'] });
    },
  });

  const descuentoGlobalPct = configQ.data?.descuento_mayorista_pct ?? 0;
  const escalasGlobales = configQ.data?.escalas_mayorista_cantidad ?? [];

  const productos = productosQ.data ?? [];
  const publicados = productos.filter((p) => p.publicado_web);
  const ocultos = productos.filter((p) => !p.publicado_web);

  let visibles = productos;
  if (filtro === 'publicados') visibles = publicados;
  if (filtro === 'ocultos') visibles = ocultos;
  if (texto) {
    const q = texto.toLowerCase();
    visibles = visibles.filter(
      (p) => p.nombre.toLowerCase().includes(q) || p.codigo_interno.includes(q),
    );
  }

  const totalVisibles = visibles.length;
  const totalPages = Math.max(1, Math.ceil(totalVisibles / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const desdeIdx = pageSafe * PAGE_SIZE;
  const hastaIdx = Math.min(desdeIdx + PAGE_SIZE, totalVisibles);
  const pagina = visibles.slice(desdeIdx, hastaIdx);

  const categoriaNombre = (id: string | null | undefined) =>
    (id && categoriasQ.data?.find((c) => c.id === id)?.nombre) || '—';

  // Cuando cambia la lista visible y el seleccionado no está, elegir el
  // primero — mismo patrón que /admin/productos.
  useEffect(() => {
    if (!pagina.length) return;
    if (!seleccionadoId || !pagina.some((p) => p.id === seleccionadoId)) {
      setSeleccionadoId(pagina[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina.map((p) => p.id).join(',')]);

  const [ajusteOpen, setAjusteOpen] = useState(false);

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">E-commerce mayorista</h1>
          <p className="text-xs text-muted-foreground">
            Descuentos, escalas y publicación del catálogo web.
          </p>
        </div>
        {WEB_URL && (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={WEB_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" />
                Ver sitio público
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* Configuración mayorista global */}
      <ConfigMayorista
        loading={configQ.isLoading}
        descuentoGlobalPct={descuentoGlobalPct}
        escalasGlobales={escalasGlobales}
        mayoristaDesdeMonto={configQ.data?.mayorista_desde_monto ?? 0}
        disabled={!puedeEditar}
        onSaved={() => qc.invalidateQueries({ queryKey: ['config'] })}
      />

      {/* KPIs compactos */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <KpiChip
          titulo="Publicados"
          valor={publicados.length}
          icon={Eye}
          accent
          loading={productosQ.isLoading}
        />
        <KpiChip
          titulo="Ocultos"
          valor={ocultos.length}
          icon={EyeOff}
          loading={productosQ.isLoading}
        />
        <KpiChip
          titulo="Total catálogo"
          valor={productos.length}
          icon={Globe}
          loading={productosQ.isLoading}
        />
      </div>

      {/* Layout tabla + panel detalle (estilo /admin/productos) */}
      <div className="flex min-h-[600px] flex-col gap-3 lg:h-[calc(100vh-380px)] lg:flex-row">
        {/* Tabla izquierda */}
        <div className="flex min-h-0 flex-1 flex-col rounded border border-slate-300 bg-white shadow-sm lg:basis-[65%]">
          {/* Toolbar */}
          <div className="grid grid-cols-1 gap-2 border-b border-slate-200 bg-slate-50 p-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar por nombre o código"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                className="h-8 pl-7 text-sm"
              />
            </div>
            <div className="flex gap-1 rounded-md border border-slate-300 bg-white p-0.5 text-xs">
              {(['todos', 'publicados', 'ocultos'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`rounded px-2 py-0.5 ${
                    filtro === f
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {f === 'todos' ? 'Todos' : f === 'publicados' ? 'Publicados' : 'Ocultos'}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!publicados.length) {
                  toast.warning('No hay productos publicados para exportar.');
                  return;
                }
                try {
                  const doc = generarCatalogoPdf({
                    productos: publicados.map((p) => ({
                      ...p,
                      precio_cf: preciosCfQ.data?.get(p.id) ?? 0,
                    })),
                    categoriaNombrePorId: categoriaNombre,
                    descuentoGlobalPct,
                    escalasGlobales,
                    empresa: { nombre: configQ.data?.comercio?.razon_social },
                  });
                  const fecha = new Date().toISOString().slice(0, 10);
                  doc.save(`catalogo-mayorista-${fecha}.pdf`);
                  toast.success(`PDF listo — ${publicados.length} productos`);
                } catch (e) {
                  console.error('[pdf-catalogo]', e);
                  toast.error('No pudimos generar el PDF. Revisá la consola.');
                }
              }}
              className="h-8 text-xs"
              title="Descargar PDF con los productos publicados"
            >
              <FileDown className="mr-1 h-3 w-3" />
              PDF catálogo
            </Button>
            <Button
              size="sm"
              onClick={() => setAjusteOpen(true)}
              disabled={!puedeEditar}
              className="h-8 text-xs"
            >
              <Percent className="mr-1 h-3 w-3" />
              Ajuste masivo
            </Button>
          </div>

          {/* Acciones rápidas — chicas, embebidas */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5 text-xs">
            <button
              disabled={
                publicarTodosMut.isPending ||
                publicados.length === productos.length ||
                !puedeEditar
              }
              onClick={() => {
                if (
                  confirm(`¿Publicar los ${ocultos.length} productos ocultos en la web?`)
                )
                  publicarTodosMut.mutate(true);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <Eye className="mr-1 inline h-3 w-3" />
              Publicar todos
            </button>
            <button
              disabled={
                publicarTodosMut.isPending ||
                ocultos.length === productos.length ||
                !puedeEditar
              }
              onClick={() => {
                if (confirm(`¿Ocultar los ${publicados.length} productos publicados?`))
                  publicarTodosMut.mutate(false);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <EyeOff className="mr-1 inline h-3 w-3" />
              Ocultar todos
            </button>
            <span className="ml-auto text-slate-500">
              {totalVisibles === 0
                ? `0 de ${productos.length}`
                : `${desdeIdx + 1}–${hastaIdx} de ${totalVisibles}`}
            </span>
          </div>

          {/* Tabla compacta estilo software viejo */}
          <div className="flex-1 overflow-auto">
            {productosQ.isLoading ? (
              <Skeleton className="m-2 h-40" />
            ) : totalVisibles === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No hay productos que coincidan.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase text-slate-600 shadow-sm">
                  <tr>
                    <th className="border-b border-r border-slate-300 px-2 py-1.5 text-center w-10">
                      Web
                    </th>
                    <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">
                      Artículo
                    </th>
                    <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left w-20">
                      Código
                    </th>
                    <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">
                      Grupo
                    </th>
                    <th className="border-b border-r border-slate-300 px-2 py-1.5 text-right w-24">
                      Precio local{' '}
                      <InfoTip text="Precio Consumidor Final del sistema (lo que se cobra en el local). Es la base sobre la que se aplica el descuento mayorista." />
                    </th>
                    <th className="border-b border-r border-slate-300 px-2 py-1.5 text-right w-14">
                      Desc.
                    </th>
                    <th className="border-b border-slate-300 px-2 py-1.5 text-right w-28">
                      Precio web{' '}
                      <InfoTip text="Precio final que ve el cliente mayorista en la tienda web. Se calcula: precio local menos el % de descuento." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.map((p) => {
                    const cf = preciosCfQ.data?.get(p.id) ?? 0;
                    const calc = calcularPrecioMayorista({
                      precioCF: cf,
                      descuentoOverridePct: p.descuento_mayorista_pct_override,
                      descuentoGlobalPct,
                      cantidad: 1,
                      redondeo: 'cent',
                    });
                    const seleccionado = p.id === seleccionadoId;
                    const usaOverride = calc.fuente === 'override';
                    return (
                      <tr
                        key={p.id}
                        ref={seleccionado ? filaSeleccionadaRef : undefined}
                        onClick={() => setSeleccionadoId(p.id)}
                        className={`cursor-pointer border-b border-slate-200 ${
                          seleccionado
                            ? 'bg-blue-100 font-medium'
                            : 'hover:bg-blue-50/50'
                        }`}
                      >
                        <td className="border-r border-slate-200 px-1 py-0.5 text-center">
                          <ToggleSwitch
                            checked={p.publicado_web}
                            onChange={(v) => {
                              togglePublicarMut.mutate({ id: p.id, publicar: v });
                            }}
                            disabled={togglePublicarMut.isPending || !puedeEditar}
                          />
                        </td>
                        <td className="border-r border-slate-200 px-2 py-1">{p.nombre}</td>
                        <td className="border-r border-slate-200 px-2 py-1 font-mono">
                          {p.codigo_interno}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-1 text-slate-600">
                          {categoriaNombre(p.categoria_id)}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums text-slate-600">
                          {formatCurrency(cf)}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums">
                          <span className={usaOverride ? 'font-semibold text-cyan-700' : ''}>
                            {calc.pctAplicado}%
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">
                          {formatCurrency(calc.precio)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer paginación */}
          {totalVisibles > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
              <span className="text-slate-500">
                Página {pageSafe + 1} de {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={pageSafe === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded-sm border border-slate-300 bg-white px-2 py-0.5 disabled:opacity-40"
                >
                  ← Anterior
                </button>
                <button
                  disabled={pageSafe >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="rounded-sm border border-slate-300 bg-white px-2 py-0.5 disabled:opacity-40"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Panel detalle derecha */}
        <div className="flex min-h-0 flex-1 flex-col rounded border border-slate-300 bg-white shadow-sm lg:basis-[35%]">
          {seleccionadoId && productos.find((p) => p.id === seleccionadoId) ? (
            <PanelDetalleWeb
              producto={productos.find((p) => p.id === seleccionadoId)!}
              precioCF={preciosCfQ.data?.get(seleccionadoId) ?? 0}
              descuentoGlobalPct={descuentoGlobalPct}
              escalasGlobales={escalasGlobales}
              categoriaNombre={categoriaNombre(
                productos.find((p) => p.id === seleccionadoId)!.categoria_id,
              )}
              proveedorNombre={
                proveedoresQ.data?.find(
                  (x) => x.id === productos.find((p) => p.id === seleccionadoId)!.proveedor_id,
                )?.nombre ?? '—'
              }
              disabled={!puedeEditar}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['productos-web-admin'] });
                qc.invalidateQueries({ queryKey: ['producto-detalle'] });
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Elegí un producto de la lista para ver y editar sus datos de e-commerce.
            </div>
          )}
        </div>
      </div>

      {ajusteOpen && (
        <AjusteMasivoDialog
          onClose={() => setAjusteOpen(false)}
          categorias={categoriasQ.data ?? []}
          proveedores={proveedoresQ.data ?? []}
          descuentoGlobalPct={descuentoGlobalPct}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['productos-web-admin'] });
            qc.invalidateQueries({ queryKey: ['producto-detalle'] });
          }}
        />
      )}
    </div>
  );
}

/** Panel derecho — datos del producto ORIENTADOS A E-COMMERCE:
 *  fotos, descripciones, precios calculados, margen sobre costo, override
 *  y config de venta web (bulto/mínimo/incremento). */
function PanelDetalleWeb({
  producto,
  precioCF,
  descuentoGlobalPct,
  escalasGlobales,
  categoriaNombre,
  proveedorNombre,
  disabled,
  onSaved,
}: {
  producto: Producto;
  precioCF: number;
  descuentoGlobalPct: number;
  escalasGlobales: EscalaMayorista[];
  categoriaNombre: string;
  proveedorNombre: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const db = getDb();
  const verCosto = usePermiso('productos', 'ver_costo');

  const [nombreWeb, setNombreWeb] = useState(producto.nombre_web ?? '');
  const [descripcion, setDescripcion] = useState(producto.descripcion ?? '');
  const [descripcionLarga, setDescripcionLarga] = useState(
    producto.descripcion_larga ?? '',
  );
  const [descuentoPropioTxt, setDescuentoPropioTxt] = useState(
    producto.descuento_mayorista_pct_override != null
      ? String(producto.descuento_mayorista_pct_override)
      : '',
  );
  const [soloPorBulto, setSoloPorBulto] = useState(producto.solo_por_bulto ?? false);
  const [cantidadMinimaTxt, setCantidadMinimaTxt] = useState(
    producto.cantidad_minima_web != null ? String(producto.cantidad_minima_web) : '',
  );
  const [incrementoTxt, setIncrementoTxt] = useState(
    producto.incremento_web != null ? String(producto.incremento_web) : '',
  );

  // Cuando cambia de producto, reset del state.
  useEffect(() => {
    setNombreWeb(producto.nombre_web ?? '');
    setDescripcion(producto.descripcion ?? '');
    setDescripcionLarga(producto.descripcion_larga ?? '');
    setDescuentoPropioTxt(
      producto.descuento_mayorista_pct_override != null
        ? String(producto.descuento_mayorista_pct_override)
        : '',
    );
    setSoloPorBulto(producto.solo_por_bulto ?? false);
    setCantidadMinimaTxt(
      producto.cantidad_minima_web != null ? String(producto.cantidad_minima_web) : '',
    );
    setIncrementoTxt(
      producto.incremento_web != null ? String(producto.incremento_web) : '',
    );
  }, [producto.id]);

  const guardarMut = useMutation({
    mutationFn: async () => {
      const t = descuentoPropioTxt.trim();
      const propioNum = t ? parseFloat(t) : NaN;
      const descuentoPropio = t && Number.isFinite(propioNum)
        ? Math.max(0, Math.min(100, propioNum))
        : null;
      const cantMin = parseInt(cantidadMinimaTxt, 10);
      const incr = parseInt(incrementoTxt, 10);
      await db.productos.update(producto.id, {
        nombre_web: nombreWeb.trim() || null,
        descripcion: descripcion.trim() || undefined,
        descripcion_larga: descripcionLarga.trim() || undefined,
        descuento_mayorista_pct_override: descuentoPropio,
        solo_por_bulto: soloPorBulto,
        cantidad_minima_web: Number.isFinite(cantMin) && cantMin > 0 ? cantMin : undefined,
        incremento_web: Number.isFinite(incr) && incr > 1 ? incr : undefined,
      } as Partial<Producto>);
    },
    onSuccess: () => {
      toast.success('Datos guardados');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePublicarMut = useMutation({
    mutationFn: () =>
      db.productos.update(producto.id, { publicado_web: !producto.publicado_web }),
    onSuccess: () => onSaved(),
    onError: (e: Error) => toast.error(e.message),
  });

  // Cálculos con precisión — usa el descuento propio si lo hay, sino el general.
  const propioNum = descuentoPropioTxt.trim()
    ? parseFloat(descuentoPropioTxt)
    : NaN;
  const descuentoPropio =
    descuentoPropioTxt.trim() && Number.isFinite(propioNum)
      ? Math.max(0, Math.min(100, propioNum))
      : null;
  const calcUno = calcularPrecioMayorista({
    precioCF,
    descuentoOverridePct: descuentoPropio,
    descuentoGlobalPct,
    cantidad: 1,
  });

  // Preview por escalas globales de cantidad.
  const previewEscalas = useMemo(() => {
    const puntos = new Set<number>([1]);
    for (const e of escalasGlobales) if (e.desde > 1) puntos.add(e.desde);
    return Array.from(puntos)
      .sort((a, b) => a - b)
      .map((cant) => {
        const r = calcularPrecioMayorista({
          precioCF,
          descuentoOverridePct: descuentoPropio,
          descuentoGlobalPct,
          escalas: escalasGlobales,
          cantidad: cant,
        });
        return { cant, precio: r.precio, pct: r.pctAplicado };
      });
  }, [precioCF, descuentoPropio, descuentoGlobalPct, escalasGlobales]);

  // Margen sobre COSTO al precio mayorista @1u. Sirve para ver si un descuento
  // agresivo deja negativo.
  const costo = producto.costo ?? 0;
  const margenMonto = calcUno.precio - costo;
  const margenPct = costo > 0 ? ((calcUno.precio - costo) / costo) * 100 : 0;
  const margenNegativo = margenMonto < 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header sticky con nombre + código + toggle publicar */}
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">
              {producto.nombre}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-600">
              <span className="font-mono">#{producto.codigo_interno}</span>
              <span>·</span>
              <span>{categoriaNombre}</span>
              {proveedorNombre && proveedorNombre !== '—' && (
                <>
                  <span>·</span>
                  <span>{proveedorNombre}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => togglePublicarMut.mutate()}
              disabled={togglePublicarMut.isPending || disabled}
              className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${
                producto.publicado_web
                  ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              } disabled:opacity-50`}
            >
              {producto.publicado_web ? (
                <>
                  <Eye className="h-3 w-3" />
                  Publicado
                </>
              ) : (
                <>
                  <EyeOff className="h-3 w-3" />
                  Oculto
                </>
              )}
            </button>
            <Button asChild variant="outline" size="sm" className="h-6 px-2 text-[11px]">
              <Link href={`/productos/${producto.id}`}>
                <Pencil className="mr-1 h-3 w-3" />
                Editar todo
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Cuerpo scroll */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Precio final para el cliente — headline */}
        <div className="rounded border border-cyan-200 bg-cyan-50/40 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-cyan-800">
            Precio final en la tienda (1 unidad){' '}
            <InfoTip text="Es lo que ve el cliente en la web mayorista al comprar 1 unidad. Sale de restarle el descuento al precio del local." />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-cyan-900">
              {formatCurrency(calcUno.precio)}
            </span>
            <span className="text-xs text-slate-600">
              ({calcUno.pctAplicado}% de descuento ·{' '}
              {calcUno.fuente === 'override'
                ? 'propio de este producto'
                : calcUno.fuente === 'global'
                  ? `general ${descuentoGlobalPct}%`
                  : 'sin descuento'}
              )
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600">
            Precio en el local:{' '}
            <span className="tabular-nums">{formatCurrency(precioCF)}</span>
            {precioCF === 0 && (
              <span className="ml-2 text-amber-700">— este producto no tiene precio cargado</span>
            )}
          </div>
        </div>

        {/* Preview por cantidades */}
        {previewEscalas.length > 1 && (
          <div className="rounded border border-slate-200 bg-slate-50/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
              <Layers className="h-3 w-3" />
              Precio por cantidad{' '}
              <InfoTip text="Si configuraste rebajas por cantidad en la sección de arriba, acá se ve cómo baja el precio cuando el cliente compra más unidades." />
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {previewEscalas.map((r) => (
                <span
                  key={r.cant}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 tabular-nums"
                >
                  {r.cant}u → <strong>{formatCurrency(r.precio)}</strong>
                  <span className="ml-1 text-slate-500">({r.pct}%)</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Margen sobre costo — solo si tiene permiso ver_costo */}
        {verCosto && costo > 0 && (
          <div
            className={`rounded border p-2 ${
              margenNegativo
                ? 'border-red-300 bg-red-50'
                : 'border-slate-200 bg-slate-50/60'
            }`}
          >
            <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
              Ganancia sobre el costo (vendiendo 1 unidad en la web){' '}
              <InfoTip text="Cuánto ganás por vender esta unidad al precio de la tienda web. Si te sale rojo, el descuento es tan alto que estás perdiendo plata." />
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <div>
                <span className="text-slate-600">Te cuesta:</span>{' '}
                <span className="tabular-nums">{formatCurrency(costo)}</span>
              </div>
              <div>
                <span className="text-slate-600">Ganás:</span>{' '}
                <span
                  className={`font-semibold tabular-nums ${
                    margenNegativo ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {formatCurrency(margenMonto)}{' '}
                  {costo > 0 && (
                    <span className="text-xs">
                      ({margenPct >= 0 ? '+' : ''}
                      {margenPct.toFixed(0)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
            {margenNegativo && (
              <div className="mt-1 text-[11px] font-medium text-red-700">
                ⚠ Estás vendiendo a pérdida — el descuento es más grande que la ganancia.
              </div>
            )}
          </div>
        )}

        {/* Nombre para la tienda */}
        <div>
          <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Nombre para la tienda web (opcional){' '}
            <InfoTip text="Si internamente le pusiste un nombre raro (con códigos, apodos, etc.) podés poner acá otro más claro solo para que vea el cliente. Si lo dejás vacío, se muestra el mismo nombre del sistema." />
          </Label>
          <Input
            placeholder={producto.nombre}
            value={nombreWeb}
            onChange={(e) => setNombreWeb(e.target.value)}
            disabled={disabled}
            className="h-7 text-sm"
          />
        </div>

        {/* Descuento propio del producto */}
        <div>
          <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Descuento propio de este producto (%){' '}
            <InfoTip text="Si este producto va a tener un descuento distinto al general de la tienda, ponelo acá. Ej: si el descuento general es 30% pero este producto lo querés al 45%, escribí 45. Si lo dejás vacío, usa el general." />
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              placeholder={`vacío = usa el general (${descuentoGlobalPct}%)`}
              value={descuentoPropioTxt}
              onChange={(e) => setDescuentoPropioTxt(e.target.value)}
              disabled={disabled}
              className="h-7 w-32 text-sm"
            />
            <span className="text-xs text-slate-600">%</span>
            {descuentoPropioTxt && (
              <button
                onClick={() => setDescuentoPropioTxt('')}
                disabled={disabled}
                className="text-[11px] text-slate-500 underline hover:text-slate-700"
                title="Volver a usar el descuento general"
              >
                borrar
              </button>
            )}
          </div>
        </div>

        {/* Fotos */}
        <div>
          <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Fotos del producto{' '}
            <InfoTip text="Las fotos aparecen en la tienda web. La primera es la principal (la que se ve en el listado). Podés agregar varias y reordenarlas." />
          </Label>
          <ImagenesProducto productoId={producto.id} />
        </div>

        {/* Descripción corta */}
        <div>
          <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Descripción corta{' '}
            <InfoTip text="Una línea de texto que aparece bajo el nombre del producto en la web. Ej: 'Set de 4 vasos térmicos con tapa'." />
          </Label>
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={disabled}
            className="h-7 text-sm"
          />
        </div>

        {/* Descripción larga */}
        <div>
          <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Descripción larga{' '}
            <InfoTip text="Texto más completo que aparece en la página del producto: materiales, medidas, colores, usos, etc." />
          </Label>
          <textarea
            value={descripcionLarga}
            onChange={(e) => setDescripcionLarga(e.target.value)}
            disabled={disabled}
            rows={4}
            className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </div>

        {/* Reglas de venta web */}
        <div className="rounded border border-slate-200 bg-slate-50/60 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Cómo se vende en la web{' '}
            <InfoTip text="Reglas para el cliente al comprar por la tienda web. No afectan al PoS ni a la venta en el local." />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={soloPorBulto}
              onChange={(e) => setSoloPorBulto(e.target.checked)}
              disabled={disabled}
              className="h-3.5 w-3.5"
            />
            Solo se vende de a bulto (no se puede pedir 1 sola unidad)
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-0.5 flex items-center gap-1 text-[10px] uppercase text-slate-600">
                Compra mínima{' '}
                <InfoTip text="Cantidad mínima de unidades que puede pedir el cliente. Dejalo vacío si no hay mínimo." />
              </Label>
              <Input
                type="number"
                min="0"
                placeholder="sin mínimo"
                value={cantidadMinimaTxt}
                onChange={(e) => setCantidadMinimaTxt(e.target.value)}
                disabled={disabled}
                className="h-7 text-sm"
              />
            </div>
            <div>
              <Label className="mb-0.5 flex items-center gap-1 text-[10px] uppercase text-slate-600">
                Se pide de a{' '}
                <InfoTip text="Cada cuántas unidades se incrementa. Ej: 6 → el cliente solo puede pedir 6, 12, 18... 1 = unidad suelta." />
              </Label>
              <Input
                type="number"
                min="1"
                placeholder="1 = unidad"
                value={incrementoTxt}
                onChange={(e) => setIncrementoTxt(e.target.value)}
                disabled={disabled}
                className="h-7 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer sticky con guardar */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          {producto.publicado_web && WEB_URL && (
            <Button asChild variant="ghost" size="sm" className="h-7 text-[11px]">
              <a
                href={`${WEB_URL}/catalogo/${producto.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                Ver en la web
              </a>
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => guardarMut.mutate()}
            disabled={guardarMut.isPending || disabled}
            className="ml-auto"
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfigMayorista({
  loading,
  descuentoGlobalPct,
  escalasGlobales,
  mayoristaDesdeMonto,
  disabled,
  onSaved,
}: {
  loading: boolean;
  descuentoGlobalPct: number;
  escalasGlobales: EscalaMayorista[];
  mayoristaDesdeMonto: number;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const db = getDb();
  const [pctTxt, setPctTxt] = useState(String(descuentoGlobalPct));
  const [escalas, setEscalas] = useState<EscalaMayorista[]>(escalasGlobales);
  const [desdeMontoTxt, setDesdeMontoTxt] = useState(String(mayoristaDesdeMonto));

  useEffect(() => {
    setPctTxt(String(descuentoGlobalPct));
    setEscalas(escalasGlobales);
    setDesdeMontoTxt(String(mayoristaDesdeMonto));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descuentoGlobalPct, JSON.stringify(escalasGlobales), mayoristaDesdeMonto]);

  const guardarMut = useMutation({
    mutationFn: async () => {
      const pctNum = parseFloat(pctTxt);
      const pctClean = Number.isFinite(pctNum) ? Math.max(0, Math.min(100, pctNum)) : 0;
      const desdeNum = parseFloat(desdeMontoTxt);
      const desdeClean = Number.isFinite(desdeNum) ? Math.max(0, desdeNum) : 0;
      const escLimpias = escalas
        .filter((e) => e.desde > 0 && e.pct > 0)
        .map((e) => ({
          desde: Math.floor(e.desde),
          pct: Math.max(0, Math.min(100, e.pct)),
        }))
        .sort((a, b) => a.desde - b.desde);
      await db.configuracion.update(PRESET_IDS.empresa, {
        descuento_mayorista_pct: pctClean,
        escalas_mayorista_cantidad: escLimpias.length > 0 ? escLimpias : undefined,
        mayorista_desde_monto: desdeClean,
      });
    },
    onSuccess: () => {
      toast.success('Configuración mayorista guardada');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = useMemo(() => {
    const rows = [1, 5, 10, 25, 50, 100];
    return rows.map((cant) => {
      const calc = calcularPrecioMayorista({
        precioCF: 1000,
        descuentoGlobalPct: parseFloat(pctTxt) || 0,
        escalas,
        cantidad: cant,
      });
      return { cant, pct: calc.pctAplicado, precio: calc.precio };
    });
  }, [pctTxt, escalas]);

  if (loading) {
    return (
      <Card className="mb-4">
        <CardContent className="p-3">
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 border-cyan-200 bg-cyan-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Percent className="h-4 w-4 text-cyan-700" />
          Precios de la tienda web
          <InfoTip
            className="text-cyan-700 hover:text-cyan-900"
            text="Configurá el descuento que aplica a TODOS los productos publicados en la tienda web mayorista. También podés dar rebajas extra si el cliente compra grandes cantidades. Esto no cambia los precios del PoS ni del local."
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <div>
            <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
              Descuento general (%){' '}
              <InfoTip text="% de descuento sobre el precio del local que se aplica por defecto a todos los productos publicados en la tienda. Ej: 30 significa 30% menos que el precio del local." />
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={pctTxt}
                onChange={(e) => setPctTxt(e.target.value)}
                disabled={disabled}
                className="h-7 w-24 text-sm"
              />
              <span className="text-xs text-slate-600">% menos que el local</span>
            </div>
            <p className="mt-1 text-[10px] text-slate-600">
              Se aplica a todo lo publicado, salvo productos que tengan su
              propio descuento distinto.
            </p>
          </div>

          <div>
            <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
              Rebajas por cantidad (opcional){' '}
              <InfoTip text="Descuentos extra cuando el cliente compra más unidades. Ej: 'Desde 10u → 35% off', 'Desde 100u → 45% off'. Estas rebajas GANAN sobre el descuento general si dan más porcentaje." />
            </Label>
            <div className="space-y-1">
              {escalas.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  Sin rebajas por cantidad — solo aplica el descuento general.
                </p>
              )}
              {escalas.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <span className="w-12 text-slate-600">Desde</span>
                  <Input
                    type="number"
                    min="1"
                    value={e.desde}
                    onChange={(ev) => {
                      const desde = parseInt(ev.target.value, 10) || 0;
                      setEscalas((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, desde } : x)),
                      );
                    }}
                    disabled={disabled}
                    className="h-6 w-16 text-xs"
                  />
                  <span className="text-slate-600">u →</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={e.pct}
                    onChange={(ev) => {
                      const pct = parseFloat(ev.target.value) || 0;
                      setEscalas((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, pct } : x)),
                      );
                    }}
                    disabled={disabled}
                    className="h-6 w-16 text-xs"
                  />
                  <span className="text-slate-600">% off</span>
                  <button
                    onClick={() => setEscalas((arr) => arr.filter((_, j) => j !== i))}
                    disabled={disabled}
                    className="rounded p-0.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setEscalas((arr) => [
                    ...arr,
                    { desde: arr.length ? (arr[arr.length - 1]!.desde || 0) + 10 : 10, pct: 0 },
                  ])
                }
                disabled={disabled}
                className="mt-1 flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                Agregar escala
              </button>
            </div>
          </div>
        </div>

        <div className="rounded border border-amber-200 bg-amber-50/60 p-2">
          <Label className="mb-1 flex items-center gap-1 text-[10px] uppercase text-amber-900">
            Compra mínima para precio mayorista{' '}
            <InfoTip text="Si el subtotal del carrito no llega a este monto, el cliente ve un banner y los precios se cobran al valor del local (sin descuento). Cuando llega al monto, los precios pasan al mayorista solos. 0 = siempre mayorista, sin mínimo." />
          </Label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-700">Precio mayorista a partir de $</span>
            <Input
              type="number"
              min="0"
              step="1000"
              value={desdeMontoTxt}
              onChange={(e) => setDesdeMontoTxt(e.target.value)}
              disabled={disabled}
              className="h-7 w-28 text-sm"
              placeholder="0"
            />
            <span className="text-slate-600">de compra</span>
            {parseFloat(desdeMontoTxt) > 0 ? (
              <span className="ml-auto text-[11px] text-amber-800">
                Debajo de {formatCurrency(parseFloat(desdeMontoTxt) || 0)} se cobra
                el precio del local.
              </span>
            ) : (
              <span className="ml-auto text-[11px] text-slate-500">
                Sin mínimo — siempre precio mayorista.
              </span>
            )}
          </div>
        </div>

        <div className="rounded border border-cyan-200 bg-white/60 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-slate-600">
            Ejemplo (para un producto que en el local vale $1.000){' '}
            <InfoTip text="Simulación de cómo queda el precio final para el cliente en la web según la cantidad que pida, usando esta configuración." />
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {preview.map((r) => (
              <span
                key={r.cant}
                className="rounded bg-slate-100 px-1.5 py-0.5 tabular-nums"
              >
                {r.cant}u → {formatCurrency(r.precio)}{' '}
                <span className="text-slate-500">({r.pct}%)</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => guardarMut.mutate()}
            disabled={guardarMut.isPending || disabled}
            className="h-7 text-xs"
          >
            <Save className="mr-1 h-3 w-3" />
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AjusteMasivoDialog({
  onClose,
  categorias,
  proveedores,
  descuentoGlobalPct,
  onDone,
}: {
  onClose: () => void;
  categorias: { id: string; nombre: string }[];
  proveedores: { id: string; nombre: string }[];
  descuentoGlobalPct: number;
  onDone: () => void;
}) {
  const db = getDb();
  const [alcance, setAlcance] = useState<'publicados' | 'todos' | 'categoria' | 'proveedor'>(
    'publicados',
  );
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [modo, setModo] = useState<'setear' | 'limpiar'>('setear');
  const [pctTxt, setPctTxt] = useState('');

  const armarFiltro = (): FiltroProductos => {
    const base: FiltroProductos = { activo: true };
    if (alcance === 'publicados') base.publicado_web = true;
    if (alcance === 'categoria' && categoriaId) base.categoria_id = categoriaId;
    if (alcance === 'proveedor' && proveedorId) base.proveedor_id = proveedorId;
    return base;
  };

  const aplicarMut = useMutation({
    mutationFn: async () => {
      const pct = modo === 'limpiar' ? null : parseFloat(pctTxt);
      if (modo === 'setear' && (!Number.isFinite(pct as number) || (pct as number) < 0)) {
        throw new Error('Ingresá un % válido entre 0 y 100');
      }
      const filtro = armarFiltro();
      return await db.productos.setDescuentoMayoristaMasivo(filtro, pct);
    },
    onSuccess: (n) => {
      toast.success(
        modo === 'limpiar'
          ? `${n} producto(s) volvieron al descuento general (${descuentoGlobalPct}%)`
          : `${n} producto(s) actualizados a ${pctTxt}% de descuento`,
      );
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Cambiar descuento de muchos productos a la vez</DialogTitle>
      </DialogHeader>

      <div className="space-y-4 p-2">
        <div>
          <Label className="mb-1 block text-xs uppercase text-slate-600">Aplicar a</Label>
          <div className="grid gap-1.5 text-sm">
            {(
              [
                ['publicados', 'Todos los publicados en la web'],
                ['todos', 'Todos los productos activos'],
                ['categoria', 'Una categoría específica'],
                ['proveedor', 'Un proveedor específico'],
              ] as const
            ).map(([val, lbl]) => (
              <label key={val} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="alcance"
                  checked={alcance === val}
                  onChange={() => setAlcance(val)}
                />
                {lbl}
              </label>
            ))}
          </div>
          {alcance === 'categoria' && (
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">— Elegir categoría —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          )}
          {alcance === 'proveedor' && (
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">— Elegir proveedor —</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <Label className="mb-1 block text-xs uppercase text-slate-600">Qué hacer</Label>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="modo"
                checked={modo === 'setear'}
                onChange={() => setModo('setear')}
              />
              Ponerles un descuento propio de
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder="ej. 30"
                value={pctTxt}
                onChange={(e) => setPctTxt(e.target.value)}
                className="ml-1 h-7 w-24 text-sm"
                disabled={modo !== 'setear'}
              />
              <span className="text-xs">%</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="modo"
                checked={modo === 'limpiar'}
                onChange={() => setModo('limpiar')}
              />
              Sacarles el descuento propio (que vuelvan a usar el general del {descuentoGlobalPct}%)
            </label>
          </div>
        </div>

        <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          Esto cambia muchos productos a la vez y no se puede deshacer todo junto.
          Podés cambiar producto por producto desde el panel de la derecha si te
          equivocás.
        </p>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={
            aplicarMut.isPending ||
            (alcance === 'categoria' && !categoriaId) ||
            (alcance === 'proveedor' && !proveedorId)
          }
          onClick={() => {
            if (!confirm('¿Aplicar el ajuste masivo? No hay deshacer.')) return;
            aplicarMut.mutate();
          }}
        >
          Aplicar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      disabled={disabled}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-emerald-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function KpiChip({
  titulo,
  valor,
  icon: Icon,
  accent,
  loading,
}: {
  titulo: string;
  valor: number;
  icon: typeof Globe;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded border px-3 py-1.5 ${
        accent ? 'border-cyan-300 bg-cyan-50/50' : 'border-slate-300 bg-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" />
        <span className="text-xs text-slate-600">{titulo}</span>
      </div>
      {loading ? (
        <Skeleton className="h-5 w-8" />
      ) : (
        <span className="text-lg font-bold tabular-nums">{valor}</span>
      )}
    </div>
  );
}

export default function WebPage() {
  return (
    <PaginaProtegida modulo="productos" accion="publicar_ecommerce">
      <WebPageInner />
    </PaginaProtegida>
  );
}
