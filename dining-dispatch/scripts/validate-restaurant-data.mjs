#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v1Root = resolve(root, "restaurant-intelligence/v1");
const siteRoot = resolve(v1Root, "site-data");
const fail = (message) => {
  throw new Error(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const registry = readJson(resolve(v1Root, "registry.json"));
const allowlist = readJson(resolve(v1Root, "allowlist.json"));
const collections = readJson(resolve(siteRoot, "collections.json"));
const siteFiles = readdirSync(resolve(siteRoot, "restaurants"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));
const enrichedFiles = readdirSync(resolve(v1Root, "enriched"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));
const menuFiles = readdirSync(resolve(v1Root, "menus"))
  .filter((file) => file.endsWith(".json") && file !== "_index.json")
  .map((file) => file.replace(/\.json$/, ""));

const slugs = registry.map((row) => row.slug);
const unique = new Set(slugs);
if (unique.size !== 113) fail(`Expected 113 unique registry slugs, found ${unique.size}`);
if (slugs.length !== 113) fail(`Expected 113 registry rows, found ${slugs.length}`);
if (slugs.includes("aguamiel")) fail("Aguamiel must not be in the V1 registry");
if (allowlist.restaurants.length !== 29) {
  fail(`Expected 29 allowlist restaurants, found ${allowlist.restaurants.length}`);
}
if (siteFiles.length !== 29) fail(`Expected 29 site-data restaurant files, found ${siteFiles.length}`);
if (enrichedFiles.length !== 84) fail(`Expected 84 enriched files, found ${enrichedFiles.length}`);
if (menuFiles.length !== 113) fail(`Expected 113 menu files, found ${menuFiles.length}`);

const allowlistSlugs = allowlist.restaurants.map((row) => row.slug);
for (const slug of allowlistSlugs) {
  if (!unique.has(slug)) fail(`Allowlist slug missing from registry: ${slug}`);
  if (!siteFiles.includes(slug)) fail(`Allowlist slug missing site-data fiche: ${slug}`);
}

const remaining = slugs.filter((slug) => !siteFiles.includes(slug));
if (remaining.length !== 84) fail(`Expected 84 registry slugs without site-data, found ${remaining.length}`);
for (const slug of remaining) {
  if (!enrichedFiles.includes(slug)) fail(`Missing enriched file for ${slug}`);
}
for (const slug of slugs) {
  if (!menuFiles.includes(slug)) fail(`Missing menu file for ${slug}`);
}

let indexable = 0;
for (const slug of siteFiles) {
  const record = readJson(resolve(siteRoot, "restaurants", `${slug}.json`));
  if (record.seo?.indexable === true) {
    indexable += 1;
    fail(`${slug} became indexable`);
  }
}
for (const slug of remaining) {
  const record = readJson(resolve(v1Root, "enriched", `${slug}.json`));
  if (record.seo?.indexable === true) {
    indexable += 1;
    fail(`${slug} enriched record is indexable`);
  }
  if (record.editorial?.review) fail(`${slug} has invented editorial review`);
}

for (const slug of ["quintonil", "pujol"]) {
  const record = readJson(resolve(siteRoot, "restaurants", `${slug}.json`));
  if (record.slug !== slug) fail(`Failed to load ${slug}`);
  if (record.editorial?.status === "reviewed") fail(`${slug} editorial unexpectedly reviewed`);
  if (
    record.editorial?.bestFor?.length ||
    record.editorial?.avoidFor?.length ||
    record.editorial?.ambience ||
    record.editorial?.idealMoment ||
    record.editorial?.review ||
    record.seo?.faq?.length
  ) {
    fail(`${slug} has subjective editorial content`);
  }
  if (record.reservation?.difficulty != null) {
    fail(`${slug} has a fabricated reservation difficulty`);
  }
}

const collectionParams = collections.map((row) => `${row.type}--${row.slug}`);
if (new Set(collectionParams).size !== collections.length) {
  fail("Collection type+slug keys must be unique");
}

const runtime = readFileSync(resolve(root, "lib/data/index.ts"), "utf8");
if (runtime.includes("fixtureStore") || runtime.includes("supabaseStore")) {
  fail("Runtime data index must not select fixtureStore or supabaseStore");
}
const paths = readFileSync(resolve(root, "lib/restaurants/paths.ts"), "utf8");
if (paths.includes('"site-data"') && !paths.includes("v1")) {
  fail("SITE_DATA_ROOT must point at restaurant-intelligence/v1");
}
if (paths.includes("restaurant-intelligence\",\n  \"site-data\"")) {
  fail("Loader still points at the WIP 876 site-data directory");
}

console.log(
  JSON.stringify(
    {
      valid: true,
      uniqueSlugs: unique.size,
      siteDataFiches: siteFiles.length,
      enrichedFiches: remaining.length,
      menus: menuFiles.length,
      indexableRestaurants: indexable,
      collections: collections.length,
      requiredRoutes: ["pujol", "quintonil", "nicos", "baldio", "sarde"],
      excluded: ["aguamiel"],
    },
    null,
    2,
  ),
);
