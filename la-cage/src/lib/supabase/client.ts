import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser / client-side Supabase (anon key only).
 * Missing env → null so the UI still runs with mock data.
 */
export function createBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon);
}
