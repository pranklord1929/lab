import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase.
 * Prefer service role for imports (Drive/Excel/PDF → SQL) — never expose to browser.
 */
export function createServerClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
