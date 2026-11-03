import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { BRAND } from '@comercio/business';
import { useSesion } from '@/stores/sesion';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency } from '@comercio/ui/utils';

export function AbrirCaja() {
  const db = getDb();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const empleado = useSesion((s) => s.empleado);
  const setCaja = useSesion((s) => s.setCaja);
  const setSesionCaja = useSesion((s) => s.setSesionCaja);
  const logout = useSesion((s) => s.logout);

  const [cajaId, setCajaId] = useState<string>('');
  const [saldoInicial, setSaldoInicial] = useState<string>('0');

  const cajasQ = useQuery({
    queryKey: ['cajas-pos', empleado?.local_id],
    queryFn: () => db.cajas.list(empleado?.local_id),
    enabled: !!empleado,
  });

  useEffect(() => {
    if (cajasQ.data && cajasQ.data.length > 0 && !cajaId) {
      setCajaId(cajasQ.data[0]!.id);
    }
  }, [cajasQ.data, cajaId]);

  // Todas las sesiones (cualquier empleado) de la caja seleccionada.
  // Con la regla "una sesión por caja" solo debería haber máximo 1
  // abierta; la usamos para decidir el flujo (libre / tuya / ajena).
  const sesionesQ = useQuery({
    queryKey: ['sesiones-abiertas-caja', cajaId],
    queryFn: () => db.sesionesCaja.list({ caja_id: cajaId }),
    enabled: !!cajaId,
  });
  const empleadosQ = useQuery({
    queryKey: ['empleados-pos'],
    queryFn: () => db.empleados.list(),
    enabled: !!empleado,
  });

  const sesionAbiertaEnCaja =
    (sesionesQ.data ?? []).find((s) => s.estado === 'abierta') ?? null;
  // Última sesión cerrada de esta caja física con arqueo declarado.
  // Sirve para sugerir "el turno anterior dejó $X" al abrir un turno
  // nuevo: por ejemplo mañana cierra con $10.000, tarde entra y arranca
  // sugerido en $10.000. Descartamos las que quedaron con
  // saldo_final_declarado null (típicamente cierres forzados por el
  // dev) porque no aportan info real de cuánto quedó físicamente.
  const ultimaCerradaConDeclarado = (sesionesQ.data ?? [])
    .filter((s) => s.estado === 'cerrada' && s.saldo_final_declarado != null)
    .sort((a, b) => (b.cerrada_en ?? '').localeCompare(a.cerrada_en ?? ''))[0];
  const saldoSugerido = ultimaCerradaConDeclarado?.saldo_final_declarado ?? null;
  const cajeroCierreAnteriorNombre = ultimaCerradaConDeclarado
    ? (() => {
        const respId =
          ultimaCerradaConDeclarado.empleado_actual_id ??
          ultimaCerradaConDeclarado.empleado_id;
        const e = empleadosQ.data?.find((x) => x.id === respId);
        return e ? `${e.nombre} ${e.apellido ?? ''}`.trim() : null;
      })()
    : null;
  // Fecha + hora del último cierre en formato corto para el banner. Con
  // multi-sesión + relevos, el "último cierre" no siempre es el turno
  // literalmente anterior de este cajero — mostrarlo evita la confusión
  // de "yo cerré con X, ¿por qué sale otro monto?".
  const cerradaEnFormato = ultimaCerradaConDeclarado?.cerrada_en
    ? new Date(ultimaCerradaConDeclarado.cerrada_en).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const responsableActualId =
    sesionAbiertaEnCaja?.empleado_actual_id ?? sesionAbiertaEnCaja?.empleado_id;
  const esTuya =
    !!sesionAbiertaEnCaja && responsableActualId === empleado?.id;
  const esAjena =
    !!sesionAbiertaEnCaja && responsableActualId !== empleado?.id;
  // ¿La sesión ajena se abrió otro día? Comparamos por fecha calendario
  // en zona local. Si es del mismo día, es un relevo normal (típico
  // cambio de turno mañana→tarde). Si es de otro día, hubo un olvido
  // de cierre del turno anterior — mostramos un banner más notorio y
  // un copy sin jerga.
  const esDeOtroDia =
    !!sesionAbiertaEnCaja &&
    new Date(sesionAbiertaEnCaja.abierta_en).toDateString() !==
      new Date().toDateString();

  const dueño = sesionAbiertaEnCaja
    ? empleadosQ.data?.find((e) => e.id === responsableActualId)
    : null;
  const dueñoNombre = dueño
    ? `${dueño.nombre} ${dueño.apellido ?? ''}`.trim()
    : 'otro cajero';

  // Pre-llenar el saldo si la sesión es del mismo empleado (para poder
  // corregirlo si quedó mal cargado al abrir originalmente).
  useEffect(() => {
    if (esTuya && sesionAbiertaEnCaja) {
      setSaldoInicial(String(sesionAbiertaEnCaja.saldo_inicial));
    }
  }, [esTuya, sesionAbiertaEnCaja]);

  // Cuando la caja está LIBRE (sin sesión abierta) y hay un cierre
  // anterior con arqueo declarado, sugerimos ese monto como saldo
  // inicial — "lo que dejó el turno anterior". Reemplaza al sistema
  // viejo que arrancaba siempre en 0 y obligaba a recordar de memoria
  // lo que había en la caja. El cajero igual puede sobreescribirlo si
  // el conteo físico da distinto.
  //
  // Piso el input solo cuando cambia la caja o llega/cambia la data
  // de sesiones. Si el cajero después edita, se respeta hasta que
  // vuelva a cambiar la caja.
  useEffect(() => {
    if (!sesionAbiertaEnCaja && saldoSugerido != null) {
      setSaldoInicial(String(saldoSugerido));
    }
  }, [cajaId, sesionAbiertaEnCaja, saldoSugerido]);

  const abrirMut = useMutation({
    mutationFn: async () => {
      if (!empleado) throw new Error('No hay empleado');
      const caja = cajasQ.data?.find((c) => c.id === cajaId);
      if (!caja) throw new Error('Elegí una caja');
      const monto = parseFloat(saldoInicial) || 0;

      // Refrescamos por si otro empleado abrió esta caja entre que se
      // renderizó la pantalla y el click. Regla dura: una sesión por caja.
      const abiertaAhora = (await db.sesionesCaja.list({ caja_id: caja.id })).find(
        (s) => s.estado === 'abierta',
      );
      let sesion;
      if (abiertaAhora) {
        const respId = abiertaAhora.empleado_actual_id ?? abiertaAhora.empleado_id;
        if (respId !== empleado.id) {
          throw new Error(
            `La caja ya está abierta por ${dueñoNombre}. Refrescá y tomá la posta.`,
          );
        }
        // Es tuya: si cambió el saldo, corregilo en BD.
        if (
          monto !== abiertaAhora.saldo_inicial &&
          db.sesionesCaja.actualizarSaldoInicial
        ) {
          sesion = await db.sesionesCaja.actualizarSaldoInicial(abiertaAhora.id, monto);
          toast.success('Saldo inicial actualizado');
        } else {
          sesion = abiertaAhora;
        }
      } else {
        sesion = await db.sesionesCaja.abrir({
          caja_id: caja.id,
          empleado_id: empleado.id,
          saldo_inicial: monto,
        });
      }
      setCaja(caja);
      setSesionCaja(sesion);
      return sesion;
    },
    onSuccess: () => {
      toast.success('Caja abierta');
      navigate('/caja');
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ['sesiones-abiertas-caja', cajaId] });
    },
  });

  // "Tomar posta": la caja está abierta por otro empleado. Le cambiamos
  // el responsable actual a nosotros (mediante cambiarResponsable) y
  // entramos a /caja con la sesión existente — sin tocar saldo_inicial
  // ni cerrar/reabrir. Sirve para relevo de turno: Diego cierra a las
  // 15h dejando la caja abierta, Franco entra y toma la posta a las
  // 15:01.
  const tomarPostaMut = useMutation({
    mutationFn: async () => {
      if (!empleado) throw new Error('No hay empleado');
      if (!sesionAbiertaEnCaja) throw new Error('No hay sesión abierta');
      const caja = cajasQ.data?.find((c) => c.id === cajaId);
      if (!caja) throw new Error('Caja no encontrada');
      if (!db.sesionesCaja.cambiarResponsable) {
        throw new Error('El repo no soporta cambiar responsable');
      }
      const actualizada = await db.sesionesCaja.cambiarResponsable(
        sesionAbiertaEnCaja.id,
        empleado.id,
      );
      // Audit: quién tomó la posta y a quién relevó.
      await db.auditoria
        .log({
          empleado_id: empleado.id,
          accion: 'cambio_responsable_caja',
          entidad: 'sesion_caja',
          entidad_id: sesionAbiertaEnCaja.id,
          detalle: {
            empleado_anterior_id: responsableActualId,
            empleado_nuevo_id: empleado.id,
            empleado_nuevo_nombre: `${empleado.nombre} ${empleado.apellido ?? ''}`.trim(),
            desde: 'abrir_caja',
          },
        })
        .catch(() => {});
      setCaja(caja);
      setSesionCaja(actualizada);
      return actualizada;
    },
    onSuccess: () => {
      toast.success('Tomaste la posta de la caja');
      navigate('/caja');
    },
    onError: (e: Error) => {
      toast.error(e.message);
      // La sesión pudo haber sido cerrada (o forzada) entre que se
      // renderizó la pantalla y el click. Refetch para que el cajero
      // vea el estado real (probablemente "caja libre") y pueda abrir
      // normal en vez de quedar trabado.
      qc.invalidateQueries({ queryKey: ['sesiones-abiertas-caja', cajaId] });
    },
  });

  if (!empleado) return null;

  const cargandoEstadoCaja = !!cajaId && sesionesQ.isLoading;

  return (
    <main className="container mx-auto max-w-xl px-4 py-12">
      <div className="mb-6 text-center">
        <div className="text-sm font-medium tracking-tight text-muted-foreground">
          {BRAND.nombreCorto}
        </div>
        <h1 className="text-2xl font-semibold">Apertura de caja</h1>
        <p className="text-sm text-muted-foreground">
          Hola <span className="font-medium">{empleado.nombre}</span>, elegí sobre
          qué caja vas a trabajar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de apertura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block">Caja</Label>
            {cajasQ.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (cajasQ.data?.length ?? 0) === 0 ? (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                No hay cajas asignadas a tu local. Pedile al admin que te asigne una.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {cajasQ.data!.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCajaId(c.id)}
                    className={`rounded border p-3 text-left text-sm transition ${
                      c.id === cajaId
                        ? 'border-primary bg-primary/5'
                        : 'border-input hover:bg-accent'
                    }`}
                  >
                    {c.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Estado de la caja seleccionada. La lógica ahora es dura:
              una sola sesión por caja. Si otro empleado la tiene abierta,
              este empleado NO puede abrir otra — solo tomar la posta. */}
          {cargandoEstadoCaja && <Skeleton className="h-24 w-full" />}

          {!cargandoEstadoCaja && esAjena && sesionAbiertaEnCaja && (
            <div
              className={`rounded-md border p-3 text-sm ${
                esDeOtroDia
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-blue-300 bg-blue-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <Users
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                    esDeOtroDia ? 'text-orange-700' : 'text-blue-700'
                  }`}
                />
                <div className="flex-1">
                  <div
                    className={`font-medium ${
                      esDeOtroDia ? 'text-orange-900' : 'text-blue-900'
                    }`}
                  >
                    {esDeOtroDia
                      ? 'El turno anterior no cerró la caja'
                      : `Caja abierta por ${dueñoNombre}`}
                  </div>
                  <div
                    className={`mt-1 grid grid-cols-2 gap-y-0.5 text-xs ${
                      esDeOtroDia ? 'text-orange-900/90' : 'text-blue-900/90'
                    }`}
                  >
                    {esDeOtroDia && (
                      <>
                        <span>Cajero anterior:</span>
                        <span className="text-right">{dueñoNombre}</span>
                      </>
                    )}
                    <span>Apertura:</span>
                    <span className="text-right tabular-nums">
                      {new Date(sesionAbiertaEnCaja.abierta_en).toLocaleString('es-AR')}
                    </span>
                    <span>Saldo inicial declarado:</span>
                    <span className="text-right tabular-nums">
                      {formatCurrency(sesionAbiertaEnCaja.saldo_inicial)}
                    </span>
                  </div>
                  <p
                    className={`mt-2 text-xs ${
                      esDeOtroDia ? 'text-orange-900/90' : 'text-blue-900/90'
                    }`}
                  >
                    {esDeOtroDia
                      ? 'Podés continuar sobre la misma caja tocando "Continuar mi turno" (el saldo inicial no se toca) o avisale a Agus para que la revise antes.'
                      : 'Si vas a atender vos, tocá "Continuar mi turno" — quedás como responsable de la caja y las ventas siguen sobre la misma sesión (el saldo inicial no se toca).'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!cargandoEstadoCaja && !esAjena && (
            <div>
              <Label htmlFor="saldo" className="mb-2 block">
                {esTuya
                  ? 'Saldo inicial (podés corregirlo si quedó mal)'
                  : 'Saldo inicial (efectivo en caja)'}
              </Label>
              {/* Banner sugerencia: aparece solo cuando la caja está libre
                  y hay un cierre anterior con arqueo declarado. */}
              {!esTuya && saldoSugerido != null && (
                <div className="mb-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
                  <div className="font-medium">
                    Último cierre:{' '}
                    <span className="tabular-nums">
                      {formatCurrency(saldoSugerido)}
                    </span>
                    {cajeroCierreAnteriorNombre && (
                      <> · por <span className="font-normal">{cajeroCierreAnteriorNombre}</span></>
                    )}
                    {cerradaEnFormato && (
                      <> · <span className="font-normal">{cerradaEnFormato}</span></>
                    )}
                  </div>
                  <div className="mt-0.5 text-emerald-800/90">
                    Cargamos ese monto como saldo inicial. Ajustalo si el
                    conteo físico da distinto.
                  </div>
                </div>
              )}
              <Input
                id="saldo"
                type="number"
                inputMode="numeric"
                min="0"
                step="any"
                value={saldoInicial}
                onChange={(e) => setSaldoInicial(e.target.value)}
                // BUG histórico: con step="100" + type="number", un scroll
                // accidental sobre el input enfocado o una flecha ↑/↓
                // del teclado cambiaba el valor de a 100 sin que el cajero
                // lo notara → "el sistema me restó 100" cada tanto.
                // Bloqueamos ambos disparadores.
                onWheel={(e) => e.currentTarget.blur()}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                  }
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCurrency(parseFloat(saldoInicial) || 0)}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Cambiar usuario
            </Button>
            {esAjena ? (
              <Button
                className="flex-1"
                disabled={!cajaId || tomarPostaMut.isPending}
                onClick={() => tomarPostaMut.mutate()}
              >
                {tomarPostaMut.isPending
                  ? 'Continuando…'
                  : 'Continuar mi turno'}
              </Button>
            ) : (
              <Button
                className="flex-1"
                disabled={!cajaId || abrirMut.isPending || cargandoEstadoCaja}
                onClick={() => abrirMut.mutate()}
              >
                {abrirMut.isPending
                  ? 'Abriendo…'
                  : esTuya
                    ? 'Continuar mi caja'
                    : 'Abrir caja'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
