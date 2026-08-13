# PaneShift Open Context Research

Status: public technical research and product architecture proposal

Last updated: 2026-08-01

Scope: Unabyss, Obsidian, open-source memory engines, and a local context layer for PaneShift

## Executive conclusion

PaneShift should not become a self-hosted copy of Unabyss. It should become an
open, local context operating system for multiple AI agents.

The target combines:

- PaneShift's existing multi-provider control room;
- Obsidian's readable Markdown and local ownership model;
- Unabyss's automated ingestion, provenance, permissions, and MCP distribution;
- an interchangeable open-source retrieval engine such as GBrain;
- Git as the durable and auditable source of truth.

The product boundary is:

> PaneShift is an open, local context operating system for multiple AI agents.

Obsidian can edit the same Markdown vault, but PaneShift must not depend on
Obsidian. MCP is the transport layer. The local vault is the durable knowledge
layer. PaneShift remains the execution and coordination layer.

## Documents

1. [Unabyss public architecture](01-UNABYSS-PUBLIC-ARCHITECTURE.md)
2. [Obsidian and the open-source landscape](02-OBSIDIAN-AND-OPEN-SOURCE-LANDSCAPE.md)
3. [Target PaneShift context architecture](03-PANESHIFT-CONTEXT-ARCHITECTURE.md)
4. [Implementation roadmap](04-IMPLEMENTATION-ROADMAP.md)
5. [Public sources](SOURCES.md)

## Three kinds of statements

The documents deliberately distinguish:

- **Confirmed**: visible in public product assets, official documentation,
  public source code, protocol metadata, or official job descriptions.
- **Inferred**: the most likely implementation given public behavior, but not
  directly confirmed by Unabyss.
- **Recommended**: a design decision proposed specifically for PaneShift.

No private Unabyss system was accessed. No authentication was bypassed. No
proprietary source code or visual assets are copied into PaneShift. The proposal
is a clean-room reimplementation of useful public behavior and open protocols.

## The central model

```text
Sources
  -> immutable raw records
  -> deterministic normalization
  -> optional AI distillation
  -> human-readable canonical Markdown
  -> rebuildable search index
  -> permission gateway
  -> PaneShift agents through MCP
```

The index is never the source of truth. It must be possible to delete it and
rebuild it from Markdown, Git, raw records, and the append-only event log.
