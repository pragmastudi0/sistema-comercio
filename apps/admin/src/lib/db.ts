import { createDbClient, type DbClient } from '@comercio/db';

let _client: DbClient | null = null;

/**
 * Singleton del cliente DB. Si están seteadas las env vars de Supabase, usa
 * la BD real; si no, cae al mock con seed en memoria (modo demo / desarrollo).
 */
export function getDb(): DbClient {
  if (!_client) {
    _client = createDbClient({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return _client;
}
