'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeftRight, ArrowRight, RefreshCw, Search } from 'lucide-react';
import { getDb } from '@/lib/db';
import { PaginaProtegida } from '@/lib/permisos';
import {
  motivoLegible,
  origenDeMovimiento,
} from '@/lib/movimientos-stock-helpers';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Button } from '@comercio/ui/button';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';

function formatHora(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MovimientosStockInner() {
  const db = getDb();
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const hace7 = format(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

  const [desde, setDesde] = useState(hace7);
  const [hasta, setHasta] = useState(hoy);
  const [empleadoId, setEmpleadoId] = useState<string>('');
  const [depositoId, setDepositoId] = useState<string>('');
  const [texto, setTexto] = useState<string>('');
  // Filtro por origen: '' todos, 'pos' solo PoS, 'admin' solo admin.
  const [origenFiltro, setOrigenFiltro] = useState<'' | 'pos' | 'admin'>('');
  // Filtro de "solo activas" — esconde las transferencias que ya fueron
  // anuladas. Por default ON: lo más usual es ver lo que sigue vigente.
  const [soloActivas, setSoloActivas] = useState(true);

  const desdeIso = new Date(`${desde}T00:00:00`).toISOString();
  const hastaIso = new Date(`${hasta}T23:59:59`).toISOString();

  // OJO: no filtramos por deposito_id en el query porque cada transferencia
  // tiene 2 movs (uno por depósito). Si filtramos en el server, traemos solo
  // la mitad del par y no podemos reconstruir la fila "Origen → Destino".
  // El filtro por depósito se aplica DESPUÉS de armar los pares.
  const movsQ = useQuery({
    queryKey: ['admin-movs-stock', desdeIso, hastaIso],
    queryFn: () =>
      db.stock.movimientos({
        desde: desdeIso,
        hasta: hastaIso,
      }),
    refetchInterval: 30_000,
  });
  const productosQ = useQuery({
    queryKey: ['productos-admin-list'],
    queryFn: () => db.productos.list(),
  });
  const depositosQ = useQuery({
    queryKey: ['depositos'],
    queryFn: () => db.depositos.list(),
  });
  const empleadosQ = useQuery({
    queryKey: ['empleados'],
    queryFn: () => db.empleados.list(),
  });

  const prodPorId = useMemo(() => {
    const m = new Map(productosQ.data?.map((p) => [p.id, p]) ?? []);
    return m;
  }, [productosQ.data]);
  const depPorId = useMemo(() => {
    const m = new Map(depositosQ.data?.map((d) => [d.id, d]) ?? []);
    return m;
  }, [depositosQ.data]);
  const empPorId = useMemo(() => {
    const m = new Map(empleadosQ.data?.map((e) => [e.id, e]) ?? []);
    return m;
  }, [empleadosQ.data]);

  // Helpers extraídos a lib/movimientos-stock-helpers para reutilizarlos
  // desde el modal Estadísticas del producto (misma lógica de origen +
  // formato del motivo).

  // Agrupamos las transferencias en pares (salida+entrada con misma
  // fecha+producto+cantidad) — cada par es UNA fila "De → A" en la tabla.
  // Las anulaciones se detectan por motivo y se marcan sobre la transferencia
  // original, en vez de listarlas como filas propias.
  type Transferencia = {
    keyPar: string;
    salidaId: string;
    fecha: string;
    producto_id: string;
    cantidad: number;
    origen_id: string;
    destino_id: string;
    empleado_id: string;
    motivo?: string;
    anulada: boolean;
    /** Si la transferencia ES una anulación de otra, este flag la marca.
     * Útil para verla cuando soloActivas=false. */
    esAnulacionDe?: string;
  };

  const transferencias = useMemo<Transferencia[]>(() => {
    const movs = (movsQ.data ?? []).filter(
      (m) =>
        m.tipo === 'transferencia_salida' || m.tipo === 'transferencia_entrada',
    );
    const grupos = new Map<
      string,
      { salida?: typeof movs[number]; entrada?: typeof movs[number] }
    >();
    for (const m of movs) {
      // Redondeamos la fecha al segundo (dropeamos los ms). Los
      // transferenciaInmediata históricos guardaban 2 movs con timestamps
      // que diferían en microsegundos, y como agrupábamos por fecha
      // exacta los pares no se formaban. Con el fix del repo los nuevos
      // ya comparten timestamp, pero este redondeo rescata los históricos.
      const fechaSeg = m.fecha.slice(0, 19);
      const key = `${m.producto_id}|${m.cantidad}|${fechaSeg}`;
      const g = grupos.get(key) ?? {};
      if (m.tipo === 'transferencia_salida') g.salida = m;
      else g.entrada = m;
      grupos.set(key, g);
    }
    const pares: Transferencia[] = [];
    const anuladasIds = new Set<string>();
    for (const [, g] of grupos) {
      if (!g.salida || !g.entrada) continue;
      const motivo = g.salida.motivo ?? '';
      const matchAnul = /^Anulaci[óo]n de transferencia (\S+)/.exec(motivo);
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
        anulada: false,
        esAnulacionDe: matchAnul?.[1],
      });
      if (matchAnul) anuladasIds.add(matchAnul[1]!);
    }
    // Marcar las que tienen anulación
    for (const t of pares) {
      if (anuladasIds.has(t.salidaId)) t.anulada = true;
    }
    return pares;
  }, [movsQ.data]);

  const transferenciasFiltradas = useMemo(() => {
    let lista = transferencias;
    // Por default escondemos tanto las anuladas como las propias filas
    // de anulación. Si soloActivas=false, las mostramos para auditoría.
    if (soloActivas) {
      lista = lista.filter((t) => !t.anulada && !t.esAnulacionDe);
    }
    if (depositoId) {
      lista = lista.filter(
        (t) => t.origen_id === depositoId || t.destino_id === depositoId,
      );
    }
    if (empleadoId) {
      lista = lista.filter((t) => t.empleado_id === empleadoId);
    }
    if (texto.trim()) {
      const q = texto.trim().toLowerCase();
      const esNumerico = /^\d+$/.test(q);
      lista = lista.filter((t) => {
        const p = prodPorId.get(t.producto_id);
        if (!p) return false;
        if (esNumerico) return p.codigo_interno === q;
        return p.nombre.toLowerCase().includes(q);
      });
    }
    if (origenFiltro) {
      // Este listado es de Transferencias (no de movimientos individuales),
      // así que solo importa el prefijo del motivo — no hay ventas acá.
      lista = lista.filter((t) => origenDeMovimiento(t.motivo) === origenFiltro);
    }
    return [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [transferencias, soloActivas, depositoId, empleadoId, texto, origenFiltro, prodPorId]);

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
            <ArrowLeftRight className="h-5 w-5 text-amber-600" />
            Movimientos de stock
          </h1>
          <p className="text-sm text-muted-foreground">
            Transferencias asentadas desde el PoS: quién movió qué cantidad,
            de qué local a cuál y cuándo. Refresca cada 30s.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => movsQ.refetch()}
          disabled={movsQ.isFetching}
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${movsQ.isFetching ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <div>
              <Label className="mb-1 block text-xs">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Local / depósito</Label>
              <select
                value={depositoId}
                onChange={(e) => setDepositoId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos (origen o destino)</option>
                {(depositosQ.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Empleado</Label>
              <select
                value={empleadoId}
                onChange={(e) => setEmpleadoId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {(empleadosQ.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre} {e.apellido ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Origen</Label>
              <select
                value={origenFiltro}
                onChange={(e) => setOrigenFiltro(e.target.value as '' | 'pos' | 'admin')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="pos">Desde el PoS (cajero)</option>
                <option value="admin">Desde el admin (encargado/dueño)</option>
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Producto</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Código o nombre"
                  className="pl-8"
                />
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={soloActivas}
                onChange={(e) => setSoloActivas(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Solo activas (esconder anuladas y sus reversos)
            </label>
          </div>
        </CardContent>
      </Card>

      {movsQ.isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {transferenciasFiltradas.length}{' '}
              {transferenciasFiltradas.length === 1 ? 'transferencia' : 'transferencias'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {transferenciasFiltradas.length === 0 ? (
              <p className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                No hay transferencias de stock con esos filtros.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-left">Código</th>
                      <th className="px-3 py-2 text-left">Producto</th>
                      <th className="px-3 py-2 text-right">Cant.</th>
                      <th className="px-3 py-2 text-left">De</th>
                      <th className="px-3 py-2"></th>
                      <th className="px-3 py-2 text-left">A</th>
                      <th className="px-3 py-2 text-left">Motivo</th>
                      <th className="px-3 py-2 text-left">Origen</th>
                      <th className="px-3 py-2 text-left">Empleado</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferenciasFiltradas.map((t) => {
                      const prod = prodPorId.get(t.producto_id);
                      const origenDep = depPorId.get(t.origen_id);
                      const destinoDep = depPorId.get(t.destino_id);
                      const emp = empPorId.get(t.empleado_id);
                      const empNombre = emp
                        ? `${emp.nombre} ${emp.apellido ?? ''}`.trim()
                        : '—';
                      return (
                        <tr
                          key={t.keyPar}
                          className={`border-b border-border/50 hover:bg-accent/40 ${
                            t.anulada || t.esAnulacionDe ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
                            {formatHora(t.fecha)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {prod?.codigo_interno ?? '—'}
                          </td>
                          <td
                            className={`px-3 py-2 ${t.anulada ? 'line-through' : ''}`}
                          >
                            {prod?.nombre ?? 'Producto borrado'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {t.cantidad}
                          </td>
                          <td className="px-3 py-2 text-xs">{origenDep?.nombre ?? '—'}</td>
                          <td className="px-3 py-2 text-center text-muted-foreground">
                            <ArrowRight className="inline h-3 w-3" />
                          </td>
                          <td className="px-3 py-2 text-xs">{destinoDep?.nombre ?? '—'}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {motivoLegible(t.motivo)}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {origenDeMovimiento(t.motivo) === 'pos' ? (
                              <Badge
                                variant="outline"
                                className="border-blue-300 bg-blue-50 text-blue-800"
                                title="Cargado por un cajero desde el botón Stock del PoS"
                              >
                                PoS
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-purple-300 bg-purple-50 text-purple-800"
                                title="Cargado desde el panel admin (encargado o dueño)"
                              >
                                Admin
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">{empNombre}</td>
                          <td className="px-3 py-2 text-xs">
                            {t.anulada ? (
                              <Badge variant="outline" className="border-amber-300 text-amber-700">
                                Anulada
                              </Badge>
                            ) : t.esAnulacionDe ? (
                              <Badge variant="outline" className="border-slate-300 text-slate-600">
                                Reverso
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-green-300 text-green-700">
                                Activa
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function MovimientosStockPage() {
  return (
    <PaginaProtegida modulo="stock" accion="ver_propio_deposito">
      <MovimientosStockInner />
    </PaginaProtegida>
  );
}
