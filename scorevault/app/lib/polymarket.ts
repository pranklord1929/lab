export interface PolymarketMarket {
  id?: string;
  question: string;
  conditionId?: string;
  outcomePrices: string | string[];
  outcomes?: string | string[];
  resolved?: boolean | null;
}

export interface PolymarketEvent {
  slug?: string;
  title: string;
  markets: PolymarketMarket[];
}

export type MatchOdds = {
  home: number | null;
  draw: number | null;
  away: number | null;
};

export function parseOutcomePrices(raw: string | string[]): number[] {
  const prices: string[] = typeof raw === "string" ? JSON.parse(raw) : raw;
  return prices.map(Number);
}

export function teamsFromTitle(title: string): [string, string] {
  const parts = title.split(/\s+vs\.?\s+/i);
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? ""];
}

export function classifyMarket(
  question: string,
  homeTeam: string,
  awayTeam: string,
): keyof MatchOdds | null {
  const normalizedQuestion = question.toLowerCase();
  if (normalizedQuestion.includes("draw")) return "draw";
  if (homeTeam && normalizedQuestion.includes(homeTeam.toLowerCase())) return "home";
  if (awayTeam && normalizedQuestion.includes(awayTeam.toLowerCase())) return "away";
  return null;
}

export function oddsFromEvent(event: PolymarketEvent): MatchOdds {
  const [homeTeam, awayTeam] = teamsFromTitle(event.title);
  const odds: MatchOdds = { home: null, draw: null, away: null };

  for (const market of event.markets ?? []) {
    const outcome = classifyMarket(market.question, homeTeam, awayTeam);
    if (!outcome) continue;
    odds[outcome] = parseOutcomePrices(market.outcomePrices)[0] ?? null;
  }

  return odds;
}
