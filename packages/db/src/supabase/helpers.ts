import type { PostgrestError } from '@supabase/supabase-js';

type RowResp<T> = { data: T | null; error: PostgrestError | null };
type ListResp<T> = { data: T[] | null; error: PostgrestError | null };

/** Detecta el clásico "JWT expired" de PostgREST para traducirlo a un
 *  mensaje amigable. El cliente Supabase ya se encarga del auto-refresh
 *  (ver client.ts) — cuando el error llega hasta acá es porque el
 *  refresh en background falló (tablet dormido, red intermitente, etc).
 *  El usuario tiene que recargar para forzar un nuevo login. */
function esJwtExpirado(err: PostgrestError): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('jwt expired') || err.code === 'PGRST301';
}

function formatError(err: PostgrestError, ctx?: string): string {
  const prefix = ctx ? `${ctx}: ` : '';
  if (esJwtExpirado(err)) {
    return `${prefix}Sesión vencida — recargá la página para seguir.`;
  }
  return `${prefix}${err.message}`;
}

/** Lanza un Error legible si la respuesta de Supabase trae error. */
export function ok<T>(res: RowResp<T>, ctx?: string): T {
  if (res.error) throw new Error(formatError(res.error, ctx));
  if (res.data === null || res.data === undefined) {
    throw new Error(`${ctx ? ctx + ': ' : ''}sin datos`);
  }
  return res.data;
}

/** Variante para listados: data puede ser [] (válido). */
export function okList<T>(res: ListResp<T>, ctx?: string): T[] {
  if (res.error) throw new Error(formatError(res.error, ctx));
  return res.data ?? [];
}

/** Para single()/maybeSingle() que puede devolver null si no existe. */
export function okMaybe<T>(res: RowResp<T>, ctx?: string): T | null {
  if (res.error) {
    // PGRST116 = no rows returned
    if (res.error.code === 'PGRST116') return null;
    throw new Error(formatError(res.error, ctx));
  }
  return res.data;
}

/**
 * PostgREST corta a 1000 filas por request aunque no pongas `.limit()`. Este
 * helper llama `buildQuery(from, to)` de a 1000 hasta que una página vuelva
 * incompleta y devuelve todo concatenado. Usarlo en cualquier `list()` que
 * pueda superar 1000 registros (ventas, auditoría, notas de crédito,
 * transferencias, movimientos, etc.) — sin esto los datos se pierden en
 * silencio y el admin cree que ese es el total.
 */
export async function paginarTodo<T>(
  buildQuery: (from: number, to: number) => PromiseLike<ListResp<T>>,
  ctx: string,
): Promise<T[]> {
  const PAGE = 1000;
  const acumulado: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE;
    const to = from + PAGE - 1;
    const chunk = okList<T>(await buildQuery(from, to), ctx);
    acumulado.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return acumulado;
}
