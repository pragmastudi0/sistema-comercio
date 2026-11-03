import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { useVenta } from '@/stores/venta';
import { useDepositoActivo } from '@/lib/deposito-activo';
import { Input } from '@comercio/ui/input';
import { formatCurrency } from '@comercio/ui/utils';

// Acepta tanto el UUID real de Supabase como el ID legacy del mock 'lp_cf'.
const LISTA_CF_IDS = [PRESET_IDS.listas.consumidorFinal, 'lp_cf'];

type StockPorDeposito = {
  local: number;
  /** Stock en depósitos distintos al del cajero (suma) */
  otros: number;
  /** Nombres de los depósitos donde hay (para mostrar al cajero) */
  otrosNombres: string[];
};

export type BuscadorProductoHandle = {
  focus: () => void;
};

export function BuscadorProducto() {
  const db = getDb();
  const { depositoId } = useDepositoActivo();

  const [q, setQ] = useState('');
  const [mostrarLista, setMostrarLista] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const agregar = useVenta((s) => s.agregar);
  const quitar = useVenta((s) => s.quitar);
  const itemsEnCarrito = useVenta((s) => s.items);
  const seleccionadoId = useVenta((s) => s.seleccionadoId);
  const moverSeleccion = useVenta((s) => s.moverSeleccion);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // "Foco siempre listo": el cajero no debería tener que tocar el mouse.
  // Dos mecanismos complementarios:
  //
  //  1) Tecla printable apretada fuera de cualquier input → redirigimos
  //     el caracter al buscador. Patrón típico de PoS: tipeás un código
  //     desde cualquier lugar y aparece en el buscador.
  //  2) Si el body queda con foco (click en zona vacía), re-enfocamos
  //     el buscador. No reenfocamos si el foco fue a otro input legítimo
  //     (precio/cantidad del carrito, dialog, etc).
  //
  // Ambos están limitados a "estamos en la pantalla principal de Caja":
  // detectamos eso chequeando que el body no tenga modales/dialogs abiertos
  // (los Radix-style ponen role=dialog en el árbol del body).
  useEffect(() => {
    function hayModalAbierto(): boolean {
      return !!document.querySelector('[role="dialog"], [data-state="open"][role="menu"]');
    }
    function esTagInteractivo(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        (el as HTMLElement).isContentEditable === true
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return; // solo printable
      if (esTagInteractivo(e.target as Element)) return;
      if (hayModalAbierto()) return;
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      e.preventDefault();
      input.focus();
      // Agregar el caracter manualmente — el evento original ya pasó por
      // body, no llegaría al input por sí solo.
      const nuevo = (input.value ?? '') + e.key;
      setQ(nuevo);
      setMostrarLista(true);
      setResaltadoIdx(0);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const resultadosQ = useQuery({
    queryKey: ['pos-buscar', q],
    // 200 resultados: subimos del default 8 para que búsquedas genéricas
    // ("caja", "agenda", "llavero") traigan TODOS los matches del
    // catálogo — con ~1900 productos, palabras comunes pueden pegar en
    // 50-100 items. El dropdown scrollea (max-h-80) así que 200 no
    // rompe la UI, y en la práctica el cajero refina tipeando más
    // caracteres antes de tener que scrollear mucho.
    queryFn: () => db.productos.buscarRapido(q, 200),
    enabled: q.trim().length > 0,
  });

  // Diccionario de depósitos para mostrar nombres legibles cuando hay
  // stock en uno distinto al del cajero.
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
    staleTime: 5 * 60_000,
  });

  // Precios de la lista Consumidor Final, para el dropdown Y para el
  // agregar al carrito. Cachear ambos consumos en la MISMA query
  // garantiza que dropdown y carrito muestren el mismo precio (bug
  // real: antes el dropdown leía cache viejo y el agregar hacía una
  // llamada fresca a `preciosDe()`, entonces si Agus cambiaba un precio
  // en admin el cajero veía dos números distintos).
  //
  // staleTime: 30s → los cambios de precio del admin se propagan al PoS
  // en máximo 30 segundos. Antes eran 5 min, un cajero atento veía el
  // precio viejo hasta que expirara el cache.
  const preciosQ = useQuery({
    queryKey: ['pos-precios-cf'],
    queryFn: () => db.productos.preciosDeLista(PRESET_IDS.listas.consumidorFinal),
    staleTime: 30_000,
  });
  // Map producto_id → escalas ORDENADAS por `desde` ASC. Cambio del
  // antiguo Map<string, number>: ahora tenemos las escalas completas
  // para poder pasárselas al carrito (recalcula precio al cambiar
  // cantidad si hay mayorista).
  const escalasPorProducto = (() => {
    const m = new Map<string, { desde: number; precio: number }[]>();
    for (const r of preciosQ.data ?? []) {
      const ord = [...r.escalas].sort((a, b) => a.desde - b.desde);
      if (ord.length > 0) m.set(r.producto_id, ord);
    }
    return m;
  })();

  // Item resaltado en el dropdown (para navegar con flechas).
  const [resaltadoIdx, setResaltadoIdx] = useState(0);

  // Estado de "confirmar borrado" — cuando el cajero aprieta Supr con
  // el buscador vacío, en vez de borrar el producto directamente
  // guardamos acá el objetivo y mostramos un banner: "Enter para
  // borrar, Esc para cancelar". Antes borraba directo y los cajeros
  // se comían productos sin querer al tipear Backspace de más.
  const [confirmarBorrar, setConfirmarBorrar] = useState<{
    id: string;
    nombre: string;
  } | null>(null);


  // Stocks de los productos visibles en los resultados (con breakdown
  // local vs otros depósitos). Antes solo traíamos el del local, lo que
  // hacía que productos disponibles en B12 desde la caja C11 figuraran
  // como "sin stock" cuando en realidad estaban en otro depósito.
  const idsVisibles = (resultadosQ.data ?? []).map((p) => p.id).join(',');
  const stocksQ = useQuery({
    queryKey: ['pos-stocks-buscar', idsVisibles, depositoId],
    queryFn: async () => {
      const map = new Map<string, StockPorDeposito>();
      const nombrePorDep = new Map<string, string>(
        (depositosQ.data ?? []).map((d) => [d.id, d.nombre]),
      );
      for (const p of resultadosQ.data ?? []) {
        const items = await db.stock.porProducto(p.id);
        let local = 0;
        let otros = 0;
        const otrosNombres: string[] = [];
        for (const it of items) {
          const cant = Number(it.cantidad);
          if (it.deposito_id === depositoId) {
            local += cant;
          } else if (cant > 0) {
            otros += cant;
            // Sacamos prefijo "#Turisteando" y deduplicamos. Si no
            // pudimos resolver el nombre, omitimos (no agregamos
            // "otro depósito" para no ensuciar el mensaje).
            const raw = nombrePorDep.get(it.deposito_id);
            if (!raw) continue;
            const n = raw.replace(/^#?\s*turisteando\s*/i, '').trim() || raw;
            if (!otrosNombres.includes(n)) otrosNombres.push(n);
          }
        }
        map.set(p.id, { local, otros, otrosNombres });
      }
      return map;
    },
    enabled: (resultadosQ.data?.length ?? 0) > 0 && !!depositosQ.data,
  });

  function stockDeProducto(id: string): StockPorDeposito {
    return stocksQ.data?.get(id) ?? { local: 0, otros: 0, otrosNombres: [] };
  }
  function yaEnCarrito(id: string): number {
    return itemsEnCarrito.find((it) => it.producto.id === id)?.cantidad ?? 0;
  }

  /**
   * Decide si se puede agregar el producto al carrito y cómo.
   * Devuelve { ok, crossDeposito, nombresOtros } o lanza toast de error si no se puede.
   */
  async function evaluarStock(p: { id: string; nombre: string }): Promise<
    | { ok: true; crossDeposito: boolean; nombresOtros: string[] }
    | { ok: false }
  > {
    const items = await db.stock.porProducto(p.id);
    let local = 0;
    const otrosPorDep = new Map<string, number>();
    for (const it of items) {
      const cant = Number(it.cantidad);
      if (it.deposito_id === depositoId) local += cant;
      else if (cant > 0) otrosPorDep.set(it.deposito_id, cant);
    }
    const cantEnCarrito = yaEnCarrito(p.id);
    // Política Turisteando: permitir vender SIEMPRE, aunque el stock
    // quede negativo. Si tu depósito tiene cualquier valor (incluso 0
    // o negativo), vendés desde acá. Solo sugerimos cross-depósito
    // como warning cuando hay stock positivo en otro lado.
    if (local > 0 && local - cantEnCarrito > 0) {
      return { ok: true, crossDeposito: false, nombresOtros: [] };
    }
    if (local <= 0 && otrosPorDep.size === 0) {
      // Vendemos igual (queda negativo). Aviso pero no bloqueo.
      return { ok: true, crossDeposito: false, nombresOtros: [] };
    }
    // Si depositosQ todavía no cargó (race contra el primer click después
    // de abrir la pantalla), forzamos el fetch acá. Sin esto los nombres
    // caen al fallback y el toast queda con "otro depósito o otro depósito".
    const depositos =
      depositosQ.data ?? (await db.depositos.list().catch(() => []));
    const nombrePorDep = new Map(depositos.map((d) => [d.id, d.nombre]));
    // Resolvemos nombres reales (B12/C11/Central, sin "#Turisteando"),
    // deduplicando y descartando los que no pudimos resolver.
    const nombresOtros: string[] = [];
    for (const id of otrosPorDep.keys()) {
      const raw = nombrePorDep.get(id);
      if (!raw) continue;
      const n = raw.replace(/^#?\s*turisteando\s*/i, '').trim() || raw;
      if (!nombresOtros.includes(n)) nombresOtros.push(n);
    }
    return { ok: true, crossDeposito: true, nombresOtros };
  }

  async function agregarPorCodigoExacto() {
    const codigo = q.trim();
    if (!codigo) return;
    const p = await db.productos.buscarPorCodigo(codigo);
    if (!p) {
      toast.error(`Producto con código ${codigo} no encontrado`);
      return;
    }
    const eval_ = await evaluarStock(p);
    if (!eval_.ok) return;
    // Preferimos el cache (mismos datos que ve el dropdown) para que el
    // precio agregado sea EXACTAMENTE el mostrado. Si no está en cache
    // (producto nuevo cargado hace muy poco), fallback a llamada directa.
    let escalas = escalasPorProducto.get(p.id);
    if (!escalas) {
      const precios = await db.productos.preciosDe(p.id);
      const cf = precios.find((x) => LISTA_CF_IDS.includes(x.lista_precio_id));
      escalas = [...(cf?.escalas ?? [])].sort((a, b) => a.desde - b.desde);
    }
    const precio = escalas[0]?.precio ?? 0;
    agregar(p, precio, escalas);
    // NO borramos el código: dejamos el texto seleccionado para que el
    // siguiente Enter sume otra unidad del mismo producto, o que al tipear
    // se reemplace automáticamente con el código nuevo.
    setMostrarLista(false);
    setTimeout(() => inputRef.current?.select(), 0);
    if (eval_.crossDeposito) {
      const lugares = eval_.nombresOtros.length > 0
        ? `pedilo a ${eval_.nombresOtros.join(' o ')}`
        : 'pedilo al otro local';
      toast.warning(
        `+ ${p.nombre} · ${lugares}, no hay en tu caja`,
        { duration: 5000 },
      );
    } else {
      toast.success(`+ ${p.nombre}`);
    }
  }

  async function agregarProducto(productoId: string) {
    const p = (resultadosQ.data ?? []).find((x) => x.id === productoId);
    if (!p) return;
    const eval_ = await evaluarStock(p);
    if (!eval_.ok) return;
    // Ver comentario en agregarPorCodigoExacto: cache primero, fallback
    // a llamada directa. Garantiza que dropdown y carrito muestran el
    // MISMO precio siempre.
    let escalas = escalasPorProducto.get(p.id);
    if (!escalas) {
      const precios = await db.productos.preciosDe(p.id);
      const cf = precios.find((x) => LISTA_CF_IDS.includes(x.lista_precio_id));
      escalas = [...(cf?.escalas ?? [])].sort((a, b) => a.desde - b.desde);
    }
    const precio = escalas[0]?.precio ?? 0;
    agregar(p, precio, escalas);
    // Igual que agregarPorCodigoExacto: mantenemos el texto seleccionado
    // para sumar más unidades con Enter o reemplazar tipeando.
    setMostrarLista(false);
    setTimeout(() => inputRef.current?.select(), 0);
    if (eval_.crossDeposito) {
      const lugares = eval_.nombresOtros.length > 0
        ? `pedilo a ${eval_.nombresOtros.join(' o ')}`
        : 'pedilo al otro local';
      toast.warning(
        `+ ${p.nombre} · ${lugares}, no hay en tu caja`,
        { duration: 5000 },
      );
    } else {
      toast.success(`+ ${p.nombre}`);
    }
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={q}
        autoFocus
        onBlur={() => {
          // Si el foco se va al body (click en zona vacía / detrás del
          // carrito), recuperamos. Si va a OTRO input legítimo (precio,
          // cantidad, dialog), respetamos el destino.
          setTimeout(() => {
            const active = document.activeElement;
            const hayModal = !!document.querySelector('[role="dialog"]');
            if (hayModal) return;
            if (!active || active === document.body) {
              inputRef.current?.focus();
            }
          }, 0);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setMostrarLista(true);
          setResaltadoIdx(0); // resetear al cambiar la búsqueda
          // Si el cajero empieza a tipear (o borrar texto), cancela
          // cualquier confirmación de borrado pendiente.
          if (confirmarBorrar) setConfirmarBorrar(null);
        }}
        onKeyDown={(e) => {
          const lista = resultadosQ.data ?? [];
          // Si hay una confirmación de borrado pendiente, Enter y Esc
          // tienen precedencia sobre el resto.
          if (confirmarBorrar) {
            if (e.key === 'Enter') {
              e.preventDefault();
              quitar(confirmarBorrar.id);
              toast.info(`− ${confirmarBorrar.nombre}`);
              setConfirmarBorrar(null);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setConfirmarBorrar(null);
              return;
            }
            // Cualquier otra tecla cancela y sigue el flujo normal.
            setConfirmarBorrar(null);
          }
          if (e.key === 'Enter') {
            // Caso 1: hay resultados → agregar el resaltado.
            //   Si el código ya está en el carrito, el store suma cantidad.
            //   El texto del input NO se borra: un segundo Enter sigue
            //   sumando, o se reemplaza al empezar a tipear.
            // Caso 2: hay query pero sin resultados → intentar código exacto.
            // Buscador vacío + Enter: no hace nada (para cobrar se usa "+").
            if (lista.length > 0) {
              const target = lista[Math.min(resaltadoIdx, lista.length - 1)];
              if (target) agregarProducto(target.id);
            } else if (q.trim() !== '') {
              void agregarPorCodigoExacto();
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (lista.length > 0) {
              setResaltadoIdx((i) => Math.min(i + 1, lista.length - 1));
            } else if (q === '') {
              // Buscador vacío y sin dropdown → ↓ navega items del carrito.
              moverSeleccion(1);
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (lista.length > 0) {
              setResaltadoIdx((i) => Math.max(0, i - 1));
            } else if (q === '') {
              moverSeleccion(-1);
            }
          } else if (e.key === 'Escape') {
            setQ('');
            setMostrarLista(false);
            setResaltadoIdx(0);
          } else if (e.key === 'Delete' && q === '') {
            // Solo Supr (Delete) inicia la confirmación de borrado. NO
            // usamos Backspace porque los cajeros tipean y borran texto
            // muy seguido: con q === '' y otro Backspace de más se
            // comían un producto sin querer. Supr es una tecla explícita
            // y menos usada, y además pide confirmación abajo.
            const objetivo =
              itemsEnCarrito.find((i) => i.producto.id === seleccionadoId) ??
              itemsEnCarrito[itemsEnCarrito.length - 1];
            if (objetivo) {
              e.preventDefault();
              setConfirmarBorrar({
                id: objetivo.producto.id,
                nombre: objetivo.producto.nombre,
              });
            }
          }
        }}
        placeholder="Código (ej: 1003) o nombre — Enter agrega · ↑↓ navega · Supr borra"
        className="h-14 text-lg"
      />
      {/* Banner de confirmación de borrado. Aparece cuando el cajero
          apretó Supr con el buscador vacío. */}
      {confirmarBorrar && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 flex items-center justify-between gap-2 rounded-md border-2 border-orange-400 bg-orange-50 px-3 py-2 shadow-lg">
          <div className="text-sm text-orange-900">
            ¿Quitar <span className="font-semibold">{confirmarBorrar.nombre}</span> del carrito?
            <span className="ml-2 text-xs text-orange-700">
              Enter = borrar · Esc = cancelar
            </span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setConfirmarBorrar(null)}
              className="rounded border border-orange-300 bg-white px-2 py-1 text-xs font-medium hover:bg-orange-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                quitar(confirmarBorrar.id);
                toast.info(`− ${confirmarBorrar.nombre}`);
                setConfirmarBorrar(null);
                inputRef.current?.focus();
              }}
              className="rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700"
            >
              Borrar
            </button>
          </div>
        </div>
      )}
      {mostrarLista && q.trim().length > 0 && (resultadosQ.data?.length ?? 0) > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {resultadosQ.data!.map((p, idx) => {
            const precio = escalasPorProducto.get(p.id)?.[0]?.precio;
            const resaltado = idx === resaltadoIdx;
            return (
              <button
                key={p.id}
                onClick={() => agregarProducto(p.id)}
                onMouseEnter={() => setResaltadoIdx(idx)}
                // Resaltado contrastado: azul fuerte con borde a la izquierda
                // para que el cajero vea de un vistazo en qué fila está parado
                // (antes era bg-accent — demasiado leve, se perdía la visual
                // al navegar con ↑↓ o mover el mouse).
                className={`flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors last:border-0 ${
                  resaltado
                    ? 'border-l-4 border-l-blue-600 bg-blue-100 pl-3 font-medium text-blue-900'
                    : 'hover:bg-blue-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-muted-foreground">
                    {p.codigo_interno}
                  </div>
                  <div className="truncate font-medium">{p.nombre}</div>
                </div>
                <div className="ml-3 flex flex-col items-end gap-0.5 text-xs">
                  {precio !== undefined ? (
                    <span className="text-lg font-bold tabular-nums text-foreground">
                      {formatCurrency(precio)}
                    </span>
                  ) : preciosQ.isLoading ? (
                    <span className="text-muted-foreground">…</span>
                  ) : (
                    <span className="text-orange-700">Sin precio</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {mostrarLista && q.trim().length > 0 && resultadosQ.data?.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-lg">
          Sin resultados
        </div>
      )}
    </div>
  );
}
