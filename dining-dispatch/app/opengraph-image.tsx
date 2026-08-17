import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_TAGLINE } from "@/lib/site";

export const runtime = "nodejs";
export const alt = "The Dining Dispatch";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFonts() {
  const dir = join(process.cwd(), "vendor/deepstate/fonts");
  const [sans, mono] = await Promise.all([
    readFile(join(dir, "space-grotesk-700.ttf")),
    readFile(join(dir, "space-mono-700.ttf")),
  ]);
  return [
    { name: "Space Grotesk", data: sans, weight: 700 as const, style: "normal" as const },
    { name: "Space Mono", data: mono, weight: 700 as const, style: "normal" as const },
  ];
}

export default async function OpenGraphImage() {
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fff",
          color: "#000",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          border: "12px solid #000",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Space Mono", fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          <span>Mexico City</span>
          <span>V0</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "Space Grotesk", fontSize: 64, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", lineHeight: 1 }}>
            Dining Dispatch
          </div>
          <div style={{ marginTop: 24, fontFamily: "Space Mono", fontSize: 24, maxWidth: 900 }}>
            {SITE_TAGLINE}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
