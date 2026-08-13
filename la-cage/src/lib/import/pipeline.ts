import { AGENTS } from "@/agents/registry";
import { newId, nowIso } from "@/lib/id";
import { guessExcelKind, parseExcelBuffer } from "@/lib/import/excel";
import {
  extractPdfFields,
  guessPdfKind,
  parsePdfBuffer,
} from "@/lib/import/pdf";
import {
  inventoryStatus,
  readLocalFile,
  readLocalStore,
  saveLocalFile,
  writeLocalStore,
} from "@/lib/store/local";
import { getDataMode, getSupabaseOrNull } from "@/lib/store/mode";
import type {
  DocKind,
  DocSource,
  DocumentRecord,
} from "@/lib/types";

function detectMime(filename: string, mime?: string | null): string {
  if (mime) return mime;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function isExcel(mime: string, filename: string) {
  return (
    mime.includes("sheet") ||
    mime.includes("excel") ||
    /\.(xlsx|xls|csv)$/i.test(filename)
  );
}

function isPdf(mime: string, filename: string) {
  return mime.includes("pdf") || /\.pdf$/i.test(filename);
}

export async function ingestDocument(input: {
  filename: string;
  buffer: Buffer;
  mime_type?: string | null;
  source?: DocSource;
  external_id?: string | null;
  kind?: DocKind;
}): Promise<DocumentRecord> {
  const mime = detectMime(input.filename, input.mime_type);
  const source = input.source ?? "upload";
  const mode = getDataMode();

  if (mode === "supabase") {
    return ingestSupabase({ ...input, mime_type: mime, source });
  }
  return ingestLocal({ ...input, mime_type: mime, source });
}

async function ingestLocal(input: {
  filename: string;
  buffer: Buffer;
  mime_type: string;
  source: DocSource;
  external_id?: string | null;
  kind?: DocKind;
}): Promise<DocumentRecord> {
  const storage_path = await saveLocalFile(input.filename, input.buffer);
  const t = nowIso();
  const doc: DocumentRecord = {
    id: newId(),
    source: input.source,
    kind: input.kind ?? "other",
    filename: input.filename,
    mime_type: input.mime_type,
    storage_path,
    external_id: input.external_id ?? null,
    status: "pending",
    error: null,
    meta: { bytes: input.buffer.length },
    created_at: t,
    updated_at: t,
  };
  const store = await readLocalStore();
  store.documents.unshift(doc);
  store.activity_log.unshift({
    id: newId(),
    message: `Document reçu · ${input.filename}`,
    source: "import",
    created_at: t,
  });
  await writeLocalStore(store);
  return parseDocument(doc.id);
}

async function ingestSupabase(input: {
  filename: string;
  buffer: Buffer;
  mime_type: string;
  source: DocSource;
  external_id?: string | null;
  kind?: DocKind;
}): Promise<DocumentRecord> {
  const supabase = getSupabaseOrNull();
  if (!supabase) throw new Error("Supabase non configuré");

  const id = newId();
  const storage_path = `${id}/${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(storage_path, input.buffer, {
      contentType: input.mime_type,
      upsert: false,
    });
  if (upErr) throw new Error(`Storage: ${upErr.message}`);

  const row = {
    id,
    source: input.source,
    kind: input.kind ?? "other",
    filename: input.filename,
    mime_type: input.mime_type,
    storage_path,
    external_id: input.external_id ?? null,
    status: "pending" as const,
    error: null,
    meta: { bytes: input.buffer.length },
  };

  const { data, error } = await supabase
    .from("documents")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("activity_log").insert({
    message: `Document reçu · ${input.filename}`,
    source: "import",
  });

  return parseDocument(data.id);
}

export async function parseDocument(documentId: string): Promise<DocumentRecord> {
  const mode = getDataMode();
  if (mode === "supabase") return parseSupabase(documentId);
  return parseLocal(documentId);
}

async function parseLocal(documentId: string): Promise<DocumentRecord> {
  const store = await readLocalStore();
  const doc = store.documents.find((d) => d.id === documentId);
  if (!doc) throw new Error("Document introuvable");
  if (!doc.storage_path) throw new Error("Pas de fichier");

  doc.status = "parsing";
  doc.updated_at = nowIso();
  await writeLocalStore(store);

  try {
    const buffer = await readLocalFile(doc.storage_path);
    const result = await runParsers(doc, buffer);

    doc.kind = result.kind;
    doc.status = "ready";
    doc.meta = { ...doc.meta, ...result.meta };
    doc.error = null;
    doc.updated_at = nowIso();

    store.document_rows = store.document_rows.filter(
      (r) => r.document_id !== doc.id,
    );
    for (const [i, payload] of result.rows.entries()) {
      store.document_rows.push({
        id: newId(),
        document_id: doc.id,
        row_index: i,
        payload,
        created_at: nowIso(),
      });
    }

    applyDomainLocal(store, doc, result);

    store.activity_log.unshift({
      id: newId(),
      message: `Parsé · ${doc.filename} (${doc.kind}, ${result.rows.length} lignes)`,
      source: "import",
      created_at: nowIso(),
    });

    await writeLocalStore(store);
    return doc;
  } catch (e) {
    doc.status = "error";
    doc.error = e instanceof Error ? e.message : String(e);
    doc.updated_at = nowIso();
    await writeLocalStore(store);
    throw e;
  }
}

async function parseSupabase(documentId: string): Promise<DocumentRecord> {
  const supabase = getSupabaseOrNull();
  if (!supabase) throw new Error("Supabase non configuré");

  const { data: doc, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();
  if (error || !doc) throw new Error(error?.message ?? "Document introuvable");
  if (!doc.storage_path) throw new Error("Pas de fichier");

  await supabase
    .from("documents")
    .update({ status: "parsing" })
    .eq("id", documentId);

  try {
    const { data: file, error: dlErr } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "Download failed");
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await runParsers(doc as DocumentRecord, buffer);

    await supabase.from("document_rows").delete().eq("document_id", documentId);
    if (result.rows.length) {
      await supabase.from("document_rows").insert(
        result.rows.map((payload, i) => ({
          document_id: documentId,
          row_index: i,
          payload,
        })),
      );
    }

    await applyDomainSupabase(supabase, documentId, result);

    const { data: updated, error: upErr } = await supabase
      .from("documents")
      .update({
        kind: result.kind,
        status: "ready",
        error: null,
        meta: { ...(doc.meta ?? {}), ...result.meta },
      })
      .eq("id", documentId)
      .select()
      .single();
    if (upErr) throw new Error(upErr.message);

    await supabase.from("activity_log").insert({
      message: `Parsé · ${doc.filename} (${result.kind}, ${result.rows.length} lignes)`,
      source: "import",
    });

    return updated as DocumentRecord;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("documents")
      .update({ status: "error", error: msg })
      .eq("id", documentId);
    throw e;
  }
}

type ParseResult = {
  kind: DocKind;
  rows: Record<string, unknown>[];
  meta: Record<string, unknown>;
  domain: {
    inventory?: { name: string; on_hand: number; par_level?: number; unit?: string }[];
    payroll?: {
      employee_name: string;
      role?: string;
      hours?: number;
      gross?: number;
      net?: number;
    }[];
    invoices?: {
      supplier_name?: string;
      invoice_number?: string;
      total_ht?: number;
      total_ttc?: number;
      invoice_date?: string;
    }[];
  };
};

async function runParsers(
  doc: DocumentRecord,
  buffer: Buffer,
): Promise<ParseResult> {
  const mime = doc.mime_type ?? "";
  const filename = doc.filename;

  if (isExcel(mime, filename)) {
    const sheets = parseExcelBuffer(buffer);
    const kind = doc.kind !== "other" ? doc.kind : guessExcelKind(sheets);
    const rows: Record<string, unknown>[] = sheets.flatMap((s) =>
      s.rows.map((r) => ({ _sheet: s.sheet, ...r })),
    );
    const domain: ParseResult["domain"] = {};

    if (kind === "inventaire") {
      domain.inventory = rows.map((r) => ({
        name: String(r.name ?? r.Name ?? r.article ?? r.Article ?? r.item ?? "—"),
        on_hand: num(r.on_hand ?? r.stock ?? r.quantite ?? r["Quantité"] ?? r.qty ?? 0),
        par_level: numOpt(r.par ?? r.par_level ?? r.Par),
        unit: String(r.unit ?? r["unité"] ?? r.Unite ?? "u"),
      }));
    }
    if (kind === "fiche_paie") {
      domain.payroll = rows.map((r) => ({
        employee_name: String(
          r.employee ?? r.nom ?? r.Name ?? r["employé"] ?? "—",
        ),
        role: r.role ? String(r.role) : undefined,
        hours: numOpt(r.hours ?? r.heures),
        gross: numOpt(r.gross ?? r.brut),
        net: numOpt(r.net),
      }));
    }
    if (kind === "facture") {
      domain.invoices = rows.map((r) => ({
        supplier_name: strOpt(r.supplier ?? r.fournisseur),
        invoice_number: strOpt(r.number ?? r.numero ?? r.facture),
        total_ht: numOpt(r.ht ?? r.total_ht),
        total_ttc: numOpt(r.ttc ?? r.total_ttc),
        invoice_date: strOpt(r.date),
      }));
    }

    return {
      kind,
      rows,
      meta: { sheets: sheets.map((s) => s.sheet), engine: "xlsx" },
      domain,
    };
  }

  if (isPdf(mime, filename)) {
    const pdf = await parsePdfBuffer(buffer);
    const kind =
      doc.kind !== "other" && doc.kind !== "excel"
        ? (doc.kind as "fiche_paie" | "facture" | "other")
        : guessPdfKind(pdf.text);
    const fields = extractPdfFields(kind, pdf.text);
    const domain: ParseResult["domain"] = {};
    if (kind === "fiche_paie") {
      domain.payroll = [
        {
          employee_name: String(fields.employee_name ?? "Inconnu"),
          hours: numOpt(fields.hours),
          gross: numOpt(fields.gross),
          net: numOpt(fields.net),
        },
      ];
    }
    if (kind === "facture") {
      domain.invoices = [
        {
          invoice_number: strOpt(fields.invoice_number),
          total_ht: numOpt(fields.total_ht),
          total_ttc: numOpt(fields.total_ttc),
          invoice_date: strOpt(fields.invoice_date),
        },
      ];
    }
    return {
      kind: kind === "other" ? "other" : kind,
      rows: [{ ...fields, lines: pdf.lines.slice(0, 100) }],
      meta: { pages: pdf.pages, engine: "pdf-parse", chars: pdf.text.length },
      domain,
    };
  }

  return {
    kind: "other",
    rows: [{ note: "Format non supporté pour parse auto", filename }],
    meta: { engine: "none" },
    domain: {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyDomainLocal(store: any, doc: DocumentRecord, result: ParseResult) {
  const t = nowIso();
  if (result.domain.inventory) {
    for (const item of result.domain.inventory) {
      const existing = store.inventory_items.find(
        (i: { name: string }) => i.name === item.name,
      );
      const status = inventoryStatus(item.on_hand, item.par_level ?? null);
      if (existing) {
        existing.on_hand = item.on_hand;
        if (item.par_level != null) existing.par_level = item.par_level;
        existing.status = status;
        existing.updated_at = t;
      } else {
        store.inventory_items.push({
          id: newId(),
          name: item.name,
          unit: item.unit ?? "u",
          on_hand: item.on_hand,
          par_level: item.par_level ?? null,
          status,
          updated_at: t,
        });
      }
      if (status === "low" || status === "warn") {
        store.alerts.unshift({
          id: newId(),
          severity: status === "low" ? "bad" : "warn",
          title: `${item.name} sous par`,
          detail: `${item.on_hand} · par ${item.par_level ?? "—"}`,
          source: "import",
          status: "open",
          created_at: t,
        });
      }
    }
  }
  if (result.domain.payroll) {
    for (const p of result.domain.payroll) {
      store.payroll_entries.unshift({
        id: newId(),
        document_id: doc.id,
        employee_name: p.employee_name,
        role: p.role ?? null,
        period_start: null,
        period_end: null,
        hours: p.hours ?? null,
        gross: p.gross ?? null,
        net: p.net ?? null,
        raw: p,
        created_at: t,
      });
    }
  }
  if (result.domain.invoices) {
    for (const inv of result.domain.invoices) {
      let supplier_id: string | null = null;
      if (inv.supplier_name) {
        let s = store.suppliers.find(
          (x: { name: string }) => x.name === inv.supplier_name,
        );
        if (!s) {
          s = {
            id: newId(),
            name: inv.supplier_name,
            notes: null,
            active: true,
            created_at: t,
          };
          store.suppliers.push(s);
        }
        supplier_id = s.id;
      }
      store.invoices.unshift({
        id: newId(),
        supplier_id,
        document_id: doc.id,
        invoice_number: inv.invoice_number ?? null,
        invoice_date: inv.invoice_date ?? null,
        total_ht: inv.total_ht ?? null,
        total_ttc: inv.total_ttc ?? null,
        currency: "EUR",
        flag: null,
        raw: inv,
        created_at: t,
        supplier_name: inv.supplier_name,
      });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyDomainSupabase(
  supabase: any,
  documentId: string,
  result: ParseResult,
) {
  if (result.domain.inventory) {
    for (const item of result.domain.inventory) {
      await supabase.from("inventory_items").upsert(
        {
          name: item.name,
          unit: item.unit ?? "u",
          on_hand: item.on_hand,
          par_level: item.par_level ?? null,
          updated_at: nowIso(),
        },
        { onConflict: "name" },
      );
    }
  }
  if (result.domain.payroll) {
    for (const p of result.domain.payroll) {
      await supabase.from("payroll_entries").insert({
        document_id: documentId,
        employee_name: p.employee_name,
        role: p.role ?? null,
        hours: p.hours ?? null,
        gross: p.gross ?? null,
        net: p.net ?? null,
        raw: p,
      });
    }
  }
  if (result.domain.invoices) {
    for (const inv of result.domain.invoices) {
      let supplier_id: string | null = null;
      if (inv.supplier_name) {
        const { data: existing } = await supabase
          .from("suppliers")
          .select("id")
          .eq("name", inv.supplier_name)
          .maybeSingle();
        if (existing) supplier_id = existing.id;
        else {
          const { data: created } = await supabase
            .from("suppliers")
            .insert({ name: inv.supplier_name })
            .select("id")
            .single();
          supplier_id = created?.id ?? null;
        }
      }
      await supabase.from("invoices").insert({
        document_id: documentId,
        supplier_id,
        invoice_number: inv.invoice_number ?? null,
        invoice_date: inv.invoice_date ?? null,
        total_ht: inv.total_ht ?? null,
        total_ttc: inv.total_ttc ?? null,
        raw: inv,
      });
    }
  }
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  if (getDataMode() === "supabase") {
    const supabase = getSupabaseOrNull();
    if (!supabase) return [];
    const { data } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as DocumentRecord[];
  }
  const store = await readLocalStore();
  return store.documents;
}

export async function syncAgentHeartbeats() {
  const t = nowIso();
  const rows = AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    job: a.job,
    status: a.status,
    last_seen_at: t,
    meta: {},
  }));

  if (getDataMode() === "supabase") {
    const supabase = getSupabaseOrNull();
    if (!supabase) return rows;
    await supabase.from("agent_heartbeats").upsert(rows);
    return rows;
  }

  const store = await readLocalStore();
  store.agent_heartbeats = rows.map((r) => ({
    ...r,
    status: r.status as AgentHeartbeatStatus,
  }));
  await writeLocalStore(store);
  return rows;
}

type AgentHeartbeatStatus = "running" | "idle" | "error" | "empty";

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function numOpt(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = num(v);
  return Number.isFinite(n) ? n : undefined;
}

function strOpt(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  return String(v);
}
