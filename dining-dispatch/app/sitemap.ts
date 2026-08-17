import type { MetadataRoute } from "next";
import { listIndexableRestaurantSlugs } from "@/lib/data";
import { absoluteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const indexable = await listIndexableRestaurantSlugs();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 0.7 },
  ];

  const restaurants: MetadataRoute.Sitemap = indexable.map((slug) => ({
    url: absoluteUrl(`/restaurants/${slug}`),
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  return [...staticRoutes, ...restaurants];
}
