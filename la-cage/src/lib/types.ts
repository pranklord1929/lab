export type DocSource = "upload" | "google_drive" | "email" | "manual";
export type DocKind =
  | "fiche_paie"
  | "facture"
  | "inventaire"
  | "excel"
  | "other";
export type DocStatus = "pending" | "parsing" | "ready" | "error";

export type DocumentRecord = {
  id: string;
  source: DocSource;
  kind: DocKind;
  filename: string;
  mime_type: string | null;
  storage_path: string | null;
  external_id: string | null;
  status: DocStatus;
  error: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DocumentRow = {
  id: string;
  document_id: string;
  row_index: number;
  payload: Record<string, unknown>;
  created_at: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  on_hand: number;
  par_level: number | null;
  status: "ok" | "warn" | "low";
  updated_at: string;
};

export type Supplier = {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type Invoice = {
  id: string;
  supplier_id: string | null;
  document_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_ht: number | null;
  total_ttc: number | null;
  currency: string;
  flag: string | null;
  raw: Record<string, unknown>;
  created_at: string;
  supplier_name?: string;
};

export type PayrollEntry = {
  id: string;
  document_id: string | null;
  employee_name: string;
  role: string | null;
  period_start: string | null;
  period_end: string | null;
  hours: number | null;
  gross: number | null;
  net: number | null;
  raw: Record<string, unknown>;
  created_at: string;
};

export type Alert = {
  id: string;
  severity: "bad" | "warn" | "info";
  title: string;
  detail: string | null;
  source: string | null;
  status: "open" | "done";
  created_at: string;
};

export type DailyKpi = {
  day: string;
  ca: number | null;
  food_cost_pct: number | null;
  food_cost_theo_pct: number | null;
  labor_pct: number | null;
  prime_cost_pct: number | null;
  ticket_avg: number | null;
  meta: Record<string, unknown>;
};

export type AgentHeartbeat = {
  id: string;
  name: string;
  job: string | null;
  status: "running" | "idle" | "error" | "empty";
  last_seen_at: string;
  meta: Record<string, unknown>;
};

export type ActivityItem = {
  id: string;
  message: string;
  source: string | null;
  created_at: string;
};

export type DashboardPayload = {
  mode: "supabase" | "local";
  kpis: {
    id: string;
    label: string;
    value: string;
    delta: string;
    tone: "ok" | "warn" | "bad" | "info";
    sub: string;
  }[];
  alerts: Alert[];
  inventory: InventoryItem[];
  suppliers: Supplier[];
  invoices: Invoice[];
  payroll: PayrollEntry[];
  agents: AgentHeartbeat[];
  activity: ActivityItem[];
  documents: DocumentRecord[];
  costBreakdown: { label: string; pct: number; amount: string }[];
};
