-- Vocabulaire des réactions — décision Phase 0, appliquée à la racine.
--
-- STAGING UNIQUEMENT. La production n'a pas reçu cette migration.
--
-- Les valeurs retenues sont exactement `helpful`, `still_true` et
-- `different_read`. `confirmed` et `outdated` disparaissent : garder l'ancienne
-- valeur en base et afficher le nouveau libellé côté client crée précisément
-- l'ambiguïté que la décision voulait supprimer — la base dirait `confirmed`
-- pendant que l'app dirait « Still true? ».
--
-- Le renommage est gratuit tant qu'aucune réaction n'existe. Vérifié avant
-- écriture : 0 ligne en staging, 0 ligne en production. Dans six mois ce
-- serait une migration de données avec un vocabulaire mixte à arbitrer.

-- Filet de sécurité : si cette migration est un jour rejouée sur une base qui
-- a accumulé des réactions, on refuse au lieu de renommer à l'aveugle. La
-- correspondance `confirmed -> still_true` est plausible, `outdated ->
-- different_read` ne l'est pas : ce sont deux jugements différents.
do $$
declare
  legacy_count integer;
begin
  select count(*) into legacy_count
  from public.reactions
  where type in ('confirmed', 'outdated', 'different');

  if legacy_count > 0 then
    raise exception
      'Cette migration suppose zéro réaction héritée ; % trouvée(s). Décider d''une correspondance explicite avant de continuer.',
      legacy_count;
  end if;
end
$$;

alter table public.reactions
  drop constraint if exists reactions_type_allowed;

alter table public.reactions
  add constraint reactions_type_allowed
  check (type in ('helpful', 'still_true', 'different_read'));

comment on column public.reactions.type is
  'Réaction ciblée à un dispatch. helpful = utile ; still_true = la note tient toujours ; different_read = lecture différente. Volontairement sans vote négatif ni score agrégé.';
