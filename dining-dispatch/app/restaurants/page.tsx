import { RestaurantCard } from "@/components/RestaurantCard";
import { listLaunchRestaurantRecords } from "@/lib/data";
import { candidateRobots, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "Restaurant index",
  description:
    "Mexico City restaurant catalog. 113 restaurants from the private list. Candidate does not mean indexed.",
  path: "/restaurants",
  robots: candidateRobots(false),
});

export default async function RestaurantIndexPage() {
  const restaurants = await listLaunchRestaurantRecords();

  return (
    <main className="ds-page">
      <div className="ds-kicker-row">
        <span className="ds-label">Mexico City catalog</span>
        <span className="num">{restaurants.length} restaurants</span>
      </div>
      <h1 className="ds-title">Restaurants</h1>
      <p className="ds-lede">
        113 restaurants from the private list. This is not a ranking and not
        an indexable directory.
      </p>
      <div className="ds-grid">
        {restaurants.map((restaurant) => (
          <RestaurantCard key={restaurant.slug} restaurant={restaurant} />
        ))}
      </div>
    </main>
  );
}
