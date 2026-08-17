import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Collection,
  CollectionRecord,
  CollectionSummary,
  Editorial,
  Faq,
  Hours,
  Menu,
  Note,
  PriceRange,
  ReservationDifficulty,
  ReservationInfo,
  Restaurant,
  RestaurantListQuery,
  RestaurantRecord,
  RestaurantSummary,
  Verification,
} from "@/lib/types";

type RestaurantRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  neighborhood: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  cuisine: string[];
  price_range: PriceRange;
  experience_type: string | null;
  website: string | null;
  instagram: string | null;
  hours: Hours | null;
  reservation_platform: string | null;
  reservation_url: string | null;
  reservation_difficulty: ReservationDifficulty;
  reservation_lead_days: number | null;
  reservation_tips: string | null;
  best_for: string[];
  avoid_for: string[];
  ambiance: string | null;
  ideal_moment: string | null;
  visitor_type: string | null;
  tags: string[];
  confidence_score: number | null;
  last_verified: string | null;
  featured: boolean;
  published: boolean;
};

const SUMMARY_COLUMNS =
  "id, slug, name, neighborhood, cuisine, price_range, experience_type, tags, confidence_score, last_verified, featured, best_for";

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function reservationFromRow(row: RestaurantRow): ReservationInfo {
  return {
    platform: row.reservation_platform,
    url: row.reservation_url,
    difficulty: row.reservation_difficulty,
    recommended_lead_days: row.reservation_lead_days,
    tips: row.reservation_tips,
  };
}

function editorialFromRow(row: RestaurantRow): Editorial {
  return {
    best_for: row.best_for ?? [],
    avoid_for: row.avoid_for ?? [],
    ambiance: row.ambiance,
    ideal_moment: row.ideal_moment,
    visitor_type: row.visitor_type,
  };
}

function toRestaurant(row: RestaurantRow): Restaurant {
  const editorial = editorialFromRow(row);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    neighborhood: row.neighborhood,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    cuisine: row.cuisine ?? [],
    price_range: row.price_range,
    experience_type: row.experience_type,
    website: row.website,
    instagram: row.instagram,
    hours: row.hours,
    reservation: reservationFromRow(row),
    editorial,
    tags: row.tags ?? [],
    confidence_score: row.confidence_score,
    last_verified: row.last_verified,
    featured: row.featured,
    published: row.published,
    best_for: editorial.best_for,
  };
}

function toSummary(row: Pick<RestaurantRow, keyof RestaurantSummary>): RestaurantSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    neighborhood: row.neighborhood,
    cuisine: row.cuisine ?? [],
    price_range: row.price_range,
    experience_type: row.experience_type,
    tags: row.tags ?? [],
    confidence_score: row.confidence_score,
    last_verified: row.last_verified,
    featured: row.featured,
    best_for: row.best_for ?? [],
  };
}

/** Legacy adapter. Not auto-selected; schema does not match site-data. */
export const supabaseStore = {
  async listRestaurantSlugs() {
    const { data, error } = await client()
      .from("restaurants")
      .select("slug")
      .eq("published", true);
    if (error) throw error;
    return (data ?? []).map((row) => row.slug as string);
  },

  async listRestaurants(query: RestaurantListQuery = {}) {
    let q = client()
      .from("restaurants")
      .select(SUMMARY_COLUMNS)
      .eq("published", true)
      .order("name");

    if (query.featured) q = q.eq("featured", true);
    if (query.neighborhood) q = q.eq("neighborhood", query.neighborhood);
    if (query.tag) q = q.contains("tags", [query.tag]);
    if (query.cuisine) q = q.contains("cuisine", [query.cuisine]);
    if (query.limit) q = q.limit(query.limit);
    if (query.offset) q = q.range(query.offset, query.offset + (query.limit ?? 50) - 1);

    if (query.collectionSlug) {
      const { data: collection, error: collectionError } = await client()
        .from("collections")
        .select("id")
        .eq("slug", query.collectionSlug)
        .maybeSingle();
      if (collectionError) throw collectionError;
      if (!collection) return [];

      const { data: members, error: memberError } = await client()
        .from("collection_restaurants")
        .select("restaurant_id, sort_order")
        .eq("collection_id", collection.id)
        .order("sort_order");
      if (memberError) throw memberError;
      const ids = (members ?? []).map((m) => m.restaurant_id as number);
      if (ids.length === 0) return [];

      const { data, error } = await client()
        .from("restaurants")
        .select(SUMMARY_COLUMNS)
        .eq("published", true)
        .in("id", ids);
      if (error) throw error;
      const byId = new Map((data ?? []).map((row) => [row.id, toSummary(row)]));
      return ids.map((id) => byId.get(id)).filter((row): row is RestaurantSummary => Boolean(row));
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((row) => toSummary(row));
  },

  async getRestaurantBySlug(slug: string) {
    const db = client();
    const { data: row, error } = await db
      .from("restaurants")
      .select("*")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;

    const restaurant = toRestaurant(row as RestaurantRow);

    const [menus, verifications, notes, faqs, memberships] = await Promise.all([
      db.from("menus").select("*").eq("restaurant_id", restaurant.id).order("id"),
      db.from("verifications").select("*").eq("restaurant_id", restaurant.id).order("date_checked", { ascending: false }),
      db.from("notes").select("*").eq("restaurant_id", restaurant.id).order("date", { ascending: false }),
      db.from("faqs").select("*").eq("restaurant_id", restaurant.id).order("sort_order"),
      db
        .from("collection_restaurants")
        .select("collection_id, collections(id, slug, title, intent)")
        .eq("restaurant_id", restaurant.id),
    ]);

    for (const result of [menus, verifications, notes, faqs, memberships]) {
      if (result.error) throw result.error;
    }

    const collections: CollectionSummary[] = (memberships.data ?? [])
      .map((row) => {
        const nested = row.collections as CollectionSummary | CollectionSummary[] | null;
        return Array.isArray(nested) ? nested[0] : nested;
      })
      .filter((c): c is CollectionSummary => Boolean(c));

    return {
      ...restaurant,
      menus: (menus.data ?? []) as Menu[],
      verifications: (verifications.data ?? []) as Verification[],
      notes: (notes.data ?? []) as Note[],
      faqs: (faqs.data ?? []) as Faq[],
      collections,
    } satisfies RestaurantRecord;
  },

  async listRelated(slug: string, limit = 3) {
    const db = client();
    const { data: current, error } = await db
      .from("restaurants")
      .select("neighborhood")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!current) return [];

    const { data, error: relatedError } = await db
      .from("restaurants")
      .select(SUMMARY_COLUMNS)
      .eq("published", true)
      .eq("neighborhood", current.neighborhood)
      .neq("slug", slug)
      .order("name")
      .limit(limit);
    if (relatedError) throw relatedError;
    return (data ?? []).map((row) => toSummary(row));
  },

  async listCollections() {
    const { data, error } = await client()
      .from("collections")
      .select("id, slug, title, description, intent, seo_title, seo_description")
      .order("title");
    if (error) throw error;
    return (data ?? []) as Collection[];
  },

  async listCollectionSlugs() {
    const { data, error } = await client().from("collections").select("slug");
    if (error) throw error;
    return (data ?? []).map((row) => row.slug as string);
  },

  async getCollectionBySlug(slug: string) {
    const db = client();
    const { data: collection, error } = await db
      .from("collections")
      .select("id, slug, title, description, intent, seo_title, seo_description")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!collection) return null;

    const { data: members, error: memberError } = await db
      .from("collection_restaurants")
      .select("restaurant_id, sort_order")
      .eq("collection_id", collection.id)
      .order("sort_order");
    if (memberError) throw memberError;

    const ids = (members ?? []).map((m) => m.restaurant_id as number);
    let restaurants: RestaurantSummary[] = [];
    if (ids.length > 0) {
      const { data, error: restError } = await db
        .from("restaurants")
        .select(SUMMARY_COLUMNS)
        .eq("published", true)
        .in("id", ids);
      if (restError) throw restError;
      const byId = new Map((data ?? []).map((row) => [row.id, toSummary(row)]));
      restaurants = ids
        .map((id) => byId.get(id))
        .filter((row): row is RestaurantSummary => Boolean(row));
    }

    return { ...(collection as Collection), restaurants } satisfies CollectionRecord;
  },
};
