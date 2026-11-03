'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';

/**
 * DemoGuard: cuando el empleado logueado tiene un rol cuyo nombre
 * contiene "demo" (case-insensitive), activa el flag global
 * `__DEMO_MODE__` para que `formatCurrency` de @comercio/ui enmascare
 * los montos con valores fake.
 *
 * Sirve para presentar el sistema a prospectos sin exponer facturación
 * real: navegan todo el admin y ven números plausibles pero inventados.
 *
 * Se monta una sola vez en el layout raíz (dentro del providers tree).
 * No renderiza nada visible — solo mantiene el flag sincronizado.
 *
 * Además muestra un banner amarillo arriba del todo cuando está activo,
 * para que quede claro (para el que hace la demo) que los números que
 * ve el prospecto son fake.
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
    <div className="sticky top-0 z-[60] w-full bg-amber-200 px-3 py-1 text-center text-xs font-semibold text-amber-900 shadow-sm">
      🎭 Modo demostración — los montos que aparecen en pantalla son de ejemplo, no reflejan datos reales.
    </div>
  );
}
