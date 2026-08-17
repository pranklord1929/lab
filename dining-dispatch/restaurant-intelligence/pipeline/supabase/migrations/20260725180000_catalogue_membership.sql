-- Phase 1B (1/3) — Frontière du catalogue public : la table de gouvernance.
--
-- NON APPLIQUÉE. Destinée à une branche Supabase, jamais à la production
-- directement. Voir PHASE1B_CATALOGUE_BOUNDARY_PLAN.md.
--
-- Principe : `restaurant_search_mv` reste l'instantané brut de l'ingestion.
-- Ce qui est public est décidé enregistrement par enregistrement, ici, par un
-- humain. Un filtre est une heuristique ; une adhésion est une décision.

-- `set_updated_at()` vit dans web/supabase/community.sql, qui n'a jamais été
-- versionné : sur une branche reconstruite depuis les migrations, il n'existe
-- pas. On le crée ici de façon idempotente pour que cette migration soit
-- autoportante.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.catalogue_membership (
  restaurant_id      uuid primary key
                     references public.restaurant_search_mv(id) on delete restrict,
  status             text not null default 'candidate',
  coordinate_state   text not null default 'unreviewed',
  -- Coordonnées corrigées à la main ; NULL = on garde celles du pipeline.
  lat_override       double precision,
  lng_override       double precision,
  qa_note            text,
  reviewed_by        uuid references auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint catalogue_status_allowed
    check (status in ('candidate', 'published', 'rejected', 'needs_fix')),

  constraint catalogue_coordinate_state_allowed
    check (coordinate_state in ('unreviewed', 'verified', 'corrected', 'suspect')),

  constraint catalogue_override_pair
    check ((lat_override is null) = (lng_override is null)),

  -- Bornes de la Ville de Mexico : une correction hors zone est une faute de
  -- frappe, pas une donnée.
  constraint catalogue_override_bbox check (
    lat_override is null or
    (lat_override between 19.0 and 19.9 and lng_override between -99.4 and -98.9)
  ),

  -- Une correction déclarée doit porter des coordonnées, et des coordonnées
  -- saisies doivent être déclarées comme correction.
  constraint catalogue_corrected_needs_override check (
    (coordinate_state = 'corrected') = (lat_override is not null)
  ),

  -- LA garde demandée : la base refuse elle-même de publier un enregistrement
  -- dont les coordonnées ne sont pas relues, ou qui ne porte pas l'identité et
  -- l'horodatage du relecteur. Publier reste un acte humain traçable.
  constraint catalogue_published_requires_review check (
    status <> 'published' or (
      coordinate_state in ('verified', 'corrected')
      and reviewed_by is not null
      and reviewed_at is not null
    )
  )
);

comment on table public.catalogue_membership is
  'Frontière autoritative du catalogue public. Une ligne = une décision humaine sur un restaurant. Jamais exposée via l''API publique.';
comment on column public.catalogue_membership.lat_override is
  'Latitude corrigée à la main. Prioritaire sur le pipeline dans public_catalogue.';

create index if not exists catalogue_membership_status_idx
  on public.catalogue_membership (status);
create index if not exists catalogue_membership_review_queue_idx
  on public.catalogue_membership (status, coordinate_state)
  where status in ('candidate', 'needs_fix');

drop trigger if exists catalogue_membership_touch on public.catalogue_membership;
create trigger catalogue_membership_touch
  before update on public.catalogue_membership
  for each row execute procedure public.set_updated_at();

-- Gouvernance privée : RLS active, aucune policy. Personne ne lit via l'API
-- les rejets, les notes de QA ni l'identité des relecteurs. L'édition passe
-- par la clé secrète (outils internes uniquement).
alter table public.catalogue_membership enable row level security;

revoke all on public.catalogue_membership from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Amorçage : prédicat strict validé (876 lignes attendues), en `candidate`.
-- Aucune publication automatique. Le compte de candidats n'est PAS le compte
-- du catalogue public.
-- ---------------------------------------------------------------------------
insert into public.catalogue_membership (restaurant_id, status, qa_note)
select
  r.id,
  'candidate',
  'seed 2026-07-25 — strict: enriched + photo + rating>=3.5 + reviews>=20 + operational + address + hours'
from public.restaurant_search_mv r
where r.is_enriched
  and r.has_photo
  and r.rating is not null
  and r.rating >= 3.5
  and r.review_count >= 20
  and r.business_status = 'OPERATIONAL'
  and r.address is not null
  and r.hours is not null
on conflict (restaurant_id) do nothing;
