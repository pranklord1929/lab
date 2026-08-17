-- Phase 1B (3/3) — Fermeture de l'accès brut.
--
-- NON APPLIQUÉE. À exécuter uniquement APRÈS 20260725180100, une fois les
-- contrats publics de remplacement vérifiés sur la branche.
--
-- C'est le fichier qui applique réellement la frontière. Sans lui, la
-- recherche curée n'est qu'une convention : n'importe qui lisant le bundle de
-- l'app peut interroger directement les 56 796 lignes brutes.
--
-- Effet de bord assumé : le prototype web déployé lit `restaurant_search_mv`
-- et `menu_items` en direct et cessera de fonctionner tant qu'il n'est pas
-- repointé sur les vues publiques. Le web est gelé par décision produit.
--
-- L'ingestion n'est pas affectée : elle écrit avec la clé secrète
-- (`service_role`), qui contourne ces révocations.

-- `revoke all`, pas seulement `select`. Les privilèges par défaut de Supabase
-- laissent INSERT/UPDATE/DELETE/TRUNCATE à anon sur les tables du schéma
-- public : aujourd'hui seule la RLS empêche l'écriture, et une future policy
-- permissive rouvrirait tout. On retire les droits plutôt que de dépendre
-- d'une seule barrière.
revoke all on public.restaurant_search_mv        from anon, authenticated;
revoke all on public.menu_items                  from anon, authenticated;
revoke all on public.menu_items_local_extracted  from anon, authenticated;

-- Les vues publiques doivent s'exécuter avec les droits de leur propriétaire :
-- l'appelant vient de perdre l'accès aux tables sources. Cela laisse la
-- jointure fonctionner sans rouvrir l'accès direct aux tables brutes.
alter view public.public_catalogue            set (security_invoker = false);
alter view public.public_menu_items           set (security_invoker = false);
alter view public.public_menu_items_extracted set (security_invoker = false);

-- `search_restaurants` reste `security invoker` : elle ne lit que
-- `public_catalogue`, désormais exécutée avec les droits de son propriétaire,
-- donc la chaîne tient
-- sans donner à anon le moindre droit sur les tables brutes.
