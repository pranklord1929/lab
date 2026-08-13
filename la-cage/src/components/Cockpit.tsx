"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Orb } from "./Orb";
import type { DashboardPayload, NavId } from "./cockpit-types";

export type { NavId };

const NAV: { id: NavId; label: string }[] = [
  { id: "cockpit", label: "Cockpit" },
  { id: "agents", label: "Agents" },
  { id: "inventaire", label: "Inventaire" },
  { id: "fournisseurs", label: "Fournisseurs" },
  { id: "paie", label: "Paie" },
  { id: "couts", label: "Coûts" },
  { id: "documents", label: "Documents" },
  { id: "alertes", label: "Alertes" },
];

function toneText(tone: "ok" | "warn" | "bad" | "info") {
  return {
    ok: "text-ok",
    warn: "text-warn",
    bad: "text-bad",
    info: "text-info",
  }[tone];
}

function statusLabel(status: string) {
  if (status === "running") return { label: "live", cls: "bg-ok-bg text-ok" };
  if (status === "idle") return { label: "idle", cls: "bg-warn-bg text-warn" };
  if (status === "error") return { label: "error", cls: "bg-bad-bg text-bad" };
  if (status === "ready") return { label: "ready", cls: "bg-ok-bg text-ok" };
  if (status === "pending") return { label: "pending", cls: "bg-warn-bg text-warn" };
  if (status === "parsing") return { label: "parsing", cls: "bg-info-bg text-info" };
  return { label: status, cls: "bg-surface-sunken text-muted" };
}

function severityDot(s: string) {
  if (s === "bad") return "bg-bad";
  if (s === "warn") return "bg-warn";
  return "bg-info";
}

function Panel({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[var(--r)] border border-line bg-surface ${className}`}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
        <h2 className="text-[13px] font-medium tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {action}
      </header>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

function GhostBtn({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] font-medium text-muted transition-opacity hover:text-ink"
    >
      {children}
    </button>
  );
}

function timeLabel(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function Cockpit() {
  const [nav, setNav] = useState<NavId>("cockpit");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pageTitle = NAV.find((n) => n.id === nav)?.label ?? "Cockpit";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as DashboardPayload;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [load]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "upload failed");
      await load();
      setNav("documents");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function resolveAlert(id: string) {
    await fetch(`/api/alerts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    await load();
  }

  const kpis = data?.kpis ?? [];
  const alerts = data?.alerts ?? [];
  const inventory = data?.inventory ?? [];
  const suppliers = data?.suppliers ?? [];
  const agents = data?.agents ?? [];
  const activity = data?.activity ?? [];
  const payroll = data?.payroll ?? [];
  const documents = data?.documents ?? [];
  const costBreakdown = data?.costBreakdown ?? [];
  const mode = data?.mode ?? "local";

  const liveAgents = agents.filter((a) => a.status === "running").length;

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="sticky top-0 hidden h-screen w-[200px] shrink-0 flex-col border-r border-line px-3 py-6 md:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <Orb size={26} />
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
            La Cage
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Navigation">
          {NAV.map((item) => {
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setNav(item.id)}
                className={`rounded-[var(--r-sm)] px-3 py-2 text-left text-[13.5px] transition-colors ${
                  active
                    ? "bg-surface-sunken font-medium text-ink"
                    : "text-muted hover:bg-surface-sunken/70 hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <p className="px-2 font-mono text-[10px] uppercase tracking-wider text-hint">
          {mode}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/90 px-5 py-3.5 backdrop-blur-md sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 md:hidden">
                <Orb size={22} />
                <span className="text-[14px] font-semibold tracking-[-0.02em]">
                  La Cage
                </span>
              </div>
              <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-ink md:mt-0 md:text-[18px]">
                {pageTitle}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden rounded-full bg-ok-bg px-2.5 py-1 text-[11px] font-medium text-ok sm:inline">
                {liveAgents} agents live
              </span>
              <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-medium text-warn">
                {alerts.length} alertes
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="rounded-[var(--r-sm)] bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
              >
                {uploading ? "Import…" : "Importer"}
              </button>
            </div>
          </div>

          <div className="mx-auto mt-3 flex max-w-6xl gap-1 overflow-x-auto scroll-thin pb-0.5 md:hidden">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setNav(item.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                  nav === item.id
                    ? "bg-ink text-bg"
                    : "bg-surface-sunken text-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-5 py-6 sm:px-8 sm:py-8">
          {error ? (
            <p className="rounded-[var(--r-sm)] bg-bad-bg px-3 py-2 text-[13px] text-bad">
              {error}
            </p>
          ) : null}

          {!data ? (
            <p className="text-[13px] text-muted">Chargement…</p>
          ) : null}

          {(nav === "cockpit" || nav === "couts") && data && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map((k) => (
                <article
                  key={k.id}
                  className="fade-up rounded-[var(--r)] border border-line bg-surface px-4 py-4"
                >
                  <p className="text-[12px] text-muted">{k.label}</p>
                  <p className="mt-1.5 text-[26px] font-semibold tracking-[-0.03em] text-ink">
                    {k.value}
                  </p>
                  <p className={`mt-1 text-[12px] font-medium ${toneText(k.tone)}`}>
                    {k.delta}
                  </p>
                  <p className="mt-1 text-[12px] text-hint">{k.sub}</p>
                </article>
              ))}
            </div>
          )}

          {nav === "cockpit" && data && (
            <div className="grid gap-4 xl:grid-cols-5">
              <div className="space-y-4 xl:col-span-3">
                <Panel
                  title="À traiter"
                  action={
                    <GhostBtn onClick={() => setNav("alertes")}>Tout voir</GhostBtn>
                  }
                >
                  {alerts.length === 0 ? (
                    <p className="text-[13px] text-muted">Aucune alerte</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {alerts.slice(0, 4).map((a) => (
                        <li
                          key={a.id}
                          className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${severityDot(a.severity)}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-[13.5px] font-medium text-ink">
                                {a.title}
                              </p>
                              <span className="shrink-0 text-[11px] text-hint">
                                {timeLabel(a.created_at)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[12.5px] text-muted">
                              {a.detail}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void resolveAlert(a.id)}
                            className="text-[12px] text-muted hover:text-ink"
                          >
                            ok
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Panel title="Inventaire">
                    <ul className="space-y-2.5">
                      {[
                        ...inventory.filter((i) => i.status !== "ok"),
                        ...inventory.filter((i) => i.status === "ok").slice(0, 2),
                      ]
                        .slice(0, 6)
                        .map((row) => (
                          <li
                            key={row.id}
                            className="flex items-center justify-between gap-2 text-[13px]"
                          >
                            <span className="text-ink-soft">{row.name}</span>
                            <span className="flex items-center gap-2 text-[12px] text-muted">
                              {row.on_hand} {row.unit}
                              <span
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  row.status === "low"
                                    ? "bg-bad-bg text-bad"
                                    : row.status === "warn"
                                      ? "bg-warn-bg text-warn"
                                      : "bg-ok-bg text-ok"
                                }`}
                              >
                                {row.status}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </Panel>

                  <Panel title="Fournisseurs">
                    <ul className="space-y-3">
                      {suppliers.slice(0, 4).map((s) => (
                        <li key={s.id}>
                          <p className="text-[13px] font-medium text-ink">
                            {s.name}
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted">
                            {s.notes ?? "—"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </div>
              </div>

              <div className="space-y-4 xl:col-span-2">
                <Panel
                  title="Agents"
                  action={
                    <GhostBtn onClick={() => setNav("agents")}>Voir</GhostBtn>
                  }
                >
                  <ul className="space-y-2">
                    {agents.map((a) => {
                      const st = statusLabel(a.status);
                      return (
                        <li
                          key={a.id}
                          className="rounded-[var(--r-sm)] bg-surface-sunken/80 px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[13px] font-medium text-ink">
                              {a.name}
                            </p>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                            >
                              {st.label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12px] text-muted">{a.job}</p>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>

                <Panel title="Activité">
                  <ul className="space-y-2.5">
                    {activity.slice(0, 8).map((row) => (
                      <li key={row.id} className="flex gap-3 text-[12.5px]">
                        <span className="w-10 shrink-0 font-mono text-[11px] text-hint">
                          {timeLabel(row.created_at)}
                        </span>
                        <span className="text-body">{row.message}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </div>
          )}

          {nav === "agents" && data && (
            <div className="fade-up grid gap-3 sm:grid-cols-2">
              {agents.map((a) => {
                const st = statusLabel(a.status);
                return (
                  <article
                    key={a.id}
                    className="rounded-[var(--r)] border border-line bg-surface p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Orb size={32} />
                        <div>
                          <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                            {a.name}
                          </h3>
                          <p className="text-[12.5px] text-muted">{a.job}</p>
                          <p className="mt-1 font-mono text-[11px] text-hint">
                            {a.id}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {nav === "inventaire" && data && (
            <Panel title="Stock & pars" className="fade-up">
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[440px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] text-hint">
                      <th className="pb-2 font-medium">Article</th>
                      <th className="pb-2 font-medium">On hand</th>
                      <th className="pb-2 font-medium">Par</th>
                      <th className="pb-2 font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-line last:border-0"
                      >
                        <td className="py-3 text-ink">{row.name}</td>
                        <td className="py-3 text-muted">
                          {row.on_hand} {row.unit}
                        </td>
                        <td className="py-3 text-hint">
                          {row.par_level ?? "—"}
                        </td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              row.status === "low"
                                ? "bg-bad-bg text-bad"
                                : row.status === "warn"
                                  ? "bg-warn-bg text-warn"
                                  : "bg-ok-bg text-ok"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {nav === "fournisseurs" && data && (
            <div className="fade-up grid gap-3 sm:grid-cols-2">
              {suppliers.map((s) => (
                <article
                  key={s.id}
                  className="rounded-[var(--r)] border border-line bg-surface p-5"
                >
                  <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                    {s.name}
                  </h3>
                  <p className="mt-2 text-[13px] text-body">{s.notes ?? "—"}</p>
                </article>
              ))}
              {data.invoices.length > 0 ? (
                <article className="rounded-[var(--r)] border border-line bg-surface p-5 sm:col-span-2">
                  <h3 className="mb-3 text-[13px] font-medium text-ink">
                    Dernières factures
                  </h3>
                  <ul className="divide-y divide-line">
                    {data.invoices.slice(0, 8).map((inv) => (
                      <li
                        key={inv.id}
                        className="flex justify-between gap-3 py-2 text-[13px]"
                      >
                        <span className="text-ink">
                          {inv.invoice_number ?? inv.id.slice(0, 8)}
                        </span>
                        <span className="text-muted">
                          {inv.total_ttc != null
                            ? `${inv.total_ttc} ${inv.currency}`
                            : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}
            </div>
          )}

          {nav === "paie" && data && (
            <div className="fade-up grid gap-4 lg:grid-cols-1">
              <Panel title="Staff">
                <ul className="divide-y divide-line">
                  {payroll.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="text-[13.5px] font-medium text-ink">
                          {line.employee_name}
                        </p>
                        <p className="text-[12px] text-muted">
                          {line.role ?? "—"}
                        </p>
                      </div>
                      <div className="text-right text-[12px]">
                        <p className="text-ink">
                          {line.hours != null ? `${line.hours} h` : "—"}
                        </p>
                        <p className="text-hint">
                          {line.net != null
                            ? `${line.net} € net`
                            : line.gross != null
                              ? `${line.gross} € brut`
                              : "—"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}

          {nav === "couts" && data && (
            <div className="fade-up grid gap-4 lg:grid-cols-2">
              <Panel title="Répartition food cost">
                <ul className="space-y-3">
                  {costBreakdown.map((row) => (
                    <li key={row.label}>
                      <div className="mb-1 flex justify-between text-[13px]">
                        <span className="text-ink-soft">{row.label}</span>
                        <span className="text-[12px] text-muted">
                          {row.amount} · {row.pct}%
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className="h-full rounded-full bg-ink/70"
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Théorique vs réel">
                {(() => {
                  const food = kpis.find((k) => k.id === "food");
                  return (
                    <div>
                      <p className="text-[13px] text-muted">{food?.sub ?? "—"}</p>
                      <p className="mt-3 text-[24px] font-semibold tracking-[-0.03em] text-ink">
                        {food?.value ?? "—"}
                      </p>
                      <p className={`mt-1 text-[13px] ${toneText(food?.tone ?? "info")}`}>
                        {food?.delta}
                      </p>
                    </div>
                  );
                })()}
              </Panel>
            </div>
          )}

          {nav === "documents" && data && (
            <div className="fade-up space-y-4">
              <Panel
                title="Import"
                action={
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="text-[12px] font-medium text-ink"
                  >
                    {uploading ? "…" : "Choisir un fichier"}
                  </button>
                }
              >
                <p className="text-[13px] text-muted">
                  PDF · Excel (.xlsx) · CSV — parse auto (inventaire, paie, facture)
                </p>
              </Panel>
              <Panel title="Fichiers">
                {documents.length === 0 ? (
                  <p className="text-[13px] text-muted">Aucun document</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {documents.map((d) => {
                      const st = statusLabel(d.status);
                      return (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                        >
                          <div>
                            <p className="text-[13.5px] font-medium text-ink">
                              {d.filename}
                            </p>
                            <p className="text-[12px] text-hint">
                              {d.kind} · {d.source} · {timeLabel(d.created_at)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}
                          >
                            {st.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </div>
          )}

          {nav === "alertes" && data && (
            <Panel title="File d’alertes" className="fade-up">
              {alerts.length === 0 ? (
                <p className="text-[13px] text-muted">Aucune alerte ouverte</p>
              ) : (
                <ul className="divide-y divide-line">
                  {alerts.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${severityDot(a.severity)}`}
                        />
                        <div>
                          <p className="text-[13.5px] font-medium text-ink">
                            {a.title}
                          </p>
                          <p className="text-[12.5px] text-muted">{a.detail}</p>
                          <p className="mt-1 text-[11px] text-hint">
                            {a.source} · {timeLabel(a.created_at)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void resolveAlert(a.id)}
                        className="rounded-[var(--r-sm)] bg-ink px-3 py-1.5 text-[12px] font-medium text-bg sm:shrink-0"
                      >
                        Traiter
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}
