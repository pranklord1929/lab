import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ESPN display name → normalized name
const TEAM: Record<string, string> = {
  "Canada": "Canada", "Bosnia-Herzegovina": "Bosnia", "Bosnia": "Bosnia",
  "United States": "USA", "USA": "USA",
  "Paraguay": "Paraguay",
  "Qatar": "Qatar",
  "Switzerland": "Switzerland",
  "Brazil": "Brazil", "Morocco": "Morocco", "Haiti": "Haiti", "Scotland": "Scotland",
  "Australia": "Australia",
  "Türkiye": "Türkiye", "Turkey": "Türkiye",
  "Germany": "Germany", "Curaçao": "Curaçao", "Curacao": "Curaçao",
  "Netherlands": "Netherlands", "Japan": "Japan",
  "Ivory Coast": "Ivory Coast", "Côte d'Ivoire": "Ivory Coast",
  "Ecuador": "Ecuador", "Sweden": "Sweden", "Tunisia": "Tunisia",
  "Spain": "Spain", "Cape Verde": "Cape Verde",
  "Belgium": "Belgium", "Egypt": "Egypt",
  "Saudi Arabia": "Saudi Arabia", "Uruguay": "Uruguay",
  "Iran": "Iran", "New Zealand": "New Zealand",
  "France": "France", "Senegal": "Senegal",
  "Iraq": "Iraq", "Norway": "Norway",
  "Argentina": "Argentina", "Algeria": "Algeria",
  "Austria": "Austria", "Jordan": "Jordan",
  "Portugal": "Portugal", "Congo DR": "Congo DR", "DR Congo": "Congo DR",
  "England": "England", "Croatia": "Croatia",
  "Ghana": "Ghana", "Panama": "Panama",
  "Uzbekistan": "Uzbekistan", "Colombia": "Colombia",
  "Czechia": "Czechia", "Czech Republic": "Czechia",
  "South Africa": "South Africa",
  "Mexico": "Mexico",
  "South Korea": "South Korea", "Korea Republic": "South Korea",
};

// "Home|Away" → match_id  (both orderings)
const MATCH_ID: Record<string, string> = {};
const PAIRS: [string, string, string][] = [
  ["Canada","Bosnia","can-bih"], ["USA","Paraguay","usa-par"],
  ["Qatar","Switzerland","qat-sui"], ["Brazil","Morocco","bra-mar"], ["Haiti","Scotland","hai-sco"],
  ["Australia","Türkiye","aus-tur"], ["Germany","Curaçao","ger-cur"], ["Netherlands","Japan","ned-jpn"],
  ["Ivory Coast","Ecuador","civ-ecu"], ["Sweden","Tunisia","swe-tun"],
  ["Spain","Cape Verde","esp-cpv"], ["Belgium","Egypt","bel-egy"],
  ["Saudi Arabia","Uruguay","ksa-uru"], ["Iran","New Zealand","irn-nzl"],
  ["France","Senegal","fra-sen"], ["Iraq","Norway","irq-nor"], ["Argentina","Algeria","arg-alg"],
  ["Austria","Jordan","aut-jor"], ["Portugal","Congo DR","por-cod"],
  ["England","Croatia","eng-cro"], ["Ghana","Panama","gha-pan"], ["Uzbekistan","Colombia","uzb-col"],
  ["Czechia","South Africa","cze-rsa"], ["Switzerland","Bosnia","sui-bih"],
  ["Canada","Qatar","can-qat"], ["Mexico","South Korea","mex-kor"],
  ["USA","Australia","usa-aus"], ["Scotland","Morocco","sco-mar"],
  ["Brazil","Haiti","bra-hai"], ["Türkiye","Paraguay","tur-par"],
  ["Netherlands","Sweden","ned-swe"], ["Germany","Ivory Coast","ger-civ"],
  ["Ecuador","Curaçao","ecu-cur"],
  ["Tunisia","Japan","tun-jpn"], ["Spain","Saudi Arabia","esp-ksa"],
  ["Belgium","Iran","bel-irn"], ["Uruguay","Cape Verde","uru-cpv"],
  ["New Zealand","Egypt","nzl-egy"],
  ["Argentina","Austria","arg-aut"], ["France","Iraq","fra-irq"],
  ["Norway","Senegal","nor-sen"], ["Jordan","Algeria","jor-alg"],
  ["Portugal","Uzbekistan","por-uzb"], ["England","Ghana","eng-gha"],
  ["Panama","Croatia","pan-cro"], ["Colombia","Congo DR","col-cod"],
  ["Bosnia","Qatar","bih-qat"], ["Switzerland","Canada","sui-can"],
  ["Morocco","Haiti","mar-hai"], ["Scotland","Brazil","sco-bra"],
  ["Czechia","Mexico","cze-mex"], ["South Africa","South Korea","rsa-kor"],
  ["Curaçao","Ivory Coast","cur-civ"], ["Ecuador","Germany","ecu-ger"],
  ["Japan","Sweden","jpn-swe"], ["Tunisia","Netherlands","tun-ned"],
  ["Paraguay","Australia","par-aus"], ["Türkiye","USA","tur-usa"],
  ["Norway","France","nor-fra"], ["Senegal","Iraq","sen-irq"],
  ["Cape Verde","Saudi Arabia","cpv-ksa"], ["Uruguay","Spain","uru-esp"],
  ["Egypt","Iran","egy-irn"], ["New Zealand","Belgium","nzl-bel"],
  ["Croatia","Ghana","cro-gha"], ["Panama","England","pan-eng"],
  ["Colombia","Portugal","col-por"], ["Congo DR","Uzbekistan","cod-uzb"],
  ["Algeria","Austria","alg-aut"], ["Jordan","Argentina","jor-arg"],
];
for (const [h, a, id] of PAIRS) {
  MATCH_ID[`${h}|${a}`] = id;
  MATCH_ID[`${a}|${h}`] = id;
}

// Fetch last N days + all days since tournament start
function getDatesToFetch(): string[] {
  const dates = new Set<string>();
  const start = new Date("2026-06-12");
  const now = new Date();
  // All tournament days up to today
  for (let d = new Date(start); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.add(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return Array.from(dates);
}

export async function GET() {
  const synced: string[] = [];
  const errors: string[] = [];

  for (const date of getDatesToFetch()) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date}`,
        { next: { revalidate: 0 } }
      );
      if (!res.ok) continue;
      const json = await res.json() as { events?: unknown[] };
      const events = json.events ?? [];

      for (const ev of events as Record<string, unknown>[]) {
        try {
          const comp        = ((ev.competitions as Record<string, unknown>[])?.[0]) ?? {};
          const competitors = (comp.competitors as Record<string, unknown>[]) ?? [];
          const status      = (comp.status as Record<string, unknown>) ?? {};
          const statusType  = (status.type as Record<string, unknown>) ?? {};
          const completed   = !!statusType.completed;
          const inProgress  = statusType.name === "STATUS_IN_PROGRESS";

          if (!completed && !inProgress) continue;

          const home = competitors.find((c: Record<string, unknown>) => c.homeAway === "home");
          const away = competitors.find((c: Record<string, unknown>) => c.homeAway === "away");
          if (!home || !away) continue;

          const homeName = TEAM[(home.team as Record<string, string>)?.displayName ?? ""] ?? (home.team as Record<string, string>)?.displayName;
          const awayName = TEAM[(away.team as Record<string, string>)?.displayName ?? ""] ?? (away.team as Record<string, string>)?.displayName;
          const matchId  = MATCH_ID[`${homeName}|${awayName}`];
          if (!matchId) continue;

          const homeScore = parseInt(home.score as string) || 0;
          const awayScore = parseInt(away.score as string) || 0;

          const { error } = await sb.from("results").upsert({
            match_id:   matchId,
            home_score: homeScore,
            away_score: awayScore,
            home_pct:   50,
            draw_pct:   25,
            away_pct:   25,
            is_final:   completed,
            updated_at: new Date().toISOString(),
          }, { onConflict: "match_id" });

          if (!error) synced.push(`${matchId}: ${homeScore}-${awayScore}${completed ? " (FT)" : " (LIVE)"}`);
          else errors.push(`${matchId}: ${error.message}`);
        } catch { /* skip bad event */ }
      }
    } catch (e) {
      errors.push(`date ${date}: ${e}`);
    }
  }

  return NextResponse.json({ ok: true, synced, errors, datesChecked: getDatesToFetch().length });
}
