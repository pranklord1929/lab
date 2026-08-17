export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DayKey = (typeof DAYS)[number];

export type TimeRange = {
  open: string;
  close: string;
};

export type Hours = Record<DayKey, TimeRange[]>;

export type PriceRange = "$" | "$$" | "$$$" | "$$$$";

export type ReservationDifficulty =
  | "walk_in"
  | "easy"
  | "moderate"
  | "hard"
  | "very_hard";

export type MenuType =
  | "tasting"
  | "omakase"
  | "a_la_carte"
  | "lunch"
  | "dinner"
  | "weekend"
  | "other";

export type ReservationInfo = {
  platform: string | null;
  url: string | null;
  difficulty: ReservationDifficulty;
  recommended_lead_days: number | null;
  tips: string | null;
};

export type Editorial = {
  best_for: string[];
  avoid_for: string[];
  ambiance: string | null;
  ideal_moment: string | null;
  visitor_type: string | null;
};

export type MenuItem = {
  name: string;
  description?: string;
  price?: number | null;
  notable?: boolean;
  dietary?: string[];
};

export type Menu = {
  id: number;
  restaurant_id: number;
  menu_type: MenuType;
  name: string;
  currency: string;
  price: number | null;
  items: MenuItem[];
  vegetarian_options: boolean;
  source: string | null;
  last_verified: string | null;
  notes: string | null;
};

export type Verification = {
  id: number;
  restaurant_id: number;
  source: string;
  information_checked: string;
  date_checked: string;
  confidence: number;
  notes: string | null;
};

export type Note = {
  id: number;
  restaurant_id: number;
  author: string;
  date: string;
  context: string | null;
  note: string;
};

export type Faq = {
  id: number;
  restaurant_id: number;
  question: string;
  answer: string;
  sort_order: number;
};

export type CollectionSummary = {
  id: number;
  slug: string;
  title: string;
  intent: string | null;
};

export type Collection = CollectionSummary & {
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

export type RestaurantSummary = {
  id: number;
  slug: string;
  name: string;
  neighborhood: string;
  cuisine: string[];
  price_range: PriceRange;
  experience_type: string | null;
  tags: string[];
  confidence_score: number | null;
  last_verified: string | null;
  featured: boolean;
  best_for: string[];
};

export type Restaurant = RestaurantSummary & {
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  instagram: string | null;
  hours: Hours | null;
  reservation: ReservationInfo;
  editorial: Editorial;
  published: boolean;
};

export type RestaurantRecord = Restaurant & {
  menus: Menu[];
  verifications: Verification[];
  notes: Note[];
  faqs: Faq[];
  collections: CollectionSummary[];
};

export type CollectionRecord = Collection & {
  restaurants: RestaurantSummary[];
};

/** Nested document used by fixtures and bulk ingest. */
export type RestaurantDocument = {
  slug: string;
  name: string;
  description?: string | null;
  neighborhood: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  cuisine?: string[];
  price_range: PriceRange;
  experience_type?: string | null;
  website?: string | null;
  instagram?: string | null;
  hours?: Hours | null;
  reservation?: Partial<ReservationInfo>;
  editorial?: Partial<Editorial>;
  tags?: string[];
  confidence_score?: number | null;
  last_verified?: string | null;
  featured?: boolean;
  published?: boolean;
  menus?: Array<Omit<Menu, "id" | "restaurant_id">>;
  verifications?: Array<Omit<Verification, "id" | "restaurant_id">>;
  notes?: Array<Omit<Note, "id" | "restaurant_id">>;
  faqs?: Array<Omit<Faq, "id" | "restaurant_id" | "sort_order"> & { sort_order?: number }>;
  collection_slugs?: string[];
};

export type CollectionDocument = {
  slug: string;
  title: string;
  description?: string | null;
  intent?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
};

export type CatalogDocument = {
  collections: CollectionDocument[];
  restaurants: RestaurantDocument[];
};

export type RestaurantListQuery = {
  neighborhood?: string;
  tag?: string;
  cuisine?: string;
  collectionSlug?: string;
  featured?: boolean;
  limit?: number;
  offset?: number;
};
