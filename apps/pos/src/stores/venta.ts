import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { subtotalComboXPrecio, unidadesCobradasNxM } from '@comercio/business';
import type { Producto } from '@comercio/db';
import { storageKey } from '../lib/storage';

/** Precio mínimo permitido por línea. Evita ventas accidentales a $0 o
 * con número negativo (un cero de más en el input editable). */
const PRECIO_MINIMO = 0.01;

export type ItemCarrito = {
  producto: Producto;
  cantidad: number;
  precio_unitario: number;
  precio_base: number;
  descuento_pct?: number;
  /** Motivo del cambio de precio. Obligatorio si precio_unitario != precio_base
   *  al confirmar la venta. Queda en auditoría. */
  motivo_precio?: string;
  /** Motivo del descuento por línea. Obligatorio si descuento_pct > 0
   *  al confirmar la venta. Queda en auditoría. */
  motivo_descuento_linea?: string;
  /** Escalas de precio del producto (desde N unidades → precio X). Se
   *  usan para recalcular precio_unitario al cambiar la cantidad — típico
   *  precio mayorista al pasar el umbral. Escala 0 = precio unitario CF. */
  escalas?: { desde: number; precio: number }[];
};

/** Devuelve el precio aplicable según las escalas y la cantidad. Toma
 *  la ÚLTIMA escala con `desde <= cantidad`. Ordena defensivamente por
 *  `desde` ASC: los call-sites no siempre venían ordenados y con
 *  escalas mayoristas cargadas (desde=12) daba el precio equivocado. */
function precioSegunEscala(
  escalas: { desde: number; precio: number }[],
  cantidad: number,
): number {
  const orden = [...escalas].sort((a, b) => a.desde - b.desde);
  let aplicado = orden[0]?.precio ?? 0;
  for (const e of orden) {
    if (cantidad >= e.desde) aplicado = e.precio;
    else break;
  }
  return aplicado;
}

export type ModoDescuento = 'pct' | 'monto';

/** Snapshot de un carrito "guardado" en paralelo (no activo).
 *  El carrito activo vive en los campos top-level de VentaState. */
type CarritoSnapshot = {
  items: ItemCarrito[];
  clienteId: string | null;
  descuentoModo: ModoDescuento;
  descuentoValor: number;
  motivoDescuento?: string;
};

/** Máximo de carritos simultáneos (1 activo + N paralelos). */
export const MAX_CARRITOS = 3;

type VentaState = {
  items: ItemCarrito[];
  clienteId: string | null;
  /** Id del producto resaltado en el carrito. Se usa para que la cajera
   * pueda seleccionar una fila (clic o teclado) y borrarla con Supr/Del.
   * Se auto-asigna al último agregado y se desplaza al vecino al quitar. */
  seleccionadoId: string | null;
  descuentoModo: ModoDescuento;
  descuentoValor: number;
  motivoDescuento?: string;
  /** Carritos en paralelo (los NO activos). Permite a la cajera atender
   *  a dos clientes a la vez: arma uno, le falta algo, abre otro carrito,
   *  atiende al segundo, vuelve y termina el primero. */
  carritosParalelos: Record<string, CarritoSnapshot>;
  /** Id del carrito actualmente activo (default 'c1'). */
  carritoActivoId: string;
  /** Próximo id correlativo (para nombrar c1, c2, c3...). */
  _nextCarritoSeq: number;
  agregar: (
    producto: Producto,
    precio: number,
    escalas?: { desde: number; precio: number }[],
  ) => void;
  setCantidad: (productoId: string, cantidad: number) => void;
  setPrecio: (productoId: string, precio: number) => void;
  setMotivoPrecio: (productoId: string, motivo: string) => void;
  setDescuentoLinea: (productoId: string, pct: number | undefined) => void;
  setMotivoDescuentoLinea: (productoId: string, motivo: string) => void;
  quitar: (productoId: string) => void;
  seleccionar: (productoId: string | null) => void;
  moverSeleccion: (delta: 1 | -1) => void;
  setCliente: (id: string | null) => void;
  setDescuento: (modo: ModoDescuento, valor: number, motivo?: string) => void;
  limpiarDescuento: () => void;
  limpiar: () => void;
  /** Crear un carrito nuevo vacío y activarlo. El actual queda guardado
   *  en `carritosParalelos`. Devuelve el id del nuevo. Bloquea si ya
   *  hay MAX_CARRITOS abiertos. */
  nuevoCarrito: () => string | null;
  /** Cambiar al carrito `id`: guarda el actual en paralelos y carga el
   *  target en el top-level. No-op si `id` es el actual. */
  cambiarCarrito: (id: string) => void;
  /** Cerrar un carrito específico (lo borra de paralelos). Si era el
   *  activo, salta a otro paralelo. Si no queda ninguno, queda vacío. */
  cerrarCarrito: (id: string) => void;
};

export const useVenta = create<VentaState>()(
  persist(
    (set, get) => ({
      items: [],
      clienteId: null,
      seleccionadoId: null,
      descuentoModo: 'pct',
      descuentoValor: 0,
      motivoDescuento: undefined,
      carritosParalelos: {},
      carritoActivoId: 'c1',
      _nextCarritoSeq: 2,
      agregar: (producto, precio, escalas) =>
        set((state) => {
          const existente = state.items.find((i) => i.producto.id === producto.id);
          if (existente) {
            // Sumar 1 y recalcular precio según escalas si aplica
            // (cruzar el umbral mayorista al agregar la siguiente).
            const nuevaCantidad = existente.cantidad + 1;
            const escalasOrdenadas = existente.escalas ?? escalas ?? [];
            const precioNuevo =
              escalasOrdenadas.length > 1 &&
              existente.precio_unitario === existente.precio_base
                ? Math.max(
                    PRECIO_MINIMO,
                    precioSegunEscala(escalasOrdenadas, nuevaCantidad),
                  )
                : existente.precio_unitario;
            return {
              items: state.items.map((i) =>
                i.producto.id === producto.id
                  ? {
                      ...i,
                      // Pisamos SIEMPRE el snapshot del producto con el
                      // más fresco. Antes se mantenía `i.producto` (el
                      // viejo), y si la promo se cargaba entre la 1ª y la
                      // 2ª unidad agregadas, el carrito quedaba con la
                      // versión sin promo. Causa raíz del bug reportado
                      // por Agus con los 2x1 (ver script
                      // scripts/diagnostico-promos.mjs). Al pisar con el
                      // producto que viene del cache fresco de React
                      // Query, siempre arrancamos del último estado.
                      producto,
                      cantidad: nuevaCantidad,
                      precio_unitario: precioNuevo,
                      precio_base: precioNuevo,
                    }
                  : i,
              ),
              seleccionadoId: producto.id,
            };
          }
          // Si el precio del producto es 0 (ej. mal seteado en catálogo),
          // forzamos al mínimo. Mejor evidente al cajero que silenciado.
          const precioOk = Math.max(PRECIO_MINIMO, precio);
          return {
            items: [
              ...state.items,
              {
                producto,
                cantidad: 1,
                precio_unitario: precioOk,
                precio_base: precioOk,
                escalas: escalas ?? undefined,
              },
            ],
            seleccionadoId: producto.id,
          };
        }),
      setCantidad: (productoId, cantidad) =>
        set((state) => ({
          items: state.items
            .map((i) => {
              if (i.producto.id !== productoId) return i;
              // Si el precio no fue editado a mano (== precio_base) y hay
              // escalas, recalcular según la nueva cantidad. El precio_base
              // se sincroniza con el nuevo también, así el subtotal del
              // carrito refleja correctamente el precio mayorista aplicado.
              const escalas = i.escalas ?? [];
              const puedeRecalcular =
                escalas.length > 1 && i.precio_unitario === i.precio_base;
              if (puedeRecalcular) {
                const nuevoPrecio = Math.max(
                  PRECIO_MINIMO,
                  precioSegunEscala(escalas, cantidad),
                );
                return {
                  ...i,
                  cantidad,
                  precio_unitario: nuevoPrecio,
                  precio_base: nuevoPrecio,
                };
              }
              return { ...i, cantidad };
            })
            .filter((i) => i.cantidad > 0),
        })),
      setPrecio: (productoId, precio) =>
        set((state) => ({
          // Bloqueamos precios ≤ 0. Si el cajero edita y borra el campo,
          // el input vuelve al mínimo en lugar de quedar en 0/negativo.
          // Si el nuevo precio vuelve al base, limpiamos el motivo (ya no
          // es un precio "editado").
          items: state.items.map((i) => {
            if (i.producto.id !== productoId) return i;
            const nuevo = Math.max(PRECIO_MINIMO, precio);
            return {
              ...i,
              precio_unitario: nuevo,
              motivo_precio:
                nuevo === i.precio_base ? undefined : i.motivo_precio,
            };
          }),
        })),
      setMotivoPrecio: (productoId, motivo) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.producto.id === productoId
              ? { ...i, motivo_precio: motivo || undefined }
              : i,
          ),
        })),
      setDescuentoLinea: (productoId, pct) =>
        set((state) => ({
          // Si el descuento se borra (pct=0/undefined), también limpiamos
          // el motivo asociado.
          items: state.items.map((i) =>
            i.producto.id === productoId
              ? {
                  ...i,
                  descuento_pct: pct,
                  motivo_descuento_linea: pct ? i.motivo_descuento_linea : undefined,
                }
              : i,
          ),
        })),
      setMotivoDescuentoLinea: (productoId, motivo) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.producto.id === productoId
              ? { ...i, motivo_descuento_linea: motivo || undefined }
              : i,
          ),
        })),
      quitar: (productoId) =>
        set((state) => {
          const idx = state.items.findIndex((i) => i.producto.id === productoId);
          const itemsNew = state.items.filter((i) => i.producto.id !== productoId);
          // Si lo borrado era el seleccionado, pasamos al vecino (mismo
          // índice = el siguiente; si era el último, al anterior).
          let nuevoSel: string | null = state.seleccionadoId;
          if (state.seleccionadoId === productoId) {
            const vecino = itemsNew[idx] ?? itemsNew[idx - 1];
            nuevoSel = vecino?.producto.id ?? null;
          }
          return { items: itemsNew, seleccionadoId: nuevoSel };
        }),
      seleccionar: (productoId) => set({ seleccionadoId: productoId }),
      moverSeleccion: (delta) =>
        set((state) => {
          if (state.items.length === 0) return { seleccionadoId: null };
          const idx = state.items.findIndex((i) => i.producto.id === state.seleccionadoId);
          // Si no hay nada seleccionado: ↓ va al primero, ↑ al último.
          if (idx === -1) {
            return {
              seleccionadoId:
                delta > 0 ? state.items[0]!.producto.id : state.items[state.items.length - 1]!.producto.id,
            };
          }
          const next = Math.max(0, Math.min(state.items.length - 1, idx + delta));
          return { seleccionadoId: state.items[next]!.producto.id };
        }),
      setCliente: (id) => set({ clienteId: id }),
      setDescuento: (modo, valor, motivo) =>
        set({ descuentoModo: modo, descuentoValor: Math.max(0, valor), motivoDescuento: motivo }),
      limpiarDescuento: () => set({ descuentoValor: 0, motivoDescuento: undefined }),
      limpiar: () =>
        set((state) => {
          // Si hay otros carritos abiertos, al cobrar/cancelar el actual
          // saltamos al siguiente. Si no, queda todo vacío en el slot
          // actual (c1, c2, etc. — el id se conserva).
          const ids = Object.keys(state.carritosParalelos);
          if (ids.length > 0) {
            const proximoId = ids[0]!;
            const proximo = state.carritosParalelos[proximoId]!;
            const restoParalelos = { ...state.carritosParalelos };
            delete restoParalelos[proximoId];
            return {
              items: proximo.items,
              clienteId: proximo.clienteId,
              seleccionadoId: null,
              descuentoModo: proximo.descuentoModo,
              descuentoValor: proximo.descuentoValor,
              motivoDescuento: proximo.motivoDescuento,
              carritoActivoId: proximoId,
              carritosParalelos: restoParalelos,
            };
          }
          return {
            items: [],
            clienteId: null,
            seleccionadoId: null,
            descuentoModo: 'pct',
            descuentoValor: 0,
            motivoDescuento: undefined,
          };
        }),
      nuevoCarrito: () => {
        const state = get();
        // Activos = 1 (el actual) + paralelos. MAX_CARRITOS total.
        if (Object.keys(state.carritosParalelos).length + 1 >= MAX_CARRITOS) {
          return null;
        }
        const nuevoId = `c${state._nextCarritoSeq}`;
        // Snapshot del actual a paralelos, luego limpiar top-level.
        const snapshotActual: CarritoSnapshot = {
          items: state.items,
          clienteId: state.clienteId,
          descuentoModo: state.descuentoModo,
          descuentoValor: state.descuentoValor,
          motivoDescuento: state.motivoDescuento,
        };
        set({
          carritosParalelos: {
            ...state.carritosParalelos,
            [state.carritoActivoId]: snapshotActual,
          },
          carritoActivoId: nuevoId,
          _nextCarritoSeq: state._nextCarritoSeq + 1,
          items: [],
          clienteId: null,
          seleccionadoId: null,
          descuentoModo: 'pct',
          descuentoValor: 0,
          motivoDescuento: undefined,
        });
        return nuevoId;
      },
      cambiarCarrito: (id) => {
        const state = get();
        if (id === state.carritoActivoId) return;
        const target = state.carritosParalelos[id];
        if (!target) return;
        // Snapshot del actual va a paralelos; sacamos el target.
        const snapshotActual: CarritoSnapshot = {
          items: state.items,
          clienteId: state.clienteId,
          descuentoModo: state.descuentoModo,
          descuentoValor: state.descuentoValor,
          motivoDescuento: state.motivoDescuento,
        };
        const nuevoParalelos = { ...state.carritosParalelos };
        delete nuevoParalelos[id];
        nuevoParalelos[state.carritoActivoId] = snapshotActual;
        set({
          carritosParalelos: nuevoParalelos,
          carritoActivoId: id,
          items: target.items,
          clienteId: target.clienteId,
          seleccionadoId: null,
          descuentoModo: target.descuentoModo,
          descuentoValor: target.descuentoValor,
          motivoDescuento: target.motivoDescuento,
        });
      },
      cerrarCarrito: (id) => {
        const state = get();
        if (id === state.carritoActivoId) {
          // Cerrar el activo = limpiar (que ya sabe saltar al próximo).
          // Pero limpiar solo limpia el actual; queremos descartarlo y
          // saltar. Reutilizamos la misma lógica.
          const ids = Object.keys(state.carritosParalelos);
          if (ids.length > 0) {
            const proximoId = ids[0]!;
            const proximo = state.carritosParalelos[proximoId]!;
            const restoParalelos = { ...state.carritosParalelos };
            delete restoParalelos[proximoId];
            set({
              items: proximo.items,
              clienteId: proximo.clienteId,
              seleccionadoId: null,
              descuentoModo: proximo.descuentoModo,
              descuentoValor: proximo.descuentoValor,
              motivoDescuento: proximo.motivoDescuento,
              carritoActivoId: proximoId,
              carritosParalelos: restoParalelos,
            });
          } else {
            set({
              items: [],
              clienteId: null,
              seleccionadoId: null,
              descuentoModo: 'pct',
              descuentoValor: 0,
              motivoDescuento: undefined,
            });
          }
          return;
        }
        // Cerrar un paralelo: solo lo sacamos del map.
        const nuevoParalelos = { ...state.carritosParalelos };
        delete nuevoParalelos[id];
        set({ carritosParalelos: nuevoParalelos });
      },
    }),
    {
      // Persistimos el carrito en localStorage para que si se cae el
      // navegador (corte de luz, recarga accidental, redeploy de Vercel)
      // el cajero recupere lo que estaba armando. No persistimos la
      // sesión Supabase ni los productos completos: solo lo del carrito.
      name: storageKey('pos-carrito'),
      // v3: agregamos persistencia de carritos paralelos para soportar
      // varias ventas a la vez (la cajera puede recargar el navegador
      // sin perder los carritos abiertos). El descuento global sigue
      // sin persistirse — es per-venta.
      version: 3,
      partialize: (s) => ({
        items: s.items,
        clienteId: s.clienteId,
        carritosParalelos: s.carritosParalelos,
        carritoActivoId: s.carritoActivoId,
        _nextCarritoSeq: s._nextCarritoSeq,
      }),
    },
  ),
);

export function calcularSubtotal(items: ItemCarrito[]): number {
  return items.reduce((acc, i) => acc + calcularSubtotalLinea(i), 0);
}

/**
 * Subtotal de UNA línea del carrito, aplicando (en orden):
 *   1. Promo del producto (NxM o combo N x $) → base "bruta" reducida.
 *      - NxM: reduce las unidades cobradas al precio unitario.
 *      - Combo: packs a precio fijo + sueltas a precio unitario normal.
 *   2. Descuento por línea (%) sobre esa base.
 * Si el producto no tiene promo válida, se cobra cantidad × precio.
 */
export function calcularSubtotalLinea(i: ItemCarrito): number {
  let bruto: number;
  if (
    i.producto.promo_tipo === 'nxm' &&
    i.producto.promo_nxm_lleva != null &&
    i.producto.promo_nxm_paga != null
  ) {
    const cobradas = unidadesCobradasNxM(
      i.cantidad,
      i.producto.promo_nxm_lleva,
      i.producto.promo_nxm_paga,
    );
    bruto = cobradas * i.precio_unitario;
  } else if (
    i.producto.promo_tipo === 'combo' &&
    i.producto.promo_combo_cantidad != null &&
    i.producto.promo_combo_precio != null
  ) {
    bruto = subtotalComboXPrecio(
      i.cantidad,
      i.producto.promo_combo_cantidad,
      i.producto.promo_combo_precio,
      i.precio_unitario,
    );
  } else {
    bruto = i.cantidad * i.precio_unitario;
  }
  const dto = i.descuento_pct ? bruto * (i.descuento_pct / 100) : 0;
  return bruto - dto;
}

export function calcularDescuentoGlobal(
  subtotal: number,
  modo: ModoDescuento,
  valor: number,
): number {
  if (valor <= 0) return 0;
  if (modo === 'pct') return subtotal * (Math.min(100, valor) / 100);
  return Math.min(subtotal, valor);
}

export function calcularBaseVenta(
  items: ItemCarrito[],
  modo: ModoDescuento,
  valor: number,
): number {
  const subtotal = calcularSubtotal(items);
  return subtotal - calcularDescuentoGlobal(subtotal, modo, valor);
}
