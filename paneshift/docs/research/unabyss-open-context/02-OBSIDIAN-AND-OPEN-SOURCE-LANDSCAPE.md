# Obsidian and the Open-Source Landscape

## Is Unabyss an Obsidian competitor?

Only partially.

Obsidian is primarily a human knowledge editor. Unabyss is primarily a managed
ingestion, retrieval, and distribution service for agents.

| Dimension | Obsidian | Unabyss | PaneShift target |
| --- | --- | --- | --- |
| Primary job | Write and connect notes | Compile live AI context | Coordinate agents around owned context |
| Canonical data | Local Markdown | Managed service database | Local Markdown and Git |
| Updates | Human and plugins | Automatic connectors | Events, agents, and user approval |
| Retrieval | Text, graph, plugins | Hybrid and permission-aware | Hybrid, local, and explainable |
| AI transport | Optional plugins | Native MCP | Native MCP |
| Application license | Proprietary | Proprietary | Open source |
| Data portability | Excellent | Exported/served | Native by construction |

Obsidian stores local, non-proprietary Markdown, but the application code itself
is proprietary. PaneShift should adopt the file philosophy, not embed Obsidian
as a hard dependency.

The desired rule is:

> Obsidian-compatible, not Obsidian-dependent.

An Obsidian user can open the PaneShift vault. A user without Obsidian can use
any text editor, Git client, CLI, or future PaneShift editor.

## Open-source candidates

### GBrain

Repository: `https://github.com/garrytan/gbrain`

License: MIT

Language: TypeScript

GBrain is the closest open implementation to the useful part of Unabyss:

- Markdown and Git are the system of record;
- PGLite works as a local Postgres-compatible engine;
- PostgreSQL and pgvector support larger installations;
- hybrid vector and full-text retrieval;
- reciprocal-rank fusion and optional reranking;
- wikilink-derived knowledge graph;
- provenance, timelines, source mounts, and schema packs;
- local stdio MCP;
- remote Streamable HTTP MCP with OAuth;
- scopes, administration, and an activity stream;
- local embedding and reranker options.

GBrain is powerful but opinionated and fast-moving. Its complete feature set is
too large to become an inseparable part of PaneShift. It should first be used
through an adapter.

### Basic Memory

Repository: `https://github.com/basicmachines-co/basic-memory`

License: AGPL-3.0

Language: Python

Basic Memory offers:

- plain Markdown as source of truth;
- SQLite and `sqlite-vec` locally;
- file watching and bidirectional synchronization;
- full-text and vector search;
- local FastEmbed embeddings and cross-encoder reranking;
- MCP-native operations;
- Obsidian compatibility.

It is a good architectural reference and potentially a prototype engine. The
AGPL license needs deliberate review before distributing it as part of a
PaneShift product.

### Graphiti

Repository: `https://github.com/getzep/graphiti`

License: Apache-2.0

Language: Python

Graphiti is strongest where knowledge changes over time:

- temporal facts and validity windows;
- automatic invalidation rather than deletion;
- entity and relationship graphs;
- provenance back to raw episodes;
- semantic, keyword, and graph retrieval.

It is likely too operationally heavy for PaneShift's first local version. It is
better treated as a future optional engine or as inspiration for temporal data
semantics.

### Mem0

Repository: `https://github.com/mem0ai/mem0`

License: Apache-2.0

Language: Python

Mem0 is useful for extracting and maintaining conversation-derived memories.
It is less aligned with a fully transparent Markdown source of truth. Its older
standalone MCP repository is archived, so PaneShift should not build its core
around that MCP server.

### Cognee

Repository: `https://github.com/topoteretes/cognee`

License: Apache-2.0

Language: Python

Cognee provides a broad agent memory control plane with ingestion, embeddings,
graphs, tracing, and local deployment. It is valuable as a reference for
pipelines and evaluation, but broader than PaneShift's first requirement.

## Recommended engine strategy

Define a PaneShift-owned contract before choosing or forking an implementation:

```text
ContextEngine
  ingest(source envelope)
  search(query, scope, budget)
  read(canonical URI)
  explain(result ID)
  propose(memory mutation)
  commit(proposal ID)
  reject(proposal ID)
  reindex(scope)
  health()
```

Suggested sequence:

1. implement a read-only `GBrainAdapter`;
2. validate the PaneShift product workflow;
3. keep all PaneShift canonical files outside engine-specific storage;
4. add a compact native Markdown/SQLite implementation only when the contract
   and retrieval evaluation are stable;
5. retain GBrain and other engines as optional backends.

This preserves the ability to replace any retrieval engine without migrating
the user's human-readable memory.

## Three separate memory layers

PaneShift should preserve the distinction used by mature agent-memory systems:

### Session context

Temporary information required for the current conversation. It naturally
lives in the provider transcript and model context window.

### Operational agent memory

How the agent must work:

- response preferences;
- coding conventions;
- tool configuration;
- active task and handoff;
- current file claims;
- decisions affecting execution.

PaneShift already stores much of this in `PROJECT_STATE.md`, `DECISIONS.md`,
handoffs, and runtime snapshots.

### Knowledge brain

Facts about the world and durable project knowledge:

- people and organizations;
- projects and products;
- meetings and research;
- decisions with provenance;
- learning materials;
- long-lived ideas and relationships.

Mixing all three produces noisy retrieval and stale prompts. The query router
must select the appropriate layer before searching.
