import type { Producto, ProductoImagen, ProductoListaPrecio, Variante } from '../../types';
import type { FiltroProductos, ProductosRepo } from '../../repos/productos.repo';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';

export function makeProductosRepo(store: Store): ProductosRepo {
  function match(p: Producto, f: FiltroProductos): boolean {
    if (f.activo !== undefined && p.activo !== f.activo) return false;
    if (f.categoria_id && p.categoria_id !== f.categoria_id) return false;
    if (f.proveedor_id && p.proveedor_id !== f.proveedor_id) return false;
    if (f.publicado_web !== undefined && p.publicado_web !== f.publicado_web) return false;
    if (f.texto) {
      const q = f.texto.toLowerCase();
      if (!p.nombre.toLowerCase().includes(q) && !p.codigo_interno.includes(q)) return false;
    }
    if (f.sin_stock || f.bajo_stock) {
      const total = store.stock
        .filter((s) => s.producto_id === p.id)
        .reduce((acc, s) => acc + s.cantidad, 0);
      const umbral = f.umbral_bajo_stock ?? 5;
      if (f.sin_stock && total > 0) return false;
      if (f.bajo_stock && (total <= 0 || total > umbral)) return false;
    }
    return true;
  }

  return {
    async list(filtro = {}) {
      return clone(store.productos.filter((p) => match(p, filtro)));
    },
    async listPaginado(filtro) {
      const { page, pageSize, ...resto } = filtro;
      const all = store.productos.filter((p) => match(p, resto));
      const start = page * pageSize;
      return { rows: clone(all.slice(start, start + pageSize)), total: all.length };
    },
    async buscarRapido(q, limit = 10) {
      if (!q.trim()) return [];
      const query = q.trim().toLowerCase();
      const matches = store.productos
        .filter((p) => p.activo)
        .filter(
          (p) =>
            p.codigo_interno.startsWith(query) ||
            p.nombre.toLowerCase().includes(query),
        )
        .slice(0, limit);
      return clone(matches);
    },
    async buscarPorCodigo(codigo) {
      const p = store.productos.find((x) => x.codigo_interno === codigo) ?? null;
      return p ? clone(p) : null;
    },
    async get(id) {
      const p = store.productos.find((x) => x.id === id);
      return p ? clone(p) : null;
    },
    async create(input) {
      const p: Producto = { ...input, id: makeId('prod'), creado_en: now() };
      store.productos.push(p);
      return clone(p);
    },
    async update(id, patch) {
      const idx = store.productos.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Producto', id);
      store.productos[idx] = { ...store.productos[idx]!, ...patch, id };
      return clone(store.productos[idx]!);
    },
    async delete(id) {
      const idx = store.productos.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Producto', id);
      store.productos.splice(idx, 1);
      // Limpieza referencial básica
      store.productoListaPrecio = store.productoListaPrecio.filter((x) => x.producto_id !== id);
      store.productoImagenes = store.productoImagenes.filter((x) => x.producto_id !== id);
      store.variantes = store.variantes.filter((x) => x.producto_id !== id);
      store.stock = store.stock.filter((x) => x.producto_id !== id);
    },
    async aumentoMasivo(filtro, porcentaje, listaPrecioId) {
      const productos = store.productos.filter((p) => match(p, filtro));
      let actualizados = 0;
      for (const p of productos) {
        const link = store.productoListaPrecio.find(
          (x) => x.producto_id === p.id && x.lista_precio_id === listaPrecioId,
        );
        if (!link) continue;
        link.escalas = link.escalas.map((e) => ({
          ...e,
          precio: Math.round(e.precio * (1 + porcentaje / 100)),
        }));
        actualizados += 1;
      }
      return actualizados;
    },
    async setDescuentoMayoristaMasivo(filtro, pct) {
      const value = pct == null ? null : Math.max(0, Math.min(100, pct));
      const productos = store.productos.filter((p) => match(p, filtro));
      for (const p of productos) {
        p.descuento_mayorista_pct_override = value;
      }
      return productos.length;
    },
    async variantes(productoId) {
      return clone(store.variantes.filter((v) => v.producto_id === productoId));
    },
    async crearVariante(productoId, atributos) {
      const v: Variante = { id: makeId('var'), producto_id: productoId, atributos };
      store.variantes.push(v);
      return clone(v);
    },
    async eliminarVariante(varianteId) {
      store.variantes = store.variantes.filter((v) => v.id !== varianteId);
    },
    async imagenes(productoId) {
      return clone(
        store.productoImagenes
          .filter((i) => i.producto_id === productoId)
          .sort((a, b) => a.orden - b.orden),
      );
    },
    async imagenesDeMuchos(productoIds) {
      const set = new Set(productoIds);
      return clone(
        store.productoImagenes
          .filter((i) => set.has(i.producto_id))
          .sort((a, b) => a.orden - b.orden),
      );
    },
    async agregarImagen(productoId, url) {
      const orden = store.productoImagenes.filter((i) => i.producto_id === productoId).length;
      const img: ProductoImagen = { id: makeId('img'), producto_id: productoId, url, orden };
      store.productoImagenes.push(img);
      return clone(img);
    },
    async eliminarImagen(imagenId) {
      store.productoImagenes = store.productoImagenes.filter((i) => i.id !== imagenId);
    },
    async reordenarImagenes(productoId, idsEnOrden) {
      idsEnOrden.forEach((id, i) => {
        const img = store.productoImagenes.find((x) => x.id === id && x.producto_id === productoId);
        if (img) img.orden = i;
      });
    },
    async preciosDe(productoId) {
      return clone(store.productoListaPrecio.filter((x) => x.producto_id === productoId));
    },
    async preciosDeLista(listaPrecioId) {
      return clone(
        store.productoListaPrecio.filter((x) => x.lista_precio_id === listaPrecioId),
      );
    },
    async setPrecio(productoId, listaPrecioId, escalas) {
      const ordenadas = [...escalas].sort((a, b) => a.desde - b.desde);
      const idx = store.productoListaPrecio.findIndex(
        (x) => x.producto_id === productoId && x.lista_precio_id === listaPrecioId,
      );
      const link: ProductoListaPrecio = {
        producto_id: productoId,
        lista_precio_id: listaPrecioId,
        escalas: ordenadas,
      };
      if (idx === -1) store.productoListaPrecio.push(link);
      else store.productoListaPrecio[idx] = link;
    },
  };
}
