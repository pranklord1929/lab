import type { AgentDef } from "./types";

/**
 * Source of truth for agents displayed in La Cage.
 * Add / edit agents here (or from a script that writes this file).
 * UI does not register agents — code only.
 */
export const AGENTS: AgentDef[] = [
  {
    id: "invoice-scout",
    name: "Invoice Scout",
    job: "Factures · hausses de prix",
    status: "running",
    last: "il y a 4 min",
  },
  {
    id: "stock-watch",
    name: "Stock Watch",
    job: "Pars · ruptures · waste",
    status: "running",
    last: "il y a 11 min",
  },
  {
    id: "payroll-pulse",
    name: "Payroll Pulse",
    job: "Heures · overtime · labor %",
    status: "idle",
    last: "08:12",
  },
];

export function listAgents(): AgentDef[] {
  return AGENTS;
}

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}
