-- Botanico fait partie de la sélection éditoriale MVP, mais son enregistrement
-- curated n'entrait pas dans l'amorçage automatique (pas de rating/photo issus
-- de Google). L'absence de membership le rendait invisible dans toute l'app,
-- y compris pour une recherche exacte.
--
-- On l'ajoute à la frontière beta en `candidate`, sans prétendre qu'il a déjà
-- été relu ni l'exposer par un accès au réservoir brut.

do $$
declare
  botanico_id constant uuid := 'c8a96f35-8d72-4676-8259-1808c6f12018';
begin
  if not exists (
    select 1
    from public.restaurant_search_mv
    where id = botanico_id
      and lower(name) = 'botanico'
      and lower(coalesce(address, '')) like '%alfonso reyes%217%'
  ) then
    raise exception
      'Curated Botanico record is missing or no longer matches its reviewed identity';
  end if;

  insert into public.catalogue_membership (
    restaurant_id,
    status,
    coordinate_state,
    qa_note
  )
  values (
    botanico_id,
    'candidate',
    'unreviewed',
    'curated MVP inclusion 2026-07-26 — Botanico, Alfonso Reyes 217'
  )
  on conflict (restaurant_id) do nothing;
end
$$;
