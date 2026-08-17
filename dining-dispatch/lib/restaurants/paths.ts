import { join } from "node:path";
import type { SiteCollection } from "@/lib/restaurants/types";

export const V1_ROOT = join(process.cwd(), "restaurant-intelligence", "v1");
export const SITE_DATA_ROOT = join(V1_ROOT, "site-data");
export const ENRICHED_ROOT = join(V1_ROOT, "enriched");
export const MENUS_ROOT = join(V1_ROOT, "menus");

export function collectionParam(collection: Pick<SiteCollection, "type" | "slug">) {
  return `${collection.type}--${collection.slug}`;
}

export function parseCollectionParam(param: string) {
  const separator = param.indexOf("--");
  if (separator === -1) {
    return { type: null, slug: param };
  }
  return {
    type: param.slice(0, separator),
    slug: param.slice(separator + 2),
  };
}

export function collectionHref(collection: Pick<SiteCollection, "type" | "slug">) {
  return `/collections/${collectionParam(collection)}`;
}

export function slugifyLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
