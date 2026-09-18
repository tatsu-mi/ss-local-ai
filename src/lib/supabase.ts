import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { env } from "./env";

let client: SupabaseClient<Database> | undefined;

export function db() {
  if (!client) {
    const config = env();
    client = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function throwIfDbError(error: { message: string; code?: string } | null) {
  if (error) throw new Error(`Database error (${error.code ?? "unknown"}): ${error.message}`);
}
