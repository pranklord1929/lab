import { RestaurantCard } from "@/components/RestaurantCard";
import type { SiteRestaurant } from "@/lib/restaurants/types";

export function RestaurantFiche({
  restaurant,
}: {
  restaurant: SiteRestaurant;
}) {
  return <RestaurantCard restaurant={restaurant} variant="page" />;
}
