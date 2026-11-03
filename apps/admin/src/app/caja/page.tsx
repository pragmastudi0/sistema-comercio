'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, LockOpen, Lock, Eye, ChevronDown, ChevronUp, Pencil, LockKeyhole, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { esPragmaDev } from '@comercio/business';
import { getDb } from '@/lib/db';
import { PaginaProtegida, RequierePermiso } from '@/lib/permisos';
import { useSesion } from '@/stores/sesion';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comercio/ui/dialog';
import { formatCurrency, formatDate } from '@comercio/ui/utils';
import type { MetodoPago, MovimientoCaja, SesionCaja, Venta } from '@comercio/db';

const METODOS: MetodoPago[] = ['efectivo', 'transferencia', 'debito', 'credito', 'qr', 'cta_cte'];

function CajasPageInner() {
  const db = getDb();
  const sesionesQ = useQuery({
    queryKey: ['sesiones-caja-todas'],
    queryFn: () => db.sesionesCaja.list(),
    refetchInterval: 10_000,
  });
  const empleadosQ = useQuery({ queryKey: ['empleados'], queryFn: () => db.empleados.list() });
  const cajasQ = useQuery({ queryKey: ['cajas'], queryFn: () => db.cajas.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });
  // Sesión seleccionada para ver detalle (ventas + movs + arqueo).
  const [sesionDetalle, setSesionDetalle] = useState<SesionCaja | null>(null);
  // Sesión seleccionada para EDITAR — solo el dev de Pragma tiene acceso
  // a este botón (los admins normales no lo ven). Sirve para corregir
  // datos de sesiones que se abrieron con el empleado o la caja
  // equivocada, o cerrar cajas que quedaron abiertas por olvido.
  const [sesionEditar, setSesionEditar] = useState<SesionCaja | null>(null);
  const empleadoLogueado = useSesion((s) => s.empleado);
  const puedeEditarSesiones = esPragmaDev(empleadoLogueado);

  // Filtros y orden del historial de sesiones cerradas.
  const hoy = format(new Date(), 'yyyy-MM-dd');
  const hace30 = format(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    'yyyy-MM-dd',
  );
  const [desde, setDesde] = useState(hace30);
  const [hasta, setHasta] = useState(hoy);
  // Default: más nueva arriba.
  const [ordenDesc, setOrdenDesc] = useState(true);
  // Filtro por turno (hora de apertura): mañana 7-15 / tarde 15-23.
  const [turno, setTurno] = useState<'' | 'manana' | 'tarde'>('');

  const empleadoNombre = (id: string) => {
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido}` : '—';
  };
  const cajaNombre = (id: string) => cajasQ.data?.find((c) => c.id === id)?.nombre ?? '—';
  const localDeCaja = (cajaId: string): string | undefined =>
    cajasQ.data?.find((c) => c.id === cajaId)?.local_id;
  const localNombre = (id?: string) =>
    (id && localesQ.data?.find((l) => l.id === id)?.nombre) ?? '—';

  // Resumen por local del rango filtrado — pedido de Agus. Trae ventas
  // completadas del período y agrupa por local_id para mostrar total
  // cobrado + cantidad de tickets. Usa el mismo rango que el historial
  // de abajo (desde/hasta/turno), así los números coinciden.
  const ventasRangoQ = useQuery({
    queryKey: ['cajas-ventas-rango', desde, hasta],
    queryFn: () =>
      db.ventas.list({
        desde: new Date(`${desde}T00:00:00`).toISOString(),
        hasta: new Date(`${hasta}T23:59:59`).toISOString(),
        estado: 'completada',
      }),
    staleTime: 60_000,
  });
  const ventasRango = (ventasRangoQ.data ?? []).filter((v) => {
    if (!turno) return true;
    const h = new Date(v.fecha).getHours();
    const esManana = h >= 7 && h < 15;
    return turno === 'manana' ? esManana : !esManana;
  });
  const resumenPorLocal = (() => {
    const m = new Map<string, { total: number; ventas: number }>();
    for (const v of ventasRango) {
      const prev = m.get(v.local_id) ?? { total: 0, ventas: 0 };
      prev.total += v.total;
      prev.ventas += 1;
      m.set(v.local_id, prev);
    }
    return [...m.entries()]
      .map(([localId, st]) => ({ localId, nombre: localNombre(localId), ...st }))
      .sort((a, b) => b.total - a.total);
  })();
  const totalRango = ventasRango.reduce((a, v) => a + v.total, 0);
  const ventasRangoCount = ventasRango.length;

  const sesiones = sesionesQ.data ?? [];
  const abiertas = sesiones.filter((s) => s.estado === 'abierta');
  // Historial completo (filtro fecha cierre + orden), sin cap de 10.
  const desdeIso = new Date(`${desde}T00:00:00`).toISOString();
  const hastaIso = new Date(`${hasta}T23:59:59`).toISOString();
  const cerradas = sesiones
    .filter((s) => {
      if (s.estado !== 'cerrada') return false;
      const ref = s.cerrada_en ?? s.abierta_en;
      if (ref < desdeIso || ref > hastaIso) return false;
      if (turno) {
        const h = new Date(s.abierta_en).getHours();
        const esManana = h >= 7 && h < 15;
        if (turno === 'manana' && !esManana) return false;
        if (turno === 'tarde' && esManana) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aRef = a.cerrada_en ?? a.abierta_en;
      const bRef = b.cerrada_en ?? b.abierta_en;
      const cmp = aRef.localeCompare(bRef);
      return ordenDesc ? -cmp : cmp;
    });

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold sm:text-2xl">Cajas</h1>
        <p className="text-sm text-muted-foreground">
          Sesiones abiertas y cerradas. Las abiertas se actualizan cada 10s.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LockOpen className="h-4 w-4" />
            Cajas abiertas ({abiertas.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sesionesQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : abiertas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cajas abiertas en este momento.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {abiertas.map((s) => (
                <SesionCard
                  key={s.id}
                  sesion={s}
                  cajaNombre={cajaNombre(s.caja_id)}
                  empleadoNombre={empleadoNombre(s.empleado_actual_id ?? s.empleado_id)}
                  empleadoOriginalNombre={
                    s.empleado_actual_id && s.empleado_actual_id !== s.empleado_id
                      ? empleadoNombre(s.empleado_id)
                      : undefined
                  }
                  onVerDetalle={() => setSesionDetalle(s)}
                  onEditar={puedeEditarSesiones ? () => setSesionEditar(s) : undefined}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resumen por local del rango filtrado — ayuda a Agus a ver de un
          vistazo cuánto se cobró y cuántas ventas tuvo cada local sin
          sumar fila por fila. */}
      {resumenPorLocal.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resumenPorLocal.map((r) => (
            <div
              key={r.localId}
              className="rounded-lg border bg-muted/30 p-3"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {r.nombre}
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {formatCurrency(r.total)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {r.ventas.toLocaleString('es-AR')} ventas
                {r.ventas > 0 && (
                  <>
                    {' · ticket prom. '}
                    <span className="font-medium">
                      {formatCurrency(Math.round(r.total / r.ventas))}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
          {resumenPorLocal.length > 1 && (
            <div className="rounded-lg border-2 border-foreground bg-foreground/5 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide">
                Total ({resumenPorLocal.length} locales)
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {formatCurrency(totalRango)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {ventasRangoCount.toLocaleString('es-AR')} ventas
                {ventasRangoCount > 0 && (
                  <>
                    {' · ticket prom. '}
                    <span className="font-medium">
                      {formatCurrency(Math.round(totalRango / ventasRangoCount))}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Historial de sesiones cerradas ({cerradas.length})
          </CardTitle>
          {/* Filtros por fecha de cierre + turno. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr]">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Desde
              </label>
              <Input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Hasta
              </label>
              <Input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Turno
              </label>
              <select
                value={turno}
                onChange={(e) => setTurno(e.target.value as '' | 'manana' | 'tarde')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="manana">Mañana (7-15)</option>
                <option value="tarde">Tarde (15-23)</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sesionesQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : cerradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay sesiones cerradas en el rango seleccionado. Ampliá las fechas si esperabas ver alguna.
            </p>
          ) : (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="whitespace-nowrap px-3 py-2 text-left">Caja</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Abrió</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Cerró</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">Apertura</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => setOrdenDesc((v) => !v)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      title={
                        ordenDesc
                          ? 'Más nueva arriba (click para invertir)'
                          : 'Más vieja arriba (click para invertir)'
                      }
                    >
                      Cierre
                      {ordenDesc ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronUp className="h-3 w-3" />
                      )}
                    </button>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Total cobrado</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Ventas</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Ticket prom.</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {cerradas.map((s) => (
                  <FilaSesionCerrada
                    key={s.id}
                    sesion={s}
                    cajaNombre={cajaNombre(s.caja_id)}
                    empleadoAbrioNombre={empleadoNombre(s.empleado_id)}
                    empleadoCerroNombre={empleadoNombre(
                      s.empleado_actual_id ?? s.empleado_id,
                    )}
                    onVerDetalle={() => setSesionDetalle(s)}
                    onEditar={
                      puedeEditarSesiones ? () => setSesionEditar(s) : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detalle de sesión: ventas + movimientos + arqueo */}
      <Dialog
        open={!!sesionDetalle}
        onOpenChange={(v) => !v && setSesionDetalle(null)}
        className="max-w-3xl"
      >
        {sesionDetalle && (
          <DetalleSesion
            sesion={sesionDetalle}
            cajaNombre={cajaNombre(sesionDetalle.caja_id)}
            empleadoAbrioNombre={empleadoNombre(sesionDetalle.empleado_id)}
            empleadoNombre={empleadoNombre(
              sesionDetalle.empleado_actual_id ?? sesionDetalle.empleado_id,
            )}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setSesionDetalle(null)}>
            Cerrar
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Modal de edición reservado al dev de Pragma. Se monta solo
          cuando puedeEditarSesiones=true, para que un admin normal ni
          siquiera pueda instanciarlo desde devtools. */}
      {puedeEditarSesiones && (
        <Dialog
          open={!!sesionEditar}
          onOpenChange={(v) => !v && setSesionEditar(null)}
          className="max-w-md"
        >
          {sesionEditar && (
            <DialogEditarSesion
              sesion={sesionEditar}
              empleados={empleadosQ.data ?? []}
              cajas={cajasQ.data ?? []}
              empleadoLogueadoId={empleadoLogueado?.id ?? ''}
              onCerrar={() => setSesionEditar(null)}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}

/**
 * Modal reservado al dev de Pragma. Permite corregir el empleado que
 * abrió, el empleado responsable actual, y la caja/local de una sesión;
 * y forzar el cierre de sesiones que quedaron abiertas por olvido.
 * Todo lo hecho acá se lo audita con accion='dev_editar_sesion' o
 * 'dev_forzar_cierre_sesion' para que quede rastro.
 */
function DialogEditarSesion({
  sesion,
  empleados,
  cajas,
  empleadoLogueadoId,
  onCerrar,
}: {
  sesion: SesionCaja;
  empleados: { id: string; nombre: string; apellido: string; activo: boolean }[];
  cajas: { id: string; nombre: string; local_id: string }[];
  empleadoLogueadoId: string;
  onCerrar: () => void;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const [empleadoId, setEmpleadoId] = useState(sesion.empleado_id);
  const [empleadoActualId, setEmpleadoActualId] = useState(
    sesion.empleado_actual_id ?? sesion.empleado_id,
  );
  const [cajaId, setCajaId] = useState(sesion.caja_id);
  const [saldoInicialTxt, setSaldoInicialTxt] = useState(
    String(sesion.saldo_inicial ?? 0),
  );
  const [saldoFinalDeclaradoTxt, setSaldoFinalDeclaradoTxt] = useState(
    sesion.saldo_final_declarado != null
      ? String(sesion.saldo_final_declarado)
      : '',
  );
  const empleadosOrdenados = [...empleados]
    .filter((e) => e.activo || e.id === sesion.empleado_id || e.id === sesion.empleado_actual_id)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const editarMut = useMutation({
    mutationFn: async () => {
      if (!db.sesionesCaja.editarSesion) {
        throw new Error('El repo no soporta editarSesion');
      }
      const patch: {
        empleado_id?: string;
        empleado_actual_id?: string;
        caja_id?: string;
        saldo_inicial?: number;
        saldo_final_declarado?: number | null;
      } = {};
      if (empleadoId !== sesion.empleado_id) patch.empleado_id = empleadoId;
      const actualOriginal = sesion.empleado_actual_id ?? sesion.empleado_id;
      if (empleadoActualId !== actualOriginal) {
        patch.empleado_actual_id = empleadoActualId;
      }
      if (cajaId !== sesion.caja_id) patch.caja_id = cajaId;
      const saldoInicialNum = parseFloat(saldoInicialTxt);
      if (
        Number.isFinite(saldoInicialNum) &&
        saldoInicialNum >= 0 &&
        Math.abs(saldoInicialNum - sesion.saldo_inicial) > 0.001
      ) {
        patch.saldo_inicial = saldoInicialNum;
      }
      // Saldo final: string vacío → guardamos null (sesión sin declaración).
      // Con valor → parse a number.
      const sfTrim = saldoFinalDeclaradoTxt.trim();
      const sfOriginal = sesion.saldo_final_declarado ?? null;
      if (sfTrim === '' && sfOriginal !== null) {
        patch.saldo_final_declarado = null;
      } else if (sfTrim !== '') {
        const sfNum = parseFloat(sfTrim);
        if (
          Number.isFinite(sfNum) &&
          sfNum >= 0 &&
          (sfOriginal === null || Math.abs(sfNum - sfOriginal) > 0.001)
        ) {
          patch.saldo_final_declarado = sfNum;
        }
      }
      if (Object.keys(patch).length === 0) return;
      await db.sesionesCaja.editarSesion(sesion.id, patch);
      await db.auditoria.log({
        empleado_id: empleadoLogueadoId,
        accion: 'dev_editar_sesion',
        entidad: 'sesion_caja',
        entidad_id: sesion.id,
        detalle: { antes: sesion, patch },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sesiones-caja-todas'] });
      toast.success('Sesión corregida');
      onCerrar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const forzarMut = useMutation({
    mutationFn: async () => {
      if (!db.sesionesCaja.forzarCierre) {
        throw new Error('El repo no soporta forzarCierre');
      }
      await db.sesionesCaja.forzarCierre(sesion.id);
      await db.auditoria.log({
        empleado_id: empleadoLogueadoId,
        accion: 'dev_forzar_cierre_sesion',
        entidad: 'sesion_caja',
        entidad_id: sesion.id,
        detalle: { sesion },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sesiones-caja-todas'] });
      toast.success('Sesión cerrada a la fuerza');
      onCerrar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: async () => {
      if (!db.sesionesCaja.eliminar) {
        throw new Error('El repo no soporta eliminar sesión');
      }
      // Log ANTES de eliminar — sino se borra la fila y no queda rastro.
      await db.auditoria.log({
        empleado_id: empleadoLogueadoId,
        accion: 'dev_eliminar_sesion',
        entidad: 'sesion_caja',
        entidad_id: sesion.id,
        detalle: { sesion },
      });
      const r = await db.sesionesCaja.eliminar(sesion.id);
      return r;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sesiones-caja-todas'] });
      toast.success(
        `Sesión eliminada (${r.ventas} venta(s), ${r.movimientos_caja} mov. de caja)`,
      );
      onCerrar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const abierta = sesion.estado === 'abierta';
  const saldoInicialCambio = (() => {
    const n = parseFloat(saldoInicialTxt);
    return Number.isFinite(n) && Math.abs(n - sesion.saldo_inicial) > 0.001;
  })();
  const saldoFinalCambio = (() => {
    const t = saldoFinalDeclaradoTxt.trim();
    const orig = sesion.saldo_final_declarado ?? null;
    if (t === '') return orig !== null;
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return false;
    return orig === null || Math.abs(n - orig) > 0.001;
  })();
  const cambios =
    empleadoId !== sesion.empleado_id ||
    empleadoActualId !== (sesion.empleado_actual_id ?? sesion.empleado_id) ||
    cajaId !== sesion.caja_id ||
    saldoInicialCambio ||
    saldoFinalCambio;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-blue-700" />
            Editar sesión (dev)
          </span>
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2 text-sm">
        <p className="rounded-md bg-blue-50 p-2 text-xs text-blue-900">
          Acción reservada al desarrollador. Todo lo que edites queda
          registrado en auditoría con tu email.
        </p>
        <div>
          <Label className="mb-1 block text-xs">Empleado que ABRIÓ</Label>
          <select
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {empleadosOrdenados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} {e.apellido}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs">
            Empleado ACTUAL / que cerró
          </Label>
          <select
            value={empleadoActualId}
            onChange={(e) => setEmpleadoActualId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {empleadosOrdenados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} {e.apellido}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs">Caja / local</Label>
          <select
            value={cajaId}
            onChange={(e) => setCajaId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        {/* Editar saldos: el saldo inicial siempre se puede editar; el
            saldo declarado por el cajero al cerrar solo se muestra si la
            sesión está cerrada (o si Pragma quiere setearlo en una que
            todavía no cerró — raro pero se permite). Toda edición queda
            auditada con el estado ANTES en el detalle del log. */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-1 block text-xs">Saldo inicial ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={saldoInicialTxt}
              onChange={(e) => setSaldoInicialTxt(e.target.value)}
              className="h-9 tabular-nums"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">
              Declarado al cerrar ($)
            </Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={saldoFinalDeclaradoTxt}
              onChange={(e) => setSaldoFinalDeclaradoTxt(e.target.value)}
              placeholder={abierta ? '(sesión abierta)' : 'sin declarar'}
              className="h-9 tabular-nums"
            />
          </div>
        </div>
        {abierta && (
          <div className="rounded-md border border-orange-200 bg-orange-50 p-2 text-xs">
            <div className="mb-1 font-medium text-orange-900">
              Sesión abierta
            </div>
            <p className="mb-2 text-orange-900/90">
              Si el cajero se fue sin cerrar la caja, podés forzar el
              cierre. Queda cerrada sin saldo declarado.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (
                  confirm(
                    '¿Forzar el cierre de esta sesión? No se pide arqueo — se cierra tal como está.',
                  )
                ) {
                  forzarMut.mutate();
                }
              }}
              disabled={forzarMut.isPending}
              className="border-orange-300 text-orange-800 hover:bg-orange-100"
            >
              <LockKeyhole className="mr-2 h-4 w-4" />
              {forzarMut.isPending ? 'Cerrando…' : 'Forzar cierre'}
            </Button>
          </div>
        )}
        {/* Eliminar sesión — reservado a Pragma para limpiar pruebas.
            Borra la sesión + sus ventas + movs de caja + movs de stock.
            Operación irreversible. */}
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs">
          <div className="mb-1 font-medium text-red-900">
            Eliminar sesión (irreversible)
          </div>
          <p className="mb-2 text-red-900/90">
            Borra la sesión y TODO lo asociado: ventas, movimientos de caja
            y movimientos de stock generados por esas ventas. Usar solo
            para limpiar sesiones de prueba.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const ok1 = confirm(
                'Vas a ELIMINAR la sesión y todo lo asociado (ventas, movimientos de caja y stock). Es IRREVERSIBLE. ¿Continuar?',
              );
              if (!ok1) return;
              const ok2 = confirm(
                '¿Estás totalmente seguro? Esta operación NO se puede deshacer.',
              );
              if (!ok2) return;
              eliminarMut.mutate();
            }}
            disabled={eliminarMut.isPending}
            className="border-red-400 text-red-800 hover:bg-red-100"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {eliminarMut.isPending ? 'Eliminando…' : 'Eliminar sesión'}
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button
          onClick={() => editarMut.mutate()}
          disabled={!cambios || editarMut.isPending}
        >
          {editarMut.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </DialogFooter>
    </>
  );
}

function DetalleSesion({
  sesion,
  cajaNombre,
  empleadoNombre,
  empleadoAbrioNombre,
}: {
  sesion: SesionCaja;
  cajaNombre: string;
  /** Empleado responsable actual / que cerró (empleado_actual_id). */
  empleadoNombre: string;
  /** Empleado que abrió la sesión originalmente (empleado_id). */
  empleadoAbrioNombre: string;
}) {
  const db = getDb();
  // Ventas de la sesión + movimientos de caja en paralelo.
  const ventasQ = useQuery({
    queryKey: ['detalle-sesion-ventas', sesion.id],
    queryFn: () => db.ventas.list({ sesion_caja_id: sesion.id }),
  });
  const movsQ = useQuery({
    queryKey: ['detalle-sesion-movs', sesion.id],
    queryFn: () => db.sesionesCaja.movimientos(sesion.id),
  });
  // Catálogo para mostrar código + nombre de cada producto vendido.
  const productosQ = useQuery({
    queryKey: ['productos-all-cierre-admin'],
    queryFn: () => db.productos.list(),
  });
  // Auditoría de la sesión — buscamos si el cierre fue FORZADO por el
  // dev de Pragma (accion='dev_forzar_cierre_sesion'). Si sí, badge
  // naranja en el arqueo para que Agus lo distinga de un cierre normal.
  const auditoriaQ = useQuery({
    queryKey: ['auditoria-sesion', sesion.id],
    queryFn: async () => {
      const todos = await db.auditoria.list({ entidad: 'sesion_caja' });
      return todos.filter((l) => l.entidad_id === sesion.id);
    },
  });
  const forzadoLog = (auditoriaQ.data ?? []).find(
    (l) => l.accion === 'dev_forzar_cierre_sesion',
  );
  // Cuando el cierre fue forzado desde el admin, el "Cerrada por" real
  // es quien accionó desde el admin (Agus/Pragma), no el último cajero
  // que estaba en la sesión (empleado_actual_id). Buscamos el nombre
  // en el log de auditoría del forzado.
  const empleadosLookupQ = useQuery({
    queryKey: ['empleados-lookup-cierre'],
    queryFn: () => db.empleados.list(),
  });
  const empleadoForzoNombre = (() => {
    if (!forzadoLog?.empleado_id) return null;
    const e = empleadosLookupQ.data?.find(
      (x) => x.id === forzadoLog.empleado_id,
    );
    return e ? `${e.nombre} ${e.apellido ?? ''}`.trim() : null;
  })();

  const ventas = (ventasQ.data ?? []) as Venta[];
  const ventasCompletadas = ventas.filter((v) => v.estado === 'completada');
  const ventasAnuladas = ventas.filter((v) => v.estado === 'anulada');
  const totalVentas = ventasCompletadas.reduce((acc, v) => acc + v.total, 0);

  // Totales por método de pago (solo ventas completadas).
  const porMetodo = new Map<MetodoPago, number>();
  for (const v of ventasCompletadas) {
    for (const p of v.pagos) {
      porMetodo.set(p.metodo, (porMetodo.get(p.metodo) ?? 0) + p.monto);
    }
  }

  // Arqueo — Turisteando: Agus retira el efectivo del turno y el cajero
  // solo deja el saldo inicial. Ver comentario largo en FilaSesionCerrada.
  // El arqueo se compara contra saldo_inicial, no contra
  // (saldo_inicial + cobrado).
  const declarado = sesion.saldo_final_declarado ?? 0;
  const dif = declarado - sesion.saldo_inicial;
  const cerrada = sesion.estado === 'cerrada';

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Caja {cajaNombre} · {empleadoNombre}
        </DialogTitle>
      </DialogHeader>

      {/* Cabecera con tiempos */}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Apertura</div>
          <div className="font-medium">{formatDate(sesion.abierta_en)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Cierre</div>
          <div className="font-medium">
            {sesion.cerrada_en ? (
              formatDate(sesion.cerrada_en)
            ) : (
              <Badge variant="secondary">Abierta ahora</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Ventas del turno */}
      <div className="mt-3">
        <div className="mb-2 text-sm font-medium">
          Ventas del turno ({ventasCompletadas.length} completadas
          {ventasAnuladas.length > 0 && ` · ${ventasAnuladas.length} anuladas`})
        </div>
        {ventasQ.isLoading ? (
          <Skeleton className="h-24" />
        ) : ventas.length === 0 ? (
          <p className="rounded border border-dashed py-4 text-center text-xs text-muted-foreground">
            Sin ventas en este turno.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Código</th>
                  <th className="px-2 py-1.5 text-left">Producto</th>
                  <th className="px-2 py-1.5 text-right">Cant.</th>
                  <th className="px-2 py-1.5 text-right">Precio</th>
                  <th className="px-2 py-1.5 text-right">Subtotal</th>
                  <th className="px-2 py-1.5 text-left">Pago</th>
                  <th className="px-2 py-1.5 text-left">Hora</th>
                </tr>
              </thead>
              <tbody>
                {/* Vista producto×producto del turno: una fila por ítem
                    vendido. Items de la misma venta se bandean visualmente
                    para distinguir tickets. Sin columna "Ticket" — el
                    cliente no la consulta acá. */}
                {ventas.map((v, vIdx) => {
                  const ms = Array.from(new Set(v.pagos.map((p) => p.metodo)));
                  const metodoLabel = ms.length > 1 ? 'Mixto' : ms[0] ?? '—';
                  const anulada = v.estado === 'anulada';
                  const banda = vIdx % 2 === 0 ? '' : 'bg-slate-50/70';
                  const horaTxt = new Date(v.fecha).toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  // Solo mostramos la fila de "Total venta" cuando la venta
                  // tiene 2+ ítems. Con 1 solo, el subtotal ya ES el total.
                  const mostrarTotalVenta = v.items.length > 1;
                  const filas = v.items.map((it, idx) => {
                    const p = (productosQ.data ?? []).find((x) => x.id === it.producto_id);
                    const esPrimera = idx === 0;
                    const subtotal = it.subtotal ?? it.precio_unitario * it.cantidad;
                    return (
                      <tr
                        key={`${v.id}-${idx}`}
                        className={`border-t border-border/50 ${banda} ${
                          esPrimera ? 'border-t-2 border-t-foreground/20' : ''
                        } ${anulada ? 'bg-red-50/40 opacity-60' : ''}`}
                      >
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {p?.codigo_interno ?? '—'}
                        </td>
                        <td className={`px-2 py-1 ${anulada ? 'line-through' : ''}`}>
                          {p?.nombre ?? 'Producto borrado'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{it.cantidad}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {formatCurrency(it.precio_unitario)}
                        </td>
                        <td className="px-2 py-1 text-right font-medium tabular-nums">
                          {formatCurrency(subtotal)}
                        </td>
                        <td className="px-2 py-1 text-xs">{metodoLabel}</td>
                        <td className="px-2 py-1 text-xs">{esPrimera ? horaTxt : ''}</td>
                      </tr>
                    );
                  });
                  if (mostrarTotalVenta) {
                    filas.push(
                      <tr
                        key={`${v.id}-total`}
                        className={`${banda} ${anulada ? 'opacity-60' : ''}`}
                      >
                        <td
                          colSpan={4}
                          className="px-2 py-1 text-right text-xs font-medium uppercase tracking-wider text-slate-600"
                        >
                          Total venta
                        </td>
                        <td className="px-2 py-1 text-right text-sm font-bold tabular-nums text-emerald-700">
                          {formatCurrency(v.total)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>,
                    );
                  }
                  return filas;
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-emerald-800">
            Total facturado del turno
          </span>
          <span className="text-xl font-bold tabular-nums text-emerald-700">
            {formatCurrency(totalVentas)}
          </span>
        </div>
      </div>

      {/* Desglose por método (solo si hay) */}
      {porMetodo.size > 0 && (
        <div className="mt-3">
          <div className="mb-2 text-sm font-medium">Cobrado por método</div>
          <div className="grid grid-cols-2 gap-1 rounded-md border p-2 text-sm sm:grid-cols-3">
            {METODOS.filter((m) => porMetodo.has(m)).map((m) => (
              <div
                key={m}
                className="flex items-center justify-between rounded px-2 py-1"
              >
                <span className="text-xs capitalize text-muted-foreground">
                  {m}
                </span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(porMetodo.get(m) ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cambios de responsable durante el turno (feature "Cambiar usuario"
          del PoS). Solo se lista si hubo al menos uno. Antes esta sección
          era el listado de movimientos manuales de caja — se sacó porque
          Agus lo consideraba ruido: los ingresos/egresos ya se reflejan
          en el arqueo, no hace falta verlos línea por línea. */}
      <CambiosResponsable sesionId={sesion.id} />

      {/* Arqueo final */}
      <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Arqueo de efectivo
        </div>
        <div className="mt-2 grid grid-cols-2 gap-y-1">
          <span className="text-muted-foreground">Saldo inicial</span>
          <span className="text-right tabular-nums">
            {formatCurrency(sesion.saldo_inicial)}
          </span>
          {/* Sacamos "Movimientos en efectivo: +XXX" por pedido de Agus —
              aparecía con el `+` justo debajo del saldo inicial y daba la
              impresión visual de que el sistema sumaba el cobrado al
              inicial. En Turisteando el dueño retira el efectivo cobrado
              durante el turno y el cajero deja SOLO el saldo inicial. El
              arqueo compara declarado vs saldo_inicial, nada más. Si hace
              falta ver cuánto se cobró en efectivo, ya está arriba en
              "Cobrado por método > Efectivo". */}
          {/* Sacamos "Debería quedar en caja" por pedido del cliente —
              es redundante (siempre es igual al saldo inicial). */}
          {/* Quién abrió + quién cerró — la sesión puede haber cambiado
              de responsable en el medio (feature Tomar posta) y Agus
              necesita ver ambos claramente. */}
          <span className="text-muted-foreground">Abierta por</span>
          <span className="text-right font-medium">{empleadoAbrioNombre}</span>
          {cerrada && (
            <>
              <span className="text-muted-foreground">Cerrada por</span>
              <span className="text-right">
                {/* Si fue cierre forzado desde admin, mostramos QUIÉN lo
                    forzó (Agus/Pragma) — antes decía el último cajero de
                    la sesión, que no era quien realmente la cerró. */}
                <span className="font-medium">
                  {forzadoLog && empleadoForzoNombre
                    ? empleadoForzoNombre
                    : empleadoNombre}
                </span>
                {forzadoLog && (
                  <span className="ml-1.5 inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-orange-800">
                    Cierre forzado
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">Declarado por cajero</span>
              <span className="text-right tabular-nums">
                {formatCurrency(declarado)}
              </span>
              {/* Sacamos "Sobró/Faltó/Cuadró exacto" por pedido del
                  cliente. La info sigue disponible en el resaltado
                  visual de la fila cerrada en la tabla principal. */}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function FilaSesionCerrada({
  sesion,
  cajaNombre,
  empleadoAbrioNombre,
  empleadoCerroNombre,
  onVerDetalle,
  onEditar,
}: {
  sesion: SesionCaja;
  cajaNombre: string;
  /** Empleado que ABRIÓ la sesión (empleado_id original, no cambia). */
  empleadoAbrioNombre: string;
  /** Empleado responsable al momento del cierre (empleado_actual_id
   *  al cerrar; puede ser el mismo que abrió si no hubo relevo). */
  empleadoCerroNombre: string;
  onVerDetalle: () => void;
  onEditar?: () => void;
}) {
  const db = getDb();
  // Traemos movimientos de la sesión para calcular el efectivo del turno.
  // Las sesiones ya cerradas no cambian, así que cache largo.
  const movsQ = useQuery({
    queryKey: ['movs-caja-cerrada', sesion.id],
    queryFn: () => db.sesionesCaja.movimientos(sesion.id),
    staleTime: 5 * 60 * 1000,
  });

  // Agus pidió reemplazar Inicial / Cobrado efect. / Declarado por info
  // más útil para el día a día: total cobrado del turno (todos los
  // métodos netos de anulaciones) + cantidad de ventas + ticket promedio.
  // El arqueo sigue disponible al abrir el detalle de la sesión.
  let totalCobrado = 0;
  const ventaIds = new Set<string>();
  for (const m of (movsQ.data ?? []) as MovimientoCaja[]) {
    if (m.tipo === 'venta') {
      totalCobrado += m.monto;
      if (m.venta_id) ventaIds.add(m.venta_id);
    } else if (m.tipo === 'anulacion') {
      totalCobrado -= m.monto;
    }
  }
  const cantVentas = ventaIds.size;
  const ticketPromedio = cantVentas > 0 ? totalCobrado / cantVentas : 0;

  // Arqueo — se mantiene el resaltado de fila (rojo / naranja) como señal
  // visual pero las columnas ya no muestran los números del arqueo (van
  // en el detalle). Regla: diferencia = declarado − saldo_inicial.
  const declarado = sesion.saldo_final_declarado ?? 0;
  const dif = declarado - sesion.saldo_inicial;
  const cargando = movsQ.isLoading;

  // La columna Diferencia se sacó por pedido del cliente, pero el
  // resaltado de fila se conserva como señal visual (rojo faltó,
  // naranja sobró) para que el dueño detecte al toque cuáles revisar.
  let claseFila = '';
  if (!cargando && Math.abs(dif) >= 0.01) {
    claseFila =
      dif < 0
        ? 'bg-red-50/60 dark:bg-red-950/20'
        : 'bg-orange-50/60 dark:bg-orange-950/20';
  }

  return (
    <tr
      className={`cursor-pointer border-b last:border-0 hover:bg-muted/40 ${claseFila}`}
      onClick={onVerDetalle}
    >
      <td className="whitespace-nowrap px-3 py-2">{cajaNombre}</td>
      <td className="whitespace-nowrap px-3 py-2">{empleadoAbrioNombre}</td>
      <td className="whitespace-nowrap px-3 py-2">{empleadoCerroNombre}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {formatDate(sesion.abierta_en)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {sesion.cerrada_en ? formatDate(sesion.cerrada_en) : '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
        {cargando ? '…' : formatCurrency(totalCobrado)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {cargando ? '…' : cantVentas.toLocaleString('es-AR')}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
        {cargando ? '…' : cantVentas > 0 ? formatCurrency(Math.round(ticketPromedio)) : '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <Eye className="inline h-4 w-4 text-muted-foreground" />
          {onEditar && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditar();
              }}
              className="rounded p-1 text-blue-700 hover:bg-blue-50"
              title="Editar sesión (dev Pragma)"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Lista de cambios de responsable durante la sesión (logs de auditoría
 * con accion='cambio_responsable_caja'). Muestra hora + empleado que tomó
 * la posta. Si no hubo cambios, no renderiza nada (el turno lo llevó una
 * sola persona).
 */
function CambiosResponsable({ sesionId }: { sesionId: string }) {
  const db = getDb();
  // El filtro del repo solo acepta entidad (no accion ni entidad_id),
  // así que traemos todos los logs de sesion_caja y filtramos en cliente.
  const cambiosQ = useQuery({
    queryKey: ['cambios-responsable', sesionId],
    queryFn: async () => {
      const todos = await db.auditoria.list({ entidad: 'sesion_caja' });
      return todos.filter(
        (l) => l.accion === 'cambio_responsable_caja' && l.entidad_id === sesionId,
      );
    },
  });
  const empleadosQ = useQuery({
    queryKey: ['empleados-cambios'],
    queryFn: () => db.empleados.list(),
  });
  const cambios = cambiosQ.data ?? [];
  if (cambios.length === 0) return null;
  function nombre(id: string | undefined) {
    if (!id) return '—';
    const e = empleadosQ.data?.find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido ?? ''}`.trim() : '—';
  }
  return (
    <div className="mt-3">
      <div className="mb-2 text-sm font-medium">
        Cambios de responsable ({cambios.length})
      </div>
      <div className="rounded-md border">
        {cambios
          .slice()
          .sort((a, b) => a.fecha.localeCompare(b.fecha))
          .map((c) => {
            const d = (c.detalle ?? {}) as Record<string, unknown>;
            const anteriorId = typeof d.empleado_anterior_id === 'string'
              ? d.empleado_anterior_id
              : undefined;
            const nuevoId = typeof d.empleado_nuevo_id === 'string'
              ? d.empleado_nuevo_id
              : undefined;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between border-t px-3 py-1.5 text-xs first:border-t-0"
              >
                <span>
                  <span className="text-muted-foreground">{nombre(anteriorId)}</span>
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  <span className="font-medium">{nombre(nuevoId)}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {new Date(c.fecha).toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function SesionCard({
  sesion,
  cajaNombre,
  empleadoNombre,
  empleadoOriginalNombre,
  onVerDetalle,
  onEditar,
}: {
  sesion: SesionCaja;
  cajaNombre: string;
  empleadoNombre: string;
  /** Si hubo cambio de responsable, quién había abierto originalmente.
   *  Se muestra como aclaración chica al lado del responsable actual. */
  empleadoOriginalNombre?: string;
  onVerDetalle: () => void;
  onEditar?: () => void;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const movsQ = useQuery({
    queryKey: ['movs-caja-admin', sesion.id],
    queryFn: () => db.sesionesCaja.movimientos(sesion.id),
    refetchInterval: 5_000,
  });
  // Otras sesiones abiertas en la misma caja física (multi-sesión iter-2).
  // Se muestran como aviso en el modal de cierre para que el admin sepa
  // que al confirmar va a cerrar TODAS de una.
  const otrasEnCajaQ = useQuery({
    queryKey: ['otras-sesiones-caja', sesion.caja_id, sesion.id],
    queryFn: async () => {
      const todas = await db.sesionesCaja.list({ caja_id: sesion.caja_id });
      return todas.filter(
        (s) => s.estado === 'abierta' && s.id !== sesion.id,
      );
    },
    refetchInterval: 10_000,
  });
  const otrasCount = otrasEnCajaQ.data?.length ?? 0;

  const totales = METODOS.reduce(
    (acc, m) => ({ ...acc, [m]: 0 }),
    {} as Record<MetodoPago, number>,
  );
  for (const m of (movsQ.data ?? []) as MovimientoCaja[]) {
    const signo = m.tipo === 'egreso' || m.tipo === 'retiro' || m.tipo === 'anulacion' ? -1 : 1;
    totales[m.metodo] += signo * m.monto;
  }
  const totalIngresos = Object.values(totales).reduce((a, b) => a + b, 0);
  const efectivoEsperado = sesion.saldo_inicial + totales.efectivo;

  // Estado del modal de cierre. El admin puede cerrar cualquier caja abierta,
  // por ejemplo cuando el cajero se olvidó de cerrarla. Pedimos confirmación
  // y un monto declarado (pre-llenado con el efectivo esperado).
  const [cerrarOpen, setCerrarOpen] = useState(false);
  const [saldoFinal, setSaldoFinal] = useState('');

  const cerrarMut = useMutation({
    mutationFn: async () => {
      const monto = parseFloat(saldoFinal);
      if (Number.isNaN(monto) || monto < 0) {
        throw new Error('Ingresá un monto válido para el efectivo declarado.');
      }
      const cerrada = await db.sesionesCaja.cerrar(sesion.id, monto);
      // Multi-sesión: cerrar TODAS las otras sesiones abiertas en la
      // misma caja física (mismo criterio que en el PoS). La caja física
      // es una, el efectivo declarado es uno solo; las otras sesiones
      // quedan con saldo_final_declarado=null.
      let otrasCerradas = 0;
      if (db.sesionesCaja.cerrarOtrasSesionesEnCaja) {
        otrasCerradas = await db.sesionesCaja
          .cerrarOtrasSesionesEnCaja(sesion.caja_id, sesion.id)
          .catch(() => 0);
      }
      return { cerrada, otrasCerradas };
    },
    onSuccess: (r) => {
      if (r.otrasCerradas > 0) {
        toast.success(
          `Caja "${cajaNombre}" cerrada. Además ${r.otrasCerradas} ${
            r.otrasCerradas === 1 ? 'sesión' : 'sesiones'
          } de otros cajeros en la misma caja.`,
        );
      } else {
        toast.success(`Caja "${cajaNombre}" cerrada`);
      }
      setCerrarOpen(false);
      qc.invalidateQueries({ queryKey: ['sesiones-caja-todas'] });
    },
    onError: (e: Error) => {
      // Cierre idempotente: si otro cerró primero, mostrar como info
      // amigable y refrescar la vista. Para todo otro error, rojo.
      if (e.name === 'SesionYaCerrada') {
        toast.info(e.message);
        setCerrarOpen(false);
        qc.invalidateQueries({ queryKey: ['sesiones-caja-todas'] });
      } else {
        toast.error(e.message);
      }
    },
  });

  function abrirDialog() {
    setSaldoFinal(efectivoEsperado.toString());
    setCerrarOpen(true);
  }

  // "Sobró para retirar" — usamos la misma lógica que el PoS al cerrar caja
  // (iter-6). El cajero al cierre se lleva el efectivo cobrado y deja SOLO
  // el saldo inicial como cambio para el próximo turno. Fórmula:
  //   sobranteRetiro = declarado - saldo_inicial
  //   - Positivo: retira ese monto, quedan saldo_inicial en caja. OK.
  //   - Cero: dejó exactamente lo que abrió, retiró todo el efectivo. Perfecto.
  //   - Negativo: cerró con menos que el inicial, algo raro (revisar).
  // Se ignora el "efectivo esperado" a propósito — antes marcaba rojo
  // cuando el cajero declaraba $15k con esperado $184k, pero era normal
  // (se llevó los $169k cobrados). Info engañosa.
  const sobranteRetiroPreview =
    saldoFinal && !Number.isNaN(parseFloat(saldoFinal))
      ? parseFloat(saldoFinal) - sesion.saldo_inicial
      : 0;
  const diferenciaPreview =
    saldoFinal && !Number.isNaN(parseFloat(saldoFinal))
      ? parseFloat(saldoFinal) - efectivoEsperado
      : 0;

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="font-medium">{cajaNombre}</span>
            <Badge variant="secondary">abierta</Badge>
          </div>
          <div className="mt-1 text-sm">
            {empleadoNombre}
            {empleadoOriginalNombre && (
              <span className="ml-1 text-xs text-muted-foreground">
                (abrió {empleadoOriginalNombre})
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Abierta: {formatDate(sesion.abierta_en)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total ingresos</div>
          <div className="font-semibold tabular-nums">{formatCurrency(totalIngresos)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
        {METODOS.map((m) => (
          <div key={m} className="flex justify-between">
            <span className="text-muted-foreground capitalize">{m.replace('_', ' ')}</span>
            <span className="tabular-nums">{formatCurrency(totales[m])}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t pt-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Saldo inicial</span>
          <span className="tabular-nums">{formatCurrency(sesion.saldo_inicial)}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Efectivo esperado en caja</span>
          <span className="tabular-nums">{formatCurrency(efectivoEsperado)}</span>
        </div>
      </div>

      <div className="mt-3 border-t pt-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={onVerDetalle}
        >
          <Eye className="mr-2 h-4 w-4" />
          Ver detalle
        </Button>
        <RequierePermiso modulo="caja" accion="cerrar">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={abrirDialog}
          >
            <Lock className="mr-2 h-4 w-4" />
            Cerrar caja
          </Button>
        </RequierePermiso>
        {onEditar && (
          <Button
            variant="outline"
            size="sm"
            onClick={onEditar}
            className="text-blue-700"
            title="Corregir datos de la sesión o forzar cierre (dev Pragma)"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={cerrarOpen} onOpenChange={setCerrarOpen}>
        <DialogHeader>
          <DialogTitle>¿Cerrar la caja de {cajaNombre}?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Esta acción cierra la sesión abierta de <b>{empleadoNombre}</b>. El
            cajero no podrá seguir vendiendo en esta caja hasta volver a abrirla.
          </p>
          {otrasCount > 0 && (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠ También se van a cerrar <b>{otrasCount}</b>{' '}
              {otrasCount === 1 ? 'sesión' : 'sesiones'} de{' '}
              otros cajeros en esta misma caja (multi-sesión). El efectivo
              declarado que ingreses cuenta para el arqueo consolidado.
            </div>
          )}
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted/40 p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saldo inicial</span>
              <span className="tabular-nums">{formatCurrency(sesion.saldo_inicial)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Efectivo del turno</span>
              <span className="tabular-nums">{formatCurrency(totales.efectivo)}</span>
            </div>
            <div className="flex justify-between font-medium border-t pt-1">
              <span>Efectivo esperado</span>
              <span className="tabular-nums">{formatCurrency(efectivoEsperado)}</span>
            </div>
          </div>

          <div>
            <Label htmlFor={`saldo-${sesion.id}`}>Efectivo declarado en caja</Label>
            <Input
              id={`saldo-${sesion.id}`}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={saldoFinal}
              onChange={(e) => setSaldoFinal(e.target.value)}
              className="mt-1"
              autoFocus
            />
            {saldoFinal && !Number.isNaN(parseFloat(saldoFinal)) && (
              <div className="mt-1 space-y-0.5 text-xs">
                {/* KPI principal: sobró para retirar (declarado - saldo_inicial).
                    Es lo que el cajero se lleva del turno; el saldo inicial
                    queda como cambio para el próximo. */}
                {sobranteRetiroPreview > 0.01 ? (
                  <p className="tabular-nums text-blue-800">
                    Sobró para retirar: {formatCurrency(sobranteRetiroPreview)}{' '}
                    · quedan {formatCurrency(sesion.saldo_inicial)} como cambio.
                  </p>
                ) : sobranteRetiroPreview < -0.01 ? (
                  <p className="tabular-nums text-destructive">
                    Cierra con menos que el saldo inicial ({formatCurrency(
                      Math.abs(sobranteRetiroPreview),
                    )}
                    ). Revisá antes de confirmar.
                  </p>
                ) : (
                  <p className="tabular-nums text-emerald-700">
                    Deja exactamente el saldo inicial. Perfecto.
                  </p>
                )}
                {/* Arqueo: sólo mostramos si el declarado difiere del
                    esperado (o sea, cobró efectivo que no se llevó, o sobró
                    plata sin ventas). No es un error grave, solo aviso. */}
                {Math.abs(diferenciaPreview) >= 0.01 &&
                  Math.abs(diferenciaPreview - -totales.efectivo) >= 0.01 && (
                    <p
                      className={`tabular-nums ${
                        diferenciaPreview > 0
                          ? 'text-orange-600'
                          : 'text-muted-foreground'
                      }`}
                    >
                      Arqueo respecto al esperado: {formatCurrency(diferenciaPreview)}
                    </p>
                  )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCerrarOpen(false)}
            disabled={cerrarMut.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => cerrarMut.mutate()}
            disabled={cerrarMut.isPending}
          >
            {cerrarMut.isPending ? 'Cerrando…' : 'Sí, cerrar la caja'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

export default function CajasPage() {
  return (
    <PaginaProtegida modulo="caja" accion="ver_propia">
      <CajasPageInner />
    </PaginaProtegida>
  );
}
