import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSesion } from '@/stores/sesion';
import { getDb } from '@/lib/db';
import type { ReactNode } from 'react';

// Defensa contra sesiones residuales del modo mock (IDs como '1', 'emp_admin').
// Si algo de la sesión persistida no es UUID, hacemos logout y volvemos al login.
// Regex liberal "cualquier hex 8-4-4-4-12" — Postgres acepta UUIDs sin restricción
// de versión/variante (los preset IDs nuestros tipo 00000000-...-0301 no cumplirían
// el spec RFC 4122 estricto pero sí son UUID válidos en la DB).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function esUuid(v: string | undefined | null): boolean {
  return !!v && UUID_RE.test(v);
}

// Acepta null/undefined (campos opcionales) pero rechaza cualquier string
// no-UUID (residuo del modo mock con IDs tipo '1', 'emp_admin', etc).
function esUuidOpcional(v: string | null | undefined): boolean {
  return v === null || v === undefined || esUuid(v);
}

function useLimpiarSesionMockResidual(): boolean {
  const empleado = useSesion((s) => s.empleado);
  const caja = useSesion((s) => s.caja);
  const sesionCaja = useSesion((s) => s.sesionCaja);
  const logout = useSesion((s) => s.logout);

  const empleadoInvalido =
    empleado &&
    (!esUuid(empleado.id) ||
      !esUuidOpcional(empleado.local_id) ||
      !esUuidOpcional(empleado.deposito_id));
  const cajaInvalida = caja && (!esUuid(caja.id) || !esUuid(caja.local_id));
  const sesionInvalida =
    sesionCaja &&
    (!esUuid(sesionCaja.id) ||
      !esUuid(sesionCaja.caja_id) ||
      !esUuid(sesionCaja.empleado_id));
  const hayResiduo = !!(empleadoInvalido || cajaInvalida || sesionInvalida);

  useEffect(() => {
    if (hayResiduo) {
      logout();
      toast.warning('Tu sesión anterior expiró. Volvé a iniciar sesión.');
    }
  }, [hayResiduo, logout]);

  return hayResiduo;
}

export function RequireEmpleado({ children }: { children: ReactNode }) {
  const residuo = useLimpiarSesionMockResidual();
  const empleado = useSesion((s) => s.empleado);
  if (residuo || !empleado) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireSesionAbierta({ children }: { children: ReactNode }) {
  const residuo = useLimpiarSesionMockResidual();
  const sesion = useSesion((s) => s.sesionCaja);
  const empleado = useSesion((s) => s.empleado);
  const setSesionCaja = useSesion((s) => s.setSesionCaja);
  const setCaja = useSesion((s) => s.setCaja);
  const db = getDb();

  // Polling cada 10s para detectar si la sesión fue cerrada desde otro
  // lado (admin cerrándola desde /admin/caja, o el mismo cajero en otro
  // dispositivo). Sin esto, el PoS local sigue creyendo que está abierta
  // y deja vender — esas ventas pegarían contra el RPC que tampoco las
  // aceptaría, pero el cajero pierde tiempo y la UX queda confusa.
  const checkQ = useQuery({
    queryKey: ['sesion-actual', sesion?.id],
    queryFn: () => (sesion ? db.sesionesCaja.get(sesion.id) : Promise.resolve(null)),
    enabled: !!sesion,
    // 30s en vez de 10s. El caso que cubre esta query — el admin
    // cierra la caja desde /admin/caja mientras el cajero está en el
    // PoS — es raro, y 30s de latencia para detectarlo es aceptable.
    // Baja un 66% las requests en background del PoS.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!sesion || !checkQ.data) return;
    if (checkQ.data.estado !== 'abierta') {
      toast.warning(
        'Tu caja fue cerrada por otro usuario. Volvé a abrirla para seguir vendiendo.',
        { duration: 6000 },
      );
      setSesionCaja(null);
      setCaja(null);
    }
  }, [sesion, checkQ.data, setSesionCaja, setCaja]);

  if (residuo || !empleado) return <Navigate to="/login" replace />;
  if (!sesion || sesion.estado !== 'abierta') return <Navigate to="/abrir-caja" replace />;
  return <>{children}</>;
}
