import { promises as fs } from "fs";
import path from "path";
import { newId, nowIso } from "@/lib/id";
import type {
  ActivityItem,
  AgentHeartbeat,
  Alert,
  DailyKpi,
  DocumentRecord,
  DocumentRow,
  InventoryItem,
  Invoice,
  PayrollEntry,
  Supplier,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const FILES_DIR = path.join(DATA_DIR, "files");

export type LocalStore = {
  documents: DocumentRecord[];
  document_rows: DocumentRow[];
  suppliers: Supplier[];
  invoices: Invoice[];
  inventory_items: InventoryItem[];
  payroll_entries: PayrollEntry[];
  alerts: Alert[];
  daily_kpis: DailyKpi[];
  agent_heartbeats: AgentHeartbeat[];
  activity_log: ActivityItem[];
};

function emptyStore(): LocalStore {
  return {
    documents: [],
    document_rows: [],
    suppliers: [],
    invoices: [],
    inventory_items: [],
    payroll_entries: [],
    alerts: [],
    daily_kpis: [],
    agent_heartbeats: [],
    activity_log: [],
  };
}

function seedStore(): LocalStore {
  const t = nowIso();
  return {
    documents: [],
    document_rows: [],
    suppliers: [
      {
        id: newId(),
        name: "Metro",
        notes: null,
        active: true,
        created_at: t,
      },
      {
        id: newId(),
        name: "Rungis — Poissonnerie L.",
        notes: null,
        active: true,
        created_at: t,
      },
      {
        id: newId(),
        name: "Boulanger local",
        notes: null,
        active: true,
        created_at: t,
      },
    ],
    invoices: [],
    inventory_items: [
      {
        id: newId(),
        name: "Saumon ASC",
        unit: "kg",
        on_hand: 2.1,
        par_level: 6,
        status: "low",
        updated_at: t,
      },
      {
        id: newId(),
        name: "Beurre AOP",
        unit: "kg",
        on_hand: 4.5,
        par_level: 3,
        status: "ok",
        updated_at: t,
      },
      {
        id: newId(),
        name: "Huile olive EV",
        unit: "bidon",
        on_hand: 1,
        par_level: 2,
        status: "low",
        updated_at: t,
      },
      {
        id: newId(),
        name: "Crème 35 %",
        unit: "L",
        on_hand: 3,
        par_level: 4,
        status: "warn",
        updated_at: t,
      },
      {
        id: newId(),
        name: "Pommes de terre",
        unit: "kg",
        on_hand: 18,
        par_level: 12,
        status: "ok",
        updated_at: t,
      },
    ],
    payroll_entries: [
      {
        id: newId(),
        document_id: null,
        employee_name: "Alex",
        role: "Cuisine",
        period_start: "2026-03-01",
        period_end: "2026-03-15",
        hours: 72,
        gross: 1440,
        net: 1120,
        raw: {},
        created_at: t,
      },
      {
        id: newId(),
        document_id: null,
        employee_name: "Sam",
        role: "Salle 50 %",
        period_start: "2026-03-01",
        period_end: "2026-03-15",
        hours: 46,
        gross: 782,
        net: 610,
        raw: {},
        created_at: t,
      },
    ],
    alerts: [
      {
        id: newId(),
        severity: "bad",
        title: "Huile d’olive +18 %",
        detail: "Metro · vs 30j",
        source: "Invoice Scout",
        status: "open",
        created_at: t,
      },
      {
        id: newId(),
        severity: "warn",
        title: "Saumon sous par",
        detail: "2,1 kg · par 6 kg",
        source: "Stock Watch",
        status: "open",
        created_at: t,
      },
      {
        id: newId(),
        severity: "warn",
        title: "Food cost drift",
        detail: "Écart théo/réel +2,3 pts",
        source: "Cockpit",
        status: "open",
        created_at: t,
      },
      {
        id: newId(),
        severity: "info",
        title: "Paie à valider",
        detail: "Période 1–15 · 1,5 ETP",
        source: "Payroll Pulse",
        status: "open",
        created_at: t,
      },
    ],
    daily_kpis: [
      {
        day: new Date().toISOString().slice(0, 10),
        ca: 4280,
        food_cost_pct: 31.4,
        food_cost_theo_pct: 29.1,
        labor_pct: 28.8,
        prime_cost_pct: 60.2,
        ticket_avg: 38.2,
        meta: {},
      },
    ],
    agent_heartbeats: [],
    activity_log: [
      {
        id: newId(),
        message: "Stock Watch · saumon sous par",
        source: "stock-watch",
        created_at: t,
      },
      {
        id: newId(),
        message: "Invoice Scout · hausse huile olive",
        source: "invoice-scout",
        created_at: t,
      },
    ],
  };
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(FILES_DIR, { recursive: true });
}

export async function readLocalStore(): Promise<LocalStore> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return { ...emptyStore(), ...JSON.parse(raw) } as LocalStore;
  } catch {
    const seeded = seedStore();
    await writeLocalStore(seeded);
    return seeded;
  }
}

export async function writeLocalStore(store: LocalStore): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function saveLocalFile(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  await ensureDirs();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${Date.now()}_${safe}`;
  await fs.writeFile(path.join(FILES_DIR, storagePath), buffer);
  return storagePath;
}

export async function readLocalFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(path.join(FILES_DIR, storagePath));
}

export function inventoryStatus(
  onHand: number,
  par: number | null,
): "ok" | "warn" | "low" {
  if (par == null) return "ok";
  if (onHand <= par * 0.4) return "low";
  if (onHand <= par * 0.75) return "warn";
  return "ok";
}
