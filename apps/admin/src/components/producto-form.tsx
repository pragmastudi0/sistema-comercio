'use client';

import { useState } from 'react';
import type { Producto } from '@comercio/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';

// ─── Helpers de fecha amigable (compartidos entre PreciosFields y
// el campo costo) ─────────────────────────────────────────────────
function tiempoDesde(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (dias < 1) return 'hoy';
  if (dias < 2) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  if (dias < 365) {
    const meses = Math.floor(dias / 30);
    return meses <= 1 ? 'hace 1 mes' : `hace ${meses} meses`;
  }
  const anios = Math.floor(dias / 365);
  return anios <= 1 ? 'hace 1 año' : `hace ${anios} años`;
}
function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export type ProductoFormValues = {
  codigo_interno: string;
  nombre: string;
  descripcion: string;
  descripcion_larga: string;
  categoria_id: string;
  proveedor_id: string;
  costo: number;
  publicado_web: boolean;
  activo: boolean;
  solo_por_bulto: boolean;
  cantidad_minima_web: number;
  incremento_web: number;
  atributos: Record<string, string | number | boolean>;
};

export function productoToForm(p: Producto): ProductoFormValues {
  return {
    codigo_interno: p.codigo_interno,
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    descripcion_larga: p.descripcion_larga ?? '',
    categoria_id: p.categoria_id ?? '',
    proveedor_id: p.proveedor_id ?? '',
    costo: p.costo,
    publicado_web: p.publicado_web,
    activo: p.activo,
    solo_por_bulto: p.solo_por_bulto ?? false,
    cantidad_minima_web: p.cantidad_minima_web ?? 0,
    incremento_web: p.incremento_web ?? 1,
    atributos: (p.atributos ?? {}) as Record<string, string | number | boolean>,
  };
}

type CategoriaConAttrs = {
  id: string;
  nombre: string;
  atributos?: Record<string, { tipo: 'string' | 'number' | 'boolean' | 'enum'; opciones?: string[] }>;
};

export function ProductoFormFields({
  values,
  onChange,
  categorias,
  proveedores,
  /** Última vez que se cambió el costo. Si se pasa string con valor →
   *  "Actualizado hace X". Si se pasa null/'' → "Sin fecha registrada".
   *  Si se omite (undefined) → no se muestra nada (caso alta nueva). */
  costoActualizadoEn,
}: {
  values: ProductoFormValues;
  onChange: (next: ProductoFormValues) => void;
  categorias: CategoriaConAttrs[];
  proveedores: { id: string; nombre: string }[];
  costoActualizadoEn?: string | null;
}) {
  const catActual = categorias.find((c) => c.id === values.categoria_id);
  const atrDefs = catActual?.atributos
    ? Object.entries(catActual.atributos)
    : [];
  function set<K extends keyof ProductoFormValues>(key: K, v: ProductoFormValues[K]) {
    onChange({ ...values, [key]: v });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del producto</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1 block">Código interno (4–5 dígitos)</Label>
            <Input
              value={values.codigo_interno}
              onChange={(e) => set('codigo_interno', e.target.value.replace(/\D/g, ''))}
              maxLength={5}
              placeholder="1234"
              required
            />
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <Label className="block">Costo</Label>
              {/* Misma lógica que en PreciosFields: si el caller pasó la
                  prop pero no hay valor (típico en alta de producto),
                  mostramos "Sin fecha registrada". */}
              {costoActualizadoEn !== undefined && (
                costoActualizadoEn ? (
                  <span
                    className="text-xs text-muted-foreground"
                    title={`Última modificación: ${fechaCorta(costoActualizadoEn)}`}
                  >
                    Actualizado {tiempoDesde(costoActualizadoEn)}
                  </span>
                ) : (
                  <span className="text-xs italic text-muted-foreground/60">
                    Sin fecha registrada
                  </span>
                )
              )}
            </div>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={values.costo}
              onChange={(e) => set('costo', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div>
          <Label className="mb-1 block">Nombre</Label>
          <Input
            value={values.nombre}
            onChange={(e) => set('nombre', e.target.value)}
            placeholder="Producto"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1 block">Categoría</Label>
            <select
              value={values.categoria_id}
              onChange={(e) => set('categoria_id', e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">— Elegir —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-1 block">Proveedor (opcional)</Label>
            <select
              value={values.proveedor_id}
              onChange={(e) => set('proveedor_id', e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Ninguno —</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label className="mb-1 block">Descripción corta</Label>
          <Input
            value={values.descripcion}
            onChange={(e) => set('descripcion', e.target.value)}
            placeholder="Resumen breve, aparece en el catálogo"
          />
        </div>
        <div>
          <Label className="mb-1 block">Descripción larga (para e-commerce)</Label>
          <textarea
            value={values.descripcion_larga}
            onChange={(e) => set('descripcion_larga', e.target.value)}
            placeholder="Detalle completo, usado en la ficha online cuando se publique"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.activo}
              onChange={(e) => set('activo', e.target.checked)}
              className="h-4 w-4"
            />
            Activo (visible en el catálogo y en caja)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.publicado_web}
              onChange={(e) => set('publicado_web', e.target.checked)}
              className="h-4 w-4"
            />
            Publicado en e-commerce
          </label>
        </div>

        {/* Reglas de venta web (sólo aplican a la web mayorista) */}
        <div className="mt-2 rounded-md border bg-muted/30 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reglas para el e-commerce mayorista
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.solo_por_bulto}
              onChange={(e) => set('solo_por_bulto', e.target.checked)}
              className="h-4 w-4"
            />
            Solo se vende por bulto (no admite unidad suelta)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">Cantidad mínima de compra</Label>
              <Input
                type="number"
                min={0}
                value={values.cantidad_minima_web}
                onChange={(e) =>
                  set('cantidad_minima_web', Math.max(0, parseInt(e.target.value) || 0))
                }
              />
              <p className="mt-1 text-[10px] text-muted-foreground">0 = sin mínimo</p>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Incremento (de a cuántas u)</Label>
              <Input
                type="number"
                min={1}
                value={values.incremento_web}
                onChange={(e) =>
                  set('incremento_web', Math.max(1, parseInt(e.target.value) || 1))
                }
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Ej: 12 obliga a comprar en docenas
              </p>
            </div>
          </div>
        </div>

        {/* Atributos dinámicos definidos por la categoría */}
        {atrDefs.length > 0 && (
          <div className="mt-2 rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Atributos de la categoría
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {atrDefs.map(([clave, def]) => {
                const valor = values.atributos[clave];
                const label = clave.replace(/_/g, ' ');
                if (def.tipo === 'boolean') {
                  return (
                    <label key={clave} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={valor === true}
                        onChange={(e) =>
                          set('atributos', { ...values.atributos, [clave]: e.target.checked })
                        }
                        className="h-4 w-4"
                      />
                      <span className="capitalize">{label}</span>
                    </label>
                  );
                }
                if (def.tipo === 'enum') {
                  return (
                    <div key={clave}>
                      <Label className="mb-1 block text-xs capitalize">{label}</Label>
                      <select
                        value={typeof valor === 'string' ? valor : ''}
                        onChange={(e) =>
                          set('atributos', { ...values.atributos, [clave]: e.target.value })
                        }
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">—</option>
                        {(def.opciones ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                if (def.tipo === 'number') {
                  return (
                    <div key={clave}>
                      <Label className="mb-1 block text-xs capitalize">{label}</Label>
                      <Input
                        type="number"
                        value={typeof valor === 'number' ? valor : ''}
                        onChange={(e) =>
                          set('atributos', {
                            ...values.atributos,
                            [clave]: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  );
                }
                return (
                  <div key={clave}>
                    <Label className="mb-1 block text-xs capitalize">{label}</Label>
                    <Input
                      value={typeof valor === 'string' ? valor : ''}
                      onChange={(e) =>
                        set('atributos', { ...values.atributos, [clave]: e.target.value })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PreciosFields({
  precios,
  onChange,
  listas,
  /** Map listaId → fecha ISO de última actualización del precio.
   *  Si está, mostramos "actualizado hace X días" al lado del nombre.
   *  Opcional para no romper otros callers (creación de producto nuevo). */
  ultimaActualizacionPorLista,
  /** Costo del producto. Si está y es > 0, al lado de cada precio
   *  mostramos el margen calculado y un input para editarlo
   *  (cambiar margen → recalcula precio). */
  costo,
}: {
  precios: { listaId: string; escalas: { desde: number; precio: number }[] }[];
  onChange: (
    next: { listaId: string; escalas: { desde: number; precio: number }[] }[],
  ) => void;
  listas: { id: string; nombre: string }[];
  ultimaActualizacionPorLista?: Record<string, string | undefined>;
  costo?: number;
}) {
  function setEscala(listaId: string, idx: number, patch: Partial<{ desde: number; precio: number }>) {
    onChange(
      precios.map((p) =>
        p.listaId === listaId
          ? {
              ...p,
              escalas: p.escalas.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
            }
          : p,
      ),
    );
  }
  function agregarEscala(listaId: string) {
    onChange(
      precios.map((p) =>
        p.listaId === listaId
          ? { ...p, escalas: [...p.escalas, { desde: (p.escalas.at(-1)?.desde ?? 0) + 1, precio: 0 }] }
          : p,
      ),
    );
  }
  function quitarEscala(listaId: string, idx: number) {
    onChange(
      precios.map((p) =>
        p.listaId === listaId
          ? { ...p, escalas: p.escalas.filter((_, i) => i !== idx) }
          : p,
      ),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Precios por lista</CardTitle>
        <p className="text-sm text-muted-foreground">
          Definí precios por cantidad. La primera escala "desde 1" se usa por defecto.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {listas.map((lista) => {
          const p = precios.find((x) => x.listaId === lista.id);
          if (!p) return null;
          const actualizado = ultimaActualizacionPorLista?.[lista.id];
          // Si el prop está presente pero no hay valor para esta lista,
          // mostramos "sin fecha registrada" para que sea evidente que
          // la feature está y que solo falta el dato (típicamente, ese
          // precio nunca se editó desde que se agregó el tracking).
          const mostrarFecha = ultimaActualizacionPorLista !== undefined;
          return (
            <div key={lista.id}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{lista.nombre}</span>
                {mostrarFecha && (
                  actualizado ? (
                    <span
                      className="text-xs text-muted-foreground"
                      title={`Última modificación: ${fechaCorta(actualizado)}`}
                    >
                      Actualizado {tiempoDesde(actualizado)}
                    </span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground/60">
                      Sin fecha registrada
                    </span>
                  )
                )}
              </div>
              {p.escalas.map((esc, idx) => {
                // Margen calculado: si hay costo > 0, mostramos el % de
                // ganancia sobre el costo y permitimos editarlo (tipear
                // margen recalcula precio = costo * (1 + margen/100)).
                const margenPct =
                  costo && costo > 0 ? ((esc.precio - costo) / costo) * 100 : null;
                const tieneCosto = costo !== undefined && costo > 0;
                return (
                <div
                  key={idx}
                  className={`mb-2 grid gap-2 ${tieneCosto ? 'grid-cols-[1fr_1fr_1fr_auto]' : 'grid-cols-[1fr_1fr_auto]'}`}
                >
                  <div>
                    <Label className="mb-1 block text-xs">Desde cantidad</Label>
                    <Input
                      type="number"
                      min="1"
                      value={esc.desde}
                      onChange={(e) =>
                        setEscala(lista.id, idx, { desde: parseInt(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">Precio</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={esc.precio}
                      onChange={(e) =>
                        setEscala(lista.id, idx, { precio: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  {tieneCosto && (
                    <div>
                      <Label className="mb-1 block text-xs">
                        Margen %{' '}
                        <span className="text-muted-foreground/70">
                          (s/costo ${costo})
                        </span>
                      </Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={margenPct !== null ? Number(margenPct.toFixed(2)) : ''}
                        onChange={(e) => {
                          const m = parseFloat(e.target.value);
                          if (Number.isFinite(m) && costo) {
                            const nuevoPrecio = costo * (1 + m / 100);
                            setEscala(lista.id, idx, {
                              precio: Number(nuevoPrecio.toFixed(2)),
                            });
                          }
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-end">
                    {idx > 0 ? (
                      <button
                        type="button"
                        onClick={() => quitarEscala(lista.id, idx)}
                        className="h-10 px-3 text-xs text-destructive hover:underline"
                      >
                        Quitar
                      </button>
                    ) : (
                      <span className="h-10" />
                    )}
                  </div>
                </div>
                );
              })}
              <button
                type="button"
                onClick={() => agregarEscala(lista.id)}
                className="text-xs text-primary hover:underline"
              >
                + Agregar escala por cantidad
              </button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function useProductoForm(initial?: ProductoFormValues) {
  return useState<ProductoFormValues>(
    initial ?? {
      codigo_interno: '',
      nombre: '',
      descripcion: '',
      descripcion_larga: '',
      categoria_id: '',
      proveedor_id: '',
      costo: 0,
      publicado_web: false,
      activo: true,
      solo_por_bulto: false,
      cantidad_minima_web: 0,
      incremento_web: 1,
      atributos: {},
    },
  );
}
