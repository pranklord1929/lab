export const MENU_STATES = [
  "structured_candidate",
  "local_extraction_candidate",
  "document_only",
  "missing",
] as const;

export type MenuState = (typeof MENU_STATES)[number];

export type RestaurantIndexRecord = {
  id: string;
  slug: string;
  name: string;
  neighborhood: string;
  borough: string | null;
  cuisine: string | null;
  priceLevel: number | null;
  rating: number | null;
  reviewCount: number | null;
  michelin: string | null;
  worlds50Best: boolean;
  menuState: MenuState | string;
  menuObservedAt: string | null;
  sourceCount: number;
  freshestSourceAt: string | null;
  launchEligible: boolean;
  indexable: boolean;
  editorialStatus: string;
  qaFlags: string[];
};

export type LaunchCandidate = {
  id: string;
  slug: string;
  name: string;
  neighborhood: string;
  cuisine: string | null;
  top500Rank: number;
  sourceCount: number;
  menuState: MenuState | string;
  editorialStatus: string;
  indexable: boolean;
};

export type CollectionType =
  | "borough"
  | "cuisine"
  | "distinction"
  | "neighborhood";

export type SiteCollection = {
  id: string;
  type: CollectionType | string;
  slug: string;
  label: string;
  restaurantCount: number;
  restaurantSlugs: string[];
};

export type SiteCollectionRecord = SiteCollection & {
  restaurants: RestaurantIndexRecord[];
};

export type MenuDocument = {
  id: string;
  sourceUrl: string | null;
  fileType: string | null;
  language: string | null;
  confidence: number | null;
  extractionMethod: string | null;
  status: string | null;
  lastCheckedAt: string | null;
};

export type MenuItem = {
  id: string;
  documentId: string | null;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  category: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  extractionConfidence: number | null;
  extractionLayer: string | null;
};

export type SiteRestaurant = {
  schemaVersion: string;
  id: string;
  slug: string;
  name: string;
  location: {
    neighborhood: string | null;
    borough: string | null;
    address: string | null;
    coordinates: { latitude: number; longitude: number } | null;
  };
  contact: {
    phone: string | null;
    website: string | null;
    instagram: string | null;
    googleMapsUrl: string | null;
  };
  food: {
    cuisine: string | null;
    michelinCuisine: string | null;
    openTableCuisine: string | null;
    priceLevel: number | null;
  };
  experience: {
    sourceSummary: string | null;
    hours: string[];
    rating: number | null;
    reviewCount: number | null;
  };
  distinctions: {
    michelin: string | null;
    michelinStars: number;
    bibGourmand: boolean;
    worlds50Best: boolean;
    worlds50BestRank: string | null;
    worlds50BestList: string | null;
  };
  reservation: {
    openTableUrl: string | null;
    links: Array<{
      url?: string | null;
      platform?: string | null;
      provider?: string | null;
      type?: string | null;
    }>;
    difficulty: string | null;
    recommendedLeadTime: string | null;
    advice: string | null;
  };
  menu: {
    state: MenuState | string;
    observedAt: string | null;
    observationAgeDaysAtExport: number | null;
    documentCount: number;
    itemCount: number;
    documents: MenuDocument[];
    items: MenuItem[];
  };
  links: Array<{
    type: string;
    provider: string;
    url: string;
    confidence: number | null;
    checkedAt: string | null;
  }>;
  media: {
    photoCount: number;
    publicImageUrl: string | null;
    note: string | null;
  };
  verification: {
    status: string;
    sourceCount: number;
    sourceNames: string[];
    fieldProvenance: Record<string, string | null>;
    freshestSourceAt: string | null;
    canonicalUpdatedAt: string | null;
    snapshotGeneratedAt: string | null;
    humanReviewedAt: string | null;
  };
  editorial: {
    status: string;
    bestFor: string[];
    avoidFor: string[];
    ambience: string | null;
    idealMoment: string | null;
    visitorTypes: string[];
    review: string | null;
    author: string | null;
    reviewedAt: string | null;
  };
  seo: {
    launchEligible: boolean;
    indexable: boolean;
    title: string | null;
    description: string | null;
    faq: Array<{ question: string; answer: string }>;
  };
};

export type RestaurantListQuery = {
  neighborhood?: string;
  cuisine?: string;
  launchEligible?: boolean;
  indexable?: boolean;
  limit?: number;
  offset?: number;
};
