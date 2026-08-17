-- User-uploaded photos only. No Google Places media at read time.
--
-- Demo posts may still have places_ref rows from the previous migration; the
-- feed ignores them. Display requires a free public_url (Supabase Storage).

begin;

create or replace function public.dispatch_feed_image(p_dispatch_id uuid, p_restaurant_id uuid)
returns table (image_url text, image_ref text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Only hosted URLs. places_ref is never returned for display (no paid Google).
  select dm.public_url as image_url, null::text as image_ref
  from public.dispatch_media as dm
  where dm.dispatch_id = p_dispatch_id
    and dm.public_url is not null
    and length(btrim(dm.public_url)) > 0
  order by dm.sort_order, dm.created_at
  limit 1;
$$;

comment on function public.dispatch_feed_image(uuid, uuid) is
  'Primary post image for the feed. public_url only — never Google Places.';

-- Drop the unused Places helper from the public surface (definer internals OK to keep offline).
revoke execute on function public.restaurant_primary_photo_ref(uuid) from anon, authenticated;

commit;
