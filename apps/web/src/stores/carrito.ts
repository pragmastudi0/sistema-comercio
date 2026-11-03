import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Producto } from '@comercio/db';

export type ItemCarritoWeb = {
  productoId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  /** Escalas de precio que aplica el cliente, snapshot del momento. */
  escalas: { desde: number; precio: number }[];
  /** Precio local (CF) unitario snapshot — fallback si no se llega al
   *  umbral de mayorista_desde_monto. Opcional para no romper carritos
   *  guardados en localStorage antes de este cambio. */
  precioLocal?: number;
};

type CarritoState = {
  items: ItemCarritoWeb[];
  agregar: (
    producto: Pick<Producto, 'id' | 'codigo_interno' | 'nombre'>,
    escalas: { desde: number; precio: number }[],
    cantidad?: number,
    precioLocal?: number,
  ) => void;
  setCantidad: (productoId: string, cantidad: number) => void;
  quitar: (productoId: string) => void;
  vaciar: () => void;
};

export const useCarrito = create<CarritoState>()(
  persist(
    (set) => ({
      items: [],
      agregar: (producto, escalas, cantidad = 1, precioLocal) =>
        set((s) => {
          const existente = s.items.find((i) => i.productoId === producto.id);
          if (existente) {
            return {
              items: s.items.map((i) =>
                i.productoId === producto.id
                  ? {
                      ...i,
                      cantidad: i.cantidad + cantidad,
                      // Actualizar el precio local si no lo teníamos snapshot.
                      precioLocal: i.precioLocal ?? precioLocal,
                    }
                  : i,
              ),
            };
          }
          return {
            items: [
              ...s.items,
              {
                productoId: producto.id,
                codigo: producto.codigo_interno,
                nombre: producto.nombre,
                cantidad,
                escalas,
                precioLocal,
              },
            ],
          };
        }),
      setCantidad: (productoId, cantidad) =>
        set((s) => ({
          items: s.items
            .map((i) => (i.productoId === productoId ? { ...i, cantidad } : i))
            .filter((i) => i.cantidad > 0),
        })),
      quitar: (productoId) =>
        set((s) => ({ items: s.items.filter((i) => i.productoId !== productoId) })),
      vaciar: () => set({ items: [] }),
    }),
    { name: 'turisteando-web-carrito' },
  ),
);

/** Devuelve el precio aplicable a esa cantidad según las escalas. */
export function precioPorCantidad(
  escalas: { desde: number; precio: number }[],
  cantidad: number,
): number {
  if (escalas.length === 0 || cantidad <= 0) return 0;
  let aplicado = escalas[0]!.precio;
  for (const e of escalas) {
    if (cantidad >= e.desde) aplicado = e.precio;
    else break;
  }
  return aplicado;
}

export function subtotalDeItem(item: ItemCarritoWeb): number {
  return item.cantidad * precioPorCantidad(item.escalas, item.cantidad);
}

export function totalCarrito(items: ItemCarritoWeb[]): number {
  return items.reduce((acc, i) => acc + subtotalDeItem(i), 0);
}

/**
 * Resuelve el carrito aplicando el umbral de "precio mayorista desde
 * $X". Si el subtotal mayorista no llega al umbral, cada ítem se cobra
 * al precio local (CF) snapshot. Si un ítem no tiene `precioLocal`
 * guardado (carritos viejos de localStorage), se mantiene el mayorista
 * como fallback.
 */
export type ItemResuelto = ItemCarritoWeb & {
  precioUnitarioEfectivo: number;
  subtotalEfectivo: number;
};

export type CarritoResuelto = {
  items: ItemResuelto[];
  subtotal: number;
  subtotalMayorista: number;
  aplicaMayorista: boolean;
  umbralMayorista: number;
  faltaParaMayorista: number;
};

export function resolverCarrito(
  items: ItemCarritoWeb[],
  mayoristaDesdeMonto: number,
): CarritoResuelto {
  const umbral = Math.max(0, mayoristaDesdeMonto ?? 0);
  const subtotalMayorista = items.reduce(
    (acc, i) => acc + i.cantidad * precioPorCantidad(i.escalas, i.cantidad),
    0,
  );
  const aplicaMayorista = umbral === 0 || subtotalMayorista >= umbral;

  const resueltos: ItemResuelto[] = items.map((i) => {
    const mayorista = precioPorCantidad(i.escalas, i.cantidad);
    const efectivo = aplicaMayorista ? mayorista : i.precioLocal ?? mayorista;
    return {
      ...i,
      precioUnitarioEfectivo: efectivo,
      subtotalEfectivo: efectivo * i.cantidad,
    };
  });

  const subtotal = resueltos.reduce((acc, i) => acc + i.subtotalEfectivo, 0);

  return {
    items: resueltos,
    subtotal,
    subtotalMayorista,
    aplicaMayorista,
    umbralMayorista: umbral,
    faltaParaMayorista: aplicaMayorista ? 0 : Math.max(0, umbral - subtotalMayorista),
  };
}
