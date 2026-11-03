/**
 * Hook que devuelve el depósito desde donde se vende en la caja actual.
 *
 * La lógica correcta es: descontar stock del depósito asociado al LOCAL
 * de la caja donde el cajero abrió sesión, NO del depósito asignado al
 * empleado en su perfil.
 *
 * Ejemplo: si Agus (asignado al Central) abre caja en B12, las ventas
 * descuentan de Depósito B12. Si abre en C11, de Depósito C11.
 *
 * Fallback: si no hay un depósito tipo 'local' para ese local, usamos el
 * empleado.deposito_id; si eso tampoco existe, el UUID canónico del Central.
 */
import { useQuery } from '@tanstack/react-query';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { useSesion } from '@/stores/sesion';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidSeguro(id: string | null | undefined): string | null {
  return id && UUID_RE.test(id) ? id : null;
}

export function useDepositoActivo(): {
  depositoId: string;
  cargando: boolean;
  nombre: string | undefined;
} {
  const db = getDb();
  const empleado = useSesion((s) => s.empleado);
  const caja = useSesion((s) => s.caja);

  const depositosQ = useQuery({
    queryKey: ['depositos-pos'],
    queryFn: () => db.depositos.list(),
    staleTime: 5 * 60 * 1000,
  });

  // Buscar el depósito tipo 'local' que pertenece al local de la caja activa.
  // Si no hay caja o no encontramos el depósito local, usamos empleado.deposito_id
  // como fallback (puede ser el Central) y, en último caso, el UUID preset.
  const cajaLocalId = uuidSeguro(caja?.local_id);
  const empleadoDepId = uuidSeguro(empleado?.deposito_id);

  const depositoDeLocal = depositosQ.data?.find(
    (d) => d.local_id === cajaLocalId && d.tipo === 'local' && d.activo !== false,
  );

  const depositoId =
    uuidSeguro(depositoDeLocal?.id) ??
    empleadoDepId ??
    PRESET_IDS.depositoCentralFallback;

  const nombre = depositosQ.data?.find((d) => d.id === depositoId)?.nombre;

  return {
    depositoId,
    cargando: depositosQ.isLoading,
    nombre,
  };
}
