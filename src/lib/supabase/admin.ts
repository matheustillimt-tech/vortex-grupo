import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let unico: SupabaseClient | undefined;

/** Service role: ignora RLS. Só cron, webhooks e server actions que precisam dos tokens. */
export function dbAdmin(): SupabaseClient {
  unico ??= createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return unico;
}
