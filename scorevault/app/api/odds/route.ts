import { NextResponse } from "next/server";
import {
  oddsFromEvent,
  type PolymarketEvent,
} from "@/app/lib/polymarket";

const GAMMA = "https://gamma-api.polymarket.com";

// Polymarket event slugs — populated once Polymarket publishes WC2026 markets.
// Format follows their FIFA WC convention: fifwc-{home3}-{away3}-{date}
const SLUGS: Record<string, string> = {
  "gha-pan": "fifwc-gha-pan-2026-06-18",
  "uzb-col": "fifwc-uzb-col-2026-06-18",
  "cze-rsa": "fifwc-cze-rsa-2026-06-18",
  "usa-bol": "fifwc-usa-bol-2026-06-19",
  "ecu-ven": "fifwc-ecu-ven-2026-06-19",
  "mex-cam": "fifwc-mex-cam-2026-06-19",
  "fra-aut": "fifwc-fra-aut-2026-06-20",
  "bra-arg": "fifwc-bra-arg-2026-06-20",
  "eng-irl": "fifwc-eng-irl-2026-06-21",
  "esp-mar": "fifwc-esp-mar-2026-06-21",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("match") ?? "";
  const slug = SLUGS[matchId];

  if (!slug) return NextResponse.json({ live: false }, { status: 400 });

  try {
    const res = await fetch(`${GAMMA}/events/slug/${slug}`, {
      next: { revalidate: 30 },
    });

    if (!res.ok) return NextResponse.json({ live: false });

    const event = (await res.json()) as PolymarketEvent;
    if (!event?.markets?.length) return NextResponse.json({ live: false });

    const odds = oddsFromEvent(event);

    // Convert to integer percentages
    return NextResponse.json({
      live: true,
      home: odds.home != null ? Math.round(odds.home * 100) : null,
      draw: odds.draw != null ? Math.round(odds.draw * 100) : null,
      away: odds.away != null ? Math.round(odds.away * 100) : null,
      source: "polymarket",
    });
  } catch {
    return NextResponse.json({ live: false });
  }
}
