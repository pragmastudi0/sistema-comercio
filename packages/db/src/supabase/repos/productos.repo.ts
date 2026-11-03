import type { SupabaseClient } from '@supabase/supabase-js';
import type { FiltroProductos, ProductosRepo } from '../../repos/productos.repo';
import type { Producto, ProductoImagen, ProductoListaPrecio, Variante } from '../../types';
import { ok, okList, okMaybe } from '../helpers';

type PrecioRow = {
  producto_id: string;
  lista_precio_id: string;
  escalas: { desde: number; precio: number }[];
};

export function makeProductosRepo(sb: SupabaseClient): ProductosRepo {
  function aplicarFiltro<T>(q: T, f: FiltroProductos): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let qq: any = q;
    if (f.activo !== undefined) qq = qq.eq('activo', f.activo);
    if (f.categoria_id) qq = qq.eq('categoria_id', f.categoria_id);
    if (f.proveedor_id) qq = qq.eq('proveedor_id', f.proveedor_id);
    if (f.publicado_web !== undefined) qq = qq.eq('publicado_web', f.publicado_web);
    if (f.texto) {
      const q = f.texto.trim();
      const esNumerico = /^\d+$/.test(q);
      // Misma regla que en buscarRapido del PoS: si la query es 100%
      // numérica, asumimos que es código y matcheamos EXACTO. Antes con
      // `codigo_interno.ilike.%7%` tipear "7" traía 1776, 1697, etc.
      // (cualquier código con un 7 dentro). Ahora "7" trae solo el
      // código 7 exacto. Para buscar por nombre, tipear letras.
      if (esNumerico) {
        qq = qq.eq('codigo_interno', q);
      } else {
        qq = qq.ilike('nombre', `%${q}%`);
      }
    }
    return qq;
  }

  return {
    async list(filtro = {}) {
      // Paginar internamente para sortear el límite de 1000 filas de PostgREST.
      // Traemos chunks de 1000 hasta agotar.
      const CHUNK = 1000;
      const acumulado: Producto[] = [];
      let from = 0;
      while (true) {
        let q = sb.from('productos').select('*').order('nombre').range(from, from + CHUNK - 1);
        q = aplicarFiltro(q, filtro);
        const chunk = okList<Producto>(await q, 'productos.list');
        acumulado.push(...chunk);
        if (chunk.length < CHUNK) break;
        from += CHUNK;
      }
      let rows = acumulado;
      if (filtro.sin_stock || filtro.bajo_stock) {
        if (rows.length === 0) return rows;
        // Optimización: en vez de chunkear ids de 200 en 200 con .in() (que
        // para 1907 productos eran ~10 round-trips en serie), traemos la
        // tabla stock_items completa paginada de a 1000 — el límite real
        // del REST. Para ~2500 stock_items son ~3 round-trips. Cuesta lo
        // mismo levantar todo y sumar localmente que filtrar por ids,
        // porque la tabla no crece más rápido que el catálogo.
        const total = new Map<string, number>();
        let f = 0;
        while (true) {
          const { data, error } = await sb
            .from('stock_items')
            .select('producto_id, cantidad')
            .range(f, f + 999);
          if (error) throw new Error(`productos.list (stock): ${error.message}`);
          for (const s of data ?? []) {
            total.set(
              s.producto_id,
              (total.get(s.producto_id) ?? 0) + Number(s.cantidad),
            );
          }
          if (!data || data.length < 1000) break;
          f += 1000;
        }
        const umbral = filtro.umbral_bajo_stock ?? 5;
        if (filtro.sin_stock) {
          // "Sin stock" = strictly 0 o negativo.
          rows = rows.filter((p) => (total.get(p.id) ?? 0) <= 0);
        } else {
          // "Bajo stock" = todo lo que está bajo el umbral, INCLUYENDO
          // negativos y 0. Antes excluía los ≤ 0; ahora los suma porque
          // el dueño usa "Faltantes" para ver TODO lo que necesita reponer
          // (sin distinguir entre stock real bajo y desfasaje negativo).
          rows = rows.filter((p) => (total.get(p.id) ?? 0) <= umbral);
        }
      }
      return rows;
    },
    async listPaginado(filtro) {
      const { page, pageSize, ...resto } = filtro;
      // Si filtra por sin_stock o bajo_stock necesitamos el set completo de
      // candidatos primero (para contar bien y paginar sobre el subconjunto).
      // Caemos en la versión simple: traer todo via list() y paginar en
      // memoria. Es 1 query extra pero garantiza count exacto.
      if (resto.sin_stock || resto.bajo_stock) {
        const all = await this.list(resto);
        const start = page * pageSize;
        return { rows: all.slice(start, start + pageSize), total: all.length };
      }
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let q = sb
        .from('productos')
        .select('*', { count: 'exact' })
        .order('nombre')
        .range(from, to);
      q = aplicarFiltro(q, resto);
      const { data, error, count } = await q;
      if (error) throw new Error(`productos.listPaginado: ${error.message}`);
      return { rows: (data ?? []) as Producto[], total: count ?? 0 };
    },
    async buscarRapido(query, limit = 20) {
      if (!query.trim()) return [];
      const q = query.trim();
      const esNumerico = /^\d+$/.test(q);

      // Regla del cliente: si tipean números → match SOLO EXACTO por código.
      // Antes el filtro incluía también `nombre.ilike.%q%` para los números
      // — eso traía productos cuyo NOMBRE contiene el dígito (ej. tipear
      // "7" devolvía "Vela 7 colores", "Marca 7"). La cajera busca por
      // código numérico exacto; los matches por nombre solo aplican si
      // tipean letras.
      if (esNumerico) {
        return okList<Producto>(
          await sb
            .from('productos')
            .select('*')
            .eq('activo', true)
            .eq('codigo_interno', q)
            .limit(limit),
          'productos.buscarRapido',
        );
      }
      // Búsqueda por nombre: traemos hasta `limit` con orden alfabético
      // desde Postgres, y después priorizamos client-side los que EMPIEZAN
      // con el término tipeado. Antes se traían 8 sin ORDER BY: si había
      // 15+ productos con "valija" en el nombre, Postgres devolvía 8 en
      // orden random y "Valija mediana" podía quedar afuera. Bug real
      // reportado por el cliente.
      const filas = okList<Producto>(
        await sb
          .from('productos')
          .select('*')
          .eq('activo', true)
          .ilike('nombre', `%${q}%`)
          .order('nombre', { ascending: true })
          .limit(limit),
        'productos.buscarRapido',
      );
      const qLower = q.toLowerCase();
      const empieza: Producto[] = [];
      const contiene: Producto[] = [];
      for (const p of filas) {
        if (p.nombre.toLowerCase().startsWith(qLower)) empieza.push(p);
        else contiene.push(p);
      }
      return [...empieza, ...contiene];
    },
    async buscarPorCodigo(codigo) {
      return okMaybe<Producto>(
        await sb
          .from('productos')
          .select('*')
          .eq('codigo_interno', codigo)
          .maybeSingle(),
        'productos.buscarPorCodigo',
      );
    },
    async get(id) {
      return okMaybe<Producto>(
        await sb.from('productos').select('*').eq('id', id).maybeSingle(),
        'productos.get',
      );
    },
    async create(input) {
      return ok<Producto>(
        await sb.from('productos').insert(input).select('*').single(),
        'productos.create',
      );
    },
    async update(id, patch) {
      return ok<Producto>(
        await sb.from('productos').update(patch).eq('id', id).select('*').single(),
        'productos.update',
      );
    },
    async delete(id) {
      const { error } = await sb.from('productos').delete().eq('id', id);
      if (error) throw new Error(`productos.delete: ${error.message}`);
    },
    async aumentoMasivo(filtro, porcentaje, listaPrecioId) {
      // Estrategia:
      // - Si hay filtro (categoría / proveedor / texto), traemos los
      //   ids del filtro y los matcheamos del lado cliente. Evitamos
      //   `.in('producto_id', ids)` porque con muchos UUIDs supera el
      //   límite de URL de PostgREST y devuelve "Bad Request".
      // - Si NO hay filtro (aumento a TODOS los productos), saltamos
      //   ese paso: traemos directamente todos los precios de la lista.
      const filtroVacio =
        !filtro.categoria_id && !filtro.proveedor_id && !filtro.texto;

      // 1) Si hay filtro, traer los ids de productos que matchean
      //    (paginado para sortear el cap de 1000 filas).
      let idsFiltro: Set<string> | null = null;
      if (!filtroVacio) {
        idsFiltro = new Set<string>();
        const PAGE = 1000;
        let from = 0;
        while (true) {
          let q = sb
            .from('productos')
            .select('id')
            .range(from, from + PAGE - 1);
          q = aplicarFiltro(q, filtro);
          const chunk = okList<{ id: string }>(
            await q,
            'productos.aumentoMasivo (list)',
          );
          for (const p of chunk) idsFiltro.add(p.id);
          if (chunk.length < PAGE) break;
          from += PAGE;
        }
        if (idsFiltro.size === 0) return 0;
      }

      // 2) Traer TODOS los precios de la lista (paginado). Si hay
      //    filtro, descartamos in-memory los que no matchean.
      const PAGE = 1000;
      const precios: PrecioRow[] = [];
      let from = 0;
      while (true) {
        const chunk = okList<PrecioRow>(
          await sb
            .from('producto_lista_precio')
            .select('*')
            .eq('lista_precio_id', listaPrecioId)
            .range(from, from + PAGE - 1),
          'productos.aumentoMasivo (precios)',
        );
        for (const p of chunk) {
          if (!idsFiltro || idsFiltro.has(p.producto_id)) precios.push(p);
        }
        if (chunk.length < PAGE) break;
        from += PAGE;
      }

      // 3) Aplicar el aumento — uno por uno, secuencial. El trigger
      //    trg_precio_actualizado_en (migración 0009) refresca la
      //    fecha en DB cuando escalas cambia, así que no la tocamos.
      const factor = 1 + porcentaje / 100;
      let actualizados = 0;
      for (const p of precios) {
        const nuevasEscalas = p.escalas.map((e) => ({
          ...e,
          precio: Math.round(e.precio * factor),
        }));
        const { error } = await sb
          .from('producto_lista_precio')
          .update({ escalas: nuevasEscalas })
          .eq('producto_id', p.producto_id)
          .eq('lista_precio_id', listaPrecioId);
        if (error) throw new Error(`productos.aumentoMasivo (update): ${error.message}`);
        actualizados += 1;
      }
      return actualizados;
    },
    async setDescuentoMayoristaMasivo(filtro, pct) {
      // Reutiliza la misma estrategia de aumentoMasivo: si hay filtro, traer
      // ids que matchean paginado, después update in-memory. Si no hay filtro,
      // update directo sobre todos los productos activos.
      const filtroVacio =
        !filtro.categoria_id &&
        !filtro.proveedor_id &&
        !filtro.texto &&
        filtro.publicado_web === undefined &&
        filtro.activo === undefined;

      const value = pct == null ? null : Math.max(0, Math.min(100, pct));

      if (filtroVacio) {
        // Update masivo sin filtro — afecta a todos los productos.
        // Necesitamos un WHERE para que PostgREST acepte el update sin
        // requerir `?prefer=` especial. Usamos "activo IS NOT NULL" que
        // matchea todo.
        const { data, error } = await sb
          .from('productos')
          .update({ descuento_mayorista_pct_override: value })
          .not('id', 'is', null)
          .select('id');
        if (error) throw new Error(`productos.setDescuentoMayoristaMasivo: ${error.message}`);
        return (data ?? []).length;
      }

      // Con filtro: traer ids paginados.
      const idsFiltro = new Set<string>();
      const PAGE = 1000;
      let from = 0;
      while (true) {
        let q = sb.from('productos').select('id').range(from, from + PAGE - 1);
        q = aplicarFiltro(q, filtro);
        const chunk = okList<{ id: string }>(await q, 'productos.setDescuentoMayoristaMasivo (list)');
        for (const p of chunk) idsFiltro.add(p.id);
        if (chunk.length < PAGE) break;
        from += PAGE;
      }
      if (idsFiltro.size === 0) return 0;

      // Update por lotes de 200 ids (evita URL demasiado larga en el .in()).
      const ids = Array.from(idsFiltro);
      const CHUNK = 200;
      let actualizados = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await sb
          .from('productos')
          .update({ descuento_mayorista_pct_override: value })
          .in('id', slice)
          .select('id');
        if (error) throw new Error(`productos.setDescuentoMayoristaMasivo (update): ${error.message}`);
        actualizados += (data ?? []).length;
      }
      return actualizados;
    },
    async variantes(productoId) {
      return okList<Variante>(
        await sb.from('variantes').select('*').eq('producto_id', productoId),
        'productos.variantes',
      );
    },
    async crearVariante(productoId, atributos) {
      return ok<Variante>(
        await sb
          .from('variantes')
          .insert({ producto_id: productoId, atributos })
          .select('*')
          .single(),
        'productos.crearVariante',
      );
    },
    async eliminarVariante(varianteId) {
      const { error } = await sb.from('variantes').delete().eq('id', varianteId);
      if (error) throw new Error(`productos.eliminarVariante: ${error.message}`);
    },
    async imagenes(productoId) {
      return okList<ProductoImagen>(
        await sb
          .from('producto_imagenes')
          .select('*')
          .eq('producto_id', productoId)
          .order('orden'),
        'productos.imagenes',
      );
    },
    async imagenesDeMuchos(productoIds) {
      if (productoIds.length === 0) return [];
      // PostgREST tiene un límite práctico en el largo del IN. Loteamos
      // por 200 ids para evitar 414/431.
      const acumulado: ProductoImagen[] = [];
      const CHUNK = 200;
      for (let i = 0; i < productoIds.length; i += CHUNK) {
        const slice = productoIds.slice(i, i + CHUNK);
        const rows = okList<ProductoImagen>(
          await sb
            .from('producto_imagenes')
            .select('*')
            .in('producto_id', slice)
            .order('orden'),
          'productos.imagenesDeMuchos',
        );
        acumulado.push(...rows);
      }
      return acumulado;
    },
    async agregarImagen(productoId, url) {
      const { data: count } = await sb
        .from('producto_imagenes')
        .select('orden', { count: 'exact', head: true })
        .eq('producto_id', productoId);
      const orden = (count as unknown as number) ?? 0;
      return ok<ProductoImagen>(
        await sb
          .from('producto_imagenes')
          .insert({ producto_id: productoId, url, orden })
          .select('*')
          .single(),
        'productos.agregarImagen',
      );
    },
    async eliminarImagen(imagenId) {
      const { error } = await sb.from('producto_imagenes').delete().eq('id', imagenId);
      if (error) throw new Error(`productos.eliminarImagen: ${error.message}`);
    },
    async reordenarImagenes(productoId, idsEnOrden) {
      for (let i = 0; i < idsEnOrden.length; i++) {
        const id = idsEnOrden[i]!;
        const { error } = await sb
          .from('producto_imagenes')
          .update({ orden: i })
          .eq('id', id)
          .eq('producto_id', productoId);
        if (error) throw new Error(`productos.reordenarImagenes: ${error.message}`);
      }
    },
    async preciosDe(productoId) {
      const rows = okList<PrecioRow>(
        await sb
          .from('producto_lista_precio')
          .select('*')
          .eq('producto_id', productoId),
        'productos.preciosDe',
      );
      // El tipo ProductoListaPrecio coincide 1:1
      return rows as ProductoListaPrecio[];
    },
    async preciosDeLista(listaPrecioId) {
      // Paginamos para sortear el límite de 1000 del REST (puede haber
      // ~2000 productos con precio en una lista grande).
      const CHUNK = 1000;
      const acumulado: ProductoListaPrecio[] = [];
      let from = 0;
      while (true) {
        const rows = okList<PrecioRow>(
          await sb
            .from('producto_lista_precio')
            .select('*')
            .eq('lista_precio_id', listaPrecioId)
            .range(from, from + CHUNK - 1),
          'productos.preciosDeLista',
        );
        acumulado.push(...(rows as ProductoListaPrecio[]));
        if (rows.length < CHUNK) break;
        from += CHUNK;
      }
      return acumulado;
    },
    async setPrecio(productoId, listaPrecioId, escalas) {
      const ordenadas = [...escalas].sort((a, b) => a.desde - b.desde);
      const { error } = await sb
        .from('producto_lista_precio')
        .upsert({
          producto_id: productoId,
          lista_precio_id: listaPrecioId,
          escalas: ordenadas,
        });
      if (error) throw new Error(`productos.setPrecio: ${error.message}`);
    },
  };
}
