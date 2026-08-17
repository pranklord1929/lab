import { siteDataStore } from "@/lib/data/site-data";
import type { RestaurantListQuery } from "@/lib/restaurants/types";

const store = siteDataStore;

export async function listRestaurantSlugs() {
  return store.listRestaurantSlugs();
}

export async function listIndexableRestaurantSlugs() {
  return store.listIndexableRestaurantSlugs();
}

export async function listRestaurants(query?: RestaurantListQuery) {
  return store.listRestaurants(query);
}

export async function listLaunchRestaurants(limit?: number) {
  return store.listLaunchRestaurants(limit);
}

export async function listRestaurantsBySlugs(slugs: string[]) {
  const rows = await Promise.all(slugs.map((slug) => store.getRestaurantBySlug(slug)));
  return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function listLaunchRestaurantRecords(limit?: number) {
  const launch = await listLaunchRestaurants(limit);
  return listRestaurantsBySlugs(launch.map((row) => row.slug));
}

export async function getRestaurantBySlug(slug: string) {
  return store.getRestaurantBySlug(slug);
}

export async function listRelated(slug: string, limit?: number) {
  return store.listRelated(slug, limit);
}

export async function listCollections() {
  return store.listCollections();
}

export async function listCollectionSlugs() {
  return store.listCollectionSlugs();
}

export async function getCollectionBySlug(param: string) {
  return store.getCollectionBySlug(param);
}
