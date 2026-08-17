-- Public contracts must run as their owner after raw-table grants are revoked.
-- The published-only predicates live in the views themselves; security_barrier
-- prevents caller predicates from being pushed beneath that boundary.

alter view public.public_catalogue
  set (security_invoker = false, security_barrier = true);
alter view public.public_menu_items
  set (security_invoker = false, security_barrier = true);
alter view public.public_menu_items_extracted
  set (security_invoker = false, security_barrier = true);
