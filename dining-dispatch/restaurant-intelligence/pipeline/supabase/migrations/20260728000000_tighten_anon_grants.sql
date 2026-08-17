-- Give the anonymous role only what an anonymous reader needs.
--
-- `anon` held INSERT, UPDATE, DELETE and TRUNCATE on every community table.
-- Row Level Security has always been the real gate and no policy allows an
-- anonymous write, so nothing was exploitable through the API. But TRUNCATE is
-- the one statement RLS cannot restrain: it is checked against table
-- privileges alone. Holding it meant a single mis-scoped policy — or any other
-- path that authenticates as `anon` — stood between the beta and an empty
-- table. Grants are the second wall behind RLS, and this one was missing.
--
-- Reading stays exactly as it was, so no client behaviour changes.

begin;

-- Anonymous readers read. Nothing else.
revoke insert, update, delete, truncate, references, trigger
  on public.dispatches from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.reactions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.dispatch_mentions from anon;

-- Signed-in members write through RLS, but never need to empty a table or
-- attach triggers.
revoke truncate, references, trigger on public.dispatches from authenticated;
revoke truncate, references, trigger on public.profiles from authenticated;
revoke truncate, references, trigger on public.reactions from authenticated;
revoke truncate, references, trigger on public.dispatch_mentions from authenticated;
revoke truncate, references, trigger on public.saved_posts from authenticated;
revoke truncate, references, trigger on public.saved_restaurants from authenticated;

-- A member updates their own profile and their own comment body; they never
-- delete a profile row directly (delete_own_account does that) and never
-- update someone else's reaction.
revoke delete on public.profiles from authenticated;
revoke update on public.reactions from authenticated;

-- Read paths, restated so the intent is explicit rather than inherited.
grant select on public.dispatches to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant select on public.reactions to anon, authenticated;
grant select on public.dispatch_mentions to anon, authenticated;

commit;
