-- Signalement de dispatches — la table que l'app iOS appelle déjà.
--
-- STAGING UNIQUEMENT. La production n'a pas reçu cette migration.
--
-- L'app expédie un signalement vers `dispatch_reports` depuis sa sortie ; la
-- table n'a jamais existé. PostgREST répond 404, l'app affiche « The report
-- could not be sent » et le signalement disparaît. Un contenu communautaire
-- sans voie de signalement fonctionnelle bloque aussi la publication App Store.
--
-- Reprend `web/supabase/20260719_beta_safety.sql`, qui n'a jamais été versionné
-- ni appliqué, en durcissant l'accès : personne ne lit les signalements des
-- autres, et la modération se fait à la clé secrète, hors de l'API publique.

create table if not exists public.dispatch_reports (
  id          uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null,
  details     text,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,

  -- Un signalement par personne et par dispatch : re-signaler n'est pas voter.
  unique (dispatch_id, reporter_id),

  constraint dispatch_reports_reason check (
    reason in (
      'Spam or promotion',
      'Harassment or abuse',
      'Conflict of interest',
      'False or misleading information',
      'Other'
    )
  ),
  constraint dispatch_reports_details_length check (
    details is null or char_length(details) between 1 and 1000
  ),
  constraint dispatch_reports_status check (
    status in ('open', 'reviewing', 'resolved', 'dismissed')
  )
);

comment on table public.dispatch_reports is
  'Signalements privés. Un auteur ne sait jamais qu''il a été signalé ni par qui : le rendre visible transformerait la modération en confrontation.';

create index if not exists dispatch_reports_status_idx
  on public.dispatch_reports (status, created_at desc);

alter table public.dispatch_reports enable row level security;

-- Écriture : authentifié, en son propre nom, et jamais sur son propre dispatch.
-- `auth.uid() = reporter_id` bloque aussi l'anonyme, dont `auth.uid()` est nul.
drop policy if exists "Users create their reports" on public.dispatch_reports;
create policy "Users create their reports"
  on public.dispatch_reports for insert
  with check (
    auth.uid() = reporter_id
    and exists (
      select 1 from public.dispatches
      where id = dispatch_id and author_id <> auth.uid()
    )
  );

-- Lecture : uniquement ses propres signalements. Aucune policy de update ou de
-- delete — un signalement envoyé n'est pas rétractable par son auteur, et le
-- traitement (`status`, `reviewed_at`) appartient à la clé secrète.
drop policy if exists "Users read their reports" on public.dispatch_reports;
create policy "Users read their reports"
  on public.dispatch_reports for select
  using (auth.uid() = reporter_id);

-- Les privilèges par défaut de Supabase donnent tout à anon sur les tables du
-- schéma public : seule la RLS retiendrait un anonyme. On retire les droits
-- plutôt que de dépendre d'une barrière unique, et on ne rend à l'authentifié
-- que ce dont l'app a besoin.
revoke all on public.dispatch_reports from anon, authenticated;
grant select, insert on public.dispatch_reports to authenticated;
