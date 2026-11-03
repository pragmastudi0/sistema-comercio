import { createDbClient, type DbClient } from '@comercio/db';

let _client: DbClient | null = null;

export function getDb(): DbClient {
  if (!_client) {
    _client = createDbClient({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return _client;
}
