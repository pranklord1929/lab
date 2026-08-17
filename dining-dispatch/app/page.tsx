import Link from "next/link";
import { RestaurantCard } from "@/components/RestaurantCard";
import { listCollections, listLaunchRestaurantRecords } from "@/lib/data";
import { collectionHref } from "@/lib/restaurants/paths";
import { pageMetadata } from "@/lib/seo";
import { SITE_TAGLINE } from "@/lib/site";

export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "The Dining Dispatch",
  description: SITE_TAGLINE,
  path: "/",
});

export default async function HomePage() {
  const [sample, collections] = await Promise.all([
    listLaunchRestaurantRecords(12),
    listCollections(),
  ]);

  const grouped = collections.reduce((acc, collection) => {
    const list = acc.get(collection.type) ?? [];
    list.push(collection);
    acc.set(collection.type, list);
    return acc;
  }, new Map<string, typeof collections>());

  return (
    <main className="ds-page">
      <h1 className="ds-title">The most trusted restaurant intelligence for Mexico City.</h1>
      <div className="ds-pills" style={{ marginBottom: 24 }}>
        <span className="ds-pill">
          <span className="ds-token-icon">C</span>
          <b>113 restaurants</b>
        </span>
        <span className="ds-pill">
          <span className="ds-token-icon">I</span>
          <b>0 indexed</b>
        </span>
      </div>

      <section id="mission" className="ds-panel">
        <div className="ds-panel-head">
          <span className="ds-label">01 · Mission</span>
        </div>
        <div className="ds-pad ds-prose">
          <p>
            Answer the questions Google Maps still fumbles: where to eat, for
            which occasion, for which visitor, with a menu that is actually
            current, and whether the table is worth the displacement.
          </p>
        </div>
      </section>

      <div className="ds-stack">
        <div className="ds-kicker-row" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <span className="ds-label">02 · Catalog</span>
          <Link href="/restaurants" className="ds-link">
            113 restaurants
          </Link>
        </div>
        <p className="ds-lede" style={{ marginTop: 0 }}>
          Mexico City catalog from the private list. Order is the list order,
          not an editorial ranking.
        </p>
        <div className="ds-grid">
          {sample.map((restaurant) => (
            <RestaurantCard key={restaurant.slug} restaurant={restaurant} />
          ))}
        </div>
      </div>

      <section className="ds-panel" style={{ marginTop: 16 }}>
        <div className="ds-panel-head">
          <span className="ds-label">03 · Objective collections</span>
        </div>
        {[...grouped.entries()].map(([type, items]) => (
          <div key={type}>
            <div className="ds-row">
              <span className="ds-label">{type}</span>
              <span className="num">{items.length}</span>
            </div>
            <ul className="ds-list">
              {items.map((collection) => (
                <li key={collection.id}>
                  <Link href={collectionHref(collection)} className="ds-link">
                    {collection.label}
                  </Link>
                  <span className="num"> · {collection.restaurantCount}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
