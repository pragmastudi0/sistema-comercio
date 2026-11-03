'use client';

/**
 * Reimpresión del ticket de una venta desde el admin. Usa el mismo template
 * que el PoS (auto-print al cargar la primera vez) para que el dueño pueda
 * descargar la venta como PDF desde el diálogo del navegador o reimprimirla
 * en la impresora térmica.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { BRAND } from '@comercio/business';
import { PRESET_IDS } from '@comercio/db';
import { getDb } from '@/lib/db';
import { Button } from '@comercio/ui/button';
import { Skeleton } from '@comercio/ui/skeleton';
import { formatCurrency, formatDate } from '@comercio/ui/utils';

const LABEL_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
  cta_cte: 'Cuenta corriente',
};

export default function TicketAdminPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const db = getDb();

  const ventaQ = useQuery({
    queryKey: ['venta-admin-ticket', params.id],
    queryFn: () => (params.id ? db.ventas.get(params.id) : Promise.resolve(null)),
    enabled: !!params.id,
  });
  const productosQ = useQuery({
    queryKey: ['productos-all'],
    queryFn: () => db.productos.list(),
  });
  const configQ = useQuery({
    queryKey: ['config-ticket'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });
  const empleadosQ = useQuery({
    queryKey: ['empleados-ticket'],
    queryFn: () => db.empleados.list(),
  });

  // Auto-print al cargar — abre el diálogo del navegador donde el usuario
  // elige imprimir o "Guardar como PDF".
  useEffect(() => {
    if (ventaQ.data) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
    return;
  }, [ventaQ.data]);

  if (ventaQ.isLoading) {
    return (
      <main className="container mx-auto max-w-xl p-6">
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }
  const venta = ventaQ.data;
  if (!venta) {
    return (
      <main className="container mx-auto max-w-xl p-6 text-center">
        <p className="text-sm text-muted-foreground">Venta no encontrada.</p>
        <Button variant="link" onClick={() => router.push('/ventas')}>
          Volver a Ventas
        </Button>
      </main>
    );
  }

  const nombre = (productoId: string) =>
    productosQ.data?.find((p) => p.id === productoId)?.nombre ?? '—';
  const codigo = (productoId: string) =>
    productosQ.data?.find((p) => p.id === productoId)?.codigo_interno ?? '—';

  return (
    <>
      <header className="no-print border-b bg-background">
        <div className="container mx-auto flex h-14 items-center justify-between gap-2 px-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/ventas')}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver a Ventas
          </Button>
          <Button onClick={() => window.print()} size="sm">
            <Printer className="mr-1 h-4 w-4" />
            Imprimir / Guardar PDF
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-md p-6 print:p-2">
        <div className="ticket rounded border border-dashed bg-white p-6 font-mono text-sm text-black print:border-0 print:p-0">
          <div className="mb-3 text-center">
            {configQ.data?.comercio?.logo_url && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img
                src={configQ.data.comercio.logo_url}
                alt=""
                className="mx-auto mb-1 h-12 w-12 object-contain"
              />
            )}
            <div className="font-bold uppercase">
              {configQ.data?.comercio?.razon_social || BRAND.nombreCompleto}
            </div>
            {configQ.data?.comercio?.direccion && (
              <div className="text-xs">{configQ.data.comercio.direccion}</div>
            )}
            {configQ.data?.comercio?.cuit && (
              <div className="text-xs">CUIT {configQ.data.comercio.cuit}</div>
            )}
            {configQ.data?.comercio?.telefono && (
              <div className="text-xs">Tel: {configQ.data.comercio.telefono}</div>
            )}
            <div className="mt-2 text-xs">
              {venta.estado === 'presupuesto' ? 'PRESUPUESTO' : 'COMPROBANTE NO FISCAL'}
            </div>
            {venta.estado === 'anulada' && (
              <div className="mt-1 inline-block rounded border-2 border-red-600 px-3 py-1 text-base font-bold uppercase tracking-wider text-red-600">
                ANULADA
              </div>
            )}
            <div className="text-xs">N° {venta.numero}</div>
            <div className="text-xs">{formatDate(venta.fecha)}</div>
            {(() => {
              const emp = empleadosQ.data?.find((e) => e.id === venta.empleado_id);
              return emp ? (
                <div className="text-xs">
                  Cajero: {emp.nombre} {emp.apellido}
                </div>
              ) : null;
            })()}
          </div>

          <div className="my-3 border-t border-dashed pt-2">
            {venta.items.map((it, idx) => (
              <div key={idx} className="mb-2">
                <div className="flex justify-between text-xs">
                  <span>{codigo(it.producto_id)}</span>
                  <span>{nombre(it.producto_id)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>
                    {it.cantidad} x {formatCurrency(it.precio_unitario)}
                  </span>
                  <span>{formatCurrency(it.subtotal)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed pt-2 text-xs">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(venta.subtotal)}</span>
            </div>
            {venta.descuento_total > 0 && (
              <div className="flex justify-between">
                <span>Descuento</span>
                <span>-{formatCurrency(venta.descuento_total)}</span>
              </div>
            )}
            {venta.recargo_total > 0 && (
              <div className="flex justify-between">
                <span>Recargo</span>
                <span>+{formatCurrency(venta.recargo_total)}</span>
              </div>
            )}
            <div className="mt-2 flex justify-between text-base font-bold">
              <span>TOTAL</span>
              <span>{formatCurrency(venta.total)}</span>
            </div>
          </div>

          <div className="mt-3 border-t border-dashed pt-2 text-xs">
            {venta.pagos.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>
                  {LABEL_METODO[p.metodo] ?? p.metodo}
                  {p.cuotas ? ` (${p.cuotas} cuotas)` : ''}
                </span>
                <span>{formatCurrency(p.monto)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 text-center text-xs">¡Gracias por su compra!</div>
        </div>
      </main>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </>
  );
}
