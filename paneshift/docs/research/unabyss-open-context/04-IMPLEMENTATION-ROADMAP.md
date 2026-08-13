# Implementation Roadmap

## Product objective

Prove that Codex, Claude, Grok, and a future local model can start from the same
owned project context, retrieve the same cited facts, and propose durable memory
updates without any provider becoming the source of truth.

## Non-goals for the first release

- no billing;
- no multi-tenant organization management;
- no large connector marketplace;
- no automatic ingestion of an entire mailbox;
- no mandatory knowledge graph database;
- no background use of subscription CLIs as hidden APIs;
- no direct automatic deletion by agents;
- no new PaneShift visual redesign before the data contract works.

## Phase 0 — Contract and isolation

Estimated effort: 2 to 3 focused days.

Deliverables:

- write a versioned `ContextEngine` contract;
- define source envelope, canonical note, result, proposal, and policy schemas;
- decide the local brain root and Git boundaries;
- create a separate `paneshift-context` process boundary;
- add fixtures representing Git, handoff, decision, and transcript sources;
- define typed error and health states.

Acceptance:

- the Swift app can be completely stopped without affecting context data;
- the index can be deleted without losing canonical knowledge;
- the same fixture produces the same canonical result twice.

## Phase 1 — Read-only GBrain adapter

Estimated effort: 5 to 7 focused days.

Deliverables:

- detect or configure a local GBrain installation;
- add a narrow adapter for health, sync, search, read, and explain;
- index only PaneShift's existing project state, decisions, and handoffs;
- expose results to a CLI test harness;
- preserve PaneShift URIs independently of GBrain slugs.

Acceptance:

- the same question from Codex, Claude, and Grok returns the same cited source;
- engine failure degrades to plain Markdown/`rg` lookup;
- no engine-specific data becomes the canonical source of truth;
- no API key is required for lexical retrieval.

## Phase 2 — Canonical vault and event ingestion

Estimated effort: 1 to 2 weeks.

Deliverables:

- append-only event journal;
- content-addressed raw store;
- filesystem and Git adapters;
- handoff and decision adapters;
- provider transcript receipts without bulk prompt injection;
- file watcher with checksum deduplication;
- full rebuild and doctor commands.

Acceptance:

- a modified source creates one new version, not duplicate memories;
- a deleted canonical note becomes a soft-deleted index record;
- every derived note links to a real source receipt;
- interrupted ingestion resumes without corrupting the vault.

## Phase 3 — Local MCP gateway

Estimated effort: approximately 1 week.

Deliverables:

- local stdio MCP server;
- read-only resources;
- `context_search`, `context_read`, and `context_explain`;
- per-agent namespace configuration;
- activity log;
- MCP Inspector verification.

Acceptance:

- each provider can connect without an API key;
- tool descriptions remain compact enough not to create excessive context tax;
- a denied namespace never appears in search candidates or logs returned to the
  agent;
- every answer can expose a canonical and raw source URI.

## Phase 4 — Proposal-based write-back

Estimated effort: 1 to 2 weeks.

Deliverables:

- `memory_propose`;
- proposal diff format;
- pending/accepted/rejected lifecycle;
- review in the PaneShift UI or CLI;
- `memory_commit` with optimistic concurrency checks;
- Git commit or append-only audit receipt after acceptance;
- trusted write namespaces for low-risk automation.

Acceptance:

- two agents editing the same canonical note produce a visible conflict;
- rejected proposals never modify the vault or index;
- accepted changes preserve author, agent, provider, source, and timestamp;
- no default MCP token can delete canonical memory.

## Phase 5 — Retrieval quality and evaluation

Estimated effort: 1 to 2 weeks.

Deliverables:

- FTS baseline;
- optional local embeddings;
- reciprocal-rank fusion;
- authority, recency, and active-project boosts;
- optional local cross-encoder reranker;
- a replayable PaneShift retrieval benchmark;
- regression reports with expected source IDs.

Initial evaluation set:

- current project objective;
- most recent architectural decision;
- active blocker for each agent;
- file currently claimed by another agent;
- superseded versus active decision;
- preference versus world fact routing;
- cross-project question requiring explicit scope;
- deliberately denied sensitive document.

Acceptance:

- exact decision and project-state questions retrieve the expected source in
  the top three;
- superseded facts are labeled and not presented as current;
- the permission suite has zero known cross-scope leaks;
- ranking changes can be replayed against the same queries.

## Phase 6 — External sources

Add sources only after local project memory is reliable.

Recommended order:

1. arbitrary Markdown or Obsidian vault;
2. local calendar export or connected Google Calendar adapter;
3. Notion export or API connector;
4. selected Google Drive folders;
5. OpenClaw event and routine logs;
6. optional email folders with explicit user selection.

Every connector must implement:

- authorization independent from retrieval;
- selection before import;
- incremental cursor;
- rate-limit recovery;
- source deletion semantics;
- disconnect without implicit deletion;
- explicit purge;
- progress and typed failure events.

## Recommended implementation strategy

Start as a separate TypeScript service because:

- GBrain is TypeScript and exposes a compatible local surface;
- the official MCP TypeScript SDK is mature;
- it keeps retrieval and file watching outside the Swift UI;
- schema validation can be shared with future connectors;
- it can later be replaced by a Rust or Swift daemon behind the same contract.

Suggested packages are implementation choices, not durable contracts. The
durable elements are Markdown, Git, URIs, event schemas, and MCP.

## First vertical demo

The smallest convincing demo is:

1. start the PaneShift room;
2. ingest `PROJECT_STATE.md`, `DECISIONS.md`, and six handoffs;
3. expose them through local MCP;
4. ask the same project-status question in Codex, Claude, and Grok;
5. show the same cited source in all three;
6. ask one agent to propose a decision update;
7. accept the diff once;
8. observe the new decision from the other two agents.

That proves shared context, provider independence, provenance, and write-back
without needing Notion, Calendar, cloud hosting, or a large UI.

