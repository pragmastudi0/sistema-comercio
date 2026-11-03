'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Package } from 'lucide-react';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { calcularPrecioMayorista } from '@comercio/business';
import { Card, CardContent } from '@comercio/ui/card';
import { Input } from '@comercio/ui/input';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';
import { emojiProducto, visualDeCategoria } from '@/lib/imagenes';
import { ProcesoCompra } from '@/components/proceso-compra';

function CatalogoInner() {
  const db = getDb();
  const router = useRouter();
  const params = useSearchParams();
  const catParam = params.get('cat') ?? '';
  const [texto, setTexto] = useState('');

  const categoriasQ = useQuery({
    queryKey: ['categorias'],
    queryFn: () => db.categorias.list(),
  });
  // TODOS los productos publicados (sin filtro de texto/cat). Sirve para
  // saber qué categorías tienen al menos un producto cargado para no
  // mostrar categorías vacías en el selector.
  const todosPublicadosQ = useQuery({
    queryKey: ['catalogo-todos-publicados'],
    queryFn: () => db.productos.list({ publicado_web: true, activo: true }),
    staleTime: 5 * 60_000,
  });
  const productosQ = useQuery({
    queryKey: ['productos-web-cat', catParam, texto],
    queryFn: () =>
      db.productos.list({
        publicado_web: true,
        activo: true,
        categoria_id: catParam || undefined,
        texto: texto || undefined,
      }),
  });
  // Precio Consumidor Final por producto — es la referencia sobre la que
  // se calcula el precio mayorista (aplicando el descuento configurado).
  //
  // Usamos Promise.allSettled porque `lista_precio_id` es de tipo uuid en
  // Postgres, y el id legacy 'lp_cf' del mock rompe el WHERE con error
  // "invalid input syntax for type uuid". Con Promise.all común, una
  // query rota tiraba abajo también los precios válidos del UUID canónico.
  const preciosQ = useQuery({
    queryKey: ['precios-cf-web-catalogo'],
    queryFn: async () => {
      const CF_IDS = [PRESET_IDS.listas.consumidorFinal, 'lp_cf'];
      const resultados = await Promise.allSettled(
        CF_IDS.map((id) => db.productos.preciosDeLista(id)),
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
  // Configuración mayorista global (descuento + escalas por cantidad).
  const configQ = useQuery({
    queryKey: ['config-mayorista'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
    staleTime: 5 * 60_000,
  });
  // Imágenes principales (orden 0) de todos los productos visibles, en UN
  // solo query batch.
  const imagenesPrincipalesQ = useQuery({
    queryKey: ['imgs-catalogo', productosQ.data?.map((p) => p.id).join(',')],
    queryFn: async () => {
      const ids = (productosQ.data ?? []).map((p) => p.id);
      const todas = await db.productos.imagenesDeMuchos(ids);
      // Quedarme con la primera imagen (orden mínimo) de cada producto.
      const map = new Map<string, string>();
      for (const img of todas) {
        const actual = map.get(img.producto_id);
        if (!actual) map.set(img.producto_id, img.url);
        // Como vienen ordenadas por `orden`, la primera que entra es la principal.
      }
      return map;
    },
    enabled: (productosQ.data?.length ?? 0) > 0,
  });

  const categorias = categoriasQ.data ?? [];
  const productos = productosQ.data ?? [];

  // Solo categorías que tienen al menos un producto publicado, con su
  // conteo. Las que no tienen productos cargados no aparecen en el selector.
  const categoriasConProductos = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const p of todosPublicadosQ.data ?? []) {
      // Los productos sin categoría (categoria_id null) no cuentan para
      // el selector de categorías del catálogo.
      if (!p.categoria_id) continue;
      conteo.set(p.categoria_id, (conteo.get(p.categoria_id) ?? 0) + 1);
    }
    return categorias
      .filter((c) => (conteo.get(c.id) ?? 0) > 0)
      .map((c) => ({ ...c, cantidad: conteo.get(c.id) ?? 0 }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [categorias, todosPublicadosQ.data]);

  const totalProductos = todosPublicadosQ.data?.length ?? 0;

  function cambiarCategoria(catId: string) {
    const url = catId ? `/catalogo?cat=${catId}` : '/catalogo';
    router.push(url);
  }

  const descuentoGlobalPct = configQ.data?.descuento_mayorista_pct ?? 0;
  const escalasMayoristas = configQ.data?.escalas_mayorista_cantidad ?? [];

  function precioUnitario(producto: {
    id: string;
    descuento_mayorista_pct_override?: number | null;
  }): { precio: number; pctAplicado: number; precioCF: number } {
    const cf = preciosQ.data?.get(producto.id) ?? 0;
    const r = calcularPrecioMayorista({
      precioCF: cf,
      descuentoOverridePct: producto.descuento_mayorista_pct_override,
      descuentoGlobalPct,
      cantidad: 1,
      redondeo: 'cent',
    });
    return { precio: r.precio, pctAplicado: r.pctAplicado, precioCF: cf };
  }
  function categoriaNombre(id: string | null | undefined) {
    if (!id) return '';
    return categorias.find((c) => c.id === id)?.nombre ?? '';
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Catálogo</h1>
        <p className="text-sm text-muted-foreground">
          Precios mayoristas. Para hacer el pedido armá el carrito y enviá por WhatsApp.
        </p>
      </div>

      <div className="mb-6">
        <ProcesoCompra />
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código o nombre"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="h-11 pl-10 text-base"
          />
        </div>
      </div>

      {/* Selector de categorías como chips horizontales scrollables.
          Más visual y fácil de usar en mobile que un select. Solo
          muestra categorías que tienen al menos 1 producto cargado. */}
      <div className="-mx-4 mb-6 overflow-x-auto px-4">
        <div className="flex w-max gap-2 pb-1">
          <button
            type="button"
            onClick={() => cambiarCategoria('')}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
              catParam === ''
                ? 'border-foreground bg-foreground text-background'
                : 'border-input bg-background hover:border-foreground/40'
            }`}
          >
            Todos
            {totalProductos > 0 && (
              <span className="text-xs opacity-75">({totalProductos})</span>
            )}
          </button>
          {categoriasConProductos.map((c) => {
            const activa = catParam === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => cambiarCategoria(c.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                  activa
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background hover:border-foreground/40'
                }`}
              >
                {c.nombre}
                <span className="text-xs opacity-75">({c.cantidad})</span>
              </button>
            );
          })}
        </div>
      </div>

      {productosQ.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : productos.length === 0 ? (
        <div className="rounded-md border bg-muted/30 py-16 text-center text-muted-foreground">
          <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No encontramos productos con esos filtros.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {productos.map((p) => {
            const precioInfo = precioUnitario(p);
            const primeraEscala = [...escalasMayoristas]
              .sort((a, b) => a.desde - b.desde)
              .find((e) => e.pct > precioInfo.pctAplicado);
            const precioConEscala = primeraEscala
              ? calcularPrecioMayorista({
                  precioCF: precioInfo.precioCF,
                  descuentoOverridePct: p.descuento_mayorista_pct_override,
                  descuentoGlobalPct,
                  escalas: escalasMayoristas,
                  cantidad: primeraEscala.desde,
                  redondeo: 'cent',
                }).precio
              : null;
            const imgUrl = imagenesPrincipalesQ.data?.get(p.id);
            const nombreMostrado = p.nombre_web?.trim() || p.nombre;
            return (
              <Link key={p.id} href={`/catalogo/${p.id}`}>
                <Card className="h-full overflow-hidden transition hover:border-foreground">
                  {imgUrl ? (
                    <div className="aspect-square overflow-hidden bg-muted/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl}
                        alt={nombreMostrado}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                      />
                    </div>
                  ) : (
                    // Fallback: placeholder visual con emoji representativo
                    <div
                      className={`flex aspect-square items-center justify-center text-6xl ${visualDeCategoria(p.categoria_id).bg}`}
                    >
                      <span aria-hidden>{emojiProducto(nombreMostrado, p.categoria_id)}</span>
                    </div>
                  )}
                  <CardContent className="space-y-1 p-4">
                    <Badge variant="secondary" className="mb-1">
                      {categoriaNombre(p.categoria_id)}
                    </Badge>
                    <h3 className="line-clamp-2 font-medium leading-tight">{nombreMostrado}</h3>
                    <div className="font-mono text-xs text-muted-foreground">
                      Cód {p.codigo_interno}
                    </div>
                    <div className="pt-1">
                      <div className="text-lg font-semibold tabular-nums">
                        {formatCurrency(precioInfo.precio)}
                      </div>
                      {precioConEscala != null && primeraEscala && (
                        <div className="text-xs text-muted-foreground">
                          desde {primeraEscala.desde}u:{' '}
                          {formatCurrency(precioConEscala)} c/u
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CatalogoPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-8">
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <CatalogoInner />
    </Suspense>
  );
}
