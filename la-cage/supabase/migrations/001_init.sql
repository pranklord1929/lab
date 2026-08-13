-- La Cage — schema complet
-- Supabase SQL Editor → Run, ou: npx supabase db push

create extension if not exists "pgcrypto";

-- ── Documents bruts (Drive / upload / email) ─────────────────
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'upload',
  kind text not null default 'other',
  filename text not null,
  mime_type text,
  storage_path text,
  external_id text,
  status text not null default 'pending',
  error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_kind_idx on documents (kind);
create index if not exists documents_status_idx on documents (status);
create index if not exists documents_created_idx on documents (created_at desc);

-- Lignes extraites
create table if not exists document_rows (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  row_index int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_rows_document_idx on document_rows (document_id);

-- Fournisseurs
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Factures
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers (id) on delete set null,
  document_id uuid references documents (id) on delete set null,
  invoice_number text,
  invoice_date date,
  total_ht numeric(12, 2),
  total_ttc numeric(12, 2),
  currency text not null default 'EUR',
  flag text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists invoices_date_idx on invoices (invoice_date desc);

-- Inventaire
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'kg',
  on_hand numeric(12, 3) not null default 0,
  par_level numeric(12, 3),
  status text generated always as (
    case
      when par_level is null then 'ok'
      when on_hand <= par_level * 0.4 then 'low'
      when on_hand <= par_level * 0.75 then 'warn'
      else 'ok'
    end
  ) stored,
  updated_at timestamptz not null default now()
);

-- Paie
create table if not exists payroll_entries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents (id) on delete set null,
  employee_name text not null,
  role text,
  period_start date,
  period_end date,
  hours numeric(10, 2),
  gross numeric(12, 2),
  net numeric(12, 2),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Alertes ops
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info',
  title text not null,
  detail text,
  source text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists alerts_open_idx on alerts (status, created_at desc);

-- KPIs journaliers (optionnel, calculés ou poussés par agents)
create table if not exists daily_kpis (
  day date primary key,
  ca numeric(12, 2),
  food_cost_pct numeric(6, 2),
  food_cost_theo_pct numeric(6, 2),
  labor_pct numeric(6, 2),
  prime_cost_pct numeric(6, 2),
  ticket_avg numeric(10, 2),
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Agents heartbeat
create table if not exists agent_heartbeats (
  id text primary key,
  name text not null,
  job text,
  status text not null default 'idle',
  last_seen_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

-- Activité
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx on activity_log (created_at desc);

-- updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists documents_updated on documents;
create trigger documents_updated
  before update on documents
  for each row execute function set_updated_at();

-- Storage bucket (run in dashboard if storage.buckets insert fails)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
