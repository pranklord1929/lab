-- Phase 2 — Quick Signals.
--
-- Les dispatches existants sont des Field Notes. Un Quick Signal reste attaché
-- à un restaurant et au même auteur/RLS, mais peut être court et n'exige pas
-- de sujets. Aucun nouveau chemin d'écriture ne contourne les politiques.

alter table public.dispatches
  add column if not exists kind text not null default 'field_note';

alter table public.dispatches
  drop constraint if exists dispatches_kind_allowed;

alter table public.dispatches
  add constraint dispatches_kind_allowed
  check (kind in ('quick_signal', 'field_note'));

alter table public.dispatches
  drop constraint if exists dispatches_body_length;

alter table public.dispatches
  add constraint dispatches_body_length_by_kind
  check (
    (kind = 'quick_signal' and char_length(btrim(body)) between 3 and 280)
    or
    (kind = 'field_note' and char_length(btrim(body)) between 20 and 4000)
  );

create index if not exists dispatches_restaurant_kind_created_at_idx
  on public.dispatches (restaurant_id, kind, created_at desc);

comment on column public.dispatches.kind is
  'Community contribution format. quick_signal is a concise, restaurant-specific practical update; field_note is the existing long form.';
