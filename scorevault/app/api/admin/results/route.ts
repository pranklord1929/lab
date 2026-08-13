import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "scorevault2026";

function getSupabase() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase env vars not configured");
  }
  return createClient(url, anon);
}

/**
 * POST /api/admin/results
 * Body: { secret, matchId, homeScore, awayScore, homePct, drawPct, awayPct, isFinal }
 * Sets or updates the official result for a match.
 */
export async function POST(req: Request) {
  let supabase;
  try { supabase = getSupabase(); } catch {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const body = await req.json();

  if (body.secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { matchId, homeScore, awayScore, homePct = 50, drawPct = 25, awayPct = 25, isFinal = true } = body;

  if (!matchId || homeScore == null || awayScore == null) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const { error } = await supabase.from("results").upsert({
    match_id:   matchId,
    home_score: homeScore,
    away_score: awayScore,
    home_pct:   homePct,
    draw_pct:   drawPct,
    away_pct:   awayPct,
    is_final:   isFinal,
    updated_at: new Date().toISOString(),
  }, { onConflict: "match_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  let supabase;
  try { supabase = getSupabase(); } catch {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await supabase.from("results").select("*").order("match_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
