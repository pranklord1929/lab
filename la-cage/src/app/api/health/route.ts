import { getDataMode, getSupabaseOrNull } from "@/lib/store/mode";
import { NextResponse } from "next/server";

export async function GET() {
  const mode = getDataMode();
  let supabaseOk: boolean | "unconfigured" | "error" = "unconfigured";

  if (mode === "supabase") {
    const supabase = getSupabaseOrNull();
    if (!supabase) supabaseOk = "unconfigured";
    else {
      const { error } = await supabase
        .from("agent_heartbeats")
        .select("id")
        .limit(1);
      supabaseOk = error ? "error" : true;
    }
  }

  return NextResponse.json({
    ok: true,
    app: "la-cage",
    mode,
    supabase: supabaseOk,
    at: new Date().toISOString(),
  });
}
