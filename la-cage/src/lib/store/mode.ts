import { createServerClient } from "@/lib/supabase/server";

export type DataMode = "supabase" | "local";

export function getDataMode(): DataMode {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key && !url.includes("YOUR_PROJECT")) return "supabase";
  return "local";
}

export function getSupabaseOrNull() {
  if (getDataMode() !== "supabase") return null;
  return createServerClient();
}
