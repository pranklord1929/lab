/**
 * polymarket.ts
 *
 * Fetches odds for a WC2026 match from the Polymarket Gamma API.
 * Usage:
 *   npx tsx scripts/polymarket.ts fifwc-ger-civ-2026-06-20
 *
 * Output: the winnerOddsBps values to pass to OracleAdapter.setResult()
 */

import {
  classifyMarket,
  parseOutcomePrices,
  teamsFromTitle,
  type PolymarketEvent,
} from "../app/lib/polymarket";

const GAMMA_API = "https://gamma-api.polymarket.com";

async function fetchMatchOdds(slug: string) {
  const url = `${GAMMA_API}/events/slug/${slug}`;
  console.log(`\nFetching: ${url}\n`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — slug not found: ${slug}`);

  const event: PolymarketEvent = await res.json();
  const [homeTeam, awayTeam] = teamsFromTitle(event.title);

  console.log(`Event:     ${event.title}`);
  console.log(`Home team: ${homeTeam}`);
  console.log(`Away team: ${awayTeam}\n`);

  const odds: Record<"home" | "away" | "draw", number | null> = {
    home: null,
    away: null,
    draw: null,
  };

  for (const market of event.markets) {
    const prices = parseOutcomePrices(market.outcomePrices);
    const yesPrice = prices[0]; // index 0 = "Yes" outcome price
    const type = classifyMarket(market.question, homeTeam, awayTeam);

    if (type) {
      odds[type] = yesPrice;
      const statusStr = market.resolved ? "✓ RESOLVED" : "open";
      console.log(
        `  [${type.padEnd(4)}] ${market.question.padEnd(60)} → ${(yesPrice * 100).toFixed(1).padStart(5)}%  (${statusStr})`
      );
    }
  }

  const homeBps  = odds.home  != null ? Math.round(odds.home  * 10000) : null;
  const awayBps  = odds.away  != null ? Math.round(odds.away  * 10000) : null;
  const drawBps  = odds.draw  != null ? Math.round(odds.draw  * 10000) : null;

  console.log("\n── winnerOddsBps for OracleAdapter.setResult() ─────────────────────");
  console.log(`  Home win (${homeTeam.padEnd(20)}): ${homeBps ?? "N/A"}`);
  console.log(`  Away win (${awayTeam.padEnd(20)}): ${awayBps ?? "N/A"}`);
  console.log(`  Draw:                           ${drawBps ?? "N/A"}`);
  console.log("\n  → After the match, pass the value that matches the ACTUAL outcome.");
  console.log(`  Example: if ${homeTeam} wins, call setResult(matchId, homeGoals, awayGoals, ${homeBps})`);

  // Show resolution if any market settled
  const resolved = event.markets.filter((m) => m.resolved);
  if (resolved.length > 0) {
    console.log("\n── Resolved ─────────────────────────────────────────────────────────");
    for (const m of resolved) {
      const prices = parseOutcomePrices(m.outcomePrices);
      const winner = prices[0] === 1 ? "YES" : "NO";
      console.log(`  ${m.question} → ${winner} won`);
    }
  }

  return { homeBps, awayBps, drawBps, homeTeam, awayTeam };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npx tsx scripts/polymarket.ts <event-slug>");
  console.error("Example: npx tsx scripts/polymarket.ts fifwc-ger-civ-2026-06-20");
  process.exit(1);
}

fetchMatchOdds(slug).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
