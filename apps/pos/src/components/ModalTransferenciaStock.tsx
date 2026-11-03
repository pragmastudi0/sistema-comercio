import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, ArrowLeftRight, Search, Trash2 } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Button } from '@comercio/ui/button';
import { Skeleton } from '@comercio/ui/skeleton';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { useDepositoActivo } from '@/lib/deposito-activo';
import { formatCurrency } from '@comercio/ui/utils';
import { PRESET_IDS, type Deposito, type Producto } from '@comercio/db';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

/**
 * Modal "Stock" del PoS — asienta una transferencia entre depósitos/locales.
 * El movimiento es INMEDIATO (decrementa origen + incrementa destino + crea
 * los 2 movimientos en historial). Sin flujo de aprobación: refleja lo que
 * el cajero/encargado ya hizo físicamente.
 *
 * Patrón de uso:
 *   1. Tipear código o nombre → seleccionar producto
 *   2. Elegir origen (default: depósito activo del cajero)
 *   3. Elegir destino (otro depósito)
 *   4. Cantidad → Confirmar
 */
export function ModalTransferenciaStock({ open, onOpenChange }: Props) {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  const { depositoId: depositoActivo } = useDepositoActivo();

  // Pestañas: asentar nuevo movimiento vs ver/anular recientes.
  const [tab, setTab] = useState<'asentar' | 'movimientos'>('asentar');

  // Multi-item: los cajeros / dueño arman una lista de productos
  // (con cantidad) y transfieren todos de un tirón con un mismo par
  // origen → destino. Reemplaza el flujo "un producto por vez" anterior
  // que obligaba a repetir el modal N veces al mover una bolsa
  // completa entre locales.
  type ItemTransferencia = {
    producto: Producto;
    cantidad: number;
  };
  const [items, setItems] = useState<ItemTransferencia[]>([]);

  // Búsqueda (input siempre visible; al elegir un producto lo agrega
  // a `items` y limpia el input para el próximo).
  const [q, setQ] = useState('');
  const [resaltadoIdx, setResaltadoIdx] = useState(0);
  const codigoRef = useRef<HTMLInputElement>(null);

  // Origen y destino comunes a toda la transferencia.
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');

  // OJO: sacamos `enabled: open`. Reporte del cliente (2026-07-15) —
  // los selectors "Desde/Hacia" aparecían vacíos aunque los depósitos
  // existían en la BD. Hipótesis: el modal se desmontaba/montaba
  // rápido (cerrar+abrir) y la query quedaba en un estado sin data.
  // Ahora corre siempre, cachea entre aperturas, y si falla reintenta
  // hasta 3 veces con backoff. Bonus: al ser cache warm, el modal se
  // abre con las opciones ya listas.
  // Fallback persistente: la última lista conocida de depósitos vive en
  // localStorage. Se usa cuando la query devuelve vacío (RLS silencioso,
  // sesión no lista, etc). Depósitos casi nunca cambian → un cache viejo
  // es preferible a "No hay depósitos disponibles".
  const CACHE_KEY = 'pos-depositos-cache-v1';
  const cacheInicial = useMemo<Deposito[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as Deposito[]) : [];
    } catch {
      return [];
    }
  }, []);

  const depositosQ = useQuery({
    queryKey: ['depositos-transferencia'],
    queryFn: async () => {
      const r = await db.depositos.list();
      // eslint-disable-next-line no-console
      console.log('[Transferencia] depósitos cargados:', r.length);
      // Tratar "array vacío" como error para que React Query dispare
      // el retry: 3 con backoff. Sin esto, una respuesta vacía por RLS
      // silencioso o sesión no lista dejaba los selects vacíos hasta
      // que el usuario hacía click en "Reintentar" manualmente.
      if (r.length === 0) {
        throw new Error('Depósitos: respuesta vacía (posible RLS / sesión no lista)');
      }
      // Persistir para usar como fallback en la próxima apertura si el
      // servidor devuelve vacío antes de que retry se dé cuenta.
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(r));
      } catch {
        // localStorage lleno / disabled — no crítico
      }
      return r;
    },
    // Placeholder desde localStorage: si tenemos algo cacheado, los
    // selects arrancan poblados aunque la primera request tarde/falle.
    placeholderData: cacheInicial.length > 0 ? cacheInicial : undefined,
    staleTime: 5 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    // Refetchear cuando el usuario vuelve a la pestaña (cajero deja el
    // PoS en background, vuelve, la data queda fresca sin abrir/cerrar).
    refetchOnWindowFocus: true,
  });

  const resultadosQ = useQuery({
    queryKey: ['pos-buscar-transferencia', q],
    queryFn: () => db.productos.buscarRapido(q, 200),
    enabled: open && q.trim().length > 0,
  });
  // Precios CF de todos los productos, para mostrar al lado del nombre
  // en el buscador y en la lista de items a transferir. Ayuda al cajero
  // a verificar rápido el precio antes de mover mercadería entre locales
  // (ej: "no muevo estos, son los caros que no salen"). Reusa el mismo
  // cache que el BuscadorProducto principal (mismo queryKey).
  const preciosQ = useQuery({
    queryKey: ['pos-precios-cf'],
    queryFn: () => db.productos.preciosDeLista(PRESET_IDS.listas.consumidorFinal),
    staleTime: 30_000,
    enabled: open,
  });
  const precioPorProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const lp of preciosQ.data ?? []) {
      const escs = [...(lp.escalas ?? [])].sort((a, b) => a.desde - b.desde);
      m.set(lp.producto_id, escs[0]?.precio ?? 0);
    }
    return m;
  }, [preciosQ.data]);

  // Stocks de los productos ya agregados en el ORIGEN — para mostrar
  // cuánto hay disponible al lado de cada línea y avisar si algún item
  // dejaría el origen en negativo (no bloqueamos: política Turisteando
  // permite negativos y la operación física ya sucedió).
  const idsItems = items.map((it) => it.producto.id).join(',');
  const stocksOrigenQ = useQuery({
    queryKey: ['stocks-origen-transferencia', idsItems, origenId],
    queryFn: async () => {
      const map = new Map<string, number>();
      if (!origenId) return map;
      for (const it of items) {
        const filas = await db.stock.porProducto(it.producto.id);
        const s = filas
          .filter((s) => s.deposito_id === origenId)
          .reduce((a, s) => a + Number(s.cantidad), 0);
        map.set(it.producto.id, s);
      }
      return map;
    },
    enabled: open && items.length > 0 && !!origenId,
  });

  // Reset cuando se abre/cierra
  useEffect(() => {
    if (open) {
      setTab('asentar');
      setQ('');
      setItems([]);
      setResaltadoIdx(0);
      setOrigenId(depositoActivo ?? '');
      setDestinoId('');
      setTimeout(() => codigoRef.current?.focus(), 50);
    }
  }, [open, depositoActivo]);

  function agregarItem(p: Producto) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.producto.id === p.id);
      if (idx >= 0) {
        // Si ya está, incrementa cantidad en vez de duplicar la línea.
        return prev.map((it, i) =>
          i === idx ? { ...it, cantidad: it.cantidad + 1 } : it,
        );
      }
      return [...prev, { producto: p, cantidad: 1 }];
    });
    setQ('');
    setResaltadoIdx(0);
    codigoRef.current?.focus();
  }
  function quitarItem(productoId: string) {
    setItems((prev) => prev.filter((it) => it.producto.id !== productoId));
  }
  function setCantidad(productoId: string, valor: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.producto.id === productoId ? { ...it, cantidad: Math.max(1, valor) } : it,
      ),
    );
  }

  const origenOk = !!origenId;
  const destinoOk = !!destinoId && destinoId !== origenId;
  const puedeConfirmar =
    items.length > 0 && origenOk && destinoOk && items.every((it) => it.cantidad > 0);

  const transferirMut = useMutation({
    mutationFn: async () => {
      if (!empleado) throw new Error('Sin sesión');
      if (items.length === 0) throw new Error('Agregá al menos un producto');
      if (!db.stock.transferenciaInmediata) {
        throw new Error('La transferencia inmediata no está disponible en este modo');
      }
      // Ejecutamos item por item. Si alguno falla NO revertimos los
      // anteriores (no hay RPC atómica), guardamos el detalle para
      // mostrar un resumen al final. La política del cliente es
      // "avisar y seguir", no bloquear por stock insuficiente.
      const ok: string[] = [];
      const errores: { nombre: string; mensaje: string }[] = [];
      for (const it of items) {
        try {
          await db.stock.transferenciaInmediata!({
            producto_id: it.producto.id,
            deposito_origen_id: origenId,
            deposito_destino_id: destinoId,
            cantidad: it.cantidad,
            motivo: `Transferencia PoS · ${it.producto.nombre}`,
            empleado_id: empleado.id,
          });
          ok.push(it.producto.nombre);
        } catch (e) {
          errores.push({
            nombre: it.producto.nombre,
            mensaje: (e as Error).message,
          });
        }
      }
      return { ok, errores };
    },
    onSuccess: ({ ok, errores }) => {
      const origenNom = depositosQ.data?.find((d) => d.id === origenId)?.nombre ?? 'origen';
      const destinoNom = depositosQ.data?.find((d) => d.id === destinoId)?.nombre ?? 'destino';
      qc.invalidateQueries({ queryKey: ['stock-prod'] });
      qc.invalidateQueries({ queryKey: ['stock-prod-transferencia'] });
      qc.invalidateQueries({ queryKey: ['stocks-origen-transferencia'] });
      qc.invalidateQueries({ queryKey: ['pos-stocks-buscar'] });
      if (errores.length === 0) {
        toast.success(
          `Transferencia OK · ${ok.length} producto(s) · ${origenNom} → ${destinoNom}`,
        );
        onOpenChange(false);
      } else {
        // Operación parcial: dejamos el modal abierto y mostramos qué
        // pasó con cada uno para que el usuario decida (reintentar los
        // que fallaron, cerrar, etc). Usamos un toast largo con la lista.
        toast.warning(
          `Parcial: ${ok.length} OK, ${errores.length} fallaron. ` +
            `Fallaron: ${errores.map((e) => e.nombre).join(', ')}`,
          { duration: 10_000 },
        );
        // Sacamos de la lista los que sí se hicieron; los que fallaron
        // quedan visibles para reintentar.
        setItems((prev) => prev.filter((it) => !ok.includes(it.producto.nombre)));
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-amber-600" />
            Movimientos de stock
          </span>
        </DialogTitle>
      </DialogHeader>

      {/* Pestañas: nueva transferencia | historial (con anular) */}
      <div className="mb-3 flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab('asentar')}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === 'asentar'
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Asentar nuevo
        </button>
        <button
          type="button"
          onClick={() => setTab('movimientos')}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === 'movimientos'
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Movimientos recientes
        </button>
      </div>

      {tab === 'movimientos' ? (
        <MovimientosRecientes onClose={() => onOpenChange(false)} />
      ) : (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Registrá una transferencia que ya hiciste físicamente entre depósitos
          o locales. Agregá los productos que moviste y transferilos todos de
          una.
        </p>

        {/* Paso 1: origen y destino comunes */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div>
            <Label className="mb-1 block text-xs">Desde</Label>
            <select
              value={origenId}
              onChange={(e) => setOrigenId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              disabled={depositosQ.isLoading}
            >
              <option value="">
                {depositosQ.isLoading ? 'Cargando…' : '— Elegir —'}
              </option>
              {(depositosQ.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="pb-2">
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Hacia</Label>
            <select
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              disabled={depositosQ.isLoading}
            >
              <option value="">
                {depositosQ.isLoading ? 'Cargando…' : '— Elegir —'}
              </option>
              {(depositosQ.data ?? [])
                .filter((d) => d.id !== origenId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
            </select>
          </div>
        </div>
        {/* Feedback si la lista no cargó o vino vacía — así el cajero no
            queda mirando un select mudo sin saber si es error o timing.
            Botón Reintentar fuerza refetch sin necesidad de Ctrl+F5. */}
        {depositosQ.error && (
          <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <span>
              No se pudieron cargar los locales. Tocá Reintentar. Si sigue
              igual, refrescá con Ctrl+F5.
            </span>
            <button
              type="button"
              onClick={() => depositosQ.refetch()}
              className="rounded border border-destructive/50 bg-white px-2 py-0.5 font-medium text-destructive hover:bg-destructive/5"
            >
              Reintentar
            </button>
          </div>
        )}
        {!depositosQ.isLoading &&
          !depositosQ.error &&
          (depositosQ.data?.length ?? 0) === 0 && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <span>
                No hay depósitos disponibles. Puede ser una desconexión
                temporal — tocá Reintentar.
              </span>
              <button
                type="button"
                onClick={() => depositosQ.refetch()}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              >
                Reintentar
              </button>
            </div>
          )}

        {/* Paso 2: buscador para agregar productos a la lista */}
        <div>
          <Label className="mb-1 block text-xs">Agregar producto</Label>
          <div className="relative">
            <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search className="h-4 w-4" />
            </div>
            <Input
              ref={codigoRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setResaltadoIdx(0);
              }}
              onKeyDown={(e) => {
                const lista = resultadosQ.data ?? [];
                if (e.key === 'Enter' && lista.length > 0) {
                  e.preventDefault();
                  const target = lista[Math.min(resaltadoIdx, lista.length - 1)];
                  if (target) agregarItem(target);
                } else if (e.key === 'ArrowDown' && lista.length > 0) {
                  e.preventDefault();
                  setResaltadoIdx((i) => Math.min(i + 1, lista.length - 1));
                } else if (e.key === 'ArrowUp' && lista.length > 0) {
                  e.preventDefault();
                  setResaltadoIdx((i) => Math.max(0, i - 1));
                }
              }}
              placeholder="Código o nombre — Enter agrega"
              className="pl-8"
            />
          </div>
          {q.trim() && (resultadosQ.data?.length ?? 0) > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow">
              {resultadosQ.data!.map((p, idx) => {
                const resaltado = idx === resaltadoIdx;
                const yaAgregado = items.some((it) => it.producto.id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => agregarItem(p)}
                    onMouseEnter={() => setResaltadoIdx(idx)}
                    className={`flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm transition-colors last:border-0 ${
                      resaltado
                        ? 'border-l-4 border-l-blue-600 bg-blue-100 pl-2 font-medium text-blue-900'
                        : 'hover:bg-blue-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {p.codigo_interno}
                      </div>
                      <div className="truncate">{p.nombre}</div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      {(precioPorProducto.get(p.id) ?? 0) > 0 && (
                        <span className="text-xs font-semibold tabular-nums text-slate-700">
                          {formatCurrency(precioPorProducto.get(p.id)!)}
                        </span>
                      )}
                      {yaAgregado && (
                        <span className="text-[10px] text-emerald-700">Ya en lista +1</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {q.trim() && resultadosQ.data?.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Sin resultados.</p>
          )}
        </div>

        {/* Paso 3: lista de items a transferir */}
        {items.length > 0 && (
          <div className="rounded-md border">
            <div className="border-b bg-muted/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              A transferir ({items.length})
            </div>
            <div className="max-h-64 overflow-y-auto">
              {items.map((it) => {
                const stockOr = stocksOrigenQ.data?.get(it.producto.id) ?? 0;
                const insuficiente = origenOk && stockOr < it.cantidad;
                const precio = precioPorProducto.get(it.producto.id) ?? 0;
                return (
                  <div
                    key={it.producto.id}
                    className="flex items-center gap-2 border-b px-2 py-1.5 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {it.producto.nombre}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">#{it.producto.codigo_interno}</span>
                        {precio > 0 && (
                          <span className="font-semibold text-slate-700">
                            · {formatCurrency(precio)} c/u
                          </span>
                        )}
                        {origenOk && (
                          <span
                            className={insuficiente ? 'text-amber-700' : ''}
                          >
                            · En origen: {stockOr}
                            {insuficiente && ' (insuficiente)'}
                          </span>
                        )}
                      </div>
                    </div>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={it.cantidad}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setCantidad(it.producto.id, isNaN(v) ? 1 : v);
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-8 w-16 tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => quitarItem(it.producto.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Quitar de la lista"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            {/* Aviso agregado si hay al menos un item con stock insuficiente
                en origen. NO bloquea — solo avisa, la política del cliente
                permite transferir aunque quede negativo. */}
            {items.some(
              (it) =>
                origenOk &&
                (stocksOrigenQ.data?.get(it.producto.id) ?? 0) < it.cantidad,
            ) && (
              <div className="border-t bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                Algún producto no tiene stock suficiente en origen. Se transfiere igual si ya hiciste el movimiento.
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {tab === 'asentar' && (
      <div className="mt-4 flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          onClick={() => transferirMut.mutate()}
          disabled={!puedeConfirmar || transferirMut.isPending}
        >
          {transferirMut.isPending
            ? 'Transfiriendo…'
            : items.length === 0
              ? 'Transferir'
              : `Transferir ${items.length} producto${items.length === 1 ? '' : 's'}`}
        </Button>
      </div>
      )}
    </Dialog>
  );
}

/**
 * Lista de transferencias de stock de las últimas 48hs. Agrupa salida+entrada
 * en una sola fila ("Producto · X unidades · Origen → Destino · Hora · Cajero").
 * Botón Anular crea el par inverso y revierte el stock. Las anuladas quedan
 * con un pill "Anulada" en lugar del botón.
 */
function MovimientosRecientes({ onClose: _onClose }: { onClose: () => void }) {
  const db = getDb();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  const desde = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() - 48);
    return d.toISOString();
  }, []);

  const movsQ = useQuery({
    queryKey: ['stock-movs-recientes-pos', desde],
    queryFn: () => db.stock.movimientos({ desde }),
  });
  const depositosQ = useQuery({
    queryKey: ['depositos-pos-recientes'],
    queryFn: () => db.depositos.list(),
  });
  const productosQ = useQuery({
    queryKey: ['productos-pos-recientes'],
    queryFn: () => db.productos.list(),
  });
  const empleadosQ = useQuery({
    queryKey: ['empleados-pos-recientes'],
    queryFn: () => db.empleados.list(),
  });

  type Par = {
    keyPar: string;
    salidaId: string;
    fecha: string;
    producto_id: string;
    cantidad: number;
    origen_id: string;
    destino_id: string;
    empleado_id: string;
    motivo?: string;
  };

  // Agrupamos por (producto + cantidad + fecha) — transferenciaInmediata
  // crea ambos movs con el MISMO timestamp. Cada par tiene 1 salida + 1 entrada.
  const { pares, anuladas } = useMemo(() => {
    const movs = movsQ.data ?? [];
    const grupos = new Map<string, { salida?: typeof movs[number]; entrada?: typeof movs[number] }>();
    for (const m of movs) {
      if (m.tipo !== 'transferencia_salida' && m.tipo !== 'transferencia_entrada') continue;
      const key = `${m.producto_id}|${m.cantidad}|${m.fecha}`;
      const g = grupos.get(key) ?? {};
      if (m.tipo === 'transferencia_salida') g.salida = m;
      else g.entrada = m;
      grupos.set(key, g);
    }
    const pares: Par[] = [];
    const anuladas = new Set<string>();
    for (const [, g] of grupos) {
      if (!g.salida || !g.entrada) continue;
      const motivo = g.salida.motivo ?? '';
      // Anulación: el motivo apunta a un id de movimiento previo.
      const matchAnul = /^Anulaci[óo]n de transferencia (\S+)/.exec(motivo);
      if (matchAnul) {
        anuladas.add(matchAnul[1]!);
        continue; // no listamos las anulaciones como filas propias
      }
      pares.push({
        keyPar: g.salida.id,
        salidaId: g.salida.id,
        fecha: g.salida.fecha,
        producto_id: g.salida.producto_id,
        cantidad: g.salida.cantidad,
        origen_id: g.salida.deposito_id,
        destino_id: g.entrada.deposito_id,
        empleado_id: g.salida.empleado_id,
        motivo: g.salida.motivo,
      });
    }
    pares.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { pares, anuladas };
  }, [movsQ.data]);

  const anularMut = useMutation({
    mutationFn: async (movimiento_id: string) => {
      if (!empleado) throw new Error('Sin sesión');
      if (!db.stock.anularTransferenciaInmediata) {
        throw new Error('Anulación no disponible en este modo');
      }
      return db.stock.anularTransferenciaInmediata({
        movimiento_id,
        empleado_id: empleado.id,
      });
    },
    onSuccess: () => {
      toast.success('Transferencia anulada — stock revertido');
      qc.invalidateQueries({ queryKey: ['stock-movs-recientes-pos'] });
      qc.invalidateQueries({ queryKey: ['stock-prod'] });
      qc.invalidateQueries({ queryKey: ['pos-stocks-buscar'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function nombreProd(id: string) {
    return productosQ.data?.find((p) => p.id === id)?.nombre ?? '—';
  }
  function codigoProd(id: string) {
    return productosQ.data?.find((p) => p.id === id)?.codigo_interno ?? '—';
  }
  function nombreDep(id: string) {
    return depositosQ.data?.find((d) => d.id === id)?.nombre ?? '—';
  }
  function nombreEmp(id: string) {
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido ?? ''}`.trim() : '—';
  }
  function horaTxt(iso: string) {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (movsQ.isLoading) return <Skeleton className="h-40" />;
  if (pares.length === 0) {
    return (
      <p className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        No hay transferencias en las últimas 48 horas.
      </p>
    );
  }

  return (
    <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
      {pares.map((p) => {
        const anulada = anuladas.has(p.salidaId);
        return (
          <div
            key={p.keyPar}
            className={`rounded-md border bg-card p-2 text-sm ${
              anulada ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {codigoProd(p.producto_id)}
                  </span>
                  <span className={`truncate font-medium ${anulada ? 'line-through' : ''}`}>
                    {nombreProd(p.producto_id)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {p.cantidad} unidades
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {nombreDep(p.origen_id)}
                  </span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {nombreDep(p.destino_id)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {horaTxt(p.fecha)} · {nombreEmp(p.empleado_id)}
                </div>
              </div>
              {anulada ? (
                <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Anulada
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (
                      confirm(
                        `¿Anular esta transferencia? Se va a revertir el stock: ${p.cantidad} × ${nombreProd(p.producto_id)} vuelve de ${nombreDep(p.destino_id)} a ${nombreDep(p.origen_id)}.`,
                      )
                    ) {
                      anularMut.mutate(p.salidaId);
                    }
                  }}
                  disabled={anularMut.isPending}
                  title="Anular y revertir el stock"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Anular
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
