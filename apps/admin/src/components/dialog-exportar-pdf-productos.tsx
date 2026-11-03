'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { FileDown, Search } from 'lucide-react';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import {
  generarCatalogoPdf,
  type ColumnasPrecio,
  type ProductoParaPdf,
} from '@/lib/pdf-catalogo';
import type { EscalaMayorista } from '@comercio/db';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Productos ya filtrados que el usuario está viendo en la tabla. */
  productosFiltrados: ProductoParaPdf[];
  categoriaNombrePorId: (id: string | null | undefined) => string;
  descuentoGlobalPct: number;
  escalasGlobales: EscalaMayorista[];
  empresa?: { nombre?: string };
};

export function DialogExportarPdfProductos({
  open,
  onClose,
  productosFiltrados,
  categoriaNombrePorId,
  descuentoGlobalPct,
  escalasGlobales,
  empresa,
}: Props) {
  const [alcance, setAlcance] = useState<'filtrados' | 'seleccion'>('filtrados');
  const [precio, setPrecio] = useState<ColumnasPrecio>('local');
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');

  const listaVisible = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productosFiltrados;
    return productosFiltrados.filter(
      (p) =>
        (p.nombre ?? '').toLowerCase().includes(q) ||
        p.codigo_interno.includes(q),
    );
  }, [productosFiltrados, busqueda]);

  const toggleUno = (id: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const marcarTodosVisibles = () => {
    setSeleccionados(new Set(listaVisible.map((p) => p.id)));
  };
  const desmarcarTodos = () => setSeleccionados(new Set());

  const productosParaExportar =
    alcance === 'filtrados'
      ? productosFiltrados
      : productosFiltrados.filter((p) => seleccionados.has(p.id));

  const puedeExportar = productosParaExportar.length > 0;

  const descargar = () => {
    if (!puedeExportar) {
      toast.warning('No hay productos para exportar.');
      return;
    }
    try {
      const doc = generarCatalogoPdf({
        productos: productosParaExportar,
        categoriaNombrePorId,
        descuentoGlobalPct,
        escalasGlobales,
        empresa,
        titulo: 'Catálogo de productos',
        columnasPrecio: precio,
        soloPublicados: false,
      });
      const fecha = new Date().toISOString().slice(0, 10);
      doc.save(`catalogo-productos-${fecha}.pdf`);
      toast.success(`PDF listo — ${productosParaExportar.length} productos`);
      onClose();
    } catch (e) {
      console.error('[pdf-productos]', e);
      toast.error('No pudimos generar el PDF. Revisá la consola.');
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <FileDown className="h-5 w-5" />
              Exportar productos a PDF
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-1 pt-2">
          {/* Alcance */}
          <div>
            <Label className="mb-2 block text-xs uppercase text-slate-600">
              ¿Cuáles exportar?
            </Label>
            <div className="flex flex-col gap-2 rounded border border-slate-200 p-2 text-sm">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="alcance-pdf"
                  className="mt-1"
                  checked={alcance === 'filtrados'}
                  onChange={() => setAlcance('filtrados')}
                />
                <span>
                  <span className="font-medium">
                    Todos los que se ven ahora ({productosFiltrados.length})
                  </span>
                  <span className="block text-xs text-slate-500">
                    Usa los filtros y búsqueda que ya tenés aplicados en la tabla.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="alcance-pdf"
                  className="mt-1"
                  checked={alcance === 'seleccion'}
                  onChange={() => setAlcance('seleccion')}
                />
                <span>
                  <span className="font-medium">
                    Elegir uno por uno ({seleccionados.size} seleccionados)
                  </span>
                  <span className="block text-xs text-slate-500">
                    Marcá con el checkbox los que querés exportar de la lista.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Selección puntual */}
          {alcance === 'seleccion' && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Buscar en la lista..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="h-7 pl-7 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={marcarTodosVisibles}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50"
                >
                  Marcar visibles ({listaVisible.length})
                </button>
                <button
                  type="button"
                  onClick={desmarcarTodos}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50"
                >
                  Desmarcar todos
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
                {listaVisible.length === 0 && (
                  <div className="p-3 text-xs text-slate-500">
                    No hay productos que coincidan.
                  </div>
                )}
                {listaVisible.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={seleccionados.has(p.id)}
                      onChange={() => toggleUno(p.id)}
                    />
                    <span className="font-mono text-slate-500 w-14">
                      {p.codigo_interno}
                    </span>
                    <span className="flex-1 truncate">
                      {p.nombre_web?.trim() || p.nombre}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Precio */}
          <div>
            <Label className="mb-2 block text-xs uppercase text-slate-600">
              ¿Qué precio mostrar?
            </Label>
            <div className="flex flex-col gap-2 rounded border border-slate-200 p-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="precio-pdf"
                  checked={precio === 'local'}
                  onChange={() => setPrecio('local')}
                />
                <span>Solo precio local (del PoS)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="precio-pdf"
                  checked={precio === 'mayorista'}
                  onChange={() => setPrecio('mayorista')}
                />
                <span>Solo precio mayorista (web)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="precio-pdf"
                  checked={precio === 'ambos'}
                  onChange={() => setPrecio('ambos')}
                />
                <span>Ambos precios (local + mayorista)</span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={descargar} disabled={!puedeExportar}>
            <FileDown className="mr-1 h-4 w-4" />
            Descargar PDF ({productosParaExportar.length})
          </Button>
        </DialogFooter>
      </>
    </Dialog>
  );
}
