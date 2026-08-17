import type { Metadata } from "next";
import { SITE_NAME, SITE_TAGLINE, absoluteUrl } from "@/lib/site";

export function pageMetadata({
  title,
  description,
  path,
  robots,
}: {
  title: string;
  description: string;
  path: string;
  robots?: Metadata["robots"];
}): Metadata {
  const url = absoluteUrl(path);
  const isRootTitle = title === SITE_NAME;
  const displayTitle = isRootTitle ? SITE_NAME : `${title} · ${SITE_NAME}`;
  return {
    title: isRootTitle ? { absolute: SITE_NAME } : title,
    description,
    alternates: { canonical: url },
    robots,
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title: displayTitle,
      description,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: displayTitle,
      description,
    },
  };
}

export const defaultMetadata: Metadata = {
  metadataBase: new URL(absoluteUrl("/")),
  title: {
    default: `${SITE_NAME} · ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_TAGLINE,
  robots: { index: true, follow: true },
};

export function candidateRobots(indexable: boolean): Metadata["robots"] {
  return indexable
    ? { index: true, follow: true }
    : { index: false, follow: true };
}
