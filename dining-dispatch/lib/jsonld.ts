import { instagramHref } from "@/lib/restaurants/format";
import { collectionHref } from "@/lib/restaurants/paths";
import type {
  SiteCollectionRecord,
  SiteRestaurant,
} from "@/lib/restaurants/types";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

function omitEmpty<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined || entry === "") return false;
      if (Array.isArray(entry) && entry.length === 0) return false;
      return true;
    }),
  );
}

export function restaurantJsonLd(restaurant: SiteRestaurant) {
  const url = absoluteUrl(`/restaurants/${restaurant.slug}`);
  const instagram = instagramHref(restaurant.contact.instagram);
  const menuUrl =
    restaurant.menu.documents.find((doc) => doc.sourceUrl)?.sourceUrl ?? null;
  const cuisine = [
    restaurant.food.michelinCuisine,
    restaurant.food.cuisine,
  ].filter((value): value is string => Boolean(value));

  const restaurantNode = omitEmpty({
    "@type": "Restaurant",
    "@id": `${url}#restaurant`,
    name: restaurant.name,
    url,
    telephone: restaurant.contact.phone,
    servesCuisine: cuisine.length === 1 ? cuisine[0] : cuisine,
    priceRange:
      restaurant.food.priceLevel && restaurant.food.priceLevel >= 1
        ? "$".repeat(Math.min(restaurant.food.priceLevel, 4))
        : undefined,
    hasMenu: menuUrl,
    sameAs: [restaurant.contact.website, instagram].filter(Boolean),
    address: restaurant.location.address
      ? omitEmpty({
          "@type": "PostalAddress",
          streetAddress: restaurant.location.address,
          addressLocality: "Mexico City",
          addressRegion: restaurant.location.borough,
          addressCountry: "MX",
        })
      : undefined,
    geo:
      restaurant.location.coordinates?.latitude != null &&
      restaurant.location.coordinates?.longitude != null
        ? {
            "@type": "GeoCoordinates",
            latitude: restaurant.location.coordinates.latitude,
            longitude: restaurant.location.coordinates.longitude,
          }
        : undefined,
  });

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
          {
            "@type": "ListItem",
            position: 2,
            name: restaurant.name,
            item: url,
          },
        ],
      },
      restaurantNode,
    ],
  };
}

export function collectionJsonLd(collection: SiteCollectionRecord) {
  const url = absoluteUrl(collectionHref(collection));
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: collection.label,
    url,
    numberOfItems: collection.restaurants.length,
    itemListElement: collection.restaurants.map((restaurant, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(`/restaurants/${restaurant.slug}`),
      name: restaurant.name,
    })),
  };
}
