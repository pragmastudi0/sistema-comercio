import type { ID, Producto, ProductoImagen, ProductoListaPrecio, Variante } from '../types';

export type FiltroProductos = {
  texto?: string; // busca en código y nombre
  categoria_id?: ID;
  proveedor_id?: ID;
  /** Suma total de stock en todos los depósitos <= 0. */
  sin_stock?: boolean;
  /** Suma total de stock > 0 y <= umbral_bajo_stock. */
  bajo_stock?: boolean;
  /** Umbral en unidades para considerar "bajo stock". Default 5. */
  umbral_bajo_stock?: number;
  publicado_web?: boolean;
  activo?: boolean;
};

/** Resultado paginado con total para mostrar "X de N" en la UI. */
export type ListadoProductos = {
  rows: Producto[];
  total: number;
};

export type ProductosRepo = {
  /**
   * Devuelve TODOS los productos que matchean el filtro (paginando internamente
   * para sortear el límite de 1000 filas del REST de PostgREST). Sigue siendo
   * compatible con el código viejo que esperaba Producto[].
   */
  list(filtro?: FiltroProductos): Promise<Producto[]>;
  /**
   * Versión paginada para listados con UI. Devuelve solo `pageSize` filas y el
   * total real (con count exacto). Pensado para no traer 2000 productos cuando
   * la UI muestra 100 por vez.
   */
  listPaginado(
    filtro: FiltroProductos & { page: number; pageSize: number },
  ): Promise<ListadoProductos>;
  buscarRapido(query: string, limit?: number): Promise<Producto[]>;
  buscarPorCodigo(codigo: string): Promise<Producto | null>;
  get(id: ID): Promise<Producto | null>;
  create(input: Omit<Producto, 'id' | 'creado_en'>): Promise<Producto>;
  update(id: ID, patch: Partial<Producto>): Promise<Producto>;
  delete(id: ID): Promise<void>;
  aumentoMasivo(filtro: FiltroProductos, porcentaje: number, listaPrecioId: ID): Promise<number>;
  /**
   * Setea el override de descuento mayorista sobre todos los productos que
   * matchean el filtro. `pct = null` limpia el override → el producto pasa
   * a usar el global de la empresa. Devuelve la cantidad de filas afectadas.
   * Usado por el modal Ajuste masivo en /admin/web.
   */
  setDescuentoMayoristaMasivo(filtro: FiltroProductos, pct: number | null): Promise<number>;

  // Variantes
  variantes(productoId: ID): Promise<Variante[]>;
  crearVariante(productoId: ID, atributos: Record<string, string>): Promise<Variante>;
  eliminarVariante(varianteId: ID): Promise<void>;

  // Imágenes
  imagenes(productoId: ID): Promise<ProductoImagen[]>;
  /**
   * Trae todas las imágenes de un conjunto de productos en un solo query.
   * Útil para listados como el catálogo del e-commerce.
   */
  imagenesDeMuchos(productoIds: ID[]): Promise<ProductoImagen[]>;
  agregarImagen(productoId: ID, url: string): Promise<ProductoImagen>;
  eliminarImagen(imagenId: ID): Promise<void>;
  reordenarImagenes(productoId: ID, idsEnOrden: ID[]): Promise<void>;

  // Listas de precio
  preciosDe(productoId: ID): Promise<ProductoListaPrecio[]>;
  /**
   * Trae todos los registros de precio para una lista (todos los productos).
   * Pensado para reportes y valuación de stock: 1 sola request en lugar de
   * llamar preciosDe por cada producto.
   */
  preciosDeLista(listaPrecioId: ID): Promise<ProductoListaPrecio[]>;
  setPrecio(productoId: ID, listaPrecioId: ID, escalas: { desde: number; precio: number }[]): Promise<void>;
};
