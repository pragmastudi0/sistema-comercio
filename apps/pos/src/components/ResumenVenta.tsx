import { useState } from 'react';
import { Tag, Banknote, Layers } from 'lucide-react';
import {
  calcularBaseVenta,
  calcularDescuentoGlobal,
  calcularSubtotal,
  useVenta,
} from '@/stores/venta';
import { useSesion } from '@/stores/sesion';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { formatCurrency } from '@comercio/ui/utils';
import { SHORTCUT_LABELS } from '@/lib/shortcuts';
import type { MetodoPago } from '@comercio/db';
// VentasDelDia ya no se incluye acá; se renderiza como columna separada en Caja.tsx.

type Props = {
  onCobrar: (metodo?: MetodoPago) => void;
  onCancelar: () => void;
};

export function ResumenVenta({ onCobrar, onCancelar }: Props) {
  const items = useVenta((s) => s.items);
  const descuentoModo = useVenta((s) => s.descuentoModo);
  const descuentoValor = useVenta((s) => s.descuentoValor);
  const motivoDescuento = useVenta((s) => s.motivoDescuento);
  const setDescuento = useVenta((s) => s.setDescuento);
  const limpiarDescuento = useVenta((s) => s.limpiarDescuento);

  const subtotal = calcularSubtotal(items);
  const descuentoGlobal = calcularDescuentoGlobal(subtotal, descuentoModo, descuentoValor);
  const baseVenta = calcularBaseVenta(items, descuentoModo, descuentoValor);
  const cant = items.reduce((acc, i) => acc + i.cantidad, 0);

  const empleado = useSesion((s) => s.empleado);
  const caja = useSesion((s) => s.caja);
  const sesion = useSesion((s) => s.sesionCaja);

  const [editDto, setEditDto] = useState(false);
  const hayItems = items.length > 0;

  return (
    <div className="flex h-full flex-col bg-muted/30">
      {/* Header súper compacto: la info ya está en el header global de Caja.tsx;
          acá solo dejamos un recordatorio mínimo en 1 línea. */}
      <div className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        {empleado?.nombre} {empleado?.apellido} · {caja?.nombre} · #{sesion?.id.slice(-6)} · Consumidor final
      </div>

      {/* Bloque de números compacto */}
      <div className="border-b px-3 py-2 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Items</span>
          <span>{cant}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        {descuentoValor > 0 && (
          <div className="flex justify-between text-green-700">
            <span>
              Descuento {descuentoModo === 'pct' ? `${descuentoValor}%` : 'monto fijo'}
            </span>
            <span>-{formatCurrency(descuentoGlobal)}</span>
          </div>
        )}
      </div>

      {/* Descuento (botón colapsado o form abierto) */}
      <div className="border-b p-3">
        {editDto ? (
          <div className="space-y-2 rounded-md border bg-background p-2">
            <div className="flex items-stretch gap-1">
              <Button
                size="sm"
                variant={descuentoModo === 'pct' ? 'default' : 'outline'}
                onClick={() => setDescuento('pct', descuentoValor, motivoDescuento)}
                className="h-9 w-10 shrink-0 px-0 text-base font-semibold"
                title="Porcentaje"
              >
                %
              </Button>
              <Button
                size="sm"
                variant={descuentoModo === 'monto' ? 'default' : 'outline'}
                onClick={() => setDescuento('monto', descuentoValor, motivoDescuento)}
                className="h-9 w-10 shrink-0 px-0 text-base font-semibold"
                title="Monto fijo"
              >
                $
              </Button>
              <Input
                type="number"
                min="0"
                max={descuentoModo === 'pct' ? 100 : subtotal}
                value={descuentoValor || ''}
                placeholder={descuentoModo === 'pct' ? '%' : 'monto'}
                onChange={(e) =>
                  setDescuento(descuentoModo, parseFloat(e.target.value) || 0, motivoDescuento)
                }
                onFocus={(e) => e.currentTarget.select()}
                autoFocus
                className="h-9 flex-1 text-right text-base"
              />
            </div>
            <Input
              value={motivoDescuento ?? ''}
              onChange={(e) => setDescuento(descuentoModo, descuentoValor, e.target.value)}
              placeholder="Motivo (queda en auditoría)"
              className="h-8 text-xs"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  limpiarDescuento();
                  setEditDto(false);
                }}
                className="h-8 flex-1 text-xs"
              >
                Quitar
              </Button>
              <Button size="sm" onClick={() => setEditDto(false)} className="h-8 flex-1 text-xs">
                Aplicar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full"
            onClick={() => setEditDto(true)}
            disabled={!hayItems}
          >
            <Tag className="mr-1 h-3 w-3" />
            {descuentoValor > 0
              ? descuentoModo === 'pct'
                ? `Descuento ${descuentoValor}%`
                : `Descuento ${formatCurrency(descuentoValor)}`
              : 'Agregar descuento'}
          </Button>
        )}
      </div>

      {/* Total a cobrar (tamaño normal). NO absorbe espacio sobrante. */}
      <div className="px-3 py-3">
        <div className="text-[10px] uppercase text-muted-foreground">Total a cobrar</div>
        <div className="text-3xl font-bold leading-tight tabular-nums">
          {formatCurrency(baseVenta)}
        </div>
        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
          Recargos/descuentos por forma de pago se aplican al elegir el método.
        </p>
      </div>

      {/* Spacer flexible: absorbe todo el espacio sobrante para que el
          footer (cobro + cancelar) quede pegado al fondo del aside. */}
      <div className="min-h-0 flex-1" />

      <div className="border-t bg-background p-3">
        {/* Botón principal Cobrar (default efectivo, adentro podés cambiar)
            + Pago mixto secundario para sumar varios métodos. Reemplaza
            los tres botones viejos (Efectivo / Tarjeta / QR) que confundían
            cuando había que mezclar pagos. */}
        <div className="mb-2 grid grid-cols-[2fr_1fr] gap-2">
          <Button
            size="lg"
            disabled={!hayItems}
            onClick={() => onCobrar('efectivo')}
            className="flex h-auto items-center justify-center gap-2 px-3 py-3 text-base font-semibold"
          >
            <Banknote className="h-5 w-5" />
            Cobrar
          </Button>
          <Button
            size="lg"
            disabled={!hayItems}
            onClick={() => onCobrar()}
            variant="secondary"
            className="flex h-auto items-center justify-center gap-2 px-2 py-3 text-sm font-medium"
            title="Sumar varios métodos de pago (efectivo + tarjeta, etc.)"
          >
            <Layers className="h-4 w-4" />
            Pago mixto
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-destructive"
          disabled={!hayItems}
          onClick={onCancelar}
        >
          Cancelar venta · {SHORTCUT_LABELS.cancelar}
        </Button>
      </div>
    </div>
  );
}
