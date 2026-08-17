import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRestaurantBySlug } from "@/lib/data";
import {
  formatCuisine,
  formatPriceLevel,
} from "@/lib/restaurants/format";

export const runtime = "nodejs";
export const alt = "Restaurant fiche";
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

export default async function RestaurantOpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  const fonts = await loadFonts();
  const name = restaurant?.name ?? slug;
  const neighborhood = restaurant?.location.neighborhood ?? "Mexico City";
  const cuisine = formatCuisine(restaurant?.food.cuisine);
  const price = formatPriceLevel(restaurant?.food.priceLevel);
  const meta = [neighborhood, price, cuisine].filter(Boolean).join(" · ");

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
          <span>Dining Dispatch</span>
          <span>{price ?? "CDMX"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "Space Grotesk", fontSize: 60, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1.05 }}>
            {name}
          </div>
          <div style={{ marginTop: 24, fontFamily: "Space Mono", fontSize: 24 }}>
            {meta}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
