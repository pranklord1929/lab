-- Les fournisseurs sociaux ne transmettent pas le pseudo public exigé par
-- `profiles.username`. Sans valeur de repli, le trigger fait échouer toute
-- première connexion Apple/Google avec "Database error saving new user".
--
-- Un pseudo technique est donc attribué à la création. L'app reconnaît le
-- préfixe réservé et bloque l'onboarding jusqu'au choix d'un vrai table name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  requested_username text := nullif(btrim(new.raw_user_meta_data ->> 'username'), '');
  profile_username text;
begin
  if requested_username ~ '^[A-Za-z0-9_]{3,24}$'
     and requested_username !~* '^new_diner_'
     and not exists (
       select 1 from public.profiles where lower(username) = lower(requested_username)
     ) then
    profile_username := requested_username;
  else
    profile_username := 'new_diner_' || substring(replace(new.id::text, '-', '') from 1 for 14);
  end if;

  insert into public.profiles (id, username)
  values (new.id, profile_username);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
