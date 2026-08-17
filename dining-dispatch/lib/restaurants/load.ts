import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import {
  applyV1Menu,
  restaurantFromEnriched,
  toIndexRecord,
  mergeObjectiveCollections,
  normalizeHours,
  type V1EnrichedRecord,
  type V1MenuFile,
  type V1RegistryEntry,
} from "@/lib/restaurants/from-v1";
import {
  ENRICHED_ROOT,
  MENUS_ROOT,
  SITE_DATA_ROOT,
  V1_ROOT,
} from "@/lib/restaurants/paths";
import type { SiteCollection, SiteRestaurant } from "@/lib/restaurants/types";
import { MENU_STATES } from "@/lib/restaurants/types";

async function readJsonFile<T>(absPath: string): Promise<T> {
  const raw = await readFile(absPath, "utf8");
  return JSON.parse(raw) as T;
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function readOptionalJson<T>(absPath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(absPath);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export const loadRegistry = cache(async () => {
  const records = await readJsonFile<V1RegistryEntry[]>(join(V1_ROOT, "registry.json"));
  if (!Array.isArray(records)) {
    throw new Error("v1/registry.json must be an array");
  }
  return records.filter((row) => typeof row.slug === "string" && row.slug.length > 0);
});

export const loadRegistrySlugs = cache(async () => {
  const registry = await loadRegistry();
  return registry.map((row) => row.slug);
});

export const loadBaseCollections = cache(async () => {
  const records = await readJsonFile<SiteCollection[]>(
    join(SITE_DATA_ROOT, "collections.json"),
  );
  if (!Array.isArray(records)) {
    throw new Error("v1/site-data/collections.json must be an array");
  }
  return records;
});

const loadV1Menu = cache(async (slug: string) => {
  return readOptionalJson<V1MenuFile>(join(MENUS_ROOT, `${slug}.json`));
});

const loadSiteRestaurant = cache(async (slug: string) => {
  return readOptionalJson<SiteRestaurant>(
    join(SITE_DATA_ROOT, "restaurants", `${slug}.json`),
  );
});

const loadEnrichedRestaurant = cache(async (slug: string) => {
  return readOptionalJson<V1EnrichedRecord>(join(ENRICHED_ROOT, `${slug}.json`));
});

export const loadRestaurantBySlug = cache(async (slug: string) => {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const registrySlugs = await loadRegistrySlugs();
  if (!registrySlugs.includes(slug)) return null;

  const siteRecord = await loadSiteRestaurant(slug);
  let restaurant: SiteRestaurant | null = null;
  if (siteRecord) {
    assertRestaurant(siteRecord, slug);
    restaurant = siteRecord;
  } else {
    const enriched = await loadEnrichedRestaurant(slug);
    if (!enriched) return null;
    restaurant = restaurantFromEnriched(enriched);
  }

  const menu = await loadV1Menu(slug);
  restaurant = applyV1Menu(restaurant, menu);
  restaurant = {
    ...restaurant,
    experience: {
      ...restaurant.experience,
      hours: normalizeHours(restaurant.experience.hours),
    },
  };
  if (restaurant.seo.indexable !== true) {
    restaurant = {
      ...restaurant,
      seo: { ...restaurant.seo, indexable: false, faq: [] },
      editorial: {
        ...restaurant.editorial,
        bestFor: [],
        avoidFor: [],
        review: restaurant.editorial.status === "reviewed" ? restaurant.editorial.review : null,
      },
      reservation: {
        ...restaurant.reservation,
        difficulty: null,
        recommendedLeadTime: null,
        advice: null,
      },
    };
  }
  assertRestaurant(restaurant, slug);
  return restaurant;
});

export const loadCatalog = cache(async () => {
  const slugs = await loadRegistrySlugs();
  const rows = await Promise.all(slugs.map((slug) => loadRestaurantBySlug(slug)));
  return rows.filter((row): row is SiteRestaurant => Boolean(row));
});

export const loadIndex = cache(async () => {
  const catalog = await loadCatalog();
  return catalog.map(toIndexRecord);
});

export const loadCollections = cache(async () => {
  const [base, catalog] = await Promise.all([loadBaseCollections(), loadCatalog()]);
  return mergeObjectiveCollections(base, catalog);
});

function assertRestaurant(record: SiteRestaurant, slug: string) {
  if (record.slug !== slug) {
    throw new Error(`Restaurant file slug mismatch: ${slug}`);
  }
  if (!record.id || !record.name) {
    throw new Error(`Restaurant ${slug} is missing id or name`);
  }
  if (typeof record.seo?.indexable !== "boolean") {
    throw new Error(`Restaurant ${slug} is missing seo.indexable`);
  }
  if (!record.editorial?.status) {
    throw new Error(`Restaurant ${slug} is missing editorial.status`);
  }
  if (!record.menu?.state) {
    throw new Error(`Restaurant ${slug} is missing menu.state`);
  }
  if (
    !MENU_STATES.includes(record.menu.state as (typeof MENU_STATES)[number]) &&
    typeof record.menu.state !== "string"
  ) {
    throw new Error(`Restaurant ${slug} has an invalid menu.state`);
  }
}
