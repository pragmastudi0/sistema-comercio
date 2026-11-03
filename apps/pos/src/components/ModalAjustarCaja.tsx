import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { Dialog, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { formatCurrency } from '@comercio/ui/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Modo = 'ingreso' | 'egreso' | 'corregir';

/**
 * Dialog de ajuste de caja durante la sesión. Los TRES modos ahora
 * ajustan el saldo_inicial (no crean movimientos de caja):
 *  - Ingreso: suma un delta al saldo inicial.
 *  - Egreso: resta un delta al saldo inicial.
 *  - Corregir total: setea el saldo inicial al monto real declarado
 *    (por la diferencia con el efectivo esperado actual).
 *
 * Motivo del cambio (pedido de Agus): los cajeros usan ingreso/egreso
 * cuando en realidad quieren corregir el saldo con el que abrieron (no
 * para registrar entradas/salidas de plata reales durante el turno).
 * Antes esos modos generaban movimientos de caja que hacían pensar que
 * había habido cobros o retiros reales. Ahora todo ajusta saldo_inicial
 * y el arqueo del cierre sale correcto sin distorsiones.
 *
 * Toda operación queda registrada en auditoría con motivo, empleado
 * y valores antes/después.
 */
export function ModalAjustarCaja({ open, onOpenChange }: Props) {
  const db = getDb();
  const qc = useQueryClient();
  const sesion = useSesion((s) => s.sesionCaja);
  const empleado = useSesion((s) => s.empleado);
  const setSesionCaja = useSesion((s) => s.setSesionCaja);

  const [modo, setModo] = useState<Modo>('ingreso');
  const [monto, setMonto] = useState('');
  const [montoReal, setMontoReal] = useState('');
  const [motivo, setMotivo] = useState('');

  // Movimientos de la sesión para calcular el efectivo esperado actual
  // (usado en modo "Corregir total"). Refresca al abrir el modal.
  const movsQ = useQuery({
    queryKey: ['movimientos-sesion', sesion?.id],
    queryFn: () => (sesion ? db.sesionesCaja.movimientos(sesion.id) : Promise.resolve([])),
    enabled: !!sesion && open,
  });

  const efectivoEsperado = (() => {
    if (!sesion) return 0;
    let neto = 0;
    for (const m of movsQ.data ?? []) {
      if (m.metodo !== 'efectivo') continue;
      const signo = m.tipo === 'egreso' || m.tipo === 'retiro' || m.tipo === 'anulacion' ? -1 : 1;
      neto += signo * m.monto;
    }
    return sesion.saldo_inicial + neto;
  })();

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setMonto('');
      setMontoReal('');
      setMotivo('');
      setModo('ingreso');
    }
  }, [open]);

  // En modo "corregir", pre-llenar el input con el esperado (para que la
  // cajera vea de qué número partir y solo modifique lo necesario).
  useEffect(() => {
    if (modo === 'corregir' && open) {
      setMontoReal(String(efectivoEsperado.toFixed(2)));
    }
  }, [modo, open, efectivoEsperado]);

  const ajustarMut = useMutation({
    mutationFn: async () => {
      if (!sesion || !empleado) throw new Error('Sin sesión activa');
      if (!motivo.trim()) throw new Error('Indicá un motivo');

      // Los TRES modos ajustan saldo_inicial (no crean movimientos).
      // Calculamos el delta según el modo:
      //   - ingreso: +monto
      //   - egreso:  -monto
      //   - corregir: real - efectivo esperado
      if (!db.sesionesCaja.actualizarSaldoInicial) {
        throw new Error('No se puede corregir el saldo en este modo');
      }
      let delta = 0;
      let detalleExtra: Record<string, unknown> = {};
      if (modo === 'corregir') {
        const real = parseFloat(montoReal);
        if (!Number.isFinite(real) || real < 0) throw new Error('Monto real inválido');
        delta = real - efectivoEsperado;
        detalleExtra = { esperado_previo: efectivoEsperado, real_declarado: real };
      } else {
        const n = parseFloat(monto);
        if (!Number.isFinite(n) || n <= 0) throw new Error('Monto inválido');
        delta = modo === 'ingreso' ? n : -n;
      }
      if (Math.abs(delta) < 0.01) {
        throw new Error('El monto coincide con el esperado, no hace falta ajustar');
      }
      const nuevoSaldoInicial = sesion.saldo_inicial + delta;
      if (nuevoSaldoInicial < 0) {
        throw new Error('El saldo inicial no puede quedar negativo');
      }
      const sesionActualizada = await db.sesionesCaja.actualizarSaldoInicial(
        sesion.id,
        nuevoSaldoInicial,
      );
      setSesionCaja(sesionActualizada);
      await db.auditoria
        .log({
          accion: 'ajuste_saldo_inicial',
          entidad: 'sesion_caja',
          entidad_id: sesion.id,
          empleado_id: empleado.id,
          detalle: {
            modo,
            saldo_anterior: sesion.saldo_inicial,
            saldo_nuevo: nuevoSaldoInicial,
            delta,
            motivo: motivo.trim(),
            ...detalleExtra,
          },
        })
        .catch(() => {});
      return { modo, delta };
    },
    onSuccess: (r) => {
      const signo = r.delta > 0 ? '+' : '−';
      toast.success(
        `Saldo inicial ajustado (${signo}$${Math.abs(r.delta).toLocaleString('es-AR')})`,
      );
      qc.invalidateQueries({ queryKey: ['movimientos-sesion', sesion?.id] });
      setMonto('');
      setMontoReal('');
      setMotivo('');
      setModo('ingreso');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Para modo "corregir": preview del delta calculado
  const realN = parseFloat(montoReal);
  const deltaPreview =
    modo === 'corregir' && Number.isFinite(realN) ? realN - efectivoEsperado : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Ajustar saldo inicial de caja</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Corrige el saldo con el que se abrió la caja. Los tres modos
          actualizan el saldo inicial (no registran cobros ni gastos del
          turno). Queda en auditoría con tu nombre y el motivo.
        </p>
      </DialogHeader>

      <div className="space-y-3">
        {/* Selector de modo */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => setModo('ingreso')}
            className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-xs font-medium transition ${
              modo === 'ingreso'
                ? 'border-green-600 bg-green-50 text-green-800'
                : 'border-input hover:bg-accent'
            }`}
          >
            <ArrowDownToLine className="h-4 w-4" />
            Ingreso
          </button>
          <button
            type="button"
            onClick={() => setModo('egreso')}
            className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-xs font-medium transition ${
              modo === 'egreso'
                ? 'border-orange-600 bg-orange-50 text-orange-800'
                : 'border-input hover:bg-accent'
            }`}
          >
            <ArrowUpFromLine className="h-4 w-4" />
            Egreso
          </button>
          <button
            type="button"
            onClick={() => setModo('corregir')}
            className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-xs font-medium transition ${
              modo === 'corregir'
                ? 'border-blue-600 bg-blue-50 text-blue-800'
                : 'border-input hover:bg-accent'
            }`}
          >
            <Wallet className="h-4 w-4" />
            Corregir total
          </button>
        </div>

        {/* Modo INGRESO / EGRESO: input de monto + motivo */}
        {(modo === 'ingreso' || modo === 'egreso') && (
          <>
            <div>
              <Label className="mb-1 block text-sm">Monto</Label>
              <Input
                type="number"
                inputMode="numeric"
                step="any"
                min="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="0"
                className="text-right text-lg"
                autoFocus
                // Bloquear scroll/flechas — ver AbrirCaja para contexto.
                onWheel={(e) => e.currentTarget.blur()}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                  }
                }}
              />
            </div>
            <div>
              <Label className="mb-1 block text-sm">Motivo</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder={
                  modo === 'ingreso'
                    ? 'Ej: Corrección saldo apertura, cambio chico'
                    : 'Ej: Pago proveedor, sacar para cambio, etc.'
                }
              />
            </div>
          </>
        )}

        {/* Modo CORREGIR: muestra esperado + input monto real + preview delta */}
        {modo === 'corregir' && (
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase text-muted-foreground">
                  Efectivo esperado en caja
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(efectivoEsperado)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Calculado del saldo inicial + ventas en efectivo − retiros.
              </p>
            </div>

            <div>
              <Label className="mb-1 block text-sm">Monto real que hay en caja</Label>
              <Input
                type="number"
                inputMode="numeric"
                step="any"
                min="0"
                value={montoReal}
                onChange={(e) => setMontoReal(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="text-right text-lg"
                autoFocus
                // Bloquear scroll/flechas — ver AbrirCaja para contexto.
                onWheel={(e) => e.currentTarget.blur()}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                  }
                }}
              />
              {Number.isFinite(realN) && Math.abs(deltaPreview) >= 0.01 && (
                <div
                  className={`mt-1.5 rounded p-2 text-sm font-medium ${
                    deltaPreview > 0
                      ? 'bg-green-50 text-green-800'
                      : 'bg-orange-50 text-orange-800'
                  }`}
                >
                  El saldo inicial pasa de{' '}
                  <b>{formatCurrency(sesion?.saldo_inicial ?? 0)}</b> a{' '}
                  <b>{formatCurrency((sesion?.saldo_inicial ?? 0) + deltaPreview)}</b>{' '}
                  ({deltaPreview > 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(deltaPreview))}). Queda como
                  saldo inicial de la sesión.
                </div>
              )}
            </div>

            <div>
              <Label className="mb-1 block text-sm">Motivo</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: Saldo apertura mal cargado, conteo de caja"
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={ajustarMut.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => ajustarMut.mutate()}
            disabled={
              ajustarMut.isPending ||
              !motivo.trim() ||
              (modo === 'corregir'
                ? !Number.isFinite(realN) || Math.abs(deltaPreview) < 0.01
                : !monto)
            }
          >
            {ajustarMut.isPending ? 'Guardando…' : 'Confirmar ajuste'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
