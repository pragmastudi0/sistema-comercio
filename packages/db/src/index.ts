export * from './types';
export * from './repos';
export { createMockClient } from './mock';
export type { DbClient } from './client';
export {
  createSupabaseClient,
  wrapSupabase,
  PRESET_IDS,
} from './supabase';
export { createSupabaseRaw } from './supabase/client';
export type { SupabaseClient } from './supabase/client';

import { createMockClient } from './mock';
import { createSupabaseClient } from './supabase';
import type { DbClient } from './client';

/**
 * Decide qué cliente usar según las env vars disponibles.
 * Si hay URL y anon key de Supabase → cliente real.
 * Si no → cliente mock con seed en memoria (modo demo).
 */
export function createDbClient(opts?: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}): DbClient {
  const url = opts?.supabaseUrl;
  const key = opts?.supabaseAnonKey;
  if (url && key) {
    return createSupabaseClient(url, key);
  }
  return createMockClient();
}
