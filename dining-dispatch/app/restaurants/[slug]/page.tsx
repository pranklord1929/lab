import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { RestaurantFiche } from "@/components/RestaurantFiche";
import { getRestaurantBySlug, listRestaurantSlugs } from "@/lib/data";
import { restaurantJsonLd } from "@/lib/jsonld";
import { formatCuisine } from "@/lib/restaurants/format";
import { candidateRobots, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await listRestaurantSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/restaurants/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return pageMetadata({
      title: "Restaurant not found",
      description: "This restaurant is not in the current graph.",
      path: `/restaurants/${slug}`,
      robots: candidateRobots(false),
    });
  }

  const neighborhood = restaurant.location.neighborhood ?? "Mexico City";
  const cuisine = formatCuisine(restaurant.food.cuisine);
  const description = [
    restaurant.name,
    neighborhood,
    "Mexico City",
    cuisine,
  ]
    .filter(Boolean)
    .join(", ");

  return pageMetadata({
    title: `${restaurant.name}, ${neighborhood}`,
    description,
    path: `/restaurants/${slug}`,
    robots: candidateRobots(restaurant.seo.indexable === true),
  });
}

export default async function RestaurantPage({
  params,
}: PageProps<"/restaurants/[slug]">) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  return (
    <main className="ds-page">
      <JsonLd data={restaurantJsonLd(restaurant)} />
      <RestaurantFiche restaurant={restaurant} />
    </main>
  );
}
