import catalogJson from "@/content/fixtures.json";
import { hydrateCatalog, toRestaurantSummary } from "@/lib/data/hydrate";
import type {
  CatalogDocument,
  CollectionRecord,
  RestaurantListQuery,
  RestaurantRecord,
  RestaurantSummary,
} from "@/lib/types";
const catalog = hydrateCatalog(catalogJson as CatalogDocument);

function published(rows: RestaurantRecord[]) {
  return rows.filter((r) => r.published);
}

function filterSummaries(
  rows: RestaurantRecord[],
  query: RestaurantListQuery = {},
): RestaurantSummary[] {
  let next = published(rows);

  if (query.featured) {
    next = next.filter((r) => r.featured);
  }
  if (query.neighborhood) {
    const needle = query.neighborhood.toLowerCase();
    next = next.filter((r) => r.neighborhood.toLowerCase() === needle);
  }
  if (query.tag) {
    next = next.filter((r) => r.tags.includes(query.tag!));
  }
  if (query.cuisine) {
    const needle = query.cuisine.toLowerCase();
    next = next.filter((r) =>
      r.cuisine.some((c) => c.toLowerCase() === needle),
    );
  }
  if (query.collectionSlug) {
    next = next.filter((r) =>
      r.collections.some((c) => c.slug === query.collectionSlug),
    );
  }

  const offset = query.offset ?? 0;
  const limit = query.limit ?? next.length;
  return next.slice(offset, offset + limit).map(toRestaurantSummary);
}

/** Demo-only. Not the V0 runtime store. */
export const fixtureStore = {
  async listRestaurantSlugs() {
    return published(catalog.restaurants).map((r) => r.slug);
  },

  async listRestaurants(query?: RestaurantListQuery) {
    return filterSummaries(catalog.restaurants, query);
  },

  async getRestaurantBySlug(slug: string) {
    return (
      published(catalog.restaurants).find((r) => r.slug === slug) ?? null
    );
  },

  async listRelated(slug: string, limit = 3) {
    const current = catalog.restaurants.find((r) => r.slug === slug);
    if (!current) return [];
    return published(catalog.restaurants)
      .filter(
        (r) => r.slug !== slug && r.neighborhood === current.neighborhood,
      )
      .slice(0, limit)
      .map(toRestaurantSummary);
  },

  async listCollections() {
    return catalog.collections;
  },

  async listCollectionSlugs() {
    return catalog.collections.map((c) => c.slug);
  },

  async getCollectionBySlug(slug: string) {
    const collection = catalog.collections.find((c) => c.slug === slug);
    if (!collection) return null;
    const restaurants = filterSummaries(catalog.restaurants, {
      collectionSlug: slug,
    });
    return { ...collection, restaurants } satisfies CollectionRecord;
  },
};
