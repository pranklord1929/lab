-- Reddit-style nested restaurant conversations.
--
-- Existing dispatches remain untouched and become root comments. New replies
-- use the same table so reactions, reports, moderation and author ownership
-- continue to apply uniformly at every depth.

begin;

alter table public.dispatches
  add column if not exists parent_id uuid,
  add column if not exists root_id uuid,
  add column if not exists depth smallint;

update public.dispatches
set root_id = id,
    depth = 0
where root_id is null or depth is null;

alter table public.dispatches
  alter column root_id set not null,
  alter column depth set not null,
  alter column depth set default 0;

alter table public.dispatches
  drop constraint if exists dispatches_parent_id_fkey,
  add constraint dispatches_parent_id_fkey
    foreign key (parent_id)
    references public.dispatches(id)
    on delete cascade,
  drop constraint if exists dispatches_root_id_fkey,
  add constraint dispatches_root_id_fkey
    foreign key (root_id)
    references public.dispatches(id)
    on delete cascade,
  drop constraint if exists dispatches_depth_range,
  add constraint dispatches_depth_range
    check (depth between 0 and 8),
  drop constraint if exists dispatches_root_shape,
  add constraint dispatches_root_shape
    check (
      (parent_id is null and root_id = id and depth = 0)
      or
      (parent_id is not null and root_id <> id and depth > 0)
    );

create index if not exists dispatches_parent_created_at_idx
  on public.dispatches (parent_id, created_at);

create index if not exists dispatches_root_created_at_idx
  on public.dispatches (root_id, created_at);

create index if not exists dispatches_restaurant_parent_created_at_idx
  on public.dispatches (restaurant_id, parent_id, created_at desc);

create or replace function public.prepare_dispatch_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_row public.dispatches%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.parent_id is distinct from old.parent_id
       or new.root_id is distinct from old.root_id
       or new.depth is distinct from old.depth
       or new.restaurant_id is distinct from old.restaurant_id then
      raise exception using
        errcode = '23514',
        message = 'a published comment cannot move to another thread';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    new.root_id := new.id;
    new.depth := 0;
    return new;
  end if;

  select parent.*
    into parent_row
  from public.dispatches as parent
  where parent.id = new.parent_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'reply parent does not exist';
  end if;

  if parent_row.restaurant_id <> new.restaurant_id then
    raise exception using
      errcode = '23514',
      message = 'a reply must stay in its parent restaurant';
  end if;

  if parent_row.depth >= 8 then
    raise exception using
      errcode = '23514',
      message = 'maximum reply depth reached';
  end if;

  new.root_id := parent_row.root_id;
  new.depth := parent_row.depth + 1;
  return new;
end;
$$;

revoke execute on function public.prepare_dispatch_thread()
  from public, anon, authenticated;

drop trigger if exists dispatches_prepare_thread on public.dispatches;
create trigger dispatches_prepare_thread
  before insert or update of parent_id, root_id, depth, restaurant_id
  on public.dispatches
  for each row execute procedure public.prepare_dispatch_thread();

-- Root comments keep the existing minimum. Replies can be conversationally
-- short, while remaining bounded for moderation and rendering.
alter table public.dispatches
  drop constraint if exists dispatches_body_length;

alter table public.dispatches
  drop constraint if exists dispatches_body_length_by_kind;

alter table public.dispatches
  add constraint dispatches_body_length_by_kind
  check (
    (
      parent_id is null
      and kind = 'quick_signal'
      and char_length(btrim(body)) between 3 and 280
    )
    or
    (
      parent_id is null
      and kind = 'field_note'
      and char_length(btrim(body)) between 20 and 4000
    )
    or
    (
      parent_id is not null
      and kind = 'field_note'
      and char_length(btrim(body)) between 2 and 2000
    )
  );

-- Text and optional topics remain an atomic author-only update for roots and
-- replies. The table constraint decides the minimum length for each shape.
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
  topic_count integer := coalesce(array_length(new_topics, 1), 0);
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if topic_count > 3
     or topic_count <> coalesce((
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
    raise exception using errcode = '23514', message = 'invalid comment topics';
  end if;

  update public.dispatches
  set body = trim(new_body)
  where id = target_dispatch_id
    and author_id = caller
    and kind = 'field_note';

  if not found then
    raise exception using errcode = '42501', message = 'comment not editable';
  end if;

  delete from public.dispatch_topics where dispatch_id = target_dispatch_id;

  if topic_count > 0 then
    insert into public.dispatch_topics (dispatch_id, topic)
    select target_dispatch_id, entries.topic
    from unnest(new_topics) as entries(topic);
  end if;
end;
$$;

revoke execute on function public.update_field_note(uuid, text, text[])
  from public, anon;
grant execute on function public.update_field_note(uuid, text, text[])
  to authenticated;

comment on column public.dispatches.parent_id is
  'Immediate parent comment. Null means a root comment on the restaurant community.';
comment on column public.dispatches.root_id is
  'Root comment for efficient thread retrieval. Set and protected by prepare_dispatch_thread().';
comment on column public.dispatches.depth is
  'Server-derived nesting depth. Rendering may visually cap indentation without flattening the data.';

commit;
