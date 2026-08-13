# Unabyss Public Architecture

## Product interpretation

Unabyss is best understood as a managed compiler of personal context, not as a
chatbot or a note-taking application.

```text
Notion / Drive / Gmail / GitHub / Calendar / files
                         |
                         v
              connections and sync jobs
                         |
                         v
                  raw source records
                         |
                         v
       extraction / classification / structuring
                         |
                         v
         canonical context + provenance + policy
                         |
              +----------+----------+
              |          |          |
              v          v          v
            chat        MCP       exports
```

Their public description uses essentially the same sequence: connect, extract,
structure, control, and distribute.

## Confirmed public components

### Frontend and service separation

- The application frontend is a SvelteKit/Vite application hosted at
  `app.unabyss.com`.
- The REST API is separate at `api.unabyss.com`.
- MCP is a separate service at `mcp.unabyss.com`.
- Public frontend configuration contains the API and MCP base URLs.
- The frontend is delivered through Cloudflare.
- Public API and MCP response headers currently contain Railway edge headers.
- Production source maps for the inspected frontend assets return `404`.

This gives Unabyss three visible planes:

```text
application UI       REST control/data API       MCP distribution server
app.unabyss.com      api.unabyss.com             mcp.unabyss.com
```

### Backend stack

Official job descriptions confirm:

- Python and Django;
- asynchronous Python and asynchronous views;
- background task queues;
- real-time streaming;
- containerized deployments;
- CI/CD, monitoring, and recovery mechanisms.

The exact database, queue implementation, vector database, embedding model, and
reranker are not public.

### Authentication

The public frontend uses:

- a short-lived access token held in application memory;
- a refresh token persisted under `unabyss_refresh_token`;
- `POST /api/auth/token/refresh/` for refresh;
- bearer authentication on API calls;
- credentialed requests where cookies are also needed;
- a single refresh-and-retry attempt after a `401`.

MCP supports:

- OAuth authorization code flow with PKCE;
- dynamic client registration;
- refresh tokens;
- static bearer tokens;
- `read` and `write` scopes.

The public OAuth discovery document is exposed at:

```text
https://mcp.unabyss.com/.well-known/oauth-authorization-server
```

### Conversation and streaming flow

The observed conversation flow is:

```text
POST /api/context/conversations/
POST /api/context/conversations/{id}/messages/
GET  /api/context/conversations/{id}/stream/
POST /api/context/conversations/{id}/stop/
```

The stream uses Server-Sent Events. Public client code handles events including:

```text
processing_started
token
reasoning_started
reasoning_ended
tool_call_stub
tool_status
tool_call
tool_call_error
ask_user
connection_card
export_card
message_complete
files_updated
cancelled
error
done
```

The UI creates an optimistic local user message, streams productive progress,
then reloads the authoritative conversation at completion. This reconciliation
step is important: streamed UI state is not treated as the durable transcript.

### Ingestion pipeline

Imports stream their progress from `/api/ingest/stream/`. The client reconnects
with `Last-Event-ID` and tracks states including:

```text
started
auth_resolved
fetch_started
fetch_complete
persist_started
persist_complete
completed
failed
skipped
cancelled
interrupted
```

Entity counters separately track:

```text
total / discovered / fetched / persisted / skipped / failed
```

The application also exposes a later memory-readiness state, with concepts such
as `memory_ready`, pending promotions, and indexing failures. This confirms that
raw ingestion and memory indexing are separate stages.

Representative connection and ingestion APIs include:

```text
/api/ingest/imports/
/api/ingest/schedules
/api/ingest/raw-files
/api/ingest/web-crawl/sites
/api/ingest/obsidian/session/
/api/ingest/github/repos/selection/
/api/ingest/google-calendar/calendars/selection/
/api/ingest/pipedream
/api/ingest/disconnect/
```

Direct integrations use dedicated OAuth and selection endpoints. The public
frontend also contains the Pipedream Connect SDK for long-tail integrations.

### File upload model

The public flow is:

1. request a presigned upload;
2. upload directly to object storage;
3. confirm the upload;
4. create a raw-file ingestion record;
5. poll processing state.

This keeps large files out of the main application request path and makes raw
storage independent from extraction.

### Memory source model

Public client code exposes source-level concepts including:

- source ID;
- originating application;
- kind;
- creation time;
- parent;
- filename;
- extracted content and metadata;
- title and source;
- content type;
- store and extraction status;
- source URLs and extraction errors;
- an AI description.

Sources are listable, editable, and deletable. Filters exist for origin,
application, kind, and date ranges.

The exact internal memory-unit or fact schema is not visible. The confirmed ML
requirements nevertheless include structured extraction, traceability to root
sources, permission-aware retrieval, hybrid search, reranking, and query
decomposition.

### MCP as the distribution plane

The MCP server uses Streamable HTTP and JSON-RPC. Publicly documented tools
include:

```text
whoami
query
store
list_integrations
agentic_query
agentic_query_read
export_list
export_read
export_create_from_text
```

Additional clients can receive connection, identity, export, and skill tools.
Long-running agentic queries return a query ID and can be polled later.

MCP tokens can exclude:

- private information;
- company-confidential information;
- selected application slugs.

This strongly indicates that policies are enforced during retrieval for each
client rather than by maintaining a complete physical copy per agent.

### Exports

Exports are versioned Markdown dossiers. The public application supports:

- generation from presets or free text;
- streaming generation;
- proposed outlines;
- versions;
- manual editing;
- conflict handling;
- regeneration;
- download and copied timestamps.

Exports are a compatibility layer for systems that cannot consume MCP and a way
to produce a stable, human-readable context snapshot.

## Useful behavior to reproduce

The high-value architecture is:

1. immutable raw data before AI transformation;
2. idempotent incremental imports;
3. explicit promotion and indexing states;
4. traceability from every result to its source;
5. permissions before retrieval;
6. fast retrieval and asynchronous deep retrieval;
7. MCP as the common delivery protocol;
8. explicit write-back policy;
9. rebuildable derived indexes;
10. stream reconciliation with an authoritative durable state.

## SaaS-specific behavior not needed by PaneShift

PaneShift should initially exclude:

- subscription billing and credits;
- referral and promotion systems;
- organization seat management;
- a large connector marketplace;
- cloud multi-tenancy;
- onboarding funnels;
- usage-based AI metering;
- a separate marketing-facing chat product.

## Limits of the public reconstruction

Not recoverable from the public application:

- backend source code;
- extraction prompts;
- exact database tables;
- the vector or graph backend;
- embedding and reranking providers;
- chunking rules;
- fact resolution and contradiction algorithms;
- infrastructure topology behind the public edge;
- internal evaluation datasets.

Further minified-frontend recovery would mostly reveal SaaS UI state and API
wrappers. The valuable backend behavior is better rebuilt from public contracts
and open-source memory engines than approximated from minified UI code.

