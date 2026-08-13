# Target PaneShift Context Architecture

## Current foundation

PaneShift already has two strong primitives:

1. a provider-independent control room for authenticated Codex, Claude, Grok,
   and future local runtimes;
2. a project memory contract based on Git, project state, decisions, handoffs,
   claims, snapshots, and bootstrap files.

The existing memory is operational and project-scoped. It does not yet provide
semantic retrieval, cross-project knowledge, source provenance, or MCP.

## Target system

```text
 Git   Handoffs   Provider transcripts   Vault   Calendar   Notion
  |       |                 |               |        |         |
  +-------+-----------------+---------------+--------+---------+
                              |
                              v
                  PaneShift Source Adapters
                              |
                              v
                    Append-only Event Bus
             source URI / version / checksum / time
                              |
                 +------------+-------------+
                 |                          |
                 v                          v
          Immutable Raw Store          Import State
                 |                    cursors / errors
                 +------------+-------------+
                              |
                              v
                     Context Compiler
        deterministic parsing + optional explicit AI jobs
                              |
                              v
                    Canonical Markdown Vault
               human-readable / Git-versioned / owned
                              |
                              v
                       Rebuildable Index
              FTS + vector + graph + temporal state
                              |
                              v
                       Policy Gateway
             agent / provider / project / sensitivity
                              |
              +---------------+----------------+
              |                                |
              v                                v
       PaneShift application                 MCP
                                     Codex / Claude / Grok
```

## Component boundaries

### PaneShift application

Responsibilities:

- display agents and their real process state;
- send prompts to authenticated provider CLIs;
- render authoritative provider transcripts;
- display context citations and memory proposals;
- show synchronization and index health;
- never become the database or retrieval engine.

### Context daemon

Proposed process name: `paneshift-context`.

Responsibilities:

- watch local sources;
- receive structured source events;
- maintain cursor and ingestion state;
- manage the canonical vault;
- call the configured retrieval engine;
- expose local MCP;
- evaluate policy before reads and writes;
- emit structured health and activity events.

It must run independently from the Swift UI and tmux lifecycle. A UI crash must
not corrupt or stop the context system.

### Context engine adapter

Responsibilities:

- index canonical documents;
- perform lexical, vector, and graph retrieval;
- return stable result IDs and scoring evidence;
- support complete index rebuilds;
- contain no provider-specific UI behavior.

Initial engine: GBrain through CLI or MCP.

Future engine: native Markdown + SQLite/FTS5 + optional vector extension.

### Canonical vault

Suggested layout:

```text
~/.paneshift/brain/
├── vault/
│   ├── identity/
│   ├── preferences/
│   ├── projects/
│   ├── decisions/
│   ├── people/
│   ├── organizations/
│   ├── meetings/
│   ├── learning/
│   └── routines/
├── raw/
│   └── sha256-prefix/content-addressed-artifacts
├── proposals/
│   ├── pending/
│   ├── accepted/
│   └── rejected/
├── events/
│   └── events.jsonl
├── state/
│   ├── cursors/
│   └── imports/
├── index/
│   └── paneshift.db
└── policies.toml
```

Only `vault/`, configuration, and selected decision history need to be Git
versioned. Raw provider transcripts, private imports, indexes, and temporary
state remain local and ignored by default.

## Source envelope

Every source adapter should emit the same versioned structure:

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "source_uri": "git://paneshift/commit/abc123",
  "source_kind": "git_commit",
  "source_version": "abc123",
  "occurred_at": "2026-08-01T12:00:00Z",
  "captured_at": "2026-08-01T12:00:03Z",
  "checksum": "sha256:...",
  "sensitivity": "private",
  "project": "paneshift",
  "payload_ref": "raw://sha256/..."
}
```

Required properties:

- idempotent processing by `source_uri + source_version + checksum`;
- append-only receipt before transformation;
- explicit timestamps for event time and capture time;
- sensitivity assigned before indexing;
- no provider-specific shape beyond the adapter.

## Canonical note schema

```yaml
---
id: decision-paneshift-context-engine
type: decision
status: active
project: paneshift
source_uri: transcript://codex/session/turn
source_checksum: sha256:...
observed_at: 2026-08-01T18:00:00Z
valid_from: 2026-08-01
valid_until:
confidence: confirmed
sensitivity: private
supersedes:
tags:
  - architecture
  - context
---
```

Derived facts must never lose their source URI. A result without provenance is
not eligible for automatic injection into an agent prompt.

## Retrieval pipeline

The first local pipeline should be understandable and measurable:

```text
query classification
  -> policy filter
  -> FTS candidates
  -> vector candidates when enabled
  -> graph neighbors when relevant
  -> reciprocal-rank fusion
  -> authority / recency / project boosts
  -> optional local reranker
  -> token-budgeted context assembly
  -> citations and score explanation
```

Avoid an LLM call for basic lookup. A local model is useful for synthesis and
conflict resolution, not as a requirement for every search.

Every search result should expose:

- canonical URI;
- source URI;
- matched passage;
- retrieval modes that found it;
- fused score;
- recency and authority boosts;
- sensitivity and policy decision;
- superseded or current state.

## MCP surface

Start with six tools:

```text
context_search
context_read
context_explain
memory_propose
memory_commit
source_sync
```

Expose stable read-only resources:

```text
paneshift://identity
paneshift://project/current
paneshift://project/{id}/state
paneshift://decisions/recent
paneshift://agent/{slot}/handoff
paneshift://source/{id}
paneshift://proposal/{id}
```

Prompts can provide explicit workflows such as:

```text
prepare_handoff
record_decision
review_memory_proposals
build_daily_context
```

The MCP server should support local `stdio` first. If remote HTTP is later
enabled, it must bind to localhost by default, validate `Origin`, and require
scoped authentication.

## Policy and write-back

Recommended write modes:

```text
read-only     no mutation tools
propose       agent can create a reviewable patch
trusted       automatic writes in explicitly allowed namespaces
```

Example policy:

```toml
[agents.codex-1]
read = ["projects/paneshift", "decisions", "preferences/coding"]
write_mode = "propose"

[agents.openclaw]
read = ["identity", "routines", "calendar"]
write_mode = "trusted"
write = ["routines/logs", "inbox"]

[providers.grok]
deny_sensitivity = ["company-confidential"]
```

Trusted mode still writes through the event journal and creates a Git-auditable
change. No agent receives unrestricted deletion capability by default.

## Provider subscriptions and local inference

The core must work without API keys:

- deterministic parsing;
- Markdown and Git;
- FTS retrieval;
- local embeddings when available;
- local reranking when available.

Until the local DGX model is ready, an AI transformation should be an explicit
PaneShift job sent to a visible, authenticated subscription terminal. It must
not silently treat consumer CLI subscriptions as a hidden background API.

Later, a local model can implement the same optional transformation contract
without changing the vault, MCP surface, or retrieval engine.

## Reliability rules inherited from the PaneShift audit

The context system must not reintroduce the chat architecture's historical
failure modes:

- never infer state by scraping terminal pixels;
- never treat streamed fragments as the durable record;
- serialize mutations per source and per proposal;
- represent process, provider, conversation, memory, and index health
  separately;
- make every timeout return a typed reason;
- make all background operations resumable and idempotent;
- publish immutable snapshots to the UI;
- keep an append-only audit trail.
