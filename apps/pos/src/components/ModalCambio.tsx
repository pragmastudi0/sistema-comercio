import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  Minus,
  Plus,
  Search,
  Trash2,
  RefreshCw,
  Banknote,
  CreditCard,
  Smartphone,
} from 'lucide-react';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Badge } from '@comercio/ui/badge';
import { formatCurrency } from '@comercio/ui/utils';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { useDepositoActivo } from '@/lib/deposito-activo';
import { PRESET_IDS } from '@comercio/db';
import type { MetodoPago, Producto, Venta } from '@comercio/db';

const LISTA_CF_IDS = [PRESET_IDS.listas.consumidorFinal, 'lp_cf'];

/**
 * Modal de cambio de productos.
 *
 * Política Turisteando: NO se devuelve plata, solo se cambia el producto. Si
 * el cliente lleva uno más barato, pierde la diferencia.
 *
 * El cambio se ejecuta en 3 pasos:
 *   1. Emite una nota de crédito con los items que devuelve (vuelve el stock).
 *   2. Si lleva items nuevos, crea una venta nueva por esos items.
 *      - Si lo nuevo ≤ lo devuelto: descuento global = total nuevo (queda $0).
 *      - Si lo nuevo > lo devuelto: descuento global = total devuelto. La
 *        diferencia se cobra con el método que elija el cajero
 *        (efectivo / tarjeta / QR).
 *   3. El movimiento de caja por la diferencia se registra normalmente y
 *      queda etiquetado en auditoría como `cambio_venta` para que el admin
 *      pueda diferenciarlo de un ingreso normal.
 */
export function ModalCambio({
  venta,
  open,
  onOpenChange,
}: {
  venta: Venta;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const db = getDb();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const empleado = useSesion((s) => s.empleado);
  const caja = useSesion((s) => s.caja);
  const sesion = useSesion((s) => s.sesionCaja);
  const { depositoId } = useDepositoActivo();

  // Cantidades a devolver por item (key = producto_id).
  const [cantDevolver, setCantDevolver] = useState<Record<string, number>>({});
  // Items nuevos elegidos por el cajero.
  const [itemsNuevos, setItemsNuevos] = useState<
    { producto: Producto; cantidad: number; precio: number }[]
  >([]);
  // Buscador de items nuevos.
  const [q, setQ] = useState('');
  // Método de cobro de la diferencia (si la hay).
  const [metodoDiferencia, setMetodoDiferencia] = useState<MetodoPago>('efectivo');

  // Reset al abrir/cerrar.
  useEffect(() => {
    if (open) {
      setCantDevolver({});
      setItemsNuevos([]);
      setQ('');
      setMetodoDiferencia('efectivo');
    }
  }, [open, venta.id]);

  const productosQ = useQuery({
    queryKey: ['productos-all'],
    queryFn: () => db.productos.list(),
    enabled: open,
  });
  const productoPorId = (id: string) =>
    productosQ.data?.find((p) => p.id === id);

  const buscarQ = useQuery({
    queryKey: ['pos-cambio-buscar', q],
    queryFn: () => db.productos.buscarRapido(q, 200),
    enabled: open && q.trim().length > 0,
  });

  // Totales en vivo.
  const totalDevuelto = useMemo(() => {
    let t = 0;
    for (const it of venta.items) {
      const cant = cantDevolver[it.producto_id] ?? 0;
      // El precio efectivo del item ya tenía descuento si aplicaba.
      const unit = it.subtotal / it.cantidad;
      t += unit * cant;
    }
    return t;
  }, [cantDevolver, venta.items]);

  const totalNuevo = useMemo(
    () => itemsNuevos.reduce((acc, x) => acc + x.cantidad * x.precio, 0),
    [itemsNuevos],
  );

  const diferencia = totalNuevo - totalDevuelto; // positiva = el cliente paga
  const algoDevuelto = totalDevuelto > 0;
  const algoNuevo = itemsNuevos.length > 0;

  function setDevolver(productoId: string, cantidad: number, max: number) {
    setCantDevolver((prev) => ({
      ...prev,
      [productoId]: Math.max(0, Math.min(max, cantidad)),
    }));
  }

  async function agregarNuevo(p: Producto) {
    // Precio de lista consumidor final (escala mínima). Ordenamos por
    // `desde` ASC porque Supabase no garantiza orden y `escalas[0]`
    // podía ser la mayorista.
    const precios = await db.productos.preciosDe(p.id);
    const cf = precios.find((x) => LISTA_CF_IDS.includes(x.lista_precio_id));
    const escalasCF = [...(cf?.escalas ?? [])].sort((a, b) => a.desde - b.desde);
    const precio = escalasCF[0]?.precio ?? 0;
    setItemsNuevos((arr) => {
      const ex = arr.find((x) => x.producto.id === p.id);
      if (ex) {
        return arr.map((x) =>
          x.producto.id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x,
        );
      }
      return [...arr, { producto: p, cantidad: 1, precio }];
    });
    setQ('');
  }

  function modNuevo(productoId: string, delta: number) {
    setItemsNuevos((arr) =>
      arr
        .map((x) =>
          x.producto.id === productoId
            ? { ...x, cantidad: x.cantidad + delta }
            : x,
        )
        .filter((x) => x.cantidad > 0),
    );
  }
  function quitarNuevo(productoId: string) {
    setItemsNuevos((arr) => arr.filter((x) => x.producto.id !== productoId));
  }

  const cambioMut = useMutation({
    mutationFn: async () => {
      if (!empleado || !caja || !sesion) {
        throw new Error('Sesión inválida');
      }
      if (!algoDevuelto) {
        throw new Error('Marcá al menos un producto a devolver.');
      }
      // 1) Emitir NC por lo devuelto.
      const itemsNC = venta.items
        .map((it) => {
          const cant = cantDevolver[it.producto_id] ?? 0;
          if (cant <= 0) return null;
          return {
            producto_id: it.producto_id,
            cantidad: cant,
            precio_unitario: it.precio_unitario,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const nc = await db.notasCredito.emitir({
        venta_id: venta.id,
        empleado_id: empleado.id,
        motivo: algoNuevo
          ? `Cambio por otros productos (Caja ${caja.nombre})`
          : `Devolución sin reemplazo (Caja ${caja.nombre})`,
        items: itemsNC,
      });

      // 2) Si hay items nuevos, crear venta nueva con descuento global
      //    que compense la NC.
      let ventaNueva = null;
      if (algoNuevo) {
        const subtotalNuevo = totalNuevo;
        // Descuento global = mínimo entre lo devuelto y lo nuevo.
        // Eso garantiza:
        //  - si nuevo ≤ devuelto → descuento = nuevo → total = 0
        //  - si nuevo  > devuelto → descuento = devuelto → total = diferencia
        const descuentoGlobal = Math.min(totalDevuelto, subtotalNuevo);
        const totalAPagar = subtotalNuevo - descuentoGlobal;

        // Pagos: la diferencia se cobra con el método que eligió el cajero
        // (efectivo / tarjeta / QR). Si la diferencia es 0, no hay pago.
        const pagos = totalAPagar > 0
          ? [{ metodo: metodoDiferencia, monto: totalAPagar }]
          : [];

        ventaNueva = await db.ventas.crear({
          caja_id: caja.id,
          sesion_caja_id: sesion.id,
          local_id: caja.local_id,
          deposito_id: depositoId,
          empleado_id: empleado.id,
          items: itemsNuevos.map((x) => ({
            producto_id: x.producto.id,
            cantidad: x.cantidad,
            precio_unitario: x.precio,
            subtotal: x.cantidad * x.precio,
          })),
          pagos,
          subtotal: subtotalNuevo,
          descuento_total: descuentoGlobal,
          recargo_total: 0,
          total: totalAPagar,
        });
      }

      // 3) Registrar el cambio en auditoría para que el admin vea la
      //    historia completa. Linkea la venta original con la NC y la
      //    venta nueva (si hubo). Sin esto en el admin solo se ven 3
      //    operaciones sueltas sin contexto.
      await db.auditoria.log({
        empleado_id: empleado.id,
        accion: 'cambio_venta',
        entidad: 'venta',
        entidad_id: venta.id,
        detalle: {
          nc_id: nc.id,
          nc_numero: nc.numero,
          venta_nueva_id: ventaNueva?.id ?? null,
          venta_nueva_numero: ventaNueva?.numero ?? null,
          total_devuelto: totalDevuelto,
          total_nuevo: totalNuevo,
          diferencia_cobrada: Math.max(0, totalNuevo - totalDevuelto),
          metodo_diferencia:
            totalNuevo > totalDevuelto ? metodoDiferencia : null,
          caja: caja.nombre,
        },
      });

      return nc;
    },
    onSuccess: () => {
      toast.success('Cambio registrado correctamente');
      qc.invalidateQueries({ queryKey: ['venta', venta.id] });
      qc.invalidateQueries({ queryKey: ['pos-historial-48h'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['ventas-sesion'] });
      onOpenChange(false);
      navigate('/caja');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          Cambio de productos · venta {venta.numero}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          Marcá qué productos devuelve el cliente y qué se lleva. Recordá que
          NO se devuelve dinero: si lleva algo más barato, pierde la diferencia.
        </p>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-2">
        {/* --- Devuelve --- */}
        <div className="rounded-md border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="destructive">Devuelve</Badge>
            <span className="text-sm font-medium">
              {formatCurrency(totalDevuelto)}
            </span>
          </div>
          <div className="space-y-2">
            {venta.items.map((it) => {
              const p = productoPorId(it.producto_id);
              const cant = cantDevolver[it.producto_id] ?? 0;
              const unit = it.subtotal / it.cantidad;
              return (
                <div
                  key={it.producto_id}
                  className={`rounded border p-2 text-sm ${
                    cant > 0 ? 'bg-destructive/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">
                      {p?.nombre ?? it.producto_id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatCurrency(unit)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Comprado: {it.cantidad} u
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setDevolver(it.producto_id, cant - 1, it.cantidad)
                        }
                        disabled={cant <= 0}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="min-w-[2ch] text-center font-mono text-sm">
                        {cant}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setDevolver(it.producto_id, cant + 1, it.cantidad)
                        }
                        disabled={cant >= it.cantidad}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* --- Lleva --- */}
        <div className="rounded-md border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Badge>Se lleva</Badge>
            <span className="text-sm font-medium">
              {formatCurrency(totalNuevo)}
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Código o nombre"
              className="pl-8 text-sm"
            />
            {buscarQ.data && buscarQ.data.length > 0 && q.trim().length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow">
                {buscarQ.data.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => agregarNuevo(p)}
                    className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm hover:bg-accent last:border-0"
                  >
                    <span className="truncate">
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.codigo_interno}
                      </span>{' '}
                      {p.nombre}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            {itemsNuevos.length === 0 ? (
              <p className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                Sin items todavía.
              </p>
            ) : (
              itemsNuevos.map((x) => (
                <div
                  key={x.producto.id}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{x.producto.nombre}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(x.precio)} c/u
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => modNuevo(x.producto.id, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="min-w-[2ch] text-center font-mono text-sm">
                      {x.cantidad}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => modNuevo(x.producto.id, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => quitarNuevo(x.producto.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* --- Resumen --- */}
      <div className="mt-4 rounded-md bg-muted/40 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total devuelto</span>
          <span className="tabular-nums">{formatCurrency(totalDevuelto)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total nuevo</span>
          <span className="tabular-nums">{formatCurrency(totalNuevo)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 font-medium">
          {diferencia > 0 ? (
            <>
              <span className="text-orange-700">El cliente paga</span>
              <span className="tabular-nums text-orange-700">
                {formatCurrency(diferencia)}
              </span>
            </>
          ) : diferencia < 0 ? (
            <>
              <span className="text-muted-foreground">
                Diferencia a favor del cliente (no se devuelve)
              </span>
              <span className="tabular-nums">
                {formatCurrency(-diferencia)}
              </span>
            </>
          ) : algoDevuelto || algoNuevo ? (
            <>
              <span className="text-green-700">Cambio exacto</span>
              <span className="tabular-nums text-green-700">$ 0</span>
            </>
          ) : (
            <span className="text-muted-foreground">Marcá qué se devuelve.</span>
          )}
        </div>

        {/* Selector de método de pago — sólo si hay diferencia a cobrar.
            Si no hay diferencia (o es a favor del cliente que se pierde),
            no tiene sentido elegir método. */}
        {diferencia > 0 && (
          <div className="mt-3 border-t pt-2">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Cobrar la diferencia con
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMetodoDiferencia('efectivo')}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition ${
                  metodoDiferencia === 'efectivo'
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input hover:border-foreground/40'
                }`}
              >
                <Banknote className="h-4 w-4" />
                <span className="font-medium">Efectivo</span>
              </button>
              <button
                type="button"
                onClick={() => setMetodoDiferencia('debito')}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition ${
                  metodoDiferencia === 'debito'
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input hover:border-foreground/40'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                <span className="font-medium">Tarjeta</span>
              </button>
              <button
                type="button"
                onClick={() => setMetodoDiferencia('qr')}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition ${
                  metodoDiferencia === 'qr'
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input hover:border-foreground/40'
                }`}
              >
                <Smartphone className="h-4 w-4" />
                <span className="font-medium">QR / Transf.</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <Label className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
        <Label className="font-medium text-foreground">Importante:</Label>
        si lo nuevo es más barato, el cliente NO recibe la diferencia. Si es
        más caro, se cobra en esta caja con el método elegido arriba.
      </Label>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={cambioMut.isPending}
        >
          Cancelar
        </Button>
        <Button
          onClick={() => cambioMut.mutate()}
          disabled={cambioMut.isPending || !algoDevuelto}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          {cambioMut.isPending ? 'Procesando…' : 'Confirmar cambio'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
