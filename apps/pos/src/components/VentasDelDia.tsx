import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ScrollText, Receipt } from 'lucide-react';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import { formatCurrency } from '@comercio/ui/utils';

export function VentasDelDia() {
  const db = getDb();
  const empleado = useSesion((s) => s.empleado);
  const sesion = useSesion((s) => s.sesionCaja);

  const ventasQ = useQuery({
    queryKey: ['ventas-sesion', sesion?.id],
    queryFn: () =>
      sesion
        ? db.ventas.list({
            empleado_id: empleado?.id,
            desde: sesion.abierta_en,
          })
        : Promise.resolve([]),
    enabled: !!sesion,
    // 15s en vez de 5s — con 100+ ventas al final del turno esta query
    // trae ventas + items y satura la red del tablet + main thread.
    // Al cobrar una venta se invalida esta query manualmente desde
    // ModalCobro, así que el "nuevo ítem aparece al instante" sigue OK
    // aunque el polling sea más lento. Ver ticket "PoS se tilda varias
    // veces por día" (feedback de Agus, 2026-08-XX).
    refetchInterval: 15_000,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  // En el historial inmediato del PoS NO mostramos las canceladas (no se
  // cobraron, son ruido para el cajero). Quedan en /admin/ventas como
  // auditoría para el dueño.
  const ventas = (ventasQ.data ?? [])
    .filter((v) => v.estado !== 'cancelada')
    .slice()
    .reverse();
  // Para los totales del turno solo cuentan las completadas. Las anuladas
  // se muestran para que el cajero sepa cuáles dio de baja pero no suman.
  const completadas = (ventasQ.data ?? []).filter((v) => v.estado === 'completada');
  const totalDia = completadas.reduce((acc, v) => acc + v.total, 0);
  const cantidad = completadas.length;

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="border-b bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <ScrollText className="h-3 w-3" />
          Tus ventas del turno
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums">
          {formatCurrency(totalDia)}
        </div>
        <div className="text-xs text-muted-foreground">{cantidad} ventas · refresh c/15s</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {ventas.length === 0 ? (
          <p className="px-2 py-6 text-center text-muted-foreground">
            Sin ventas todavía.
            <br />
            Empezá la primera con F2.
          </p>
        ) : (
          ventas.map((v) => {
            const hora = new Date(v.fecha).toLocaleTimeString('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const metodosUnicos = Array.from(new Set(v.pagos.map((p) => p.metodo)));
            const esMixto = metodosUnicos.length > 1;
            const metodos = esMixto
              ? `Mixto · ${metodosUnicos.map((m) => m.replace('_', ' ')).join(' + ')}`
              : metodosUnicos[0]?.replace('_', ' ') ?? '';
            const anulada = v.estado === 'anulada';
            return (
              <Link
                key={v.id}
                to={`/ticket/${v.id}`}
                className={`block rounded px-2 py-2 transition hover:bg-accent ${
                  anulada ? 'bg-red-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex items-center gap-1 font-mono ${
                      anulada ? 'text-red-700' : 'text-muted-foreground'
                    }`}
                  >
                    <Receipt className="h-3 w-3" />
                    {v.numero}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      anulada ? 'text-red-700 line-through' : ''
                    }`}
                  >
                    {formatCurrency(v.total)}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                  <span>{hora}</span>
                  <span className="capitalize">
                    {anulada ? (
                      <span className="font-semibold text-red-700">Anulada</span>
                    ) : (
                      metodos
                    )}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
