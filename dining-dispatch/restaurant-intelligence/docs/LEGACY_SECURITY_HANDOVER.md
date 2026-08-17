# The Dining Dispatch - Security Handover

Date: 2026-07-25

## Purpose

This document is the security handover for the application work. It records
what is true in production, what has already changed, and what remains before
opening the community features to broader use.

## Production backend

- Active Supabase project: `CDMX_TDD` (`enknwdpjjkpjvhjkubju`), branch
  `main` / Production.
- Project status was **Healthy** during the audit.
- The active project is not the older project reference found in the local
  export manifest (`pdbgbpqrpcveivhvxsus`). Treat that manifest as historical
  until the ingestion/export configuration is reconciled.
- No Supabase Storage buckets exist.
- No Supabase Edge Functions are deployed.
- Supabase reports no configured scheduled backup on the current Free plan.

## Data location

The restaurant corpus is stored both locally and remotely:

- Local confidential working copy: `data/` in this repository. It contains
  SQLite databases, JSONL exports, source data and backups.
- Remote application data: the active `CDMX_TDD` Supabase project above.

The latest local manifest records roughly 56.8k restaurants, 30.6k menu
items and 11.6k source records. Do not consider `data/` disposable cache.

## Changes already applied

### Local machine and repository

1. Local data protection
   - Directories under `data/` are `0700`.
   - Files under `data/`, including SQLite databases, JSONL and backups, are
     `0600`.
   - Local `.env*` files are `0600`.

2. Web dependency hardening
   - Locked Next.js to `16.2.11`.
   - Added narrow npm overrides for `postcss@8.5.23` and `sharp@0.35.3`.
   - Verification: `npm audit --omit=dev` reports zero vulnerabilities;
     `npm run test` passed (3 tests); `npm run build` passed.

### Supabase production

The following SQL executed successfully in the active production project:

```sql
ALTER FUNCTION public.set_updated_at() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
```

Why:

- `set_updated_at()` no longer has a mutable function search path.
- `handle_new_user()` remains a `SECURITY DEFINER` trigger for creating a
  profile after signup, but it can no longer be invoked through the public
  database API. The trigger path is preserved; no data was changed.

## Supabase audit findings

### Good state confirmed

- Security Advisor: **0 errors**.
- `profiles` has RLS enabled with public read plus self-update policy.
- `dispatches` has RLS enabled with public read plus owner-scoped insert,
  update and delete policies.
- Public catalogue access is intentional: `restaurant_search_mv`,
  `menu_items` and `menu_items_local_extracted` are exposed to the Data API.
  They must contain only data acceptable for anonymous reading.
- Email signup is enabled and email confirmation is required.
- Anonymous sign-in, phone sign-in and third-party OAuth providers are
  disabled.

### Remaining Advisor warnings

1. `pg_trgm` is installed in the `public` schema. This is a standard Supabase
   warning. Move it only after validating all search queries; it is not an
   immediate application exposure.
2. Leaked-password protection is unavailable on the current Free plan. It
   requires Supabase Pro.

## Pending work for Claude / next security pass

Do not change these blindly while product work is active. First inspect the
current client flows, then version each accepted change in a migration.

1. Version production hardening
   - Add a migration reproducing the two SQL changes above. Dashboard changes
     otherwise create drift from `supabase/migrations/`.

2. Complete RLS audit and version policies
   - Inspect and capture the exact policies for `reactions`,
     `dispatch_topics`, `menu_items`, `menu_items_local_extracted`, and
     `restaurant_search_mv`.
   - Confirm reports/moderation data are not anonymously readable if a
     `dispatch_reports` table is introduced.
   - Add all accepted policies to migrations; do not rely on dashboard-only
     configuration.

3. Authentication strengthening
   - Consider enabling `Secure password change` and `Require current password
     when updating`; both are currently disabled.
   - Raise the password policy from its current minimum of 6 characters only
     after agreeing the UX and migration path with the app team.
   - CAPTCHA is disabled. Enabling it requires selecting and configuring a
     CAPTCHA provider, so it is not a one-click safe change.
   - Leaked-password protection needs a Supabase Pro upgrade if required.

4. Operational resilience
   - Decide on a backup strategy. The current Free project has no scheduled
     backup configured; retain encrypted local exports until that is solved.
   - Install/authenticate the Supabase CLI for repeatable remote schema and
     policy checks.

5. Repository secret hygiene
   - `gitleaks` found one historical Algolia-key alert in
     `scripts/sources/michelin.js` at commit `6664303`. It appears to be a
     public Michelin search-index key, not a Supabase credential. Before
     making the repository public, move it to a private environment variable
     and verify the Michelin scraper still works.

## Non-negotiable implementation rules

- Never expose a Supabase service-role key in web or iOS bundles.
- Keep public catalogue reads narrow: avoid adding private contributor or
  moderation fields to public views.
- Make access-control changes through migrations, then deploy them to
  production; avoid dashboard-only policy edits.
- Preserve the existing public restaurant search contract while changing RLS
  or database functions.
