import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDb } from '../lib/db';
import { useSesion } from '../stores/sesion';

/**
 * DemoGuard del PoS: cuando el empleado logueado tiene un rol cuyo
 * nombre contiene "demo", activa el flag global `__DEMO_MODE__`.
 *
 * El flag hace que:
 *   1. `formatCurrency` de @comercio/ui devuelva montos fake plausibles.
 *   2. Las mutations críticas del PoS (crear venta, abrir/cerrar caja,
 *      ajustar/transferir stock) se intercepten en los repos Supabase y
 *      devuelvan mocks — cero escrituras a BD.
 *
 * Sirve para que un prospecto pueda navegar TODO el sistema
 * (incluyendo el PoS end-to-end) sin ensuciar datos reales de Turisteando.
 *
 * Se monta una sola vez en el root del App. Muestra un banner ámbar
 * arriba de todo cuando está activo.
 */
export function DemoGuard() {
  const empleado = useSesion((s) => s.empleado);
  const db = getDb();

  const rolQ = useQuery({
    queryKey: ['rol-demo-check', empleado?.rol_id],
    queryFn: () =>
      empleado ? db.roles.get(empleado.rol_id) : Promise.resolve(null),
    enabled: !!empleado,
    staleTime: 5 * 60_000,
  });

  const esDemo = !!(rolQ.data?.nombre ?? '')
    .toLowerCase()
    .includes('demo');

  useEffect(() => {
    if (typeof globalThis === 'undefined') return;
    globalThis.__DEMO_MODE__ = esDemo;
  }, [esDemo]);

  if (!esDemo) return null;

  return (
    <div
      className="fixed left-0 right-0 top-0 z-[60] w-full bg-amber-200 px-3 py-1 text-center text-xs font-semibold text-amber-900 shadow-sm"
      style={{ pointerEvents: 'none' }}
    >
      🎭 Modo demostración — nada de lo que hagas en el PoS se guarda. Los montos son de ejemplo.
    </div>
  );
}
