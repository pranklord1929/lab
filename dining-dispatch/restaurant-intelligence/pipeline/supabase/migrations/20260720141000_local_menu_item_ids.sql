-- Local OCR item identifiers are content hashes rather than UUIDs.
alter table public.menu_items_local_extracted
  alter column id type text using id::text;
