'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, ChevronRight, Save } from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { PRESET_IDS } from '@comercio/db';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { formatCurrency } from '@comercio/ui/utils';

/**
 * Crear producto nuevo — layout similar al panel de detalle de /productos:
 * campos básicos arriba (código / nombre / costo / precio público con
 * margen sincronizado / categoría / proveedor), opcional stock inicial por
 * local, y una sección colapsable "Datos para e-commerce" para lo que
 * solo se necesita si se va a publicar.
 *
 * Margen ↔ precio bidireccional como en el panel de edición.
 */
export default function NuevoProductoPage() {
  const db = getDb();
  const router = useRouter();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);

  // Campos básicos
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [costoTxt, setCostoTxt] = useState('');
  const [precioCfTxt, setPrecioCfTxt] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [activo, setActivo] = useState(true);

  // Stock inicial por local (input por cada uno)
  const [stockInicial, setStockInicial] = useState<Record<string, string>>({});

  // E-commerce (sección colapsable)
  const [ecommerceAbierto, setEcommerceAbierto] = useState(false);
  const [publicadoWeb, setPublicadoWeb] = useState(false);
  const [descripcion, setDescripcion] = useState('');
  const [descripcionLarga, setDescripcionLarga] = useState('');
  const [soloPorBulto, setSoloPorBulto] = useState(false);
  const [cantMinWebTxt, setCantMinWebTxt] = useState('');
  const [incrementoWebTxt, setIncrementoWebTxt] = useState('');

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
    const nuevoPrecio = costo * (1 + nuevoMargen / 100);
    setPrecioCfTxt(String(Number(nuevoPrecio.toFixed(2))));
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

      // Crear el producto
      const p = await db.productos.create({
        codigo_interno: codigo.trim(),
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        descripcion_larga: descripcionLarga.trim() || undefined,
        categoria_id: categoriaId,
        proveedor_id: proveedorId || undefined,
        costo,
        publicado_web: publicadoWeb,
        activo,
        solo_por_bulto: soloPorBulto || undefined,
        cantidad_minima_web: parseInt(cantMinWebTxt) || undefined,
        incremento_web: parseInt(incrementoWebTxt) > 1 ? parseInt(incrementoWebTxt) : undefined,
      });

      // Crear precio CF si tipearon uno
      if (precioCf > 0) {
        await db.productos.setPrecio(p.id, LISTA_CF_ID, [
          { desde: 1, precio: precioCf },
        ]);
      }

      // Cargar stock inicial si tipearon en algún local
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

      return p;
    },
    onSuccess: async () => {
      toast.success('Producto creado');
      await qc.invalidateQueries({ queryKey: ['productos-admin'] });
      router.push('/productos');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-2xl px-3 py-4">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link href="/productos">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver a productos
        </Link>
      </Button>

      <h1 className="mb-3 text-xl font-semibold">Nuevo producto</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          crearMut.mutate();
        }}
        className="space-y-3"
      >
        {/* Bloque básico — mismo look que el panel derecho de /productos */}
        <div className="rounded border border-slate-300 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              <span className="font-medium text-slate-700">Mostrar en ventas</span>
            </label>
            <span className="text-xs text-slate-500">Datos básicos</span>
          </div>

          <div className="space-y-2">
            <div>
              <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                Nombre <span className="text-red-600">*</span>
              </Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre del producto"
                required
                autoFocus
                className="h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  Código interno <span className="text-red-600">*</span>
                </Label>
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  placeholder="4 o 5 dígitos"
                  required
                  maxLength={5}
                  className="h-8 text-sm tabular-nums"
                />
              </div>
              <div>
                <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  Costo unitario
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={costoTxt}
                  onChange={(e) => setCostoTxt(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="0"
                  className="h-8 text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="rounded border border-blue-200 bg-blue-50/50 p-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] uppercase text-slate-700">
                    Precio público
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={precioCfTxt}
                    onChange={(e) => setPrecioCfTxt(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="0"
                    className="h-8 text-sm font-semibold tabular-nums"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] uppercase text-slate-700">
                    Margen / Ganancia
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      value={costo > 0 ? Number(margen.toFixed(2)) : ''}
                      onChange={(e) => setMargenAmano(parseFloat(e.target.value) || 0)}
                      onFocus={(e) => e.currentTarget.select()}
                      disabled={costo <= 0}
                      placeholder={costo <= 0 ? 'sin costo' : '0'}
                      className="h-8 pr-7 text-sm font-semibold tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      %
                    </span>
                  </div>
                </div>
              </div>
              {costo > 0 && precioCf > 0 && (
                <div className="mt-1 text-[10px] text-slate-600">
                  Ganarás <b>{formatCurrency(precioCf - costo)}</b> por unidad sobre el costo
                  de {formatCurrency(costo)}.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  Categoría <span className="text-red-600">*</span>
                </Label>
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  required
                  className="h-8 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
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
                <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  Proveedor
                </Label>
                <select
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                  className="h-8 w-full rounded-sm border border-slate-300 bg-white px-2 text-sm"
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
          </div>
        </div>

        {/* Stock inicial — opcional */}
        <div className="rounded border border-slate-300 bg-white p-3 shadow-sm">
          <Label className="mb-1.5 block text-[10px] uppercase text-slate-600">
            Stock inicial por local (opcional)
          </Label>
          <div className="grid grid-cols-2 gap-1.5">
            {(depositosQ.data ?? []).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs"
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
                  className="h-6 w-16 text-right text-xs tabular-nums"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Tip: si dejás vacío, el stock arranca en 0 y podés cargarlo después.
          </p>
        </div>

        {/* Sección colapsable: datos para e-commerce */}
        <div className="rounded border border-slate-300 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setEcommerceAbierto((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <span className="flex items-center gap-1.5">
              {ecommerceAbierto ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Datos para e-commerce (opcional)
            </span>
            <span className="text-xs text-slate-500">
              {ecommerceAbierto ? 'Ocultar' : 'Mostrar'}
            </span>
          </button>

          {ecommerceAbierto && (
            <div className="space-y-2 border-t border-slate-200 p-3">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={publicadoWeb}
                  onChange={(e) => setPublicadoWeb(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                <span className="font-medium text-slate-700">Publicar en e-commerce</span>
              </label>

              <div>
                <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  Descripción corta (catálogo)
                </Label>
                <Input
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Ej: Pelota de fútbol oficial, talla 5"
                  className="h-8 text-sm"
                />
              </div>

              <div>
                <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                  Descripción larga (página de producto)
                </Label>
                <textarea
                  value={descripcionLarga}
                  onChange={(e) => setDescripcionLarga(e.target.value)}
                  placeholder="Texto detallado del producto…"
                  rows={4}
                  className="w-full rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-sm"
                />
              </div>

              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={soloPorBulto}
                  onChange={(e) => setSoloPorBulto(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                <span className="font-medium text-slate-700">Vender solo por bulto</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                    Cantidad mínima (web)
                  </Label>
                  <Input
                    type="number"
                    step="1"
                    value={cantMinWebTxt}
                    onChange={(e) => setCantMinWebTxt(e.target.value)}
                    placeholder="1"
                    className="h-8 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                    Incremento de compra (web)
                  </Label>
                  <Input
                    type="number"
                    step="1"
                    value={incrementoWebTxt}
                    onChange={(e) => setIncrementoWebTxt(e.target.value)}
                    placeholder="1"
                    className="h-8 text-sm tabular-nums"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer con acciones */}
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline" type="button">
            <Link href="/productos">Cancelar</Link>
          </Button>
          <Button type="submit" disabled={crearMut.isPending}>
            <Save className="mr-1 h-4 w-4" />
            {crearMut.isPending ? 'Creando…' : 'Crear producto'}
          </Button>
        </div>
      </form>
    </div>
  );
}
