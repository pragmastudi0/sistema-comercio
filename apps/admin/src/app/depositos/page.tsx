'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Search, ArrowDownUp, Minus, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comercio/ui/dialog';
import { AbmDialogFooter, AbmSimple } from '@/components/abm-simple';
import { formatCurrency } from '@comercio/ui/utils';
import { PRESET_IDS, type Deposito, type TipoDeposito } from '@comercio/db';
import { PaginaProtegida } from '@/lib/permisos';

function DepositosPageInner() {
  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold sm:text-2xl">Stock por local</h1>
        <p className="text-sm text-muted-foreground">
          Vista del stock consolidado por producto y local + administración de locales.
        </p>
      </div>
      {/* ABM de Locales (sub-tab) ocultado: el dueño no maneja el alta
          de locales, ya están creados. Si hace falta crear/editar uno,
          se hace por SQL o reactivando esta UI. */}
      <StockConsolidado />
    </div>
  );
}

function StockConsolidado() {
  const db = getDb();
  const qc = useQueryClient();
  const empleadoId = useSesion((s) => s.empleado?.id) ?? '';
  const productosQ = useQuery({
    queryKey: ['productos-stock'],
    queryFn: () => db.productos.list({ activo: true }),
  });
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
  });
  const stockQ = useQuery({
    queryKey: ['stock-consolidado'],
    queryFn: () => db.stock.consolidado(),
  });

  const [texto, setTexto] = useState('');
  const [page, setPage] = useState(0);
  const [ajustando, setAjustando] = useState<{
    productoId: string;
    depositoId: string;
    nombreProd: string;
    nombreDep: string;
    actual: number;
  } | null>(null);
  const PAGE_SIZE = 100;

  // Volver a página 0 cuando cambia el filtro
  useEffect(() => {
    setPage(0);
  }, [texto]);

  const ajustarMut = useMutation({
    mutationFn: ({
      productoId,
      depositoId,
      delta,
      motivo,
    }: {
      productoId: string;
      depositoId: string;
      delta: number;
      motivo: string;
    }) =>
      db.stock.ajustar({
        producto_id: productoId,
        deposito_id: depositoId,
        cantidad: delta,
        motivo,
        empleado_id: empleadoId,
      }),
    onSuccess: () => {
      toast.success('Stock ajustado');
      qc.invalidateQueries({ queryKey: ['stock-consolidado'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const productosFiltrados = (productosQ.data ?? []).filter((p) => {
    if (!texto) return true;
    const q = texto.toLowerCase();
    return p.nombre.toLowerCase().includes(q) || p.codigo_interno.includes(q);
  });

  const depositos = depositosQ.data ?? [];
  const stockMap = new Map<string, Map<string, number>>(); // prodId -> (depId -> cant)
  for (const s of stockQ.data ?? []) {
    if (!stockMap.has(s.producto_id)) stockMap.set(s.producto_id, new Map());
    stockMap.get(s.producto_id)!.set(s.deposito_id, s.cantidad);
  }

  function cantidad(prodId: string, depId: string): number {
    return stockMap.get(prodId)?.get(depId) ?? 0;
  }
  function total(prodId: string): number {
    let t = 0;
    for (const c of stockMap.get(prodId)?.values() ?? []) t += c;
    return t;
  }

  const loading = productosQ.isLoading || depositosQ.isLoading || stockQ.isLoading;
  const totalFiltrados = productosFiltrados.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltrados / PAGE_SIZE));
  const productosPagina = productosFiltrados.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-col gap-2 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">
          {totalFiltrados === 0 ? (
            <>0 productos</>
          ) : (
            <>
              {Math.min(page * PAGE_SIZE + 1, totalFiltrados)}–
              {Math.min((page + 1) * PAGE_SIZE, totalFiltrados)} de{' '}
              <span className="tabular-nums">{totalFiltrados}</span> productos
            </>
          )}
        </CardTitle>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código o nombre"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-8"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="px-2 py-2 text-left">Código</th>
                  <th className="px-2 py-2 text-left">Producto</th>
                  {depositos.map((d) => (
                    <th key={d.id} className="px-2 py-2 text-right">
                      {d.nombre}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {productosPagina.map((p) => {
                  const t = total(p.id);
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-2 py-2 font-mono text-xs">{p.codigo_interno}</td>
                      <td className="px-2 py-2 font-medium">{p.nombre}</td>
                      {depositos.map((d) => {
                        const c = cantidad(p.id, d.id);
                        return (
                          <td key={d.id} className="px-2 py-2 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setAjustando({
                                  productoId: p.id,
                                  depositoId: d.id,
                                  nombreProd: p.nombre,
                                  nombreDep: d.nombre,
                                  actual: c,
                                })
                              }
                              className={`group inline-flex items-center gap-1.5 rounded border border-transparent px-2 py-1 text-sm tabular-nums transition-colors hover:border-input hover:bg-accent ${
                                c === 0 ? 'text-muted-foreground' : ''
                              }`}
                              title="Click para ajustar"
                            >
                              <span className="font-medium">{c}</span>
                              <Pencil className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-100" />
                            </button>
                          </td>
                        );
                      })}
                      <td
                        className={`px-2 py-2 text-right font-bold tabular-nums ${
                          t === 0 ? 'text-destructive' : t < 5 ? 'text-orange-600' : ''
                        }`}
                      >
                        {t}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {totalFiltrados > PAGE_SIZE && (
        <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:flex-row">
          <span className="text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Siguiente <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {ajustando && (
        <AjusteStockDialog
          item={ajustando}
          onClose={() => setAjustando(null)}
          onConfirm={(delta, motivo) =>
            ajustarMut.mutate({
              productoId: ajustando.productoId,
              depositoId: ajustando.depositoId,
              delta,
              motivo,
            })
          }
        />
      )}
    </Card>
  );
}

const MOTIVOS_PRESET = [
  'Ingreso de mercadería',
  'Recuento físico',
  'Rotura / vencido',
  'Devolución',
  'Otro',
];

function AjusteStockDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: {
    productoId: string;
    depositoId: string;
    nombreProd: string;
    nombreDep: string;
    actual: number;
  };
  onClose: () => void;
  onConfirm: (delta: number, motivo: string) => void;
}) {
  const [modo, setModo] = useState<'delta' | 'absoluto'>('delta');
  // En modo delta: cuánto sumar/restar. En absoluto: cantidad final.
  const [valor, setValor] = useState(0);
  const [motivo, setMotivo] = useState('Ingreso de mercadería');
  const [motivoCustom, setMotivoCustom] = useState('');

  const delta = modo === 'delta' ? valor : valor - item.actual;
  const final = item.actual + delta;
  const motivoFinal = motivo === 'Otro' ? motivoCustom.trim() : motivo;
  const sePuedeAplicar = delta !== 0 && !!motivoFinal && final >= 0;

  function sumar(n: number) {
    if (modo === 'delta') setValor((v) => v + n);
    else setValor((v) => Math.max(0, v + n));
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogHeader>
        <DialogTitle>Ajustar stock</DialogTitle>
      </DialogHeader>

      <div className="space-y-4 text-sm">
        {/* Cabecera con producto, depósito y stock actual */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-base font-semibold leading-tight">{item.nombreProd}</div>
          <div className="text-xs text-muted-foreground">{item.nombreDep}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">Stock actual:</span>
            <span className="text-xl font-bold tabular-nums">{item.actual}</span>
          </div>
        </div>

        {/* Tabs: delta (default) vs absoluto */}
        <div className="flex rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => {
              setModo('delta');
              setValor(0);
            }}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              modo === 'delta' ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            Sumar / restar
          </button>
          <button
            type="button"
            onClick={() => {
              setModo('absoluto');
              setValor(item.actual);
            }}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              modo === 'absoluto' ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            Setear cantidad
          </button>
        </div>

        {/* Stepper grande */}
        <div className="rounded-md border p-3">
          <div className="mb-2 text-center text-xs text-muted-foreground">
            {modo === 'delta' ? '¿Cuánto sumar (o restar)?' : 'Nueva cantidad'}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0"
              onClick={() => sumar(-1)}
              aria-label="Restar 1"
            >
              <Minus className="h-5 w-5" />
            </Button>
            <Input
              type="number"
              inputMode="numeric"
              value={valor}
              onChange={(e) => setValor(parseInt(e.target.value || '0', 10))}
              className="h-12 w-24 text-center text-2xl font-bold tabular-nums"
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0"
              onClick={() => sumar(1)}
              aria-label="Sumar 1"
            >
              <Plus className="h-5 w-5" />
            </Button>
          </div>

          {/* Botones rápidos */}
          {modo === 'delta' && (
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {[1, 5, 10, 12, 24, 50].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => sumar(n)}
                >
                  +{n}
                </Button>
              ))}
            </div>
          )}

          {/* Preview del resultado */}
          {delta !== 0 && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{item.actual}</span>
              <span className="text-muted-foreground">→</span>
              <span
                className={`text-lg font-bold tabular-nums ${
                  final < 0 ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {final}
              </span>
              {final < 0 && (
                <span className="text-xs text-destructive">(no puede ser negativo)</span>
              )}
            </div>
          )}
        </div>

        {/* Motivo: chips + custom si "Otro" */}
        <div>
          <Label className="mb-2 block">Motivo</Label>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_PRESET.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMotivo(m)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  motivo === m
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background hover:bg-accent'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {motivo === 'Otro' && (
            <Input
              className="mt-2"
              value={motivoCustom}
              onChange={(e) => setMotivoCustom(e.target.value)}
              placeholder="Describir el motivo del ajuste…"
            />
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={!sePuedeAplicar}
          onClick={() => {
            onConfirm(delta, motivoFinal);
            onClose();
          }}
        >
          Aplicar ajuste
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AbmDepositos() {
  const db = getDb();
  const qc = useQueryClient();
  const depositosQ = useQuery({ queryKey: ['depositos'], queryFn: () => db.depositos.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });
  const stockQ = useQuery({ queryKey: ['stock-consolidado'], queryFn: () => db.stock.consolidado() });

  const crearMut = useMutation({
    mutationFn: (v: Omit<Deposito, 'id'>) => db.depositos.create(v),
    onSuccess: () => {
      toast.success('Local creado');
      qc.invalidateQueries({ queryKey: ['depositos'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editarMut = useMutation({
    mutationFn: ({ id, ...v }: { id: string } & Partial<Deposito>) => db.depositos.update(id, v),
    onSuccess: () => {
      toast.success('Local editado');
      qc.invalidateQueries({ queryKey: ['depositos'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => db.depositos.delete(id),
    onSuccess: () => {
      toast.success('Local eliminado');
      qc.invalidateQueries({ queryKey: ['depositos'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function stockEn(depositoId: string): number {
    return (stockQ.data ?? [])
      .filter((s) => s.deposito_id === depositoId)
      .reduce((acc, s) => acc + s.cantidad, 0);
  }

  return (
    <div className="mt-4">
      <AbmSimple<Deposito>
        titulo="Locales"
        rows={depositosQ.data ?? []}
        loading={depositosQ.isLoading}
        newButtonLabel="Nuevo local"
        columns={[
          { header: 'Nombre', cell: (r) => <span className="font-medium">{r.nombre}</span> },
          {
            header: 'Tipo',
            cell: (r) => <Badge variant="secondary">{r.tipo}</Badge>,
          },
          {
            header: 'Local',
            cell: (r) =>
              r.local_id ? (
                <span>{localesQ.data?.find((l) => l.id === r.local_id)?.nombre ?? '—'}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            header: 'Stock total',
            cell: (r) => <span className="tabular-nums">{stockEn(r.id)} u</span>,
          },
          {
            header: 'Estado',
            cell: (r) =>
              r.activo ? (
                <Badge variant="secondary">Activo</Badge>
              ) : (
                <Badge variant="destructive">Inactivo</Badge>
              ),
          },
        ]}
        buildCreate={(close) => (
          <DepositoForm
            locales={localesQ.data ?? []}
            onSubmit={(v) => {
              crearMut.mutate(v);
              close();
            }}
            onCancel={close}
          />
        )}
        buildEdit={(row, close) => (
          <DepositoForm
            initial={row}
            locales={localesQ.data ?? []}
            onSubmit={(v) => {
              editarMut.mutate({ id: row.id, ...v });
              close();
            }}
            onCancel={close}
          />
        )}
        canDelete={(r) => {
          const s = stockEn(r.id);
          if (s > 0) return `No se puede eliminar: tiene ${s} unidades. Hacé una transferencia primero.`;
          return true;
        }}
        onDelete={(r) => eliminarMut.mutateAsync(r.id)}
      />
    </div>
  );
}

function DepositoForm({
  initial,
  locales,
  onSubmit,
  onCancel,
}: {
  initial?: Deposito;
  locales: { id: string; nombre: string }[];
  onSubmit: (v: Omit<Deposito, 'id'>) => void;
  onCancel: () => void;
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoDeposito>(initial?.tipo ?? 'central');
  const [localId, setLocalId] = useState(initial?.local_id ?? '');
  const [activo, setActivo] = useState(initial?.activo ?? true);

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Nombre</Label>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block">Tipo</Label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDeposito)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="central">Central</option>
            <option value="local">Local (asociado a un local físico)</option>
            <option value="web">Web (e-commerce)</option>
          </select>
        </div>
        {tipo === 'local' && (
          <div>
            <Label className="mb-1 block">Local asociado</Label>
            <select
              value={localId}
              onChange={(e) => setLocalId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Elegir —</option>
              {locales.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
          className="h-4 w-4"
        />
        Activo
      </label>
      <AbmDialogFooter
        onCancel={onCancel}
        onSubmit={() =>
          nombre.trim() &&
          onSubmit({
            empresa_id: PRESET_IDS.empresa,
            nombre: nombre.trim(),
            tipo,
            local_id: tipo === 'local' ? localId || undefined : undefined,
            activo,
          })
        }
        disabled={!nombre.trim() || (tipo === 'local' && !localId)}
      />
    </div>
  );
}

export default function DepositosPage() {
  return (
    <PaginaProtegida modulo="stock" accion="ver_todos_depositos">
      <DepositosPageInner />
    </PaginaProtegida>
  );
}
