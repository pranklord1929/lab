-- Allow photo attachments on replies, not only root posts.

begin;

drop policy if exists "Authors add media to their posts" on public.dispatch_media;
create policy "Authors add media to their comments"
  on public.dispatch_media for insert
  with check (
    exists (
      select 1
      from public.dispatches as d
      where d.id = dispatch_media.dispatch_id
        and d.author_id = auth.uid()
    )
  );

comment on policy "Authors add media to their comments" on public.dispatch_media is
  'Any comment the member authored (root or reply) may receive Storage-hosted photos.';

commit;
