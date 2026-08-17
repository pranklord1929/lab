#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDatabase = resolve(
  process.env.TDD_SOURCE_DB ??
    resolve(packageRoot, 'archive/legacy-data/local_db/cdmx_local.sqlite'),
);
const outputRoot = resolve(packageRoot, 'site-data');
const restaurantOutput = resolve(outputRoot, 'restaurants');
const qaOutput = resolve(outputRoot, 'qa');

if (!existsSync(sourceDatabase)) {
  throw new Error(`Source SQLite database not found: ${sourceDatabase}`);
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(restaurantOutput, { recursive: true });
mkdirSync(qaOutput, { recursive: true });

const db = new DatabaseSync(sourceDatabase, { readOnly: true });
const exportedAt = new Date().toISOString();

const strictCohortSql = `
  s.is_enriched = 1
  and s.has_photo = 1
  and s.rating >= 3.5
  and s.review_count >= 20
  and s.business_status = 'OPERATIONAL'
  and s.address is not null
  and s.hours is not null
`;

const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const cleanText = (value) => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
};

const slugify = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'restaurant';

const normalizedKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const daysBetween = (older, newer) => {
  if (!older) return null;
  const milliseconds = Date.parse(newer) - Date.parse(older);
  return Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 86_400_000)) : null;
};

const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const rows = db.prepare(`
  select
    s.*,
    g.source_count,
    g.source_names,
    g.freshest_source_at,
    g.richness_score,
    g.field_provenance,
    g.canonical_updated_at,
    g.generated_at as golden_generated_at,
    t.rank as top500_rank,
    t.has_menu_document,
    t.has_quality_menu,
    t.has_extracted_menu,
    t.has_menu_items,
    t.menu_document_count,
    t.menu_item_count as audited_menu_item_count,
    t.high_conflicts,
    t.missing_fields,
    t.action_priority
  from restaurant_search_mv s
  join restaurant_golden_record g on g.restaurant_id = s.id
  left join top500_enrichment_status t on t.restaurant_id = s.id
  where ${strictCohortSql}
  order by coalesce(t.rank, 1000000), s.review_count desc, s.name, s.id
`).all();

if (rows.length !== 876) {
  throw new Error(`Strict cohort drift: expected 876 rows, found ${rows.length}`);
}

const cohortIds = new Set(rows.map((row) => row.id));

const menuDocumentsByRestaurant = new Map();
for (const document of db.prepare(`
  select id, restaurant_id, source_url, file_type, langue, confidence_score,
         extraction_method, statut, last_checked_at
  from menu_documents
  order by last_checked_at desc, id
`).iterate()) {
  if (!cohortIds.has(document.restaurant_id)) continue;
  const values = menuDocumentsByRestaurant.get(document.restaurant_id) ?? [];
  values.push({
    id: document.id,
    sourceUrl: cleanText(document.source_url),
    fileType: cleanText(document.file_type),
    language: cleanText(document.langue),
    confidence: document.confidence_score,
    extractionMethod: cleanText(document.extraction_method),
    status: cleanText(document.statut),
    lastCheckedAt: cleanText(document.last_checked_at),
  });
  menuDocumentsByRestaurant.set(document.restaurant_id, values);
}

const canonicalMenuItemsByRestaurant = new Map();
for (const item of db.prepare(`
  select mi.id, mi.restaurant_id, mi.menu_document_id, mi.nom, mi.description,
         mi.prix, mi.devise, mi.categorie, md.source_url, md.last_checked_at,
         md.confidence_score
  from menu_items mi
  left join menu_documents md on md.id = mi.menu_document_id
  order by md.last_checked_at desc, mi.categorie, mi.nom, mi.id
`).iterate()) {
  if (!cohortIds.has(item.restaurant_id) || !cleanText(item.nom)) continue;
  const values = canonicalMenuItemsByRestaurant.get(item.restaurant_id) ?? [];
  values.push({
    id: item.id,
    documentId: item.menu_document_id,
    name: cleanText(item.nom),
    description: cleanText(item.description),
    price: item.prix,
    currency: cleanText(item.devise),
    category: cleanText(item.categorie),
    sourceUrl: cleanText(item.source_url),
    observedAt: cleanText(item.last_checked_at),
    extractionConfidence: item.confidence_score,
    extractionLayer: 'canonical',
  });
  canonicalMenuItemsByRestaurant.set(item.restaurant_id, values);
}

const fallbackMenuItemsByRestaurant = new Map();
for (const item of db.prepare(`
  select id, restaurant_id, nom, prix, devise
  from menu_items_local_extracted
  order by restaurant_id, nom, prix, id
`).iterate()) {
  if (!cohortIds.has(item.restaurant_id) || !cleanText(item.nom)) continue;
  const values = fallbackMenuItemsByRestaurant.get(item.restaurant_id) ?? [];
  values.push({
    id: item.id,
    documentId: null,
    name: cleanText(item.nom),
    description: null,
    price: item.prix,
    currency: cleanText(item.devise),
    category: null,
    sourceUrl: null,
    observedAt: null,
    extractionConfidence: null,
    extractionLayer: 'local_fallback',
  });
  fallbackMenuItemsByRestaurant.set(item.restaurant_id, values);
}

const validLinksByRestaurant = new Map();
for (const link of db.prepare(`
  select restaurant_id, url, final_url, link_type, provider, confidence_score,
         checked_at
  from restaurant_links
  where status = 'valid'
  order by restaurant_id, link_type, confidence_score desc, checked_at desc
`).iterate()) {
  if (!cohortIds.has(link.restaurant_id)) continue;
  const values = validLinksByRestaurant.get(link.restaurant_id) ?? [];
  values.push({
    type: cleanText(link.link_type),
    provider: cleanText(link.provider),
    url: cleanText(link.final_url) ?? cleanText(link.url),
    confidence: link.confidence_score,
    checkedAt: cleanText(link.checked_at),
  });
  validLinksByRestaurant.set(link.restaurant_id, values);
}

const sourceStats = db.prepare(`
  select source, count(*) as record_count,
         count(distinct matched_restaurant_id) as matched_restaurant_count,
         min(coalesce(scraped_at, scrape_date)) as oldest_observation,
         max(coalesce(scraped_at, scrape_date)) as newest_observation
  from source_records
  group by source
  order by record_count desc, source
`).all().map((row) => ({
  source: row.source,
  recordCount: row.record_count,
  matchedRestaurantCount: row.matched_restaurant_count,
  oldestObservation: row.oldest_observation,
  newestObservation: row.newest_observation,
}));

const nonRestaurantCategories = new Set([
  'association_or_organization',
  'bus_stop',
  'corporate_office',
  'event_venue',
  'grocery_store',
  'jewelry_store',
  'liquor_store',
  'playground',
  'premise',
  'school',
  'shopping_mall',
]);

const nameLocationCounts = new Map();
const baseSlugCounts = new Map();
for (const row of rows) {
  const nameLocation = `${normalizedKey(row.name)}|${normalizedKey(row.colonia)}`;
  nameLocationCounts.set(nameLocation, (nameLocationCounts.get(nameLocation) ?? 0) + 1);
  const baseSlug = slugify(row.name);
  baseSlugCounts.set(baseSlug, (baseSlugCounts.get(baseSlug) ?? 0) + 1);
}

const usedSlugs = new Set();
const slugById = new Map();
for (const row of rows) {
  const base = slugify(row.name);
  let slug = baseSlugCounts.get(base) === 1 ? base : `${base}-${slugify(row.colonia)}`;
  if (usedSlugs.has(slug)) slug = `${slug}-${String(row.id).slice(0, 8)}`;
  usedSlugs.add(slug);
  slugById.set(row.id, slug);
}

const dedupeMenuItems = (items) => {
  const seen = new Set();
  const kept = [];
  for (const item of items) {
    const key = [normalizedKey(item.name), normalizedKey(item.category), item.price ?? '', normalizedKey(item.currency)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
};

const allRecords = [];
const qaIssues = [];

for (const row of rows) {
  const slug = slugById.get(row.id);
  const sourceNames = parseJson(row.source_names, []);
  const fieldProvenance = parseJson(row.field_provenance, {});
  const hours = parseJson(row.hours, []);
  const documents = menuDocumentsByRestaurant.get(row.id) ?? [];
  const canonicalItems = canonicalMenuItemsByRestaurant.get(row.id) ?? [];
  const fallbackItems = fallbackMenuItemsByRestaurant.get(row.id) ?? [];
  const selectedMenuLayer = canonicalItems.length
    ? 'canonical'
    : fallbackItems.length
      ? 'local_fallback'
      : null;
  const selectedItems = dedupeMenuItems(canonicalItems.length ? canonicalItems : fallbackItems);
  const links = validLinksByRestaurant.get(row.id) ?? [];
  const latestMenuCheck = documents
    .map((document) => document.lastCheckedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const flags = ['needs_human_editorial_review'];
  if (!cleanText(row.website)) flags.push('missing_website');
  if (!cleanText(row.instagram)) flags.push('missing_instagram');
  if (!cleanText(row.cuisine_key)) flags.push('missing_cuisine');
  if (row.price_level === null || row.price_level === undefined) flags.push('missing_price_level');
  if (!cleanText(row.summary)) flags.push('missing_source_summary');
  if (!documents.length) flags.push('missing_menu_document');
  if (!selectedItems.length) flags.push('missing_structured_menu_items');
  if (nonRestaurantCategories.has(row.cuisine_key)) flags.push('possible_non_restaurant_category');
  const duplicateKey = `${normalizedKey(row.name)}|${normalizedKey(row.colonia)}`;
  if ((nameLocationCounts.get(duplicateKey) ?? 0) > 1) flags.push('duplicate_name_and_neighborhood');
  if ((row.source_count ?? 0) < 2) flags.push('low_source_count');

  const prestigeSignal = Boolean(
    cleanText(row.michelin_distinction) || row.in_worlds_50_best === 1,
  );
  const launchEligible = Boolean(
    row.top500_rank &&
      !nonRestaurantCategories.has(row.cuisine_key) &&
      cleanText(row.website) &&
      cleanText(row.cuisine_key) &&
      row.lat !== null &&
      row.lng !== null &&
      (row.source_count ?? 0) >= 3 &&
      (row.high_conflicts ?? 0) === 0 &&
      (documents.length > 0 || prestigeSignal) &&
      !flags.includes('duplicate_name_and_neighborhood')
  );

  const record = {
    schemaVersion: 'tdd.restaurant.v0.1',
    id: row.id,
    slug,
    name: cleanText(row.name),
    location: {
      neighborhood: cleanText(row.colonia),
      borough: cleanText(row.alcaldia),
      address: cleanText(row.address),
      coordinates: { latitude: row.lat, longitude: row.lng },
    },
    contact: {
      phone: cleanText(row.phone),
      website: cleanText(row.website),
      instagram: cleanText(row.instagram),
      googleMapsUrl: cleanText(row.google_maps_uri),
    },
    food: {
      cuisine: cleanText(row.cuisine_key),
      michelinCuisine: cleanText(row.michelin_cuisine),
      openTableCuisine: cleanText(row.opentable_cuisine),
      priceLevel: row.price_level,
    },
    experience: {
      sourceSummary: cleanText(row.summary),
      hours,
      rating: row.rating,
      reviewCount: row.review_count,
    },
    distinctions: {
      michelin: cleanText(row.michelin_distinction),
      michelinStars: row.michelin_stars ?? 0,
      bibGourmand: Boolean(row.bib_gourmand),
      worlds50Best: Boolean(row.in_worlds_50_best),
      worlds50BestRank: cleanText(row.w50_rank),
      worlds50BestList: cleanText(row.w50_list),
    },
    reservation: {
      openTableUrl: cleanText(row.opentable_url),
      links: links.filter((link) => link.type === 'reservation'),
      difficulty: null,
      recommendedLeadTime: null,
      advice: null,
    },
    menu: {
      state: selectedMenuLayer === 'canonical'
        ? 'structured_candidate'
        : selectedMenuLayer === 'local_fallback'
          ? 'local_extraction_candidate'
          : documents.length
            ? 'document_only'
            : 'missing',
      observedAt: latestMenuCheck,
      observationAgeDaysAtExport: daysBetween(latestMenuCheck, exportedAt),
      documentCount: documents.length,
      itemCount: selectedItems.length,
      documents,
      items: selectedItems,
    },
    links,
    media: {
      photoCount: row.photo_count ?? 0,
      publicImageUrl: null,
      note: 'Google Places photo references were intentionally excluded from the site export.',
    },
    verification: {
      status: 'machine_assembled_candidate',
      sourceCount: row.source_count ?? 0,
      sourceNames,
      fieldProvenance,
      freshestSourceAt: cleanText(row.freshest_source_at),
      canonicalUpdatedAt: cleanText(row.canonical_updated_at),
      snapshotGeneratedAt: cleanText(row.golden_generated_at),
      humanReviewedAt: null,
    },
    editorial: {
      status: 'not_reviewed',
      bestFor: [],
      avoidFor: [],
      ambience: null,
      idealMoment: null,
      visitorTypes: [],
      review: null,
      author: null,
      reviewedAt: null,
    },
    seo: {
      launchEligible,
      indexable: false,
      title: null,
      description: null,
      faq: [],
    },
    internalQuality: {
      top500Rank: row.top500_rank ?? null,
      richnessScore: row.richness_score ?? null,
      highConflictCount: row.high_conflicts ?? null,
      missingFieldCount: row.missing_fields ?? null,
      actionPriority: row.action_priority ?? null,
      qaFlags: flags,
    },
  };

  allRecords.push(record);
  if (flags.length > 1) {
    qaIssues.push({
      id: record.id,
      slug: record.slug,
      name: record.name,
      neighborhood: record.location.neighborhood,
      flags,
    });
  }
}

const launchCandidates = allRecords
  .filter((record) => record.seo.launchEligible)
  .sort((left, right) =>
    (left.internalQuality.top500Rank ?? 1000000) - (right.internalQuality.top500Rank ?? 1000000) ||
    left.name.localeCompare(right.name),
  )
  .slice(0, 100);

const launchIds = new Set(launchCandidates.map((record) => record.id));
for (const record of allRecords) record.seo.launchEligible = launchIds.has(record.id);

const summaries = allRecords.map((record) => ({
  id: record.id,
  slug: record.slug,
  name: record.name,
  neighborhood: record.location.neighborhood,
  borough: record.location.borough,
  cuisine: record.food.cuisine,
  priceLevel: record.food.priceLevel,
  rating: record.experience.rating,
  reviewCount: record.experience.reviewCount,
  michelin: record.distinctions.michelin,
  worlds50Best: record.distinctions.worlds50Best,
  menuState: record.menu.state,
  menuObservedAt: record.menu.observedAt,
  sourceCount: record.verification.sourceCount,
  freshestSourceAt: record.verification.freshestSourceAt,
  launchEligible: record.seo.launchEligible,
  indexable: record.seo.indexable,
  editorialStatus: record.editorial.status,
  qaFlags: record.internalQuality.qaFlags,
}));

for (const record of allRecords) {
  writeJson(resolve(restaurantOutput, `${record.slug}.json`), record);
}

const buildCollections = (records) => {
  const definitions = [
    ['neighborhood', (record) => record.location.neighborhood],
    ['borough', (record) => record.location.borough],
    ['cuisine', (record) => record.food.cuisine],
  ];
  const collections = [];
  for (const [type, getter] of definitions) {
    const grouped = new Map();
    for (const record of records) {
      const label = getter(record);
      if (!label) continue;
      const group = grouped.get(label) ?? [];
      group.push(record.slug);
      grouped.set(label, group);
    }
    for (const [label, restaurantSlugs] of grouped) {
      collections.push({
        id: `${type}:${slugify(label)}`,
        type,
        slug: slugify(label),
        label,
        restaurantCount: restaurantSlugs.length,
        restaurantSlugs,
      });
    }
  }

  const michelin = records.filter((record) => record.distinctions.michelin).map((record) => record.slug);
  if (michelin.length) {
    collections.push({
      id: 'distinction:michelin', type: 'distinction', slug: 'michelin',
      label: 'Michelin-recognized restaurants', restaurantCount: michelin.length,
      restaurantSlugs: michelin,
    });
  }
  const worlds50 = records.filter((record) => record.distinctions.worlds50Best).map((record) => record.slug);
  if (worlds50.length) {
    collections.push({
      id: 'distinction:worlds-50-best', type: 'distinction', slug: 'worlds-50-best',
      label: "World's 50 Best", restaurantCount: worlds50.length,
      restaurantSlugs: worlds50,
    });
  }
  return collections.sort((left, right) => left.type.localeCompare(right.type) || left.label.localeCompare(right.label));
};

const collections = buildCollections(launchCandidates);
const menuDocumentCount = allRecords.reduce((sum, record) => sum + record.menu.documentCount, 0);
const menuItemCount = allRecords.reduce((sum, record) => sum + record.menu.itemCount, 0);

writeJson(resolve(outputRoot, 'index.json'), summaries);
writeJson(resolve(outputRoot, 'launch-candidates.json'), launchCandidates.map((record) => ({
  id: record.id,
  slug: record.slug,
  name: record.name,
  neighborhood: record.location.neighborhood,
  cuisine: record.food.cuisine,
  top500Rank: record.internalQuality.top500Rank,
  sourceCount: record.verification.sourceCount,
  menuState: record.menu.state,
  editorialStatus: record.editorial.status,
  indexable: record.seo.indexable,
})));
writeJson(resolve(outputRoot, 'collections.json'), collections);
writeJson(resolve(qaOutput, 'needs-review.json'), qaIssues);
writeJson(resolve(outputRoot, 'manifest.json'), {
  schemaVersion: 'tdd.site-data.v0.1',
  exportedAt,
  sourceDatabase: 'archive/legacy-data/local_db/cdmx_local.sqlite',
  sourceSnapshotManifest: 'archive/legacy-data/local_db/manifest.json',
  cohortRule: "is_enriched + photo + rating >= 3.5 + reviews >= 20 + OPERATIONAL + address + hours",
  counts: {
    restaurants: allRecords.length,
    launchCandidates: launchCandidates.length,
    indexableRestaurants: allRecords.filter((record) => record.seo.indexable).length,
    restaurantFiles: allRecords.length,
    menuDocuments: menuDocumentCount,
    deduplicatedMenuItems: menuItemCount,
    qaRecordsWithAdditionalFlags: qaIssues.length,
    collections: collections.length,
  },
  publicationGuardrails: {
    machineAssembledDoesNotMeanHumanVerified: true,
    editorialFieldsAreBlankByDesign: true,
    allRestaurantsDefaultToNoindex: true,
    googlePlacesPhotoReferencesExcluded: true,
  },
  sourceStats,
});

db.close();

console.log(`Exported ${allRecords.length} strict-cohort restaurants.`);
console.log(`Selected ${launchCandidates.length} launch candidates; none are indexable until human review.`);
console.log(`Wrote ${menuItemCount} deduplicated menu items and ${collections.length} objective collections.`);
console.log(`Output: ${outputRoot}`);
