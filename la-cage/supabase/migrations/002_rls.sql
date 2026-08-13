-- RLS: service role bypasses; anon can read ops tables (tighten later)

alter table documents enable row level security;
alter table document_rows enable row level security;
alter table suppliers enable row level security;
alter table invoices enable row level security;
alter table inventory_items enable row level security;
alter table payroll_entries enable row level security;
alter table alerts enable row level security;
alter table daily_kpis enable row level security;
alter table agent_heartbeats enable row level security;
alter table activity_log enable row level security;

-- Dev-friendly policies (read for anon, write for authenticated/service)
do $$
declare
  t text;
begin
  foreach t in array array[
    'documents','document_rows','suppliers','invoices','inventory_items',
    'payroll_entries','alerts','daily_kpis','agent_heartbeats','activity_log'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_select_all', t);
    execute format(
      'create policy %I on %I for select using (true)',
      t || '_select_all', t
    );
    execute format('drop policy if exists %I on %I', t || '_all_service', t);
    -- inserts/updates via service role (bypasses RLS) or authenticated
    execute format(
      'create policy %I on %I for all using (auth.role() = %L) with check (auth.role() = %L)',
      t || '_all_authenticated', t, 'authenticated', 'authenticated'
    );
  end loop;
end $$;
