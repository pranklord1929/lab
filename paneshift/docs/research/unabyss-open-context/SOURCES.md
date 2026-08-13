# Public Sources

Accessed for research on 2026-08-01.

## Unabyss

- Product workflow: https://unabyss.com/how-it-works
- Integrations: https://unabyss.com/integrations
- Security: https://unabyss.com/security
- MCP documentation: https://staging.unabyss.com/mcp-docs
- Public MCP OAuth metadata:
  https://mcp.unabyss.com/.well-known/oauth-authorization-server
- Backend engineering description:
  https://staging.unabyss.com/jobs/backend-engineer
- ML engineering description: https://staging.unabyss.com/jobs/ml-engineer
- Unabyss versus building a context system:
  https://unabyss.com/unabyss-vs-external-knowledge
- Obsidian versus a context layer:
  https://unabyss.com/blog/obsidian-for-ai-context-vs-context-layer
- Obsidian as AI memory:
  https://unabyss.com/blog/obsidian-as-ai-memory
- Context versus memory: https://unabyss.com/context-vs-memory
- Multi-agent memory:
  https://unabyss.com/blog/what-is-multiagentic-memory
- Context implementation overview:
  https://unabyss.com/blog/keeping-context-in-unabyss
- MCP loading guide:
  https://unabyss.com/blog/load-personal-context-via-mcp
- Connections live progress changelog:
  https://unabyss.com/changelog/v0-4-0
- Skills and MCP changelog:
  https://unabyss.com/changelog/v0-7-0
- GBrain local sync and MCP save-back changelog:
  https://staging.unabyss.com/changelog/v1-3-0
- Terms: https://unabyss.com/terms

The public frontend application and minified production assets were inspected at
https://app.unabyss.com. Only publicly delivered browser code and unauthenticated
protocol metadata were examined.

## Obsidian

- License and local-data model: https://obsidian.md/license
- Developer documentation: https://docs.obsidian.md/Home
- Plugin development:
  https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin

## Model Context Protocol

- Server primitives:
  https://modelcontextprotocol.io/specification/2025-06-18/server/index
- Base protocol:
  https://modelcontextprotocol.io/specification/2025-06-18/basic/index
- Streamable HTTP transport:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/
- Python SDK: https://py.sdk.modelcontextprotocol.io/
- Debugging and Inspector:
  https://modelcontextprotocol.io/docs/tools/debugging

## Open-source context and memory engines

- GBrain, MIT: https://github.com/garrytan/gbrain
- GBrain remote MCP deployment:
  https://github.com/garrytan/gbrain/blob/master/docs/mcp/DEPLOY.md
- GBrain memory-layer routing:
  https://github.com/garrytan/gbrain/blob/master/docs/guides/brain-vs-memory.md
- Basic Memory, AGPL-3.0:
  https://github.com/basicmachines-co/basic-memory
- Graphiti, Apache-2.0: https://github.com/getzep/graphiti
- Mem0, Apache-2.0: https://github.com/mem0ai/mem0
- Cognee, Apache-2.0: https://github.com/topoteretes/cognee

## Local PaneShift material

- `README.md`, especially Live memory and provider-independent architecture.
- `agent-memory.sh`, especially bootstrap, snapshots, claims, events, export,
  import, and validation.
- `AUDIT-2026-08-01.md` and `PANESHIFT_AUDIT_V2_2026-07-31.md`, especially
  transcript authority, lifecycle, concurrency, and observability findings.
- `.agent-context/PROJECT_STATE.md`, `DECISIONS.md`, and agent handoffs.

