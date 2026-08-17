import type { ReactNode } from "react";
import Link from "next/link";
import {
  formatCuisine,
  formatPriceLevel,
  instagramHandle,
  instagramHref,
  mapsHref,
  menuSourceUrl,
  reservationBookings,
} from "@/lib/restaurants/format";
import type { SiteRestaurant } from "@/lib/restaurants/types";

function Row({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="ds-row">
      <span className="ds-label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function External({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

export function RestaurantCard({
  restaurant,
  variant = "card",
}: {
  restaurant: SiteRestaurant;
  variant?: "card" | "page";
}) {
  const cuisine = formatCuisine(restaurant.food.cuisine);
  const price = formatPriceLevel(restaurant.food.priceLevel);
  const maps = mapsHref({
    googleMapsUrl: restaurant.contact.googleMapsUrl,
    address: restaurant.location.address,
  });
  const instagram = instagramHref(restaurant.contact.instagram);
  const handle = instagramHandle(restaurant.contact.instagram);
  const bookings = reservationBookings({
    openTableUrl: restaurant.reservation.openTableUrl,
    links: restaurant.reservation.links,
    extra: restaurant.links,
  });
  const menuUrl = menuSourceUrl(restaurant.menu.documents);
  const michelin = restaurant.distinctions.michelin;
  const fiftyBest = restaurant.distinctions.worlds50Best
    ? [restaurant.distinctions.worlds50BestList, restaurant.distinctions.worlds50BestRank]
        .filter(Boolean)
        .join(" · ") || "Listed"
    : null;
  const hasDistinctions = Boolean(
    michelin || fiftyBest || restaurant.distinctions.bibGourmand,
  );
  const TitleTag = variant === "page" ? "h1" : "h2";
  const title = (
    <TitleTag className={variant === "page" ? "ds-title" : "ds-card-name"}>
      {restaurant.name}
    </TitleTag>
  );

  return (
    <article className="ds-panel">
      <div className="ds-panel-head">
        <span className="ds-label">
          {restaurant.location.neighborhood ?? "Mexico City"}
        </span>
        {price ? <span className="num">{price}</span> : null}
      </div>

      <div className="ds-pad">
        {variant === "page" ? (
          title
        ) : (
          <Link href={`/restaurants/${restaurant.slug}`} className="ds-link">
            {title}
          </Link>
        )}
      </div>

      <Row
        label="Address"
        value={
          restaurant.location.address && maps ? (
            <External href={maps} className="ds-link">
              {restaurant.location.address}
            </External>
          ) : (
            restaurant.location.address
          )
        }
      />

      <Row
        label="Phone"
        value={
          restaurant.contact.phone ? (
            <a className="ds-link" href={`tel:${restaurant.contact.phone.replace(/\s+/g, "")}`}>
              {restaurant.contact.phone}
            </a>
          ) : null
        }
      />
      <Row
        label="Website"
        value={
          restaurant.contact.website ? (
            <External href={restaurant.contact.website} className="ds-link">
              Official site
            </External>
          ) : null
        }
      />
      <Row
        label="Instagram"
        value={
          instagram ? (
            <External href={instagram} className="ds-link">
              {handle}
            </External>
          ) : null
        }
      />

      {restaurant.experience.hours.length === 0 ? (
        <Row label="Hours" value="Not on file" />
      ) : (
        <details className="ds-hours">
          <summary>
            <span className="ds-label">Hours</span>
            <span className="ds-hours-arrow" aria-hidden="true" />
          </summary>
          <div className="ds-hours-list">
            {restaurant.experience.hours.map((row) => (
              <span key={row}>{row}</span>
            ))}
          </div>
        </details>
      )}

      <Row label="Cuisine" value={cuisine} />
      <Row label="Price" value={price ? <span className="num">{price}</span> : null} />

      {hasDistinctions ? (
        <>
          <Row label="Michelin" value={michelin} />
          <Row label="World's 50 Best" value={fiftyBest} />
          {restaurant.distinctions.bibGourmand ? (
            <Row label="Bib Gourmand" value="Yes" />
          ) : null}
        </>
      ) : null}

      <div className="ds-card-actions">
        {menuUrl ? (
          <External href={menuUrl} className="ds-cta">
            Menu
          </External>
        ) : (
          <span className="ds-cta ds-cta-mute">Menu not found</span>
        )}
        {bookings[0] ? (
          <External href={bookings[0].url} className="ds-cta">
            Reservation
          </External>
        ) : (
          <span className="ds-cta ds-cta-mute">Reservation</span>
        )}
      </div>
    </article>
  );
}
