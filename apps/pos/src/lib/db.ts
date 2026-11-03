import { createDbClient, type DbClient } from '@comercio/db';

let _client: DbClient | null = null;

export function getDb(): DbClient {
  if (!_client) {
    _client = createDbClient({
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
      supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
    });
  }
  return _client;
}
