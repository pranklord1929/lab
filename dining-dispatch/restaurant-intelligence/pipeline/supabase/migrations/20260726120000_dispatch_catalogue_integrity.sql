-- Keep every community note inside the qualified beta catalogue.
--
-- The client previously supplied restaurant_id, restaurant_name and
-- restaurant_area independently. RLS checked only the author, so a signed-in
-- user could publish an arbitrary restaurant and arbitrary display name.
-- Canonicalization belongs in the database because every client and future
-- import must obey the same boundary.

create or replace function public.canonicalize_dispatch_restaurant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_name text;
  canonical_area text;
begin
  select catalogue.name, coalesce(catalogue.colonia, catalogue.alcaldia)
    into canonical_name, canonical_area
  from public.app_catalogue as catalogue
  where catalogue.id = new.restaurant_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'dispatch restaurant must belong to app_catalogue';
  end if;

  new.restaurant_name := canonical_name;
  new.restaurant_area := canonical_area;
  return new;
end;
$$;

revoke execute on function public.canonicalize_dispatch_restaurant()
  from public, anon, authenticated;

drop trigger if exists dispatches_canonicalize_restaurant on public.dispatches;
create trigger dispatches_canonicalize_restaurant
  before insert or update of restaurant_id, restaurant_name, restaurant_area
  on public.dispatches
  for each row execute procedure public.canonicalize_dispatch_restaurant();

drop policy if exists "Dispatches are public" on public.dispatches;
drop policy if exists "Qualified dispatches are public" on public.dispatches;
create policy "Qualified dispatches are public"
  on public.dispatches for select
  using (
    exists (
      select 1
      from public.app_catalogue as catalogue
      where catalogue.id = dispatches.restaurant_id
    )
  );

drop policy if exists "Users create their dispatches" on public.dispatches;
drop policy if exists "Users create qualified dispatches" on public.dispatches;
create policy "Users create qualified dispatches"
  on public.dispatches for insert
  with check (
    auth.uid() = author_id
    and exists (
      select 1
      from public.app_catalogue as catalogue
      where catalogue.id = dispatches.restaurant_id
    )
  );

drop policy if exists "Users update their dispatches" on public.dispatches;
drop policy if exists "Users update their qualified dispatches" on public.dispatches;
create policy "Users update their qualified dispatches"
  on public.dispatches for update
  using (auth.uid() = author_id)
  with check (
    auth.uid() = author_id
    and exists (
      select 1
      from public.app_catalogue as catalogue
      where catalogue.id = dispatches.restaurant_id
    )
  );

-- Rewrite text and topics atomically. A PostgREST delete followed by an insert
-- can otherwise leave a valid note without topics if the second request fails.
create or replace function public.update_field_note(
  target_dispatch_id uuid,
  new_body text,
  new_topics text[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if char_length(trim(new_body)) not between 20 and 4000 then
    raise exception using errcode = '23514', message = 'invalid field note length';
  end if;

  if coalesce(array_length(new_topics, 1), 0) not between 1 and 3
     or coalesce(array_length(new_topics, 1), 0)
        <> coalesce((
          select count(distinct entries.topic)
          from unnest(new_topics) as entries(topic)
        ), 0)
     or exists (
       select 1
       from unnest(new_topics) as entries(topic)
       where entries.topic not in (
         'Food', 'Wine & Drinks', 'Vegetarian', 'Service',
         'Atmosphere', 'Family', 'Groups', 'Value'
       )
     ) then
    raise exception using errcode = '23514', message = 'invalid field note topics';
  end if;

  update public.dispatches
  set body = trim(new_body)
  where id = target_dispatch_id and author_id = caller and kind = 'field_note';

  if not found then
    raise exception using errcode = '42501', message = 'field note not editable';
  end if;

  delete from public.dispatch_topics where dispatch_id = target_dispatch_id;
  insert into public.dispatch_topics (dispatch_id, topic)
  select target_dispatch_id, entries.topic
  from unnest(new_topics) as entries(topic);
end;
$$;

revoke execute on function public.update_field_note(uuid, text, text[])
  from public, anon;
grant execute on function public.update_field_note(uuid, text, text[])
  to authenticated;

-- Qualify the correlated column explicitly so a future app_catalogue schema
-- change cannot silently rebind the policy expression.
drop policy if exists "Users save qualified restaurants" on public.saved_restaurants;
create policy "Users save qualified restaurants"
  on public.saved_restaurants for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_catalogue as catalogue
      where catalogue.id = saved_restaurants.restaurant_id
    )
  );

comment on function public.canonicalize_dispatch_restaurant() is
  'Rejects non-app catalogue notes and overwrites client-supplied restaurant labels with canonical catalogue values.';
