import type {
  MenuDocument,
  MenuItem,
  RestaurantIndexRecord,
  SiteCollection,
  SiteRestaurant,
} from "@/lib/restaurants/types";
import { slugifyLabel } from "@/lib/restaurants/paths";

export type V1RegistryEntry = {
  name: string;
  status: string;
  slug: string;
  stage: string | null;
  action: string | null;
  v1State: string;
};

export type V1MenuFile = {
  slug: string;
  name?: string;
  url?: string | null;
  status?: string | null;
  observedAt?: string | null;
  items?: Array<{
    id?: string;
    documentId?: string | null;
    name: string;
    description?: string | null;
    price?: number | null;
    currency?: string | null;
    category?: string | null;
    sourceUrl?: string | null;
    observedAt?: string | null;
    extractionConfidence?: number | null;
    extractionLayer?: string | null;
  }>;
};

export type V1EnrichedRecord = {
  slug: string;
  name: string;
  location?: {
    address?: string | null;
    neighborhood?: string | null;
    borough?: string | null;
    coordinates?: { latitude: number; longitude: number } | null;
  };
  contact?: {
    phone?: string | null;
    website?: string | null;
    instagram?: string | null;
  };
  hours?: Array<string | { weekday?: string; start?: string; end?: string }>;
  food?: {
    cuisine?: string | null;
    priceLevel?: number | null;
  };
  reservation?: {
    platform?: string | null;
    url?: string | null;
  };
  distinctions?: {
    michelin?: string | null;
    michelinStars?: number | null;
    bibGourmand?: boolean;
    worlds50Best?: boolean;
    worlds50BestRank?: string | null;
    worlds50BestList?: string | null;
  };
  sources?: Array<{ source?: string; url?: string }>;
  enrichedAt?: string | null;
  editorial?: { status?: string | null };
  seo?: { indexable?: boolean };
};

function emptyEditorial(status = "pending"): SiteRestaurant["editorial"] {
  return {
    status,
    bestFor: [],
    avoidFor: [],
    ambience: null,
    idealMoment: null,
    visitorTypes: [],
    review: null,
    author: null,
    reviewedAt: null,
  };
}

function mapsUrl(coordinates: { latitude: number; longitude: number } | null | undefined) {
  if (coordinates?.latitude == null || coordinates?.longitude == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`;
}

export function normalizeHours(hours: unknown): string[] {
  if (!Array.isArray(hours)) return [];
  return hours
    .map((row) => {
      if (typeof row === "string") return row.trim();
      if (row && typeof row === "object") {
        const entry = row as { weekday?: string; days?: string; start?: string; end?: string };
        const day = entry.weekday ?? entry.days;
        if (day && entry.start && entry.end) return `${day} ${entry.start}–${entry.end}`;
        if (entry.start && entry.end) return `${entry.start}–${entry.end}`;
      }
      return "";
    })
    .filter(Boolean);
}

export function restaurantFromEnriched(record: V1EnrichedRecord): SiteRestaurant {
  const reservationUrl = record.reservation?.url ?? null;
  const reservationPlatform = record.reservation?.platform ?? null;
  const sourceNames = [
    ...new Set(
      (record.sources ?? [])
        .map((source) => source.source)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  return {
    schemaVersion: "tdd.v1.enriched",
    id: `v1:${record.slug}`,
    slug: record.slug,
    name: record.name,
    location: {
      neighborhood: record.location?.neighborhood ?? null,
      borough: record.location?.borough ?? null,
      address: record.location?.address ?? null,
      coordinates: record.location?.coordinates ?? null,
    },
    contact: {
      phone: record.contact?.phone ?? null,
      website: record.contact?.website ?? null,
      instagram: record.contact?.instagram ?? null,
      googleMapsUrl: mapsUrl(record.location?.coordinates),
    },
    food: {
      cuisine: record.food?.cuisine ?? null,
      michelinCuisine: null,
      openTableCuisine: null,
      priceLevel: record.food?.priceLevel ?? null,
    },
    experience: {
      sourceSummary: null,
      hours: normalizeHours(record.hours),
      rating: null,
      reviewCount: null,
    },
    distinctions: {
      michelin: record.distinctions?.michelin ?? null,
      michelinStars: record.distinctions?.michelinStars ?? 0,
      bibGourmand: Boolean(record.distinctions?.bibGourmand),
      worlds50Best: Boolean(record.distinctions?.worlds50Best),
      worlds50BestRank: record.distinctions?.worlds50BestRank ?? null,
      worlds50BestList: record.distinctions?.worlds50BestList ?? null,
    },
    reservation: {
      openTableUrl:
        reservationPlatform && /opentable/i.test(reservationPlatform)
          ? reservationUrl
          : null,
      links: reservationUrl
        ? [
            {
              url: reservationUrl,
              platform: reservationPlatform,
              provider: reservationPlatform,
              type: "reservation",
            },
          ]
        : [],
      difficulty: null,
      recommendedLeadTime: null,
      advice: null,
    },
    menu: {
      state: "missing",
      observedAt: null,
      observationAgeDaysAtExport: null,
      documentCount: 0,
      itemCount: 0,
      documents: [],
      items: [],
    },
    links: (record.sources ?? [])
      .filter((source): source is { source?: string; url: string } => Boolean(source.url))
      .map((source) => ({
        type: source.source === "instagram" ? "social" : "source",
        provider: source.source ?? "source",
        url: source.url,
        confidence: null,
        checkedAt: record.enrichedAt ?? null,
      })),
    media: {
      photoCount: 0,
      publicImageUrl: null,
      note: "No public restaurant photos in the V1 export.",
    },
    verification: {
      status: "machine_assembled_candidate",
      sourceCount: sourceNames.length,
      sourceNames,
      fieldProvenance: {},
      freshestSourceAt: record.enrichedAt ?? null,
      canonicalUpdatedAt: record.enrichedAt ?? null,
      snapshotGeneratedAt: record.enrichedAt ?? null,
      humanReviewedAt: null,
    },
    editorial: emptyEditorial(record.editorial?.status || "pending"),
    seo: {
      launchEligible: false,
      indexable: false,
      title: null,
      description: null,
      faq: [],
    },
  };
}

export function applyV1Menu(restaurant: SiteRestaurant, menu: V1MenuFile | null): SiteRestaurant {
  if (!menu) return restaurant;

  const items: MenuItem[] = (menu.items ?? []).map((item, index) => ({
    id: item.id ?? `${restaurant.slug}-menu-${index}`,
    documentId: item.documentId ?? null,
    name: item.name,
    description: item.description ?? null,
    price: item.price ?? null,
    currency: item.currency ?? null,
    category: item.category ?? null,
    sourceUrl: item.sourceUrl ?? menu.url ?? null,
    observedAt: item.observedAt ?? menu.observedAt ?? null,
    extractionConfidence: item.extractionConfidence ?? null,
    extractionLayer: item.extractionLayer ?? "v1_menu",
  }));

  const document: MenuDocument | null = menu.url
    ? {
        id: `${restaurant.slug}-menu-source`,
        sourceUrl: menu.url,
        fileType: null,
        language: null,
        confidence: null,
        extractionMethod: null,
        status: menu.status ?? null,
        lastCheckedAt: menu.observedAt ?? null,
      }
    : null;

  const state = items.length
    ? "structured_candidate"
    : document
      ? "document_only"
      : "missing";

  return {
    ...restaurant,
    menu: {
      ...restaurant.menu,
      state,
      observedAt: menu.observedAt ?? restaurant.menu.observedAt,
      itemCount: items.length,
      documentCount: document ? 1 : restaurant.menu.documents.length,
      documents: document ? [document] : restaurant.menu.documents,
      items,
    },
  };
}

export function toIndexRecord(restaurant: SiteRestaurant): RestaurantIndexRecord {
  return {
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    neighborhood: restaurant.location.neighborhood ?? "Mexico City",
    borough: restaurant.location.borough,
    cuisine: restaurant.food.cuisine,
    priceLevel: restaurant.food.priceLevel,
    rating: restaurant.experience.rating,
    reviewCount: restaurant.experience.reviewCount,
    michelin: restaurant.distinctions.michelin,
    worlds50Best: restaurant.distinctions.worlds50Best,
    menuState: restaurant.menu.state,
    menuObservedAt: restaurant.menu.observedAt,
    sourceCount: restaurant.verification.sourceCount,
    freshestSourceAt: restaurant.verification.freshestSourceAt,
    launchEligible: restaurant.seo.launchEligible,
    indexable: restaurant.seo.indexable === true,
    editorialStatus: restaurant.editorial.status,
    qaFlags: [],
  };
}

export function mergeObjectiveCollections(
  base: SiteCollection[],
  restaurants: SiteRestaurant[],
): SiteCollection[] {
  const map = new Map<string, SiteCollection>();
  for (const collection of base) {
    map.set(collection.id, {
      ...collection,
      restaurantSlugs: [...collection.restaurantSlugs],
    });
  }

  const upsert = (type: string, slug: string, label: string, restaurantSlug: string) => {
    if (!slug) return;
    const id = `${type}:${slug}`;
    const existing = map.get(id);
    if (existing) {
      if (!existing.restaurantSlugs.includes(restaurantSlug)) {
        existing.restaurantSlugs.push(restaurantSlug);
      }
      existing.restaurantCount = existing.restaurantSlugs.length;
      return;
    }
    map.set(id, {
      id,
      type,
      slug,
      label,
      restaurantCount: 1,
      restaurantSlugs: [restaurantSlug],
    });
  };

  for (const restaurant of restaurants) {
    const neighborhood = restaurant.location.neighborhood;
    if (neighborhood) {
      upsert("neighborhood", slugifyLabel(neighborhood), neighborhood, restaurant.slug);
    }
    const borough = restaurant.location.borough;
    if (borough) {
      upsert("borough", slugifyLabel(borough), borough, restaurant.slug);
    }
    const cuisine = restaurant.food.cuisine;
    if (cuisine) {
      upsert("cuisine", slugifyLabel(cuisine), cuisine, restaurant.slug);
    }
    if (restaurant.distinctions.michelin) {
      upsert(
        "distinction",
        "michelin",
        "Michelin-recognized restaurants",
        restaurant.slug,
      );
    }
    if (restaurant.distinctions.worlds50Best) {
      upsert("distinction", "worlds-50-best", "World's 50 Best", restaurant.slug);
    }
  }

  return [...map.values()]
    .map((collection) => ({
      ...collection,
      restaurantCount: collection.restaurantSlugs.length,
    }))
    .filter((collection) => collection.restaurantCount > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}
