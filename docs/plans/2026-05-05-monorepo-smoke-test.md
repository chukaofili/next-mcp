# Monorepo Support — End-to-End Smoke Test

> Manual procedure for Group J of the monorepo support plan
> (see `2026-05-05-monorepo-support-implementation.md`). Run this by
> hand before merging `feat/upgrade-packages` into `main`. CI does not
> execute this — it requires a Docker daemon, network access for
> `create-next-app` plus the `better-auth-ui` shadcn registry, and
> several minutes of `pnpm install` + `docker build` time.
>
> **Up-to-date as of HEAD `fbe32e5`** — covers Groups A–J, the post-J
> coverage audit (`0f97cc5`), and Group K (`259eb0b`, Dockerfile.migrate
> templated for all 4 PMs × 3 monorepo modes). The companion punch list
> for everything **outside** this smoke lives at
> `docs/plans/2026-05-06-recommended-fixes.md` — Tier 1 there
> enumerates exactly what this smoke is meant to prove out at runtime.

## 1. Purpose

This smoke test exercises the full `next-mcp` tool surface against a
real filesystem and a real Docker daemon. The integration suite
(`tests/integration/tools/*` — currently 14 files / 185 tests) covers
each tool in isolation with `skipInstall: true` and stubbed shells,
so it cannot prove that:

- the generated `pnpm-workspace.yaml` + catalog substitution actually
  resolves on `pnpm install`,
- the better-auth CLI works against the new schema cwd
  (`packages/auth`) and migration cwd (`packages/db`),
- the shadcn init format `--preset b0 --template next --monorepo
  --pointer` succeeds against the live registry,
- `Dockerfile.monorepo` builds end-to-end (turbo prune → pruned
  install → turbo build → standalone runtime),
- the better-auth-ui shadcn registry components
  (`https://better-auth-ui.com/r/auth.json` etc.) install cleanly in
  `monorepo: full` mode,
- the templated `Dockerfile.migrate` (Group K, `259eb0b`) actually
  builds and `docker compose run --rm migrate` succeeds for each
  monorepo mode × package manager combination.

Run this **after all groups (A–J) and Group K (Dockerfile.migrate)
have landed** and before opening the merge PR. If anything fails,
capture it in the "Findings" section at the bottom and file follow-up
tickets — see `2026-05-06-recommended-fixes.md` for the canonical
follow-up list.

## 2. Prerequisites

- pnpm `10.18+` (matches the workspace's pinned `packageManager`).
- Node 20+ (corepack handles per-project pinning).
- Docker daemon running (Colima, Docker Desktop, OrbStack — any will
  do) — needed for the `docker build .` step.
- Network access to the npm registry, GitHub (for `create-next-app`),
  and `https://better-auth-ui.com/r/*.json` for the shadcn
  registry pulls (the URLs hit by `setup_authentication`'s G2
  install step are `auth.json`, `settings.json`, `user-button.json`).
- Roughly 5–10 minutes per smoke variant (most of it is
  `create-next-app` + `pnpm install` + `docker build`).

## 3. The full-mode "everything-on" smoke

The reference smoke. Walk through this top-to-bottom; the companion
variants in section 6 are abbreviated forms of this same procedure.

```sh
# 1. Build the MCP server from source
cd ~/projects/chukaofili/next-mcp
pnpm install && pnpm build

# 2. Smoke directory (cleaned each run so prior state cannot mask bugs)
rm -rf /tmp/next-mcp-smoke && mkdir -p /tmp/next-mcp-smoke
cd /tmp/next-mcp-smoke

# 3. Drive the MCP server. Pick ONE of:
#
#    Option A: MCP inspector (interactive, recommended for first run)
npx @modelcontextprotocol/inspector node ~/projects/chukaofili/next-mcp/dist/index.js
#
#    Option B: spawn the server from a Claude Code / other MCP client
#             session and call the tools from there. Configure the
#             client to launch:
#               command: node
#               args:    ["~/projects/chukaofili/next-mcp/dist/index.js"]
#
#    Option C: hand-rolled JSON-RPC over stdio (advanced — only if A/B
#             are unavailable). Not recommended for first runs.
#
# Note: there is currently no `pnpm start` script in next-mcp. If you
# find yourself doing this often, see "Findings" / follow-ups below
# for a suggestion to add one.

# 4. Inside the inspector (or your MCP client), call `scaffold_project`
#    with this config:
#
#    {
#      "name": "smoke-full",
#      "architecture": {
#        "monorepo": "full",
#        "packageManager": "pnpm",
#        "database": "postgres",
#        "orm": "prisma",
#        "auth": "better-auth",
#        "uiLibrary": "shadcn",
#        "rpc": "orpc",
#        "stateManagement": "none",
#        "testing": "vitest"
#      },
#      "targetPath": "/tmp/next-mcp-smoke"
#    }
#
#    (Other schema fields default — see ProjectConfigSchema in src/index.ts.)

# 5. After scaffold returns success, call (in this order):
#
#    setup_database         { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    setup_authentication   { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    setup_shadcn           { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    generate_dockerfile    { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    generate_readme        { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    validate_project       { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }

# 6. Inspect the result
cd /tmp/next-mcp-smoke/smoke-full
ls -la
ls -la apps/web packages

# 7. Build steps (see section 5 for what to watch for)
pnpm install
pnpm typecheck      # root delegates to turbo run typecheck
pnpm build          # turbo build across workspaces
docker build .      # uses the generated monorepo Dockerfile
```

## 4. Per-tool spot-check checklist

After each tool call, verify the assertions below before moving on.
A failure here is a blocker — stop, capture it, and file a follow-up.

### `scaffold_project` (full mode)

- `apps/web/package.json` exists; `name === "@smoke-full/web"`.
- `apps/web/next.config.ts` exists and contains `output: 'standalone'`.
- `pnpm-workspace.yaml` exists at the workspace root with workspace
  globs (`apps/*`, `packages/*`) and a populated `catalog:` section.
- `packages/eslint-config/` and `packages/typescript-config/` exist
  (always emitted in full mode).
- `packages/db/`, `packages/auth/`, `packages/ui/`, `packages/orpc/`
  all exist (the everything-on combo gates each one on).
- Root `package.json` has `packageManager: "pnpm@10.18.0"`.
- Root `turbo.json` exists.
- Root `tsconfig.json` extends `@smoke-full/typescript-config/base`.

### `setup_database`

- `packages/db/prisma/schema.prisma` exists.
- `packages/db/src/client.ts` and `packages/db/src/index.ts` exist.
- `packages/db/package.json` declares the package as `@smoke-full/db`.
- `apps/web/package.json` `dependencies` contains
  `"@smoke-full/db": "workspace:*"`.
- `.env`, `.env.example`, and `.env.local` at the **workspace root**
  (not under `apps/web/`) contain a `DATABASE_URL=` line.
- Any pre-existing `@/lib/db` imports in `apps/web/src/**` have been
  rewritten to `@smoke-full/db`.

### `setup_authentication`

- `packages/auth/src/server.ts`, `packages/auth/src/client.ts`, and
  `packages/auth/src/index.ts` exist.
- `packages/auth/src/server.ts` imports `db` from `@smoke-full/db`
  (NOT from `@/lib/db`).
- `apps/web/package.json` `dependencies` contains
  `"@smoke-full/auth": "workspace:*"`.
- The shadcn registry installs from `@better-auth-ui/r/auth.json`,
  `settings.json`, and `user-button.json` ran without error — look
  for the auth pages under `apps/web/src/app/auth/...` and the
  components they pull in.
- The better-auth CLI ran with cwd `packages/auth` for schema
  generation and `packages/db` for migrations (check the tool's
  log output).

### `setup_shadcn`

- `apps/web/components.json` exists.
- `packages/ui/components.json` exists (full + shadcn dual init).
- shadcn primitives appear under `packages/ui/src/components/` (or
  wherever `packages/ui/components.json` points).
- `apps/web` consumes `packages/ui` via `@smoke-full/ui` — check
  `apps/web/package.json` `dependencies`.

### `generate_dockerfile`

- `Dockerfile` at the workspace root contains a `RUN ... turbo@^2
  prune $PACKAGE --docker` line (i.e. the monorepo template was
  selected, not the flat one).
- The pruned-install step uses `pnpm install --frozen-lockfile`
  (substituted into `__PM_INSTALL__`).
- `.dockerignore` contains `packages/db/src/.prisma` (the path
  returned by `getPrismaGeneratedIgnorePath` for `monorepo: full`),
  NOT `src/lib/db/.prisma`.
- `docker-compose.yml`'s `app:` service does NOT carry an inline
  `prisma migrate deploy` command (deferred to the migrate service
  in monorepo mode).
- `docker-compose.yml` has a `migrate:` service that builds from
  `Dockerfile.migrate` and depends on `db` healthy.
- `Dockerfile.migrate` was emitted at the workspace root and ran
  through `substituteMigrateDockerfilePlaceholders`. **Group K
  invariants — verify against `cat Dockerfile.migrate`:**
  - Uses `node:24-alpine` base image (pnpm/npm/yarn) or
    `oven/bun:1-alpine` (bun).
  - Includes `RUN __COREPACK_SETUP__`-substituted text (corepack
    enable + prepare for pnpm/npm/yarn; no-op for bun).
  - The `COPY` block uses `COPY . .` (monorepo mode), not the
    flat-mode targeted COPYs of `prisma/` etc.
  - `RUN` line installs the workspace via the PM's frozen-lockfile
    install (e.g. `pnpm install --frozen-lockfile`).
  - The final `CMD` reads:
    `["sh", "-c", "<pm-dlx> prisma migrate deploy --schema=./packages/db/prisma/schema.prisma"]`
    — note the `--schema` flag now points into `packages/db/`, not
    the legacy `prisma/schema.prisma`.
  - **No `__SOMETHING__` placeholders remain unsubstituted** — grep
    `Dockerfile.migrate` for `__[A-Z_]+__` and confirm zero matches.

### `generate_readme`

- `README.md` "Project Structure" section lists `apps/web/`,
  `packages/db/`, `packages/auth/`, `packages/ui/`, `packages/orpc/`,
  `packages/eslint-config/`, and `packages/typescript-config/`.
- `README.md` Docker section mentions `docker compose run --rm
  migrate` for migrations.
- `README.md` does NOT contain the legacy "you may need to pass
  `--schema=./packages/db/prisma/schema.prisma`" workaround note
  (Group K removed it because the migrate Dockerfile now does this
  by default). If you see that text, K's README cleanup didn't land.
- `AGENTS.md` exists at the workspace root and contains the
  `@smoke-full/db` and `@smoke-full/auth/server` import strings
  agents should use. AGENTS.md also does NOT contain the legacy
  `--schema=` workaround paragraph (same K cleanup).
- `CLAUDE.md` exists and is a one-line pointer at `AGENTS.md`.

### `validate_project`

- Reports `next.config.ts` found at `apps/web/next.config.ts` (not
  at workspace root).
- Reports the workspace files present (`pnpm-workspace.yaml`,
  `turbo.json`).
- Reports each emitted `packages/*` directory.

## 5. Build steps (after all generation)

Each command is the next checkpoint. Stop and investigate on the
first failure — later steps will compound the diagnosis.

- **`pnpm install`** — should succeed without unresolved workspace
  deps. **Watch for:** errors about `@smoke-full/db` or
  `@smoke-full/auth` not found (would indicate F1 / G1 wiring or
  the catalog substitution missed something), or pnpm refusing the
  lockfile (catalog mismatch).

- **`pnpm typecheck`** (or `pnpm -r typecheck`) — should pass clean.
  Failures here are almost always import-string regressions —
  something still resolves to `@/lib/db` or `@/lib/auth` instead of
  the workspace package.

- **`pnpm build`** — Turbo build. Should produce
  `apps/web/.next/standalone/`. Watch for: package-name mismatches
  in turbo's filter graph, missing `output: 'standalone'` in
  `apps/web/next.config.ts`, or build-time imports that escape the
  pruned subgraph.

- **`docker build .`** — should produce a runnable image. Watch for:
  - `turbo prune` failure → workspace setup is wrong (probably the
    root `package.json` `workspaces` field or `pnpm-workspace.yaml`).
  - Prisma client generation failure → `packages/db/src/.prisma`
    path is mis-emitted, or `prisma generate` runs in the wrong cwd.
  - Layer caching surprises → not necessarily a bug, just note them.

- **`docker compose run --rm migrate`** (Group K — first end-to-end
  test of the templated `Dockerfile.migrate`) — should connect to
  the postgres `db` service and apply migrations. Watch for:
  - **Schema-not-found** → the substituted `--schema=...` path
    inside the CMD doesn't match what `COPY . .` actually landed in
    the migrate image. Capture the literal CMD line from
    `Dockerfile.migrate` and the full error.
  - **Workspace dep resolution failure during `__PM_INSTALL__`** →
    `packages/db` or its transitive deps not findable. Means
    `pnpm-workspace.yaml` or the lockfile is incomplete in the
    smoke project.
  - **Slow build** → expected. `COPY . .` plus a full workspace
    install isn't optimised; build performance is documented in the
    recommended-fixes Tier 6 (K's known rough edge).
  - For the bun + sqlite + drizzle variant: `Dockerfile.migrate`
    must NOT exist (gating: `orm === 'prisma' && database !==
    'none'`). Also no `migrate:` service in `docker-compose.yml`.

## 6. Companion smokes (light variants)

Each runs the same procedure as section 3, but with a different
config. They exist to catch regressions that the everything-on
smoke can't see.

### Variant A — Full + npm + postgres + prisma + better-auth + shadcn (no rpc)

Catches the **npm catalog substitution path** (npm has no native
catalog; we substitute literal versions into the root `workspaces`
package.json).

```diff
- "packageManager": "pnpm",
+ "packageManager": "npm",
- "rpc": "orpc",
+ "rpc": "none",
```

Run sections 3–5, replacing `pnpm` with `npm` (`npm install`,
`npm run typecheck`, `npm run build`).

### Variant B — Full + bun + sqlite + drizzle (no auth, no shadcn)

Catches **bun's different base image** in the Dockerfile and the
**non-Prisma path** for the migrate-service gating.

```diff
- "packageManager": "pnpm",
+ "packageManager": "bun",
- "database": "postgres",
+ "database": "sqlite",
- "orm": "prisma",
+ "orm": "drizzle",
- "auth": "better-auth",
+ "auth": "none",
- "uiLibrary": "shadcn",
+ "uiLibrary": "none",
- "rpc": "orpc",
+ "rpc": "none",
```

Skip `setup_authentication` and `setup_shadcn`. Confirm
`docker-compose.yml` has no `migrate:` service (gated on prisma) and
that `Dockerfile.migrate` is **not** emitted at the project root
(same gate; Group K preserved this behaviour). Also: bun's base
image in `Dockerfile.monorepo` should be `oven/bun:1-alpine`, not
`node:24-alpine`.

### Variant C — Minimal + pnpm (no db, no auth, no shadcn)

Fast smoke confirming **minimal mode emits `apps/web/` cleanly**
without any `packages/*`.

```diff
- "monorepo": "full",
+ "monorepo": "minimal",
- "database": "postgres",
+ "database": "none",
- "orm": "prisma",
+ "orm": "none",
- "auth": "better-auth",
+ "auth": "none",
- "uiLibrary": "shadcn",
+ "uiLibrary": "none",
- "rpc": "orpc",
+ "rpc": "none",
```

Confirm: only `apps/web/` and root workspace files exist; no
`packages/` directory at all.

### Variant D — Flat (`monorepo: none`) regression

Confirms **flat mode still works identically to pre-monorepo
behaviour**. Same config as the everything-on full smoke but with
`monorepo: 'none'` and `rpc: 'none'` (rpc requires full).

```diff
- "monorepo": "full",
+ "monorepo": "none",
- "rpc": "orpc",
+ "rpc": "none",
```

Confirm: no `apps/`, no `packages/`, no `pnpm-workspace.yaml`, no
`turbo.json`. The Dockerfile is the flat one (no `turbo prune`).
This is the regression baseline — if anything here behaves
differently from `main`, that's a bug.

## 7. Known limitations / where to capture findings

- **`Dockerfile.migrate` was templated in Group K (`259eb0b`).** It
  no longer needs the `--schema=...` workaround — the substituter
  bakes the right schema path into the CMD per monorepo mode. The
  smoke is the first end-to-end test of this templated output;
  expect the migrate service to "just work", but file a follow-up
  if it doesn't (the K commit's known rough edges are listed in
  `2026-05-06-recommended-fixes.md` Tier 6 → "From K").

- **better-auth CLI integration is untested in CI.** Every existing
  test run uses `skipInstall: true`, so the better-auth CLI never
  actually ran against the new `packages/auth` schema cwd or
  `packages/db` migration cwd. This smoke is the first end-to-end
  run; capture exact CLI errors (if any) verbatim — they are
  hard to reproduce later from log fragments. Tier 1 of the
  recommended-fixes doc lists this as a known smoke target.

- **shadcn `--preset b0 --template next --monorepo --pointer` is a
  newish invocation format.** If the registry / CLI changes its
  contract, this is where it'll surface first.

- **No headless driver / `pnpm start` for the MCP server.** Driving
  the server from the inspector requires a full path to
  `dist/index.js`. Recommended-fixes Tier 5a proposes adding
  `pnpm start` + `tools/smoke-call.ts` so this smoke can be
  reproduced from CI on every PR. Out of scope for the immediate
  smoke run.

- **Out-of-scope follow-ups.** For everything else not directly
  testable by this smoke (Tier 2 tool audits like
  `generate_base_components` × monorepo, Tier 3 schema refines,
  Tier 4 helper extractions), see
  `docs/plans/2026-05-06-recommended-fixes.md`.

## 8. Acceptance criteria

The smoke is "green" when:

- All five smoke configs (everything-on full + variants A–D)
  scaffold cleanly without errors from any tool.
- The everything-on full smoke gets all the way through
  `docker build .` AND `docker compose run --rm migrate` with no
  manual fixes (the migrate step is the first runtime test of
  Group K's templated `Dockerfile.migrate`).
- All four package managers' lockfiles install (variants A and B
  exercise npm and bun; the everything-on smoke covers pnpm; yarn
  is not in the smoke matrix because we have no current yarn user
  to validate against — add it if/when we do; tracked in
  `2026-05-06-recommended-fixes.md` Tier 5b).
- Findings (if any) are recorded below and filed as separate
  follow-up tickets / issues.

## Findings

> Fill this in **during the run**, one subsection per variant.
> Empty bullets are fine — leave them as a record that the variant
> was attempted and passed.

### Everything-on full (pnpm + postgres + prisma + better-auth + shadcn + orpc)

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant A — Full + npm

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant B — Full + bun + sqlite + drizzle

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant C — Minimal + pnpm

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant D — Flat regression

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:
