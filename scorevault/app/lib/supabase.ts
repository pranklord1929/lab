import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ── Types ──────────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  name: string;
  avatar: string;
};

export type Pick = {
  id: string;
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  locked: boolean;
};

export type Result = {
  match_id: string;
  home_score: number;
  away_score: number;
  home_pct: number;
  draw_pct: number;
  away_pct: number;
  is_final: boolean;
};

export type League = {
  id: string;
  code: string;
  name: string;
  stake_cents: number;
  creator_id: string;
  created_at: string;
};

export type LeagueMember = {
  league_id: string;
  user_id: string;
  paid: boolean;
  paid_at: string | null;
  joined_at: string;
};

export type LeaderboardEntry = {
  user_id: string;
  name: string;
  avatar: string;
  total_pts: number;
  paid: boolean;
};

// ── Auth ───────────────────────────────────────────────────────────────────────

export async function getAuthUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}

export async function signOut() {
  return supabase.auth.signOut();
}

// ── Profile ────────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, name, avatar")
    .eq("id", userId)
    .single();
  return data as Profile | null;
}

export async function upsertProfile(id: string, name: string, avatar: string) {
  return supabase.from("profiles").upsert({ id, name, avatar }, { onConflict: "id" });
}

// ── Picks ──────────────────────────────────────────────────────────────────────

export async function savePicks(
  userId: string,
  picks: { matchId: string; homeScore: number; awayScore: number }[]
) {
  const rows = picks.map(p => ({
    user_id:    userId,
    match_id:   p.matchId,
    home_score: p.homeScore,
    away_score: p.awayScore,
    locked:     true,
  }));
  return supabase.from("picks").upsert(rows, { onConflict: "user_id,match_id" });
}

export async function getUserPicks(userId: string): Promise<Pick[]> {
  const { data } = await supabase.from("picks").select("*").eq("user_id", userId);
  return (data as Pick[]) ?? [];
}

// ── Results ────────────────────────────────────────────────────────────────────

export async function getResults(): Promise<Result[]> {
  const { data } = await supabase.from("results").select("*");
  return (data as Result[]) ?? [];
}

// ── Leagues ────────────────────────────────────────────────────────────────────

export async function getLeagueByCode(code: string): Promise<League | null> {
  const { data } = await supabase
    .from("leagues")
    .select("*")
    .eq("code", code.toUpperCase().trim())
    .single();
  return data as League | null;
}

export async function createLeague(
  code: string,
  name: string,
  stakeCents: number,
  userId: string
): Promise<League> {
  const { data, error } = await supabase
    .from("leagues")
    .insert({ code: code.toUpperCase().trim(), name, stake_cents: stakeCents, creator_id: userId })
    .select()
    .single();
  if (error) throw error;
  // Creator joins automatically, marked as paid
  await supabase
    .from("league_members")
    .insert({ league_id: (data as League).id, user_id: userId, paid: true, paid_at: new Date().toISOString() });
  return data as League;
}

export async function joinLeague(leagueId: string, userId: string) {
  // demo mode: auto-mark as paid — no real money yet
  const { error } = await supabase
    .from("league_members")
    .upsert(
      { league_id: leagueId, user_id: userId, paid: true, paid_at: new Date().toISOString() },
      { onConflict: "league_id,user_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function getMyMembership(leagueId: string, userId: string): Promise<LeagueMember | null> {
  const { data } = await supabase
    .from("league_members")
    .select("*")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .single();
  return data as LeagueMember | null;
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

export async function getLeagueLeaderboard(leagueId: string): Promise<LeaderboardEntry[]> {
  const { data } = await supabase.rpc("get_league_leaderboard", { p_league_id: leagueId });
  return (data as LeaderboardEntry[]) ?? [];
}

// ── Admin ──────────────────────────────────────────────────────────────────────

export async function getLeagueMembers(leagueId: string): Promise<(LeagueMember & { name: string; avatar: string })[]> {
  const { data } = await supabase
    .from("league_members")
    .select("*, profiles(name, avatar)")
    .eq("league_id", leagueId);
  return (data ?? []).map((m: Record<string, unknown>) => ({
    ...(m as LeagueMember),
    name:   ((m.profiles as Record<string, string>)?.name)   ?? "?",
    avatar: ((m.profiles as Record<string, string>)?.avatar) ?? "⚽",
  }));
}

export async function markMemberAsPaid(leagueId: string, userId: string) {
  return supabase
    .from("league_members")
    .update({ paid: true, paid_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .eq("user_id", userId);
}

export async function markMemberAsUnpaid(leagueId: string, userId: string) {
  return supabase
    .from("league_members")
    .update({ paid: false, paid_at: null })
    .eq("league_id", leagueId)
    .eq("user_id", userId);
}

