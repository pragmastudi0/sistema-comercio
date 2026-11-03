'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Save,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Package,
  LineChart,
  FileDown,
} from 'lucide-react';
import { ModalEstadisticasProducto } from '@/components/modal-estadisticas-producto';
import { MotivoAjusteDialog, type DeltaAjuste } from '@/components/motivo-ajuste-dialog';
import { DialogExportarPdfProductos } from '@/components/dialog-exportar-pdf-productos';
import { ImagenesProducto } from '@/components/imagenes-producto';
import { InfoTip } from '@/components/info-tip';
import { toast } from 'sonner';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { PRESET_IDS, type Producto } from '@comercio/db';
import { previewPrecioMayorista } from '@comercio/business';
import { Button } from '@comercio/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';
import { PaginaProtegida, RequierePermiso, usePermiso } from '@/lib/permisos';

const PAGE_SIZE = 100;
const UMBRAL_BAJO_STOCK = 5;

type FiltroStock = '' | 'sin' | 'bajo';

/**
 * Página de Productos rediseñada estilo "Edición de artículos" del
 * sistema viejo: tabla a la izquierda con buscador + filtros, panel
 * detalle del producto seleccionado a la derecha. Todo en una sola
 * vista — sin tener que navegar a /productos/{id} para editar.
 *
 * La ruta /productos/{id} sigue funcionando para deep-links pero el
 * flujo principal del dueño es desde acá.
 */
function ProductosPageInner() {
  const db = getDb();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [texto, setTexto] = useState('');
  const stockInicial = (params.get('stock') ?? '') as FiltroStock;
  const [filtroStock, setFiltroStock] = useState<FiltroStock>(
    stockInicial === 'sin' || stockInicial === 'bajo' ? stockInicial : '',
  );
  const [categoriaId, setCategoriaId] = useState(params.get('categoria') ?? '');
  const [proveedorId, setProveedorId] = useState(params.get('proveedor') ?? '');
  const [page, setPage] = useState(0);

  // Producto seleccionado (de la tabla izquierda) que se muestra en el panel.
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  // Modo "crear nuevo" — el panel derecho se transforma en un form vacío
  // para crear inline. Tiene prioridad sobre seleccionadoId. Se puede
  // pre-activar entrando con ?nuevo=1 (lo usa el botón "Productos" de
  // la toolbar del shell).
  const [modoCrear, setModoCrear] = useState(params.get('nuevo') === '1');
  // Dialog para exportar productos filtrados a PDF.
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);

  useEffect(() => {
    setPage(0);
  }, [texto, categoriaId, proveedorId, filtroStock]);

  // Sincronizar state local con los query params. Necesario porque Next.js
  // mantiene el componente montado al navegar entre /productos?nuevo=1 y
  // /productos?stock=bajo — los useState con valor inicial leído de params
  // solo corren una vez al mount. Sin esto, click en "Faltantes" desde la
  // vista de "Productos" no actualizaba el filtro.
  useEffect(() => {
    const stockParam = params.get('stock') ?? '';
    setFiltroStock(
      stockParam === 'sin' || stockParam === 'bajo' ? stockParam : '',
    );
    setModoCrear(params.get('nuevo') === '1');
    setCategoriaId(params.get('categoria') ?? '');
    setProveedorId(params.get('proveedor') ?? '');
  }, [params]);

  const productosQ = useQuery({
    queryKey: ['productos-admin', texto, categoriaId, proveedorId, filtroStock, page],
    queryFn: () =>
      db.productos.listPaginado({
        page,
        pageSize: PAGE_SIZE,
        texto: texto || undefined,
        categoria_id: categoriaId || undefined,
        proveedor_id: proveedorId || undefined,
        sin_stock: filtroStock === 'sin' || undefined,
        bajo_stock: filtroStock === 'bajo' || undefined,
        umbral_bajo_stock: filtroStock === 'bajo' ? UMBRAL_BAJO_STOCK : undefined,
        activo: true,
      }),
    placeholderData: (prev) => prev,
  });
  const categoriasQ = useQuery({ queryKey: ['categorias'], queryFn: () => db.categorias.list() });
  const proveedoresQ = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => db.proveedores.list(),
  });
  // Config del comercio (descuento mayorista global, escalas, nombre) para
  // que el dialog de exportar PDF pueda mostrar precios mayoristas si Agus
  // elige esa opción.
  const configPdfQ = useQuery({
    queryKey: ['config'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
    staleTime: 60_000,
  });

  const total = productosQ.data?.total ?? 0;
  const rows = productosQ.data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const puedeEditar = usePermiso('productos', 'editar');

  // Precios CF y stock total para los productos visibles.
  const LISTA_CF_IDS = useMemo(() => [PRESET_IDS.listas.consumidorFinal, 'lp_cf'], []);
  const idsVisibles = rows.map((p) => p.id).join(',');
  const preciosQ = useQuery({
    queryKey: ['precios-cf-page', idsVisibles],
    queryFn: async () => {
      const map = new Map<string, number>();
      for (const p of rows) {
        const lp = await db.productos.preciosDe(p.id);
        const cf = lp.find((x) => LISTA_CF_IDS.includes(x.lista_precio_id));
        // Ordenar por `desde` ASC para agarrar la escala minorista
        // (Supabase no garantiza orden del array).
        const escs = [...(cf?.escalas ?? [])].sort((a, b) => a.desde - b.desde);
        map.set(p.id, escs[0]?.precio ?? 0);
      }
      return map;
    },
    enabled: rows.length > 0,
  });
  const stockQ = useQuery({
    queryKey: ['stock-totales-page', idsVisibles],
    queryFn: () => db.stock.totalesDeMuchos(rows.map((p) => p.id)),
    enabled: rows.length > 0,
    staleTime: 15_000,
  });

  // Auto-seleccionar SOLO cuando la búsqueda deja UN solo resultado
  // (típico: tipeás el código y aparece el producto sin necesidad de
  // clickear la fila). Si son varios, el usuario elige a mano. Con la
  // lista completa (sin filtro) no auto-seleccionamos — el panel derecho
  // muestra el placeholder "Seleccioná un producto…".
  useEffect(() => {
    if (rows.length === 1 && seleccionadoId !== rows[0]!.id) {
      setSeleccionadoId(rows[0]!.id);
    }
  }, [rows, seleccionadoId]);

  // Navegación por teclado en la tabla: ↑ ↓ mueven la selección al
  // producto anterior/siguiente. Solo se dispara si el foco NO está en
  // un input/textarea/select (para no pisar al usuario tipeando en un
  // buscador o edit inline). El producto seleccionado hace scrollIntoView
  // así siempre queda visible al navegar rápido.
  const filaSeleccionadaRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          t.isContentEditable
        )
          return;
      }
      // Si hay un dialog/modal abierto, no interferimos.
      if (document.querySelector('[role="dialog"]')) return;
      if (rows.length === 0) return;
      e.preventDefault();
      const idxActual = seleccionadoId
        ? rows.findIndex((p) => p.id === seleccionadoId)
        : -1;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      // Si no hay selección, ↓ arranca en el primero y ↑ en el último.
      const idxNuevo =
        idxActual < 0
          ? delta === 1
            ? 0
            : rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, idxActual + delta));
      const proxima = rows[idxNuevo];
      if (proxima && proxima.id !== seleccionadoId) {
        setSeleccionadoId(proxima.id);
        setModoCrear(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rows, seleccionadoId]);

  // Scroll a la fila seleccionada cuando cambia — así al navegar con
  // flechas la fila siempre queda visible aunque la selección quede
  // fuera del viewport.
  useEffect(() => {
    filaSeleccionadaRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [seleccionadoId]);

  const categoriaNombre = (id: string | null | undefined) =>
    (id && categoriasQ.data?.find((c) => c.id === id)?.nombre) || '—';

  return (
    <div className="flex h-[calc(100vh-180px)] flex-col gap-2 px-3 py-2 lg:flex-row">
      {/* IZQUIERDA: tabla + filtros */}
      {/* Tabla más ancha (~70%) y panel más angosto (~30%): Agus tiene
          que ver más productos a la vez. El panel sigue siendo cómodo
          de leer y editar. */}
      <div className="flex min-h-0 flex-1 flex-col rounded border border-slate-300 bg-white shadow-sm lg:basis-[70%]">
        {/* Acciones arriba: "+ Nuevo producto" (requiere permiso) + "PDF" */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-1.5">
          <RequierePermiso modulo="productos" accion="crear">
            <Button
              size="sm"
              onClick={() => {
                setModoCrear(true);
                setSeleccionadoId(null);
              }}
              className="h-7 text-xs"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Agregar producto nuevo
            </Button>
          </RequierePermiso>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPdfDialogOpen(true)}
            className="h-7 text-xs ml-auto"
            title="Exportar los productos a PDF"
          >
            <FileDown className="mr-1 h-3.5 w-3.5" />
            PDF de productos
          </Button>
        </div>

        {/* Filtros compactos arriba */}
        <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-2 lg:grid-cols-4">
          <div className="col-span-2 lg:col-span-2">
            <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
              Filtrar por nombre
            </Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Código o nombre del producto"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                className="h-8 pl-7 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div>
            <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
              Filtrar por grupo
            </Label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="h-8 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">(Mostrar todos)</option>
              {(categoriasQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
              Filtrar por proveedor
            </Label>
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className="h-8 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">(Mostrar todos)</option>
              {(proveedoresQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabla */}
        <div className="min-h-0 flex-1 overflow-auto">
          {productosQ.isLoading && rows.length === 0 ? (
            <div className="p-3">
              <Skeleton className="h-40" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No se encontraron productos con esos filtros.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase text-slate-600 shadow-sm">
                <tr>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">
                    Artículo
                  </th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">
                    Código
                  </th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">
                    Grupo
                  </th>
                  <th className="border-b border-r border-slate-300 px-2 py-1.5 text-left">
                    Proveedor
                  </th>
                  <th className="border-b border-slate-300 px-2 py-1.5 text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const stock = stockQ.data?.get(p.id) ?? 0;
                  const sinStockProd = stock <= 0;
                  const seleccionado = p.id === seleccionadoId;
                  return (
                    <tr
                      key={p.id}
                      ref={seleccionado ? filaSeleccionadaRef : undefined}
                      onClick={() => {
                        setSeleccionadoId(p.id);
                        setModoCrear(false);
                      }}
                      className={`cursor-pointer border-b border-slate-200 ${
                        seleccionado && !modoCrear
                          ? 'bg-blue-100 font-medium'
                          : 'hover:bg-blue-50/50'
                      }`}
                    >
                      <td className="border-r border-slate-200 px-2 py-1">{p.nombre}</td>
                      <td className="border-r border-slate-200 px-2 py-1 font-mono">
                        {p.codigo_interno}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1 text-slate-600">
                        {categoriaNombre(p.categoria_id)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1 text-slate-600">
                        {proveedoresQ.data?.find((x) => x.id === p.proveedor_id)?.nombre ?? '—'}
                      </td>
                      <td
                        className={`px-2 py-1 text-right tabular-nums ${
                          sinStockProd ? 'font-semibold text-red-600' : ''
                        }`}
                      >
                        {stockQ.data ? stock : '…'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Paginación + filtros adicionales en footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <select
              value={filtroStock}
              onChange={(e) => setFiltroStock(e.target.value as FiltroStock)}
              className="h-7 rounded-sm border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">Stock: todos</option>
              <option value="sin">Sin stock</option>
              <option value="bajo">Bajo stock (≤ {UMBRAL_BAJO_STOCK})</option>
            </select>
            <span className="text-slate-600">
              {total === 0
                ? '0 productos'
                : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} de ${total}`}
            </span>
          </div>
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || productosQ.isFetching}
                className="rounded-sm border border-slate-300 bg-white px-2 py-0.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-slate-600">
                {page + 1}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || productosQ.isFetching}
                className="rounded-sm border border-slate-300 bg-white px-2 py-0.5 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* DERECHA: panel detalle del producto seleccionado */}
      <div className="flex min-h-0 flex-1 flex-col rounded border border-slate-300 bg-white shadow-sm lg:basis-[30%]">
        {modoCrear ? (
          <PanelNuevoProducto
            onCreated={(nuevoId) => {
              setModoCrear(false);
              setSeleccionadoId(nuevoId);
            }}
            onCancel={() => setModoCrear(false)}
          />
        ) : seleccionadoId ? (
          <PanelProducto
            key={seleccionadoId}
            productoId={seleccionadoId}
            onDeleted={() => setSeleccionadoId(null)}
            puedeEditar={puedeEditar}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
            <div>
              <Package className="mx-auto mb-2 h-8 w-8 opacity-30" />
              Seleccioná un producto a la izquierda para ver/editar su detalle.
              <div className="mt-3">
                <RequierePermiso modulo="productos" accion="crear">
                  <Button size="sm" onClick={() => setModoCrear(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Agregar producto nuevo
                  </Button>
                </RequierePermiso>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialog para exportar productos a PDF con opciones de precio +
          selección puntual. Solo la página actual (hasta 100 productos)
          — si Agus necesita más, filtra por categoría/proveedor antes. */}
      <DialogExportarPdfProductos
        open={pdfDialogOpen}
        onClose={() => setPdfDialogOpen(false)}
        productosFiltrados={rows.map((p) => ({
          ...p,
          precio_cf: preciosQ.data?.get(p.id) ?? 0,
        }))}
        categoriaNombrePorId={categoriaNombre}
        descuentoGlobalPct={configPdfQ.data?.descuento_mayorista_pct ?? 0}
        escalasGlobales={configPdfQ.data?.escalas_mayorista_cantidad ?? []}
        empresa={{ nombre: configPdfQ.data?.comercio?.razon_social }}
      />
    </div>
  );
}

/**
 * Panel detalle del producto seleccionado. Form inline con costo / precio
 * CF / margen calculado / stock por local. Botón Guardar persiste todos
 * los cambios (producto + precio CF) en paralelo.
 */
function PanelProducto({
  productoId,
  onDeleted,
  puedeEditar,
}: {
  productoId: string;
  onDeleted: () => void;
  puedeEditar: boolean;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  // Visibilidad de finanzas — el dueño puede destildar por rol desde
  // /admin/roles. Por default todos los roles los ven.
  const verCosto = usePermiso('productos', 'ver_costo');
  const verMargen = usePermiso('productos', 'ver_margen');
  const verPrecioVenta = usePermiso('productos', 'ver_precio_venta');
  // Editar código: peligroso (tickets viejos, cajeros que lo memorizaron).
  // Solo admin y empleados con override puntual pueden. Default off.
  const puedeModificarCodigo = usePermiso('productos', 'modificar_codigo');
  const productoQ = useQuery({
    queryKey: ['producto-detalle', productoId],
    queryFn: () => db.productos.get(productoId),
  });
  const preciosQ = useQuery({
    queryKey: ['producto-precios-detalle', productoId],
    queryFn: () => db.productos.preciosDe(productoId),
  });
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
  });
  const stockQ = useQuery({
    queryKey: ['producto-stock-detalle', productoId],
    queryFn: () => db.stock.porProducto(productoId),
  });
  const categoriasQ = useQuery({ queryKey: ['categorias'], queryFn: () => db.categorias.list() });
  const proveedoresQ = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => db.proveedores.list(),
  });
  // Descuento mayorista global de la empresa (config) — se usa como
  // fallback cuando el override del producto está vacío. Solo para el
  // preview en la sección e-commerce.
  const configQ = useQuery({
    queryKey: ['config'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });

  const LISTA_CF_ID = PRESET_IDS.listas.consumidorFinal;
  // Ordenar por `desde` ASC porque Supabase no garantiza orden y
  // `escalas[0]` podía ser la mayorista.
  const escalasIniciales = [
    ...(preciosQ.data?.find((x) => x.lista_precio_id === LISTA_CF_ID)?.escalas ?? []),
  ].sort((a, b) => a.desde - b.desde);
  const precioCfInicial = escalasIniciales[0]?.precio ?? 0;
  // Segunda escala = precio mayorista. Si existe, tiene un `desde` > 1
  // (típico 12u). Sino, no hay mayorista configurado.
  const escalaMayoristaInicial = escalasIniciales.find((e) => e.desde > 1);
  const precioMayoristaInicial = escalaMayoristaInicial?.precio ?? 0;
  const desdeMayoristaInicial = escalaMayoristaInicial?.desde ?? 12;

  // State local del form. Se inicializa cuando carga el producto.
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  // Modal de estadísticas (última venta, rotación, totales).
  const [estadOpen, setEstadOpen] = useState(false);
  const [costoTxt, setCostoTxt] = useState('');
  const [precioCfTxt, setPrecioCfTxt] = useState('');
  // Precio mayorista: aplica automáticamente en el PoS cuando la
  // cantidad de la línea >= desde. Se guarda como segunda escala de la
  // lista Consumidor Final (usamos las escalas que ya soporta el modelo).
  const [tieneMayorista, setTieneMayorista] = useState(false);
  const [precioMayoristaTxt, setPrecioMayoristaTxt] = useState('');
  const [desdeMayoristaTxt, setDesdeMayoristaTxt] = useState('12');
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [activo, setActivo] = useState(true);
  // Promo/descuento que ve el cajero en el PoS. Bloque colapsable —
  // lo pidió Agus para no ocupar tanto espacio en la vista lateral.
  // Arranca abierto solo si el producto YA tiene promo cargada.
  const [promoAbierto, setPromoAbierto] = useState(false);
  const [promoTexto, setPromoTexto] = useState('');
  // 'none' = sin promo | 'pct' = % descuento | 'nxm' = 2x1, 3x2, etc. |
  // 'combo' = N unidades por $X fijo (ej: 3 x $1200).
  const [promoTipo, setPromoTipo] = useState<'none' | 'pct' | 'nxm' | 'combo'>(
    'none',
  );
  const [promoPctTxt, setPromoPctTxt] = useState('');
  const [promoNxmLlevaTxt, setPromoNxmLlevaTxt] = useState('');
  const [promoNxmPagaTxt, setPromoNxmPagaTxt] = useState('');
  const [promoComboCantidadTxt, setPromoComboCantidadTxt] = useState('');
  const [promoComboPrecioTxt, setPromoComboPrecioTxt] = useState('');
  const [cuotasSinRecargo, setCuotasSinRecargo] = useState(false);
  // Sección colapsable de e-commerce (fotos / descripción larga /
  // publicado web / config de bulto). Colapsada por default — el cliente
  // pidió tener todo en un solo lugar sin tener que navegar a otra ruta.
  const [ecommerceAbierto, setEcommerceAbierto] = useState(false);
  const [publicadoWeb, setPublicadoWeb] = useState(false);
  const [descripcionLarga, setDescripcionLarga] = useState('');
  // Override de descuento mayorista (opcional). Vacío = usar el global de
  // la config. 0-100. Solo afecta al catálogo web público — el PoS y admin
  // siguen mostrando CF.
  const [descMayoOverrideTxt, setDescMayoOverrideTxt] = useState('');
  // Deltas de stock pendientes por local (string para soportar vacío
  // y signos). Se aplican al apretar "Guardar cambios" — además los
  // botones +/- inline de cada local también disparan ajustes directos.
  const [stockDeltas, setStockDeltas] = useState<Record<string, string>>({});

  useEffect(() => {
    if (productoQ.data) {
      setNombre(productoQ.data.nombre);
      setCodigo(productoQ.data.codigo_interno);
      setCostoTxt(String(productoQ.data.costo ?? 0));
      setCategoriaId(productoQ.data.categoria_id ?? '');
      setProveedorId(productoQ.data.proveedor_id ?? '');
      setActivo(productoQ.data.activo ?? true);
      setPromoTexto(productoQ.data.promo_texto ?? '');
      setCuotasSinRecargo(productoQ.data.cuotas_sin_recargo ?? false);
      setPromoPctTxt(productoQ.data.promo_pct != null ? String(productoQ.data.promo_pct) : '');
      const nxmLleva = productoQ.data.promo_nxm_lleva;
      const nxmPaga = productoQ.data.promo_nxm_paga;
      const comboCant = productoQ.data.promo_combo_cantidad;
      const comboPrecio = productoQ.data.promo_combo_precio;
      const tipoGuardado = productoQ.data.promo_tipo;
      // Deducir el tipo activo: prioridad al tipo guardado si tiene sus
      // campos completos; sino promoción por % si hay promo_pct > 0; sino
      // 'none'.
      const tipoResuelto: 'none' | 'pct' | 'nxm' | 'combo' =
        tipoGuardado === 'combo' && comboCant && comboPrecio
          ? 'combo'
          : tipoGuardado === 'nxm' && nxmLleva && nxmPaga
            ? 'nxm'
            : tipoGuardado === 'pct' || (productoQ.data.promo_pct ?? 0) > 0
              ? 'pct'
              : 'none';
      setPromoTipo(tipoResuelto);
      setPromoNxmLlevaTxt(nxmLleva != null ? String(nxmLleva) : '');
      setPromoNxmPagaTxt(nxmPaga != null ? String(nxmPaga) : '');
      setPromoComboCantidadTxt(comboCant != null ? String(comboCant) : '');
      setPromoComboPrecioTxt(comboPrecio != null ? String(comboPrecio) : '');
      // Auto-expandir si hay algo cargado (o si querés cuotas sin recargo).
      setPromoAbierto(
        tipoResuelto !== 'none' ||
          !!productoQ.data.promo_texto ||
          !!productoQ.data.cuotas_sin_recargo,
      );
      setPublicadoWeb(productoQ.data.publicado_web ?? false);
      setDescripcionLarga(productoQ.data.descripcion_larga ?? '');
      setDescMayoOverrideTxt(
        productoQ.data.descuento_mayorista_pct_override != null
          ? String(productoQ.data.descuento_mayorista_pct_override)
          : '',
      );
      // Re-lockear el código al cambiar de producto: si Agus salta de
      // un producto a otro, tiene que confirmar el aviso antes de tocar.
      setCodigoDesbloqueado(false);
    }
  }, [productoQ.data]);

  useEffect(() => {
    if (preciosQ.data) {
      setPrecioCfTxt(String(precioCfInicial));
      const hayMayo = !!escalaMayoristaInicial && precioMayoristaInicial > 0;
      setTieneMayorista(hayMayo);
      setPrecioMayoristaTxt(hayMayo ? String(precioMayoristaInicial) : '');
      setDesdeMayoristaTxt(hayMayo ? String(desdeMayoristaInicial) : '12');
    }
  }, [
    preciosQ.data,
    precioCfInicial,
    escalaMayoristaInicial,
    precioMayoristaInicial,
    desdeMayoristaInicial,
  ]);

  const costo = parseFloat(costoTxt) || 0;
  const precioCf = parseFloat(precioCfTxt) || 0;
  const margen = costo > 0 ? ((precioCf - costo) / costo) * 100 : 0;
  const precioMayorista = parseFloat(precioMayoristaTxt) || 0;
  const desdeMayorista = parseInt(desdeMayoristaTxt, 10) || 0;
  const margenMayorista =
    costo > 0 && precioMayorista > 0
      ? ((precioMayorista - costo) / costo) * 100
      : 0;

  function setMargenAmano(nuevoMargen: number) {
    if (costo <= 0) return;
    const nuevoPrecio = costo * (1 + nuevoMargen / 100);
    setPrecioCfTxt(String(Number(nuevoPrecio.toFixed(2))));
  }

  // Dialog para pedir motivo cuando se aplican deltas de stock desde el
  // botón "Guardar cambios". El array de motivos matchea 1:1 con
  // `deltasParaMotivos` que se calcula al abrir.
  const [motivosDialogOpen, setMotivosDialogOpen] = useState(false);
  const [deltasParaMotivos, setDeltasParaMotivos] = useState<DeltaAjuste[]>([]);
  // Dialog de doble confirmación cuando se cambia el CÓDIGO del producto.
  // Es un cambio con impacto (tickets viejos, cajeros que lo memorizaron)
  // y queremos un click explícito, no un confirm() nativo que se cierra
  // sin querer.
  const [confirmarCodigoOpen, setConfirmarCodigoOpen] = useState(false);
  // Seguro extra al TOCAR el input del código: arranca bloqueado; para
  // desbloquear hay que confirmar en un dialog "¿estás seguro?". Se
  // resetea cuando cambia el producto seleccionado. Al guardar el código
  // se vuelve a lockear, así el siguiente cambio pide confirmación de
  // vuelta.
  const [codigoDesbloqueado, setCodigoDesbloqueado] = useState(false);
  const [avisoCodigoOpen, setAvisoCodigoOpen] = useState(false);

  const guardarMut = useMutation({
    mutationFn: async ({ motivosStock }: { motivosStock: string[] }) => {
      if (!productoQ.data) throw new Error('Producto no cargado');
      if (!empleado) throw new Error('Sin sesión');
      // Update del producto (campos básicos + promo + e-commerce).
      // Promo: según el tipo elegido se limpian los otros campos, así
      // no quedan restos raros (ej: tenía nxm, pasó a pct → nxm null).
      const promoPctNum = promoPctTxt.trim() === '' ? null : parseFloat(promoPctTxt);
      const nxmLleva = parseInt(promoNxmLlevaTxt, 10);
      const nxmPaga = parseInt(promoNxmPagaTxt, 10);
      const nxmValido =
        promoTipo === 'nxm' &&
        Number.isFinite(nxmLleva) &&
        Number.isFinite(nxmPaga) &&
        nxmLleva >= 2 &&
        nxmPaga >= 1 &&
        nxmLleva > nxmPaga;
      if (promoTipo === 'nxm' && !nxmValido) {
        throw new Error(
          'Promo NxM inválida: "Lleva" debe ser >= 2 y mayor que "Paga" (>= 1).',
        );
      }
      const comboCantidad = parseInt(promoComboCantidadTxt, 10);
      const comboPrecio = parseFloat(promoComboPrecioTxt);
      const comboValido =
        promoTipo === 'combo' &&
        Number.isFinite(comboCantidad) &&
        Number.isFinite(comboPrecio) &&
        comboCantidad >= 2 &&
        comboPrecio > 0;
      if (promoTipo === 'combo' && !comboValido) {
        throw new Error(
          'Promo Combo inválida: "Cantidad" debe ser >= 2 y "Precio" > 0.',
        );
      }
      // Campos de promo — usamos null explícito para LIMPIAR en Supabase
      // cuando el usuario cambia de tipo. undefined no actualizaría nada
      // y quedarían restos (ej: pasás de nxm → pct y el nxm queda vivo).
      const patchPromo = {
        promo_tipo: promoTipo === 'none' ? null : promoTipo,
        promo_pct:
          promoTipo === 'pct' && promoPctNum != null && isFinite(promoPctNum)
            ? promoPctNum
            : null,
        promo_nxm_lleva: nxmValido ? nxmLleva : null,
        promo_nxm_paga: nxmValido ? nxmPaga : null,
        promo_combo_cantidad: comboValido ? comboCantidad : null,
        promo_combo_precio: comboValido ? comboPrecio : null,
      };
      const patch = {
        nombre,
        codigo_interno: codigo,
        costo,
        // null explícito (no undefined) para que si el user eligió
        // "— Ninguna —" / "— Ninguno —" el UPDATE sí borre el valor
        // asignado. Con undefined, PostgREST no incluye el campo y el
        // valor viejo persiste — el usuario ve que "no se guarda".
        // Requiere que la columna sea nullable en BD (migraciones
        // scripts/migrations-categoria-nullable.sql y proveedor-nullable).
        categoria_id: categoriaId || null,
        proveedor_id: proveedorId || null,
        activo,
        promo_texto: promoTexto.trim() || undefined,
        cuotas_sin_recargo: cuotasSinRecargo,
        ...patchPromo,
        publicado_web: publicadoWeb,
        descripcion_larga: descripcionLarga.trim() || undefined,
        // null explícito para LIMPIAR el override en Supabase cuando el
        // input queda vacío. Undefined dejaría el valor viejo en la BD.
        descuento_mayorista_pct_override: (() => {
          const t = descMayoOverrideTxt.trim();
          if (!t) return null;
          const n = parseFloat(t);
          if (!Number.isFinite(n)) return null;
          return Math.max(0, Math.min(100, n));
        })(),
      } as unknown as Partial<Producto>;
      await db.productos.update(productoId, patch);
      // Update de las escalas de la lista CF: primera escala = precio
      // unitario (todos los productos), segunda escala = precio mayorista
      // desde X unidades (opcional). Si tieneMayorista se desactiva o
      // el precio es 0, se guarda solo la escala 1.
      const cambioCf = precioCf !== precioCfInicial;
      const cambioMayo =
        tieneMayorista !== (!!escalaMayoristaInicial && precioMayoristaInicial > 0) ||
        precioMayorista !== precioMayoristaInicial ||
        desdeMayorista !== desdeMayoristaInicial;
      if (cambioCf || cambioMayo) {
        const escalasNuevas: { desde: number; precio: number }[] = [
          { desde: 1, precio: precioCf },
        ];
        if (tieneMayorista && precioMayorista > 0 && desdeMayorista > 1) {
          escalasNuevas.push({ desde: desdeMayorista, precio: precioMayorista });
        }
        await db.productos.setPrecio(productoId, LISTA_CF_ID, escalasNuevas);
      }
      // Aplicar los deltas de stock pendientes (los que el user tipeó
      // en los inputs +/- por local pero no apretó el botón). El motivo
      // viene del dialog que se abrió antes de esta mutación.
      const deltasAAplicar = Object.entries(stockDeltas).filter(([, txt]) => {
        const n = parseFloat(txt);
        return Number.isFinite(n) && n !== 0;
      });
      for (let i = 0; i < deltasAAplicar.length; i++) {
        const [depositoId, txt] = deltasAAplicar[i]!;
        await db.stock.ajustar({
          producto_id: productoId,
          deposito_id: depositoId,
          cantidad: parseFloat(txt),
          motivo: motivosStock[i] ?? 'Ajuste desde detalle de producto',
          empleado_id: empleado.id,
        });
      }
      return { stockChanges: deltasAAplicar.length };
    },
    onSuccess: (r) => {
      if (r.stockChanges > 0) {
        toast.success(`Producto actualizado · ${r.stockChanges} ajuste(s) de stock aplicados`);
      } else {
        toast.success('Producto actualizado');
      }
      // Limpiar los inputs de stock una vez aplicados.
      setStockDeltas({});
      qc.invalidateQueries({ queryKey: ['productos-admin'] });
      qc.invalidateQueries({ queryKey: ['producto-detalle', productoId] });
      qc.invalidateQueries({ queryKey: ['producto-precios-detalle', productoId] });
      qc.invalidateQueries({ queryKey: ['producto-stock-detalle', productoId] });
      qc.invalidateQueries({ queryKey: ['precios-cf-page'] });
      qc.invalidateQueries({ queryKey: ['stock-totales-page'] });
      qc.invalidateQueries({ queryKey: ['stock-consolidado'] });
    },
    onError: (e: Error) => {
      // eslint-disable-next-line no-console
      console.error('Guardar producto falló:', e);
      toast.error(`No se pudo guardar: ${e.message}`);
    },
  });

  // Segundo paso del guardado: si hay deltas de stock pendientes, abre
  // el dialog de motivos; sino dispara la mutación directo. Extraído
  // porque lo llama el botón "Guardar cambios" (cuando no hay cambio de
  // código) y el dialog de confirmación de código.
  function continuarGuardado() {
    const deltasList: DeltaAjuste[] = Object.entries(stockDeltas)
      .map(([depositoId, txt]) => {
        const n = parseFloat(txt);
        if (!Number.isFinite(n) || n === 0) return null;
        const dep = depositosQ.data?.find((d) => d.id === depositoId);
        return {
          key: depositoId,
          depositoNombre: dep?.nombre ?? 'Local desconocido',
          delta: n,
        };
      })
      .filter((d): d is DeltaAjuste => d !== null);
    if (deltasList.length > 0) {
      setDeltasParaMotivos(deltasList);
      setMotivosDialogOpen(true);
    } else {
      guardarMut.mutate({ motivosStock: [] });
    }
  }

  const eliminarMut = useMutation({
    mutationFn: () => db.productos.delete(productoId),
    onSuccess: () => {
      toast.success('Producto eliminado');
      qc.invalidateQueries({ queryKey: ['productos-admin'] });
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalStock = (stockQ.data ?? []).reduce(
    (acc, s) => acc + Number(s.cantidad),
    0,
  );

  if (productoQ.isLoading || !productoQ.data) {
    return <Skeleton className="m-3 h-full" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      {/* Encabezado del panel (no scrollea): disponible para vender +
          estadísticas + código */}
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 pb-1.5">
        <label
          className="flex items-center gap-1.5 text-xs"
          title="Si está desmarcado, el cajero NO encuentra el producto en el PoS. Sirve para retirar de la venta un producto sin borrarlo (ej. discontinuado pero quedó stock)."
        >
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            disabled={!puedeEditar}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          <span className="font-medium text-slate-700">Mostrar en ventas</span>
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEstadOpen(true)}
            className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            title="Ver última venta, rotación y totales del producto"
          >
            <LineChart className="h-3 w-3" />
            Estadísticas
          </button>
          <span className="font-mono text-xs text-slate-500">#{productoQ.data.codigo_interno}</span>
        </div>
      </div>

      {/* Campos editables (sí scrollea acá) */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
        <div>
          <Label className="mb-0 block text-[10px] uppercase text-slate-600">Nombre</Label>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={!puedeEditar}
            className="h-7 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-0 block text-[10px] uppercase text-slate-600">
              Código
            </Label>
            {/* Doble seguro:
                1) Solo empleados con productos.modificar_codigo pueden.
                2) Aún con permiso, el input arranca LOCKEADO al abrir
                   el producto. Al clickearlo se abre un aviso "¿estás
                   seguro?". Solo si confirma se desbloquea la edición.
                Con esto un click distraído sobre el campo no basta para
                borrar el código. */}
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              readOnly={!puedeModificarCodigo || !puedeEditar || !codigoDesbloqueado}
              disabled={!puedeModificarCodigo || !puedeEditar}
              onMouseDown={(e) => {
                if (
                  puedeModificarCodigo &&
                  puedeEditar &&
                  !codigoDesbloqueado
                ) {
                  // Interceptamos el mouseDown (antes del focus) para
                  // no dejar que el input tome el foco sin confirmar.
                  e.preventDefault();
                  setAvisoCodigoOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (
                  puedeModificarCodigo &&
                  puedeEditar &&
                  !codigoDesbloqueado &&
                  e.key !== 'Tab'
                ) {
                  e.preventDefault();
                  setAvisoCodigoOpen(true);
                }
              }}
              title={
                puedeModificarCodigo
                  ? codigoDesbloqueado
                    ? 'Cambiar el código puede confundir a los cajeros que memorizaron el anterior'
                    : 'Click para editar (te pide confirmar antes)'
                  : 'El código no se puede modificar después de crear el producto'
              }
              maxLength={5}
              className={`h-7 text-sm tabular-nums ${
                puedeModificarCodigo && puedeEditar
                  ? codigoDesbloqueado
                    ? 'border-amber-400 bg-amber-50'
                    : 'cursor-pointer border-amber-200 bg-amber-50/30 hover:bg-amber-50/60'
                  : 'cursor-not-allowed opacity-70'
              }`}
            />
            {puedeModificarCodigo && codigo !== productoQ.data?.codigo_interno && (
              <p className="mt-0.5 text-[10px] text-amber-800">
                ⚠ Vas a cambiar el código de{' '}
                <b>{productoQ.data?.codigo_interno}</b> a <b>{codigo}</b>. Los
                tickets viejos siguen mostrando el anterior; los cajeros van a
                tener que buscar por el nuevo.
              </p>
            )}
          </div>
          {verCosto && (
            <div>
              <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                Costo
              </Label>
              <Input
                type="number"
                step="0.01"
                value={costoTxt}
                onChange={(e) => setCostoTxt(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                disabled={!puedeEditar}
                className="h-7 text-sm tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Precio CF + Margen lado a lado, sincronizados. Si el rol no
            tiene ver_precio_venta NI ver_margen, escondemos toda la caja. */}
        {(verPrecioVenta || verMargen) && (
        <div className="rounded border border-blue-200 bg-blue-50/50 p-1.5">
          <div className={`grid gap-2 ${verPrecioVenta && verMargen ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {verPrecioVenta && (
              <div>
                <Label className="mb-0 block text-[10px] uppercase text-slate-700">
                  Precio público
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={precioCfTxt}
                  onChange={(e) => setPrecioCfTxt(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={!puedeEditar}
                  className="h-7 text-sm font-semibold tabular-nums"
                />
              </div>
            )}
            {verMargen && (
              <div>
                <Label className="mb-0 block text-[10px] uppercase text-slate-700">
                  Margen %
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.1"
                    value={costo > 0 ? Number(margen.toFixed(2)) : ''}
                    onChange={(e) => setMargenAmano(parseFloat(e.target.value) || 0)}
                    onFocus={(e) => e.currentTarget.select()}
                    disabled={!puedeEditar || costo <= 0}
                    placeholder={costo <= 0 ? 'sin costo' : ''}
                    className="h-7 pr-6 text-sm font-semibold tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    %
                  </span>
                </div>
              </div>
            )}
          </div>
          {verCosto && verPrecioVenta && costo > 0 && precioCf > 0 && (
            <div className="mt-0.5 text-[10px] text-slate-600">
              Ganás <b>{formatCurrency(precioCf - costo)}</b> por unidad.
            </div>
          )}
        </div>
        )}

        {/* Precio mayorista: opcional. Cuando el cliente lleva N unidades
            o más, en el PoS se aplica automáticamente el precio de esta
            escala en vez del unitario. Se guarda como segunda escala en
            producto_lista_precio (la primera es el precio CF). */}
        {verPrecioVenta && (
          <div className="rounded border border-indigo-200 bg-indigo-50/40 p-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={tieneMayorista}
                onChange={(e) => setTieneMayorista(e.target.checked)}
                disabled={!puedeEditar}
                className="h-3.5 w-3.5"
              />
              <span className="font-medium">Precio mayorista por cantidad</span>
            </label>
            {tieneMayorista && (
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                    Precio mayorista
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioMayoristaTxt}
                    onChange={(e) => setPrecioMayoristaTxt(e.target.value)}
                    disabled={!puedeEditar}
                    placeholder="0"
                    className="h-7 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                    Desde qué cantidad
                  </Label>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    value={desdeMayoristaTxt}
                    onChange={(e) => setDesdeMayoristaTxt(e.target.value)}
                    disabled={!puedeEditar}
                    placeholder="12"
                    className="h-7 text-sm tabular-nums"
                  />
                </div>
              </div>
            )}
            {tieneMayorista &&
              verCosto &&
              costo > 0 &&
              precioMayorista > 0 && (
                <div className="mt-1 text-[10px] text-slate-600">
                  Ganás <b>{formatCurrency(precioMayorista - costo)}</b> por
                  unidad (margen{' '}
                  <b className={margenMayorista < 0 ? 'text-red-700' : ''}>
                    {margenMayorista.toFixed(1)}%
                  </b>
                  ). Se aplica desde {desdeMayorista || '?'} unidades.
                </div>
              )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-0 block text-[10px] uppercase text-slate-600">Categoría</Label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              disabled={!puedeEditar}
              className="h-7 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">— Ninguna —</option>
              {(categoriasQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-0 block text-[10px] uppercase text-slate-600">Proveedor</Label>
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              disabled={!puedeEditar}
              className="h-7 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">— Ninguno —</option>
              {(proveedoresQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Promo / descuento del producto — se ve en el PoS.
            Bloque colapsable: por defecto arranca cerrado (mostrando solo
            un resumen chico) para no ocupar tanto espacio en la vista
            lateral. Se auto-expande si el producto YA tiene promo.
            Adentro: radio con 3 tipos (Ninguna / % descuento / NxM). */}
        <div className="rounded border border-purple-200 bg-purple-50/40">
          <button
            type="button"
            onClick={() => setPromoAbierto((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1.5 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-800">
                Promo / descuento
              </span>
              {/* Resumen chico cuando está cerrado, para no perder de vista
                  qué promo tiene cargada. */}
              {!promoAbierto && (
                <span className="text-[11px] text-purple-800/80">
                  {promoTipo === 'nxm' && promoNxmLlevaTxt && promoNxmPagaTxt
                    ? `${promoNxmLlevaTxt}x${promoNxmPagaTxt}`
                    : promoTipo === 'combo' &&
                        promoComboCantidadTxt &&
                        promoComboPrecioTxt
                      ? `${promoComboCantidadTxt} x $${promoComboPrecioTxt}`
                      : promoTipo === 'pct' && promoPctTxt
                        ? `${promoPctTxt}%`
                        : 'sin promo'}
                  {cuotasSinRecargo ? ' · cuotas s/recargo' : ''}
                </span>
              )}
            </div>
            {promoAbierto ? (
              <ChevronUp className="h-3.5 w-3.5 text-purple-800" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-purple-800" />
            )}
          </button>
          {promoAbierto && (
            <div className="space-y-2 border-t border-purple-200 p-2">
              {/* Texto libre siempre visible — es lo que ve el cajero en
                  el PoS como pill morada. Opcional, hace de aclaración
                  por sobre el %/NxM (ej: "Solo sábados"). */}
              <div>
                <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                  Texto visible en el PoS
                </Label>
                <Input
                  value={promoTexto}
                  onChange={(e) => setPromoTexto(e.target.value)}
                  disabled={!puedeEditar}
                  placeholder='Ej: "2x1 sábados", "10% efectivo"'
                  maxLength={80}
                  className="h-7 text-sm"
                />
              </div>

              {/* Tipo de promo — el radio decide qué inputs se muestran. */}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {(
                  [
                    { v: 'none', label: 'Ninguna' },
                    { v: 'pct', label: '% descuento' },
                    { v: 'nxm', label: 'NxM (2x1, 3x2…)' },
                    { v: 'combo', label: 'Combo (N x $ fijo)' },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.v}
                    className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 ${
                      promoTipo === opt.v
                        ? 'border-purple-500 bg-purple-100 text-purple-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-purple-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="promo-tipo"
                      value={opt.v}
                      checked={promoTipo === opt.v}
                      onChange={() => setPromoTipo(opt.v)}
                      disabled={!puedeEditar}
                      className="h-3 w-3"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>

              {/* Input %: solo si tipo=pct. */}
              {promoTipo === 'pct' && (
                <div className="max-w-[120px]">
                  <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                    % a aplicar
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={promoPctTxt}
                    onChange={(e) => setPromoPctTxt(e.target.value)}
                    disabled={!puedeEditar}
                    placeholder="10"
                    className="h-7 text-sm tabular-nums"
                  />
                </div>
              )}

              {/* Inputs NxM: solo si tipo=nxm. Con presets rápidos. */}
              {promoTipo === 'nxm' && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { l: 2, p: 1, label: '2x1' },
                        { l: 3, p: 2, label: '3x2' },
                        { l: 4, p: 3, label: '4x3' },
                      ] as const
                    ).map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setPromoNxmLlevaTxt(String(preset.l));
                          setPromoNxmPagaTxt(String(preset.p));
                        }}
                        disabled={!puedeEditar}
                        className="rounded border border-purple-300 bg-white px-2 py-0.5 text-[11px] text-purple-800 hover:bg-purple-50 disabled:opacity-50"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                        Lleva
                      </Label>
                      <Input
                        type="number"
                        min="2"
                        step="1"
                        value={promoNxmLlevaTxt}
                        onChange={(e) => setPromoNxmLlevaTxt(e.target.value)}
                        disabled={!puedeEditar}
                        placeholder="2"
                        className="h-7 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                        Paga
                      </Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={promoNxmPagaTxt}
                        onChange={(e) => setPromoNxmPagaTxt(e.target.value)}
                        disabled={!puedeEditar}
                        placeholder="1"
                        className="h-7 text-sm tabular-nums"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] leading-tight text-slate-600">
                    Se aplica solo en el PoS al facturar. Ej: 2x1 → 2 unidades
                    salen al precio de 1. Con 5u lleva 3 pagas.
                  </p>
                </div>
              )}

              {/* Inputs Combo: solo si tipo=combo. N unidades por $X fijo.
                  Sueltas se cobran a precio normal. */}
              {promoTipo === 'combo' && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                        Cantidad del combo
                      </Label>
                      <Input
                        type="number"
                        min="2"
                        step="1"
                        value={promoComboCantidadTxt}
                        onChange={(e) => setPromoComboCantidadTxt(e.target.value)}
                        disabled={!puedeEditar}
                        placeholder="3"
                        className="h-7 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                        Precio total ($)
                      </Label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={promoComboPrecioTxt}
                        onChange={(e) => setPromoComboPrecioTxt(e.target.value)}
                        disabled={!puedeEditar}
                        placeholder="1200"
                        className="h-7 text-sm tabular-nums"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] leading-tight text-slate-600">
                    Ej: 3 x $1200 → cada 3 unidades se cobran $1200. Si el
                    cliente lleva 5, son 1 combo ($1200) + 2 sueltas a precio
                    normal.
                  </p>
                </div>
              )}

              {/* Cuotas sin recargo — para valijas, electros, etc. Cuando
                  está tildado, en el modal Cobrar no se aplica el recargo
                  por cuotas a este ítem (el resto del carrito sigue con
                  recargo normal). Independiente del tipo de promo. */}
              <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={cuotasSinRecargo}
                  onChange={(e) => setCuotasSinRecargo(e.target.checked)}
                  disabled={!puedeEditar}
                  className="h-3.5 w-3.5"
                />
                Cuotas sin recargo (no se cobra el % de cuotas sobre este
                ítem)
              </label>
            </div>
          )}
        </div>

        {/* Stock por local: deltas controlados desde el padre. Los
            inputs +/- siguen funcionando para ajuste rápido, Y además
            al apretar "Guardar cambios" se aplican los deltas pendientes. */}
        <StockPorLocal
          productoId={productoId}
          depositos={depositosQ.data ?? []}
          stocks={stockQ.data ?? []}
          totalStock={totalStock}
          puedeEditar={puedeEditar}
          deltas={stockDeltas}
          setDeltas={setStockDeltas}
        />

        {/* Sección colapsable: más opciones (e-commerce). Por default
            cerrada porque no todos los productos están publicados online. */}
        <div className="rounded border border-slate-300 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setEcommerceAbierto((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            <span>Más opciones (e-commerce)</span>
            <span className="text-slate-500">{ecommerceAbierto ? '▲' : '▼'}</span>
          </button>
          {ecommerceAbierto && (
            <div className="space-y-2 border-t border-slate-300 p-2">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={publicadoWeb}
                  onChange={(e) => setPublicadoWeb(e.target.checked)}
                  disabled={!puedeEditar}
                  className="h-3.5 w-3.5"
                />
                Publicado en e-commerce
              </label>
              <div>
                <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                  Descripción larga (para la web)
                </Label>
                <textarea
                  value={descripcionLarga}
                  onChange={(e) => setDescripcionLarga(e.target.value)}
                  disabled={!puedeEditar}
                  rows={3}
                  className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1 text-sm"
                />
              </div>
              {/* Fotos del producto — gestionadas inline sin salir de
                  /admin/productos (Etapa 2 e-commerce). El componente
                  usa Supabase Storage y guarda los cambios al toque
                  (sin depender del botón "Guardar" del form principal). */}
              <div>
                <Label className="mb-0 block text-[10px] uppercase text-slate-600">
                  Fotos (para la web)
                </Label>
                <ImagenesProducto productoId={productoId} />
              </div>
              {/* Descuento propio del producto para la tienda web (opcional).
                  Vacío = usa el % general configurado en /admin/web. */}
              {(() => {
                const globalPct = configQ.data?.descuento_mayorista_pct ?? 0;
                const propioNum = parseFloat(descMayoOverrideTxt);
                const propioVal =
                  descMayoOverrideTxt.trim() && Number.isFinite(propioNum)
                    ? Math.max(0, Math.min(100, propioNum))
                    : null;
                const preview = previewPrecioMayorista(precioCf, propioVal, globalPct);
                const usaPropio = propioVal != null && propioVal > 0;
                return (
                  <div className="rounded-sm border border-cyan-200 bg-cyan-50/60 p-2">
                    <Label className="mb-1 block text-[10px] uppercase text-cyan-800">
                      Descuento propio para la tienda web (%)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        placeholder={`vacío = usa el general (${globalPct}%)`}
                        value={descMayoOverrideTxt}
                        onChange={(e) => setDescMayoOverrideTxt(e.target.value)}
                        disabled={!puedeEditar}
                        className="h-7 w-32 text-sm"
                      />
                      <span className="text-xs text-slate-600">%</span>
                      {precioCf > 0 && (
                        <span className="ml-auto text-xs text-slate-700">
                          Precio en la web:{' '}
                          <strong className="text-cyan-800">
                            {formatCurrency(preview.precio)}
                          </strong>{' '}
                          <span className="text-slate-500">
                            ({preview.pctAplicado}% desc. ·{' '}
                            {usaPropio ? 'propio' : globalPct > 0 ? 'general' : 'sin descuento'})
                          </span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-600">
                      Solo afecta al precio en la tienda web mayorista. Dejalo vacío
                      para usar el descuento general configurado en Ecommerce.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Footer fijo: "Guardar" siempre visible sin scroll */}
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 pt-2">
        {puedeEditar && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm(`¿Eliminar "${productoQ.data!.nombre}"?`)) {
                eliminarMut.mutate();
              }
            }}
            disabled={eliminarMut.isPending}
            className="text-red-700 hover:bg-red-50"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Eliminar
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            // Si cambia el código, primero abrimos el dialog de doble
            // confirmación. Al confirmar del dialog se llama al flujo
            // normal (deltas o guardar directo). Si el código no cambia,
            // seguimos directo.
            if (
              productoQ.data &&
              codigo !== productoQ.data.codigo_interno
            ) {
              setConfirmarCodigoOpen(true);
              return;
            }
            continuarGuardado();
          }}
          disabled={!puedeEditar || guardarMut.isPending}
          className="ml-auto"
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {guardarMut.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>

      <MotivoAjusteDialog
        open={motivosDialogOpen}
        onOpenChange={setMotivosDialogOpen}
        deltas={deltasParaMotivos}
        productoNombre={productoQ.data?.nombre}
        onConfirm={(motivos) => {
          setMotivosDialogOpen(false);
          guardarMut.mutate({ motivosStock: motivos });
        }}
      />

      {/* Aviso al TOCAR el input del código. Es el primer filtro contra
          clicks distraídos: aparece antes de que puedas escribir, no al
          guardar. Al confirmar se desbloquea el input y hace foco. */}
      <Dialog
        open={avisoCodigoOpen}
        onOpenChange={setAvisoCodigoOpen}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>¿Modificar el código?</DialogTitle>
        </DialogHeader>
        <div className="py-2 text-sm">
          <p>
            ¿Estás seguro que querés modificar el código de{' '}
            <b>{productoQ.data?.nombre}</b> (actual:{' '}
            <span className="font-mono">{productoQ.data?.codigo_interno}</span>
            )?
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAvisoCodigoOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setAvisoCodigoOpen(false);
              setCodigoDesbloqueado(true);
              // Foco al input en el próximo tick para que quede listo
              // para escribir. Buscamos por atributo maxLength=5 dentro
              // del panel — es el único input con ese cap.
              setTimeout(() => {
                const el = document.querySelector<HTMLInputElement>(
                  'input[maxlength="5"]',
                );
                el?.focus();
                el?.select();
              }, 0);
            }}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Sí, quiero editar
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Dialog de doble confirmación para cambio de código. Reemplaza
          el confirm() nativo que se cerraba con Enter/click accidental.
          Al confirmar, sigue con continuarGuardado (que a su vez abre
          el dialog de motivos si hay deltas de stock, o guarda directo). */}
      <Dialog
        open={confirmarCodigoOpen}
        onOpenChange={setConfirmarCodigoOpen}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Confirmar cambio de código</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p>
            Vas a cambiar el código del producto{' '}
            <b>{productoQ.data?.nombre}</b>.
          </p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3">
            <span className="text-xs uppercase text-muted-foreground">
              Código actual
            </span>
            <span className="text-right font-mono text-base font-semibold text-slate-700">
              {productoQ.data?.codigo_interno}
            </span>
            <span className="text-xs uppercase text-muted-foreground">
              Código nuevo
            </span>
            <span className="text-right font-mono text-base font-semibold text-amber-700">
              {codigo}
            </span>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            Los tickets viejos siguen mostrando el código anterior. Los
            cajeros que lo memorizaron van a tener que buscar por el nuevo.
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmarCodigoOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setConfirmarCodigoOpen(false);
              continuarGuardado();
            }}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Sí, cambiar código
          </Button>
        </DialogFooter>
      </Dialog>

      <ModalEstadisticasProducto
        open={estadOpen}
        onOpenChange={setEstadOpen}
        productoId={productoId}
        productoNombre={productoQ.data.nombre}
        productoCodigo={productoQ.data.codigo_interno}
      />
    </div>
  );
}

/**
 * Stock por local con la posibilidad de cargar/descontar unidades inline.
 * Cada local tiene su input de delta y un botón "+" para sumar (o "-" si
 * el delta es negativo). Es la forma rápida que pidió Agus para ajustar
 * stock sin abrir un modal aparte.
 */
function StockPorLocal({
  productoId,
  depositos,
  stocks,
  totalStock,
  puedeEditar,
  deltas,
  setDeltas,
}: {
  productoId: string;
  depositos: { id: string; nombre: string }[];
  stocks: { deposito_id: string; cantidad: number | string }[];
  totalStock: number;
  puedeEditar: boolean;
  // Deltas controlados desde el padre — el botón "Guardar cambios" del
  // panel necesita acceso para aplicarlos junto al resto de cambios.
  deltas: Record<string, string>;
  setDeltas: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <Label className="flex items-center gap-1 text-[10px] uppercase text-slate-600">
          Stock por local
          <InfoTip text="Para AGREGAR unidades, tipeá un número positivo (ej: 5). Para RESTAR, tipealo con el signo menos adelante (ej: -3). Al guardar cambios te vamos a pedir el motivo por cada ajuste." />
        </Label>
        <span className="text-[10px] font-medium text-slate-600">
          <span className="text-emerald-700">+</span> suma ·{' '}
          <span className="text-red-600">−</span> resta
        </span>
      </div>
      <div className="space-y-1">
        {depositos.map((d) => {
          const cant = Number(
            stocks.find((s) => s.deposito_id === d.id)?.cantidad ?? 0,
          );
          const delta = deltas[d.id] ?? '';
          const deltaN = parseFloat(delta);
          const tieneDelta = !isNaN(deltaN) && deltaN !== 0;
          return (
            <div
              key={d.id}
              className="flex items-center justify-between gap-1.5 rounded-sm border border-slate-300 bg-white px-2 py-0.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-600">{d.nombre}</span>
                <span
                  className={`font-semibold tabular-nums ${
                    cant <= 0 ? 'text-red-600' : 'text-slate-900'
                  }`}
                >
                  {cant}
                </span>
              </div>
              {puedeEditar && (
                // Delta pendiente por local. Se aplica todo junto al
                // apretar "Guardar cambios" — ahí también se pide el
                // motivo una sola vez. Sacamos el botón +/- inline
                // (que abría su propio dialog de motivo) para no
                // duplicar la pregunta de motivo al usuario.
                <Input
                  type="number"
                  step="1"
                  value={delta}
                  onChange={(e) =>
                    setDeltas((prev) => ({ ...prev, [d.id]: e.target.value }))
                  }
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="+/−"
                  className="h-6 w-20 text-right text-xs tabular-nums"
                  maxLength={6}
                  title={
                    tieneDelta
                      ? `Se aplica al apretar "Guardar cambios"`
                      : 'Tipear cantidad (con signo, ej: -3)'
                  }
                />
              )}
            </div>
          );
        })}
        <div className="flex items-center justify-between rounded-sm border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs">
          <span className="font-semibold text-blue-800">Total</span>
          <span className="font-bold tabular-nums text-blue-800">{totalStock}</span>
        </div>
      </div>

      {/* El motivo del ajuste se pide una única vez en el
          MotivoAjusteDialog del padre (PanelProducto) cuando se aprieta
          "Guardar cambios". No hay dialog local para no duplicar la
          pregunta al usuario. */}
    </div>
  );
}

/**
 * Form de "crear producto nuevo" embebido en el panel derecho.
 * Versión simplificada: solo campos básicos + stock inicial. Si hace
 * falta lo del e-commerce (publicación web, descripción larga, etc.)
 * el botón "Más opciones" lleva a la página completa /productos/nuevo.
 */
function PanelNuevoProducto({
  onCreated,
  onCancel,
}: {
  onCreated: (nuevoId: string) => void;
  onCancel: () => void;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  // Mismas reglas que el panel de detalle: el dueño puede esconderle
  // costo / margen / precio a los roles que carga catálogo.
  const verCosto = usePermiso('productos', 'ver_costo');
  const verMargen = usePermiso('productos', 'ver_margen');
  const verPrecioVenta = usePermiso('productos', 'ver_precio_venta');

  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [costoTxt, setCostoTxt] = useState('');
  const [precioCfTxt, setPrecioCfTxt] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [activo, setActivo] = useState(true);
  const [stockInicial, setStockInicial] = useState<Record<string, string>>({});

  const categoriasQ = useQuery({ queryKey: ['categorias'], queryFn: () => db.categorias.list() });
  const proveedoresQ = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => db.proveedores.list({ activo: true }),
  });
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
  });

  const costo = parseFloat(costoTxt) || 0;
  const precioCf = parseFloat(precioCfTxt) || 0;
  const margen = costo > 0 ? ((precioCf - costo) / costo) * 100 : 0;
  function setMargenAmano(nuevoMargen: number) {
    if (costo <= 0) return;
    setPrecioCfTxt(String(Number((costo * (1 + nuevoMargen / 100)).toFixed(2))));
  }

  const LISTA_CF_ID = PRESET_IDS.listas.consumidorFinal;

  const crearMut = useMutation({
    mutationFn: async () => {
      if (!codigo.trim() || !nombre.trim() || !categoriaId) {
        throw new Error('Código, nombre y categoría son obligatorios');
      }
      if (!empleado) throw new Error('Sin sesión');
      const existente = await db.productos.buscarPorCodigo(codigo.trim());
      if (existente) throw new Error(`El código ${codigo.trim()} ya existe`);
      const p = await db.productos.create({
        codigo_interno: codigo.trim(),
        nombre: nombre.trim(),
        // El form marca categoría como obligatoria (asterisco rojo +
        // validación del botón), pero por defensa mandamos null en vez
        // de string vacío si de alguna forma llega vacío — evita error
        // "invalid input syntax for type uuid" desde PostgREST.
        categoria_id: categoriaId || null,
        proveedor_id: proveedorId || null,
        costo,
        publicado_web: false,
        activo,
      });
      if (precioCf > 0) {
        await db.productos.setPrecio(p.id, LISTA_CF_ID, [{ desde: 1, precio: precioCf }]);
      }
      for (const d of depositosQ.data ?? []) {
        const cant = parseFloat(stockInicial[d.id] ?? '0');
        if (Number.isFinite(cant) && cant > 0) {
          await db.stock.ajustar({
            producto_id: p.id,
            deposito_id: d.id,
            cantidad: cant,
            motivo: 'Stock inicial al crear producto',
            empleado_id: empleado.id,
          });
        }
      }
      return p.id;
    },
    onSuccess: (id) => {
      toast.success('Producto creado');
      qc.invalidateQueries({ queryKey: ['productos-admin'] });
      onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div className="mb-1.5 flex shrink-0 items-center justify-between border-b border-slate-200 pb-1.5">
        <label
          className="flex items-center gap-1.5 text-xs"
          title="Si está desmarcado, el cajero NO encuentra el producto en el PoS."
        >
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          <span className="font-medium text-slate-700">Mostrar en ventas</span>
        </label>
        <span className="text-xs font-semibold text-emerald-700">NUEVO</span>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
        <div>
          <Label className="mb-0 block text-[10px] uppercase text-slate-600">
            Nombre <span className="text-red-600">*</span>
          </Label>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoFocus
            placeholder="Nombre del producto"
            className="h-7 text-sm"
          />
        </div>

        <div className={`grid gap-2 ${verCosto ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <Label className="mb-0 block text-[10px] uppercase text-slate-600">
              Código <span className="text-red-600">*</span>
            </Label>
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              maxLength={5}
              placeholder="1234"
              className="h-7 text-sm tabular-nums"
            />
          </div>
          {verCosto && (
            <div>
              <Label className="mb-0 block text-[10px] uppercase text-slate-600">Costo</Label>
              <Input
                type="number"
                step="0.01"
                value={costoTxt}
                onChange={(e) => setCostoTxt(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-7 text-sm tabular-nums"
              />
            </div>
          )}
        </div>

        {(verPrecioVenta || verMargen) && (
          <div className="rounded border border-blue-200 bg-blue-50/50 p-1.5">
            <div className={`grid gap-2 ${verPrecioVenta && verMargen ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {verPrecioVenta && (
                <div>
                  <Label className="mb-0 block text-[10px] uppercase text-slate-700">
                    Precio público
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={precioCfTxt}
                    onChange={(e) => setPrecioCfTxt(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-7 text-sm font-semibold tabular-nums"
                  />
                </div>
              )}
              {verMargen && (
                <div>
                  <Label className="mb-0 block text-[10px] uppercase text-slate-700">Margen %</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      value={costo > 0 ? Number(margen.toFixed(2)) : ''}
                      onChange={(e) => setMargenAmano(parseFloat(e.target.value) || 0)}
                      onFocus={(e) => e.currentTarget.select()}
                      disabled={costo <= 0}
                      placeholder={costo <= 0 ? 'sin costo' : ''}
                      className="h-7 pr-6 text-sm font-semibold tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      %
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-0 block text-[10px] uppercase text-slate-600">
              Categoría <span className="text-red-600">*</span>
            </Label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="h-7 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">— Elegir —</option>
              {(categoriasQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-0 block text-[10px] uppercase text-slate-600">Proveedor</Label>
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className="h-7 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">— Ninguno —</option>
              {(proveedoresQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stock inicial por local */}
        <div className="rounded border border-slate-200 bg-slate-50 p-1.5">
          <Label className="mb-1 block text-[10px] uppercase text-slate-600">
            Stock inicial por local (opcional)
          </Label>
          <div className="space-y-1">
            {(depositosQ.data ?? []).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-2 py-0.5 text-xs"
              >
                <span className="text-slate-600">{d.nombre}</span>
                <Input
                  type="number"
                  step="1"
                  value={stockInicial[d.id] ?? ''}
                  onChange={(e) =>
                    setStockInicial((prev) => ({ ...prev, [d.id]: e.target.value }))
                  }
                  placeholder="0"
                  className="h-6 w-20 text-right text-xs tabular-nums"
                  maxLength={6}
                  title={stockInicial[d.id] ?? ''}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 pt-2">
        <Button asChild variant="ghost" size="sm" className="text-xs">
          <Link href="/productos/nuevo">+ Más opciones (web, etc.)</Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={crearMut.isPending}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => crearMut.mutate()}
            disabled={crearMut.isPending}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            {crearMut.isPending ? 'Creando…' : 'Crear producto'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ProductosPage() {
  return (
    <PaginaProtegida modulo="productos" accion="ver">
      <Suspense fallback={null}>
        <ProductosPageInner />
      </Suspense>
    </PaginaProtegida>
  );
}
