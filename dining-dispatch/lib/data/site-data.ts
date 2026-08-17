import "server-only";

import type { CatalogStore } from "@/lib/data/types";
import {
  loadCollections,
  loadIndex,
  loadRegistrySlugs,
  loadRestaurantBySlug,
} from "@/lib/restaurants/load";
import {
  collectionParam,
  parseCollectionParam,
} from "@/lib/restaurants/paths";
import type {
  RestaurantIndexRecord,
  RestaurantListQuery,
  SiteCollectionRecord,
} from "@/lib/restaurants/types";

function applyQuery(
  rows: RestaurantIndexRecord[],
  query: RestaurantListQuery = {},
) {
  let next = rows;
  if (query.launchEligible) {
    next = next.filter((row) => row.launchEligible);
  }
  if (query.indexable) {
    next = next.filter((row) => row.indexable);
  }
  if (query.neighborhood) {
    const needle = query.neighborhood.toLowerCase();
    next = next.filter((row) => row.neighborhood.toLowerCase() === needle);
  }
  if (query.cuisine) {
    const needle = query.cuisine.toLowerCase();
    next = next.filter((row) => (row.cuisine ?? "").toLowerCase() === needle);
  }
  const offset = query.offset ?? 0;
  const limit = query.limit ?? next.length;
  return next.slice(offset, offset + limit);
}

export const siteDataStore: CatalogStore = {
  async listRestaurantSlugs() {
    return loadRegistrySlugs();
  },

  async listIndexableRestaurantSlugs() {
    const index = await loadIndex();
    return index.filter((row) => row.indexable).map((row) => row.slug);
  },

  async listRestaurants(query) {
    const index = await loadIndex();
    return applyQuery(index, query);
  },

  async listLaunchRestaurants(limit) {
    const index = await loadIndex();
    return typeof limit === "number" ? index.slice(0, limit) : index;
  },

  async getRestaurantBySlug(slug) {
    return loadRestaurantBySlug(slug);
  },

  async listRelated(slug, limit = 3) {
    const [index, current] = await Promise.all([
      loadIndex(),
      loadRestaurantBySlug(slug),
    ]);
    if (!current) return [];
    const neighborhood = current.location.neighborhood;
    return index
      .filter((row) => row.slug !== slug && row.neighborhood === neighborhood)
      .slice(0, limit);
  },

  async listCollections() {
    return loadCollections();
  },

  async listCollectionSlugs() {
    const collections = await loadCollections();
    return collections.map(collectionParam);
  },

  async getCollectionBySlug(param) {
    const collections = await loadCollections();
    const parsed = parseCollectionParam(param);
    const collection = collections.find((row) => {
      if (parsed.type) {
        return row.type === parsed.type && row.slug === parsed.slug;
      }
      const matches = collections.filter((item) => item.slug === parsed.slug);
      return matches.length === 1 && row.slug === parsed.slug;
    });
    if (!collection) return null;

    const index = await loadIndex();
    const bySlug = new Map(index.map((row) => [row.slug, row]));
    const restaurants = collection.restaurantSlugs
      .map((slug) => bySlug.get(slug))
      .filter((row): row is RestaurantIndexRecord => Boolean(row));

    return { ...collection, restaurants } satisfies SiteCollectionRecord;
  },
};
