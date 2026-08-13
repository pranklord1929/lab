/** Agents are declared in code — not via the UI. */

export type AgentStatus = "running" | "idle" | "empty";

export type AgentDef = {
  /** Stable id used in API routes and logs */
  id: string;
  name: string;
  /** One-line job description shown in La Cage */
  job: string;
  status: AgentStatus;
  /** Human-readable last activity (mock until real heartbeat) */
  last: string;
};
