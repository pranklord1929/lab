import Link from "next/link";
import { listCollections } from "@/lib/data";
import { collectionHref } from "@/lib/restaurants/paths";
import { candidateRobots, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "Collections",
  description:
    "Objective Mexico City restaurant collections by neighborhood, borough, cuisine, and documented distinction.",
  path: "/collections",
  robots: candidateRobots(false),
});

export default async function CollectionsPage() {
  const collections = await listCollections();
  const grouped = collections.reduce((acc, collection) => {
    const list = acc.get(collection.type) ?? [];
    list.push(collection);
    acc.set(collection.type, list);
    return acc;
  }, new Map<string, typeof collections>());

  return (
    <main className="ds-page">
      <div className="ds-kicker-row">
        <span className="ds-label">Objective pages</span>
        <span className="num">{collections.length}</span>
      </div>
      <h1 className="ds-title">Collections</h1>
      <p className="ds-lede">
        Neighborhood, borough, cuisine, and distinction collections derived
        from the Mexico City catalog. Not occasion judgments. Not indexed until
        reviewed.
      </p>
      {[...grouped.entries()].map(([type, items]) => (
        <section key={type} className="ds-panel">
          <div className="ds-panel-head">
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
        </section>
      ))}
    </main>
  );
}
