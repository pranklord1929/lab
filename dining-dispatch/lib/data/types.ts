import type {
  RestaurantIndexRecord,
  RestaurantListQuery,
  SiteCollection,
  SiteCollectionRecord,
  SiteRestaurant,
} from "@/lib/restaurants/types";

export type CatalogStore = {
  listRestaurantSlugs(): Promise<string[]>;
  listIndexableRestaurantSlugs(): Promise<string[]>;
  listRestaurants(query?: RestaurantListQuery): Promise<RestaurantIndexRecord[]>;
  listLaunchRestaurants(limit?: number): Promise<RestaurantIndexRecord[]>;
  getRestaurantBySlug(slug: string): Promise<SiteRestaurant | null>;
  listRelated(slug: string, limit?: number): Promise<RestaurantIndexRecord[]>;
  listCollections(): Promise<SiteCollection[]>;
  listCollectionSlugs(): Promise<string[]>;
  getCollectionBySlug(param: string): Promise<SiteCollectionRecord | null>;
};
