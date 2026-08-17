import type {
  CatalogDocument,
  Collection,
  CollectionDocument,
  CollectionSummary,
  Editorial,
  Faq,
  Hours,
  Menu,
  Note,
  ReservationInfo,
  Restaurant,
  RestaurantDocument,
  RestaurantRecord,
  RestaurantSummary,
  Verification,
} from "@/lib/types";

let nextId = 1;
function id() {
  return nextId++;
}

export function resetIds() {
  nextId = 1;
}

const EMPTY_HOURS: Hours = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

export function defaultReservation(
  input: RestaurantDocument["reservation"],
): ReservationInfo {
  return {
    platform: input?.platform ?? null,
    url: input?.url ?? null,
    difficulty: input?.difficulty ?? "moderate",
    recommended_lead_days: input?.recommended_lead_days ?? null,
    tips: input?.tips ?? null,
  };
}

export function defaultEditorial(
  input: RestaurantDocument["editorial"],
): Editorial {
  return {
    best_for: input?.best_for ?? [],
    avoid_for: input?.avoid_for ?? [],
    ambiance: input?.ambiance ?? null,
    ideal_moment: input?.ideal_moment ?? null,
    visitor_type: input?.visitor_type ?? null,
  };
}

export function toRestaurantSummary(row: Restaurant): RestaurantSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    neighborhood: row.neighborhood,
    cuisine: row.cuisine,
    price_range: row.price_range,
    experience_type: row.experience_type,
    tags: row.tags,
    confidence_score: row.confidence_score,
    last_verified: row.last_verified,
    featured: row.featured,
    best_for: row.editorial.best_for,
  };
}

export function hydrateCatalog(doc: CatalogDocument): {
  collections: Collection[];
  restaurants: RestaurantRecord[];
} {
  resetIds();
  const collections = doc.collections.map((c) => hydrateCollection(c));
  const bySlug = new Map(collections.map((c) => [c.slug, c]));

  const restaurants = doc.restaurants.map((r) => {
    const restaurantId = id();
    const editorial = defaultEditorial(r.editorial);
    const restaurant: Restaurant = {
      id: restaurantId,
      slug: r.slug,
      name: r.name,
      description: r.description ?? null,
      neighborhood: r.neighborhood,
      address: r.address ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      cuisine: r.cuisine ?? [],
      price_range: r.price_range,
      experience_type: r.experience_type ?? null,
      website: r.website ?? null,
      instagram: r.instagram ?? null,
      hours: r.hours ?? EMPTY_HOURS,
      reservation: defaultReservation(r.reservation),
      editorial,
      tags: r.tags ?? [],
      confidence_score: r.confidence_score ?? null,
      last_verified: r.last_verified ?? null,
      featured: r.featured ?? false,
      published: r.published ?? true,
      best_for: editorial.best_for,
    };

    const menus: Menu[] = (r.menus ?? []).map((m) => ({
      ...m,
      id: id(),
      restaurant_id: restaurantId,
    }));
    const verifications: Verification[] = (r.verifications ?? []).map((v) => ({
      ...v,
      id: id(),
      restaurant_id: restaurantId,
    }));
    const notes: Note[] = (r.notes ?? []).map((n) => ({
      ...n,
      id: id(),
      restaurant_id: restaurantId,
    }));
    const faqs: Faq[] = (r.faqs ?? []).map((f, index) => ({
      ...f,
      id: id(),
      restaurant_id: restaurantId,
      sort_order: f.sort_order ?? index,
    }));

    const linked: CollectionSummary[] = (r.collection_slugs ?? [])
      .map((slug) => bySlug.get(slug))
      .filter((c): c is Collection => Boolean(c))
      .map(({ id: cid, slug, title, intent }) => ({
        id: cid,
        slug,
        title,
        intent,
      }));

    return {
      ...restaurant,
      menus,
      verifications,
      notes,
      faqs,
      collections: linked,
    } satisfies RestaurantRecord;
  });

  return { collections, restaurants };
}

function hydrateCollection(c: CollectionDocument): Collection {
  return {
    id: id(),
    slug: c.slug,
    title: c.title,
    description: c.description ?? null,
    intent: c.intent ?? null,
    seo_title: c.seo_title ?? null,
    seo_description: c.seo_description ?? null,
  };
}
