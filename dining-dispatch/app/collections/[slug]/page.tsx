import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { RestaurantCard } from "@/components/RestaurantCard";
import { getCollectionBySlug, listCollectionSlugs, listRestaurantsBySlugs } from "@/lib/data";
import { collectionJsonLd } from "@/lib/jsonld";
import { candidateRobots, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await listCollectionSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollectionBySlug(slug);
  if (!collection) {
    return pageMetadata({
      title: "Collection not found",
      description: "This collection is not in the current graph.",
      path: `/collections/${slug}`,
      robots: candidateRobots(false),
    });
  }

  return pageMetadata({
    title: collection.label,
    description: `Objective ${collection.type} collection: ${collection.label}, Mexico City.`,
    path: `/collections/${slug}`,
    robots: candidateRobots(false),
  });
}

export default async function CollectionPage({
  params,
}: PageProps<"/collections/[slug]">) {
  const { slug } = await params;
  const collection = await getCollectionBySlug(slug);
  if (!collection) notFound();
  const restaurants = await listRestaurantsBySlugs(collection.restaurantSlugs);

  return (
    <main className="ds-page">
      <JsonLd data={collectionJsonLd(collection)} />
      <div className="ds-kicker-row">
        <span className="ds-label">Collection · {collection.type}</span>
        <span className="num">{restaurants.length} restaurants</span>
      </div>
      <h1 className="ds-title">{collection.label}</h1>
      <p className="ds-lede">
        Objective grouping by neighborhood, borough, cuisine, or documented
        distinction. Not an editorial ranking.
      </p>
      {restaurants.length === 0 ? (
        <p className="ds-empty">No members in this collection.</p>
      ) : (
        <div className="ds-grid">
          {restaurants.map((restaurant) => (
            <RestaurantCard key={restaurant.slug} restaurant={restaurant} />
          ))}
        </div>
      )}
    </main>
  );
}
