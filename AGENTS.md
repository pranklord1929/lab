# lab — monorepo

Experimental monorepo of several independent product prototypes (`essec-circular-chair`, `dining-dispatch`, `la-cage`, `paneshift`, `scorevault`, `seo-autopilot`). Each folder is self-contained with its own README and (where relevant) its own `package.json`/tooling. There is no shared root build.

## Cursor Cloud specific instructions

### Active scope: `essec-circular-chair`
This branch is focused on `essec-circular-chair`, a static, dependency-free website (pre-generated HTML + CSS/JS assets) built by a pure-Python generator. Python 3 and Node are already available on the base image; the site needs no package installation.

- Regenerate HTML: `cd essec-circular-chair && python3 generate.py`. `generate.py` uses only the Python standard library (`pathlib`, `json`) and reads image paths from `data/local-images.json`. It rewrites all `*.html` files in place; committed HTML is the generator's output, so a clean `git status` after running it means output is up to date. Edit content/layout in `generate.py` (not the generated `*.html`) and re-run it.
- Preview locally: `cd essec-circular-chair && python3 -m http.server 4173`, then open `http://localhost:4173/index.html`. This is a plain static file server — there is no hot reload; re-run `generate.py` and refresh the browser after edits.
- Asset paths are relative, so always browse via the server (or from within the `essec-circular-chair/` dir) rather than opening files with a `file://` URL. Some student portraits/partner logos are pulled from remote Google Site URLs and may not load offline; the layout is designed to hold regardless.
- There is no lint/test/build step for this static site; "build" is `generate.py` and "run" is the http server above.

### Other projects (not exercised on this branch)
The Next.js apps (`dining-dispatch`, `la-cage`, `scorevault`) and the Node CLI (`seo-autopilot`) each have their own `package.json`/lockfile and README; install per-project with the matching package manager if you work on them. `paneshift` is shell/Swift tooling. These are intentionally left out of the automatic startup update script to keep it minimal and reliable.
