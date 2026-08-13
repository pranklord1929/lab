export type ScoreVal = number | "";

export interface OddsResponse {
  live: boolean;
  home?: number | null;
  draw?: number | null;
  away?: number | null;
  source?: "polymarket";
}

export interface Match {
  id: string;
  day: number;
  time: string;
  gw: string;
  home: { name: string; flag: string; pct: number };
  draw: { pct: number };
  away: { name: string; flag: string; pct: number };
}
