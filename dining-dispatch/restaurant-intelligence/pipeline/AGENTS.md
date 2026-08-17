# Project Working Rules

This project has no terminal roles, reserved zones, agent claims, shared agent
memory, required handoffs or provider-specific workflow. Any capable terminal
may work on the files required by its task.

- Read the relevant code and `git status --short` before editing.
- Do not revert or delete unrelated work from another session.
- Never write directly to `restaurants`; use the established ingestion path
  `data/raw/<source>/` through `ingest.js` and entity resolution.
- Treat production database, credentials and paid services as explicit approval
  boundaries. Prefer the approved staging project for experimental migrations.
- Record material product, security and architecture decisions in
  `/Users/thediningdispatch/Desktop/The_Dining_Dispatch_Product_Record.md`.
