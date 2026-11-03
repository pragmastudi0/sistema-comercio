import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, Trash2, AlertTriangle, Tag, Gift } from 'lucide-react';
import { unidadesCobradasNxM } from '@comercio/business';
import { getDb } from '@/lib/db';
import { useDepositoActivo } from '@/lib/deposito-activo';
import { useVenta, type ItemCarrito, calcularSubtotalLinea } from '@/stores/venta';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { formatCurrency } from '@comercio/ui/utils';

export function ItemCarritoRow({ item }: { item: ItemCarrito }) {
  const db = getDb();
  const setCantidad = useVenta((s) => s.setCantidad);
  const setPrecio = useVenta((s) => s.setPrecio);
  const setDescuento = useVenta((s) => s.setDescuentoLinea);
  const setMotivoDescuentoLinea = useVenta((s) => s.setMotivoDescuentoLinea);
  const quitar = useVenta((s) => s.quitar);
  const seleccionar = useVenta((s) => s.seleccionar);
  const seleccionado = useVenta((s) => s.seleccionadoId === item.producto.id);

  const { depositoId } = useDepositoActivo();
  // Traemos el stock por TODOS los depósitos del producto. Así el cajero ve
  // si hay stock en otro lugar (Central o el otro local) cuando le falta
  // en el suyo, y puede pedir una transferencia.
  const stocksQ = useQuery({
    queryKey: ['stock-prod', item.producto.id],
    queryFn: () => db.stock.porProducto(item.producto.id),
  });
  const depositosQ = useQuery({
    queryKey: ['depositos-pos'],
    queryFn: () => db.depositos.list(),
  });

  // Promos del producto — se aplican ANTES del descuento por línea.
  // Solo una activa a la vez (NxM o combo N x $).
  const promoNxm =
    item.producto.promo_tipo === 'nxm' &&
    item.producto.promo_nxm_lleva != null &&
    item.producto.promo_nxm_paga != null
      ? {
          lleva: item.producto.promo_nxm_lleva,
          paga: item.producto.promo_nxm_paga,
        }
      : null;
  const promoCombo =
    item.producto.promo_tipo === 'combo' &&
    item.producto.promo_combo_cantidad != null &&
    item.producto.promo_combo_precio != null
      ? {
          cantidad: item.producto.promo_combo_cantidad,
          precio: item.producto.promo_combo_precio,
        }
      : null;
  const unidadesCobradas = promoNxm
    ? unidadesCobradasNxM(item.cantidad, promoNxm.lleva, promoNxm.paga)
    : item.cantidad;
  const unidadesGratis = item.cantidad - unidadesCobradas;
  // Para el pill de combo: cuántos packs completos entran y cuántas sueltas.
  const comboPacks = promoCombo
    ? Math.floor(item.cantidad / promoCombo.cantidad)
    : 0;
  const comboSueltas = promoCombo ? item.cantidad % promoCombo.cantidad : 0;
  const faltanParaCombo = promoCombo
    ? promoCombo.cantidad - (item.cantidad % promoCombo.cantidad)
    : 0;
  // Subtotal delegado al store para tener UNA sola fuente de verdad —
  // el ModalCobro suma con el mismo calcularSubtotal, así visual y cobro
  // no pueden desalinearse.
  const subtotal = calcularSubtotalLinea(item);
  const precioEditado = item.precio_unitario !== item.precio_base;

  // Input de precio: buffer local de string para que el cajero pueda
  // borrar todo el campo y tipear el nuevo sin que React fuerce un "0".
  // Sincroniza al store en onBlur (o al apretar Enter).
  const [precioTxt, setPrecioTxt] = useState<string>(String(item.precio_unitario));
  useEffect(() => {
    setPrecioTxt(String(item.precio_unitario));
  }, [item.precio_unitario]);
  function commitPrecio() {
    const v = precioTxt.replace(',', '.').trim();
    if (v === '') {
      setPrecio(item.producto.id, item.precio_base);
      return;
    }
    const n = parseFloat(v);
    if (isFinite(n) && n >= 0) setPrecio(item.producto.id, n);
    else setPrecioTxt(String(item.precio_unitario));
  }
  const stockEnMiDep = Number(
    stocksQ.data?.find((s) => s.deposito_id === depositoId)?.cantidad ?? 0,
  );
  const stockEnOtros = (stocksQ.data ?? [])
    .filter((s) => s.deposito_id !== depositoId && Number(s.cantidad) > 0)
    .map((s) => ({
      cantidad: Number(s.cantidad),
      nombre:
        depositosQ.data?.find((d) => d.id === s.deposito_id)?.nombre ?? 'otro depósito',
    }));
  const stockTrasVenta = stockEnMiDep - item.cantidad;
  const sinStockSuficiente = stockTrasVenta < 0;
  const totalEnOtros = stockEnOtros.reduce((acc, s) => acc + s.cantidad, 0);

  function cambiarDescuento(pct: number) {
    setDescuento(item.producto.id, pct > 0 ? pct : undefined);
  }

  // Si hubo descuento por línea, mostramos una sub-fila con un input de
  // motivo (obligatorio al cobrar). El cambio de precio en cambio ya no
  // pide motivo por pedido de Agus: queda auditado que hubo cambio y
  // cuánto, pero sin justificación explícita.
  const requiereMotivoDescuento = !!item.descuento_pct && item.descuento_pct > 0;
  const mostrarMotivos = requiereMotivoDescuento;

  return (
    <>
    <tr
      onClick={() => seleccionar(item.producto.id)}
      className={`cursor-pointer ${mostrarMotivos ? '' : 'border-b'} align-top last:border-0 ${
        seleccionado ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : 'hover:bg-muted/40'
      }`}
    >
      <td className="px-3 py-3 font-mono text-xs">{item.producto.codigo_interno}</td>
      <td className="px-3 py-3">
        <div className="font-medium">{item.producto.nombre}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          {/* Política Turisteando: el cajero NO debe ver cantidades de
              stock — sólo el aviso cualitativo de que hay en otro local
              cuando no alcanza acá. La venta nunca se bloquea por stock. */}
          {sinStockSuficiente && totalEnOtros > 0 && (
            <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              Hay en{' '}
              {stockEnOtros.map((s, i) => (
                <span key={s.nombre}>
                  {i > 0 ? ' / ' : ''}
                  <b>{s.nombre}</b>
                </span>
              ))}
            </span>
          )}
          {precioEditado && (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700">
              precio editado · base {formatCurrency(item.precio_base)}
            </span>
          )}
          {/* Precio mayorista aplicado: si la línea tiene escalas y la
              cantidad ya cruzó el umbral, mostramos una pill indigo. */}
          {(() => {
            const escalas = item.escalas ?? [];
            if (escalas.length < 2) return null;
            const escMayo = escalas.find((e) => e.desde > 1);
            if (!escMayo) return null;
            if (item.cantidad < escMayo.desde) return null;
            return (
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-800">
                Precio mayorista (desde {escMayo.desde}u)
              </span>
            );
          })()}
          {item.descuento_pct ? (
            <span className="flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-green-700">
              <Tag className="h-3 w-3" /> -{item.descuento_pct}%
            </span>
          ) : null}
          {promoNxm && unidadesGratis > 0 && (
            <span className="flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-800">
              <Gift className="h-3 w-3" /> {promoNxm.lleva}x{promoNxm.paga}
              {' · pagás '}
              {unidadesCobradas} de {item.cantidad}
              {' ('}
              {unidadesGratis} gratis{')'}
            </span>
          )}
          {promoNxm && unidadesGratis === 0 && item.cantidad > 0 && (
            <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700 ring-1 ring-inset ring-purple-200">
              {promoNxm.lleva}x{promoNxm.paga} — sumá{' '}
              {promoNxm.lleva - (item.cantidad % promoNxm.lleva)} para la promo
            </span>
          )}
          {promoCombo && comboPacks > 0 && (
            <span className="flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-800">
              <Gift className="h-3 w-3" /> {comboPacks}× combo {promoCombo.cantidad}×
              {formatCurrency(promoCombo.precio)}
              {comboSueltas > 0 && ` + ${comboSueltas} suelta${comboSueltas > 1 ? 's' : ''}`}
            </span>
          )}
          {promoCombo && comboPacks === 0 && item.cantidad > 0 && (
            <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700 ring-1 ring-inset ring-purple-200">
              Combo {promoCombo.cantidad}×{formatCurrency(promoCombo.precio)} — sumá{' '}
              {faltanParaCombo} para armar el combo
            </span>
          )}
          {/* Promo cargada por Agus desde /admin/productos. Texto siempre
              visible; si hay promo_pct > 0 y no está aplicado, botón
              "Aplicar X%" que setea descuento de esta línea con un click. */}
          {item.producto.promo_texto && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-800">
              {item.producto.promo_texto}
            </span>
          )}
          {item.producto.cuotas_sin_recargo && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">
              Cuotas sin recargo
            </span>
          )}
          {!!item.producto.promo_pct &&
            item.producto.promo_pct > 0 &&
            item.descuento_pct !== item.producto.promo_pct && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDescuento(item.producto.id, item.producto.promo_pct);
                }}
                className="rounded border border-purple-400 bg-white px-1.5 py-0.5 text-purple-800 hover:bg-purple-50"
                title="Aplicar el descuento sugerido por la promo"
              >
                Aplicar {item.producto.promo_pct}%
              </button>
            )}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-center gap-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setCantidad(item.producto.id, item.cantidad - 1)}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="number"
            min="1"
            value={item.cantidad}
            onChange={(e) =>
              setCantidad(item.producto.id, Math.max(1, parseInt(e.target.value) || 1))
            }
            className="h-8 w-14 text-center"
          />
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setCantidad(item.producto.id, item.cantidad + 1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </td>
      <td className="px-3 py-3 text-right">
        <Input
          type="text"
          inputMode="decimal"
          value={precioTxt}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setPrecioTxt(e.target.value)}
          onBlur={commitPrecio}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitPrecio();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setPrecioTxt(String(item.precio_unitario));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`h-8 w-24 text-right ${precioEditado ? 'border-orange-400 bg-orange-50' : ''}`}
        />
      </td>
      <td className="px-3 py-3 text-right">
        <Input
          type="number"
          min="0"
          max="100"
          step="1"
          value={item.descuento_pct ?? ''}
          placeholder="0"
          onChange={(e) => cambiarDescuento(parseFloat(e.target.value) || 0)}
          className="h-8 w-16 text-right"
        />
      </td>
      <td className="px-3 py-3 text-right font-medium tabular-nums">
        {formatCurrency(subtotal)}
      </td>
      <td className="px-3 py-3">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => quitar(item.producto.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>

    {/* Sub-fila con motivos: solo aparece si el cajero editó precio o
        aplicó descuento en esta línea. Sin motivo, el cobro se bloquea
        con un toast claro y el motivo queda en auditoría. */}
    {mostrarMotivos && (
      <tr
        className={`border-b align-top last:border-0 ${
          seleccionado ? 'bg-primary/10' : 'bg-muted/20'
        }`}
        onClick={() => seleccionar(item.producto.id)}
      >
        <td colSpan={7} className="px-3 pb-2 pt-0">
          <div className="flex flex-wrap gap-2 text-[11px]">
            {requiereMotivoDescuento && (
              <div className="flex flex-1 items-center gap-1.5 rounded border border-green-300 bg-green-50/60 px-2 py-1">
                <span className="font-medium text-green-800 whitespace-nowrap">
                  Motivo descuento {item.descuento_pct}%:
                </span>
                <Input
                  type="text"
                  value={item.motivo_descuento_linea ?? ''}
                  onChange={(e) => setMotivoDescuentoLinea(item.producto.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Ej: cliente frecuente, error de marcado"
                  className="h-6 flex-1 border-green-300 bg-white text-xs"
                />
              </div>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}
