#!/usr/bin/env node
/**
 * Bulk ingest for The Dining Dispatch.
 *
 * Input: a CatalogDocument JSON file
 *   { collections: [...], restaurants: [ { slug, menus, verifications, notes, faqs, collection_slugs } ] }
 *
 * Also accepts a JSON array of restaurant documents (collections must already exist).
 * NDJSON is accepted if every line is a restaurant document.
 *
 * Usage:
 *   node scripts/ingest.mjs content/fixtures.json
 *   node scripts/ingest.mjs content/import/cdmx.ndjson
 *   node scripts/ingest.mjs content/fixtures.json --sql > supabase/seed.sql
 *
 * Writes require SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 * and SUPABASE_SERVICE_ROLE_KEY. Never expose that key to the browser.
 *
 * Upsert key: restaurants.slug / collections.slug.
 * Child rows (menus, verifications, notes, faqs, memberships) are replaced per restaurant.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const emitSql = args.includes("--sql");
const fileArg = args.find((arg) => !arg.startsWith("--"));

if (!fileArg) {
  console.error("Usage: node scripts/ingest.mjs <file.json|file.ndjson> [--sql]");
  process.exit(1);
}

const filePath = path.resolve(process.cwd(), fileArg);
const raw = fs.readFileSync(filePath, "utf8").trim();

function parseInput(text) {
  if (text.startsWith("{") || text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { collections: [], restaurants: parsed };
    }
    return {
      collections: parsed.collections ?? [],
      restaurants: parsed.restaurants ?? [],
    };
  }

  const restaurants = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { collections: [], restaurants };
}

const catalog = parseInput(raw);

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return `'{}'`;
    const escaped = value
      .map((item) => `"${String(item).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
      .join(",");
    return `'${escaped}'`;
  }
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function restaurantValues(r, index) {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description ?? null,
    neighborhood: r.neighborhood,
    address: r.address ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    cuisine: r.cuisine ?? [],
    price_range: r.price_range,
    experience_type: r.experience_type ?? null,
    website: r.website ?? null,
    instagram: r.instagram ?? null,
    hours: r.hours ?? {},
    reservation_platform: r.reservation?.platform ?? null,
    reservation_url: r.reservation?.url ?? null,
    reservation_difficulty: r.reservation?.difficulty ?? "moderate",
    reservation_lead_days: r.reservation?.recommended_lead_days ?? null,
    reservation_tips: r.reservation?.tips ?? null,
    best_for: r.editorial?.best_for ?? [],
    avoid_for: r.editorial?.avoid_for ?? [],
    ambiance: r.editorial?.ambiance ?? null,
    ideal_moment: r.editorial?.ideal_moment ?? null,
    visitor_type: r.editorial?.visitor_type ?? null,
    tags: r.tags ?? [],
    confidence_score: r.confidence_score ?? null,
    last_verified: r.last_verified ?? null,
    featured: r.featured ?? false,
    published: r.published ?? true,
    _sort: index,
  };
}

if (emitSql) {
  const lines = [
    "-- Generated from " + fileArg,
    "-- Do not edit by hand; regenerate with: node scripts/ingest.mjs content/fixtures.json --sql",
    "begin;",
  ];

  for (const collection of catalog.collections) {
    lines.push(`insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values (${sqlLiteral(collection.slug)}, ${sqlLiteral(collection.title)}, ${sqlLiteral(collection.description ?? null)}, ${sqlLiteral(collection.intent ?? null)}, ${sqlLiteral(collection.seo_title ?? null)}, ${sqlLiteral(collection.seo_description ?? null)})
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;`);
  }

  catalog.restaurants.forEach((restaurant, index) => {
    const row = restaurantValues(restaurant, index);
    const columns = Object.keys(row).filter((key) => key !== "_sort");
    lines.push(`insert into public.restaurants (${columns.join(", ")})
values (${columns.map((key) => sqlLiteral(row[key])).join(", ")})
on conflict (slug) do update set
  ${columns
    .filter((key) => key !== "slug")
    .map((key) => `${key} = excluded.${key}`)
    .join(",\n  ")};`);

    lines.push(`delete from public.menus where restaurant_id = (select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)});`);
    lines.push(`delete from public.verifications where restaurant_id = (select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)});`);
    lines.push(`delete from public.notes where restaurant_id = (select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)});`);
    lines.push(`delete from public.faqs where restaurant_id = (select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)});`);
    lines.push(`delete from public.collection_restaurants where restaurant_id = (select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)});`);

    for (const menu of restaurant.menus ?? []) {
      lines.push(`insert into public.menus (restaurant_id, menu_type, name, currency, price, items, vegetarian_options, source, last_verified, notes)
values ((select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)}), ${sqlLiteral(menu.menu_type)}, ${sqlLiteral(menu.name)}, ${sqlLiteral(menu.currency ?? "MXN")}, ${sqlLiteral(menu.price ?? null)}, ${sqlLiteral(menu.items ?? [])}, ${sqlLiteral(Boolean(menu.vegetarian_options))}, ${sqlLiteral(menu.source ?? null)}, ${sqlLiteral(menu.last_verified ?? null)}, ${sqlLiteral(menu.notes ?? null)});`);
    }
    for (const verification of restaurant.verifications ?? []) {
      lines.push(`insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)}), ${sqlLiteral(verification.source)}, ${sqlLiteral(verification.information_checked)}, ${sqlLiteral(verification.date_checked)}, ${sqlLiteral(verification.confidence)}, ${sqlLiteral(verification.notes ?? null)});`);
    }
    for (const note of restaurant.notes ?? []) {
      lines.push(`insert into public.notes (restaurant_id, author, date, context, note)
values ((select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)}), ${sqlLiteral(note.author)}, ${sqlLiteral(note.date)}, ${sqlLiteral(note.context ?? null)}, ${sqlLiteral(note.note)});`);
    }
    (restaurant.faqs ?? []).forEach((faq, faqIndex) => {
      lines.push(`insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)}), ${sqlLiteral(faq.question)}, ${sqlLiteral(faq.answer)}, ${sqlLiteral(faq.sort_order ?? faqIndex)});`);
    });
    (restaurant.collection_slugs ?? []).forEach((collectionSlug, sortOrder) => {
      lines.push(`insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = ${sqlLiteral(collectionSlug)}),
  (select id from public.restaurants where slug = ${sqlLiteral(restaurant.slug)}),
  ${sortOrder}
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;`);
    });
  });

  lines.push("commit;");
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

async function ingestRemote() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    console.error("For local UI without a database, fixtures load automatically.");
    console.error("To generate SQL instead: node scripts/ingest.mjs content/fixtures.json --sql");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const collection of catalog.collections) {
    const { error } = await supabase.from("collections").upsert(
      {
        slug: collection.slug,
        title: collection.title,
        description: collection.description ?? null,
        intent: collection.intent ?? null,
        seo_title: collection.seo_title ?? null,
        seo_description: collection.seo_description ?? null,
      },
      { onConflict: "slug" },
    );
    if (error) throw error;
  }

  const { data: collections, error: collectionLoadError } = await supabase
    .from("collections")
    .select("id, slug");
  if (collectionLoadError) throw collectionLoadError;
  const collectionIds = new Map((collections ?? []).map((row) => [row.slug, row.id]));

  for (const restaurant of catalog.restaurants) {
    const row = restaurantValues(restaurant, 0);
    delete row._sort;
    const { data, error } = await supabase
      .from("restaurants")
      .upsert(row, { onConflict: "slug" })
      .select("id")
      .single();
    if (error) throw error;
    const restaurantId = data.id;

    const deletes = ["menus", "verifications", "notes", "faqs", "collection_restaurants"];
    for (const table of deletes) {
      const { error: deleteError } = await supabase
        .from(table)
        .delete()
        .eq("restaurant_id", restaurantId);
      if (deleteError) throw deleteError;
    }

    if (restaurant.menus?.length) {
      const { error: menuError } = await supabase.from("menus").insert(
        restaurant.menus.map((menu) => ({
          restaurant_id: restaurantId,
          menu_type: menu.menu_type,
          name: menu.name,
          currency: menu.currency ?? "MXN",
          price: menu.price ?? null,
          items: menu.items ?? [],
          vegetarian_options: Boolean(menu.vegetarian_options),
          source: menu.source ?? null,
          last_verified: menu.last_verified ?? null,
          notes: menu.notes ?? null,
        })),
      );
      if (menuError) throw menuError;
    }

    if (restaurant.verifications?.length) {
      const { error: verificationError } = await supabase.from("verifications").insert(
        restaurant.verifications.map((verification) => ({
          restaurant_id: restaurantId,
          source: verification.source,
          information_checked: verification.information_checked,
          date_checked: verification.date_checked,
          confidence: verification.confidence,
          notes: verification.notes ?? null,
        })),
      );
      if (verificationError) throw verificationError;
    }

    if (restaurant.notes?.length) {
      const { error: noteError } = await supabase.from("notes").insert(
        restaurant.notes.map((note) => ({
          restaurant_id: restaurantId,
          author: note.author,
          date: note.date,
          context: note.context ?? null,
          note: note.note,
        })),
      );
      if (noteError) throw noteError;
    }

    if (restaurant.faqs?.length) {
      const { error: faqError } = await supabase.from("faqs").insert(
        restaurant.faqs.map((faq, index) => ({
          restaurant_id: restaurantId,
          question: faq.question,
          answer: faq.answer,
          sort_order: faq.sort_order ?? index,
        })),
      );
      if (faqError) throw faqError;
    }

    const memberships = (restaurant.collection_slugs ?? [])
      .map((slug, sortOrder) => {
        const collectionId = collectionIds.get(slug);
        if (!collectionId) {
          throw new Error(`Unknown collection slug: ${slug}`);
        }
        return {
          collection_id: collectionId,
          restaurant_id: restaurantId,
          sort_order: sortOrder,
        };
      });
    if (memberships.length) {
      const { error: memberError } = await supabase
        .from("collection_restaurants")
        .insert(memberships);
      if (memberError) throw memberError;
    }

    console.log(`upserted ${restaurant.slug}`);
  }

  console.log(
    `done · ${catalog.collections.length} collections · ${catalog.restaurants.length} restaurants`,
  );
}

ingestRemote().catch((error) => {
  console.error(error);
  process.exit(1);
});
