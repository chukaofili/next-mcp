# Monorepo Support — End-to-End Smoke Test

> Manual procedure for Group J of the monorepo support plan
> (see `2026-05-05-monorepo-support-implementation.md`). Run this by
> hand before merging `feat/upgrade-packages` into `main`. CI does not
> execute this — it requires a Docker daemon, network access for
> `create-next-app` plus the `better-auth-ui` shadcn registry, and
> several minutes of `pnpm install` + `docker build` time.
>
> **Up-to-date as of HEAD `6475db1`** — covers Groups A–J, the post-J
> coverage audit, Group K (Dockerfile.migrate templated for all 4 PMs
> × 3 monorepo modes), Tiers 2-6, OoS-1 (`McpServer` migration), and
> OoS-2 (Dockerfile.migrate extended to drizzle). The companion punch
> list for everything **outside** this smoke lives at
> `docs/plans/2026-05-06-recommended-fixes.md` — Tier 1 there
> enumerates exactly what this smoke is meant to prove out at runtime.

## 1. Purpose

This smoke test exercises the full `next-mcp` tool surface against a
real filesystem and a real Docker daemon. The integration suite
(`tests/integration/tools/*` — currently 18 files / 230 tests) covers
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
- the templated `Dockerfile.migrate` (Group K + OoS-2, gate now
  `(orm === 'prisma' || orm === 'drizzle') && database !== 'none'`,
  CMD substituted via `__MIGRATE_CMD__` per ORM) actually builds and
  `docker compose run --rm migrate` succeeds for each monorepo mode
  × package manager × ORM combination.

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
#    Option A: pnpm smoke (headless driver — Tier 5a, see below)
#             For the skipInstall:true generation-only signal that
#             this section's per-tool checklist exercises, the
#             headless driver at `tools/smoke.ts` runs all five
#             preset configs end-to-end in ~6 seconds total. CI
#             runs this on every PR.
pnpm run smoke              # all five presets
pnpm run smoke variant-a-full-npm   # one preset
#
#             A future `--full` flag would chain `<pm> install` +
#             `<pm> build` per generated project for the actual
#             runtime signal that steps 6-7 below exercise. Until
#             that lands, run the manual procedure (Option B/C
#             below) for the install/build/docker pass.
#
#    Option B: MCP inspector (interactive, recommended for the
#             install/build/docker pass that `pnpm smoke` doesn't
#             yet cover)
npx @modelcontextprotocol/inspector node ~/projects/chukaofili/next-mcp/dist/index.js
#
#    Option C: spawn the server from a Claude Code / other MCP client
#             session and call the tools from there. Configure the
#             client to launch:
#               command: node
#               args:    ["~/projects/chukaofili/next-mcp/dist/index.js"]

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
  - The final `CMD` is `["sh", "-c", "<__MIGRATE_CMD__>"]` and the
    substituted command varies per ORM (OoS-2):
    - prisma: `<pm-dlx> prisma migrate deploy --schema=./packages/db/prisma/schema.prisma`
      (`monorepo: full`); flat-mode points at `./prisma/schema.prisma`.
    - drizzle: `<pm-dlx> drizzle-kit migrate --config=./packages/db/drizzle.config.ts`
      (`monorepo: full`); flat-mode points at `./drizzle.config.ts`.
    Note `--schema` / `--config` paths now live under `packages/db/`
    in `monorepo: full`, not at the project root.
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

- **`docker compose run --rm migrate`** (Group K + OoS-2 — first
  end-to-end test of the templated `Dockerfile.migrate`; the same
  image now serves both prisma `migrate deploy` and drizzle
  `drizzle-kit migrate`) — should connect to the database service
  and apply migrations. Watch for:
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
  - For the bun + sqlite + drizzle variant (post-OoS-2):
    `Dockerfile.migrate` MUST exist and `docker-compose.yml` MUST
    have a `migrate:` service (gate is now
    `(orm === 'prisma' || orm === 'drizzle') && database !== 'none'`).
    The substituted CMD is the drizzle form
    (`<pm-dlx> drizzle-kit migrate --config=...`). Mongoose configs
    remain excluded from the migrate Dockerfile (no SQL migrations).

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
**drizzle migrate path** (drizzle-kit + the per-ORM flat-mode COPY
introduced by OoS-2).

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

Skip `setup_authentication` and `setup_shadcn` (gated on
`auth: 'none'` and `uiLibrary: 'none'`). Confirm `docker-compose.yml`
DOES have a `migrate:` service and `Dockerfile.migrate` IS emitted
at the project root (post-OoS-2 the gate is
`(prisma || drizzle) && db !== 'none'`). The substituted CMD must
be the drizzle form (`<pm-dlx> drizzle-kit migrate --config=...`).
Also: bun's base image in `Dockerfile.monorepo` should be
`oven/bun:1-alpine`, not `node:24-alpine`.

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

- **`Dockerfile.migrate` was templated in Group K + extended in
  OoS-2.** Gate is now
  `(orm === 'prisma' || orm === 'drizzle') && database !== 'none'`;
  mongoose stays explicitly excluded (schemaless, no SQL migrations).
  The substituter bakes the right schema/config path into the CMD
  per monorepo mode and ORM via `__MIGRATE_CMD__`. The smoke is the
  first end-to-end test of this templated output for both ORMs;
  expect the migrate service to "just work", but file a follow-up
  if it doesn't.

- **Flat-mode drizzle ordering.** The flat-mode migrate Dockerfile
  emits `COPY drizzle ./drizzle`, which requires
  `drizzle-kit generate` to have produced the `drizzle/` directory
  before `docker build` runs. If the directory is absent, the build
  fails with `COPY ... no such file or directory`. Order the smoke:
  `drizzle-kit generate` first, then build the migrate image.

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

- **Headless smoke driver — shipped (Tier 5a).** `tools/smoke.ts`
  drives the MCP server over stdio for all five preset configs in
  ~6 seconds total with `skipInstall: true`, asserting a small set
  of file-existence post-conditions per variant. CI runs this on
  every PR via `pnpm run smoke`. The manual install / build /
  docker pass (sections 5 + the migrate end-to-end) is still done
  by hand — a `--full` flag for the driver to chain `<pm> install`
  + `<pm> build` is a future extension and tracked as the
  remaining gap below.

- **Out-of-scope follow-ups.** Tiers 2-6 + OoS-1 + OoS-2 have all
  shipped; Tier 1 (this manual smoke) is the gating step before
  merge. Tier 5b (yarn variant) and a `--full` flag for
  `tools/smoke.ts` are deferred follow-ups tracked in
  `docs/plans/2026-05-06-recommended-fixes.md`. Tier 7 was
  explicitly skipped per user direction.

## 8. Acceptance criteria

The smoke is "green" when:

- All five smoke configs (everything-on full + variants A–D)
  scaffold cleanly without errors from any tool.
- The everything-on full smoke gets all the way through
  `docker build .` AND `docker compose run --rm migrate` with no
  manual fixes (the migrate step is the first runtime test of
  Group K's templated `Dockerfile.migrate`; variant B exercises the
  same path on the drizzle side per OoS-2).
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

- Date run: 2026-05-07
- Run by: Chuka Ofili — driven via MCP inspector against next-mcp HEAD `3843166` (note: the doc's "as of HEAD" anchor at line 10 is `6475db1`; intermediate commits are CI/workspace plumbing fixes that don't affect the smoke surface).
- Status: **in progress, partial RED.** Five tool calls run: `scaffold_project` ✓, `setup_database` ✓, `setup_authentication` ⚠️ (success-with-warning, multiple silent subprocess failures behind it — see B1/B3), `setup_shadcn` ✗ (`isError: true`, see B2). Manual recovery (Path A) unblocked the project to a buildable file layout — see "Recovery actions" below. `generate_dockerfile` / `generate_readme` / `validate_project` and Stage 4 (build / docker / migrate) still to run.
- Notable observations:
  - The five compounding bugs below all stem from one root cause (B5) — `create-next-app`-leftover workspace files in `apps/web/` shadow the real monorepo workspace, breaking every subsequent `pnpm add` invoked from inside `apps/web/`. Fixing B5 alone likely turns B1, B3, and the `pnpm add` half of B2 into passing paths.
  - `tools/smoke.ts` (CI, every PR) tests the `skipInstall: true` generation path and would not have caught any of B1–B5 — they all surface only when subprocesses actually run.
  - The MCP-server stderr stream (subprocess output captured by `execCommand`) carries diagnostic gold that the inspector hides in a separate panel and the MCP response strips. Several findings below required reproducing commands in a shell to recover the real error message.

- Errors / blockers (numbered for ticket filing — all source refs against `src/index.ts` at HEAD `3843166`):

  **B1 — `setup_authentication`'s better-auth schema-gen silently fails on the prisma path.**
  `getAuthSchemaCommand` (src/index.ts:3467-3473) builds `dotenv -e .env -- <pm-dlx> auth@latest generate -y --config <config>`, which needs the `dotenv` binary from `dotenv-cli`. But `dotenv-cli` is only wired as a workspace-root devDep when `getAuthGenerateScript()` is non-null — i.e. drizzle path only (src/index.ts:451-458, 1528-1534). For prisma the binary is absent; subprocess fails (`dotenv: command not found` or equivalent); `execCommand` reports `success: false`; tool falls through to the "⚠️ Manual setup required" branch (src/index.ts:3895-3909) without `isError: true`. The user sees the failure as a hint to run the command manually.
  Secondary: even on the drizzle path the same command would fail because `<pm> install` hasn't been run at the workspace root by this point — same symptom, different reason. (See B4.)

  **B2 — `setup_shadcn` invocation incompatible with shadcn CLI v4 (March 2026).**
  `buildShadcnInitCommand` (src/index.ts:533-540) hardcodes `--monorepo` whenever `monorepoMode != 'none'`. Per the [shadcn/ui docs](https://ui.shadcn.com/docs/monorepo) and the [v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4), in CLI v4 `--monorepo` is a SCAFFOLD-FROM-SCRATCH flag — it creates `apps/web` + `packages/ui` + `turbo.json` from nothing. It is NOT a "configure shadcn for an existing monorepo" flag. The existing-monorepo flow is: pre-emit `apps/web/components.json` (with cross-workspace aliases like `"ui": "@<scope>/ui/components"`, `"utils": "@<scope>/ui/lib/utils"`, plus local `"components": "#components"` etc.) and `packages/ui/components.json` (with matching `style`/`iconLibrary`/`baseColor` and its own local aliases) — then run `shadcn add <component>` from apps/web. The CLI auto-routes via the aliases; no `--monorepo` flag.
  Verbatim error reproduced from `apps/web` cwd:
  ```
  ENOENT: no such file or directory, open
  '/private/tmp/next-mcp-smoke/smoke-full/apps/web/packages/ui/components.json'
  ```
  shadcn@4.6.0 produces the same error — not a version regression, fundamental flag-semantic mismatch. Running with `--monorepo` from the workspace root fares slightly better (writes `packages/ui/components.json`) but then chokes on `apps/web/components.json` not pre-existing. Running without `--monorepo` from `apps/web` writes `apps/web/components.json` correctly with monorepo-aware aliases (auto-detected) — but then fails on the workspace-add step (B5).

  **B3 — `setup_authentication`'s better-auth-ui shadcn registry pulls silently fail.**
  Step 4.9 (src/index.ts:3677-3699) shells `<runner> shadcn@latest add <better-auth-ui registry url> -y` from apps/web for `auth.json`, `settings.json`, `user-button.json`. Both `execCommand` calls returned exit 0 → `authRegistryResult.success && settingsAndButtonResult.success` evaluated true → tool reported "Installed better-auth-ui shadcn-registry components in apps/web". But ZERO of the registry-emitted files (`auth.tsx`, `auth-provider.tsx`, `settings/settings.tsx`, `user/user-button.tsx`, plus ~25 supporting files) actually landed on disk. Cause is downstream of B5: at this point `apps/web/components.json` doesn't yet exist (that's `setup_shadcn`'s job, which runs later) AND `apps/web/pnpm-workspace.yaml` is shadowing the real workspace, so shadcn's internal `pnpm add` for primitive deps fails — but the outer `shadcn add` command returns exit 0 regardless and the outer command counts as success. Templated wrappers (`apps/web/src/app/auth/[path]/page.tsx`, `account/[path]/page.tsx`, `providers/auth-ui-provider.tsx`, `components/auth/user-button.tsx`) reference these missing imports — project does not typecheck without them.

  **B4 — Tool-pipeline architectural gap: no `<pm> install` between `scaffold_project` and downstream tools.**
  B1, B2, B3 all depend on a valid workspace state, but no tool runs `<pm> install` at the workspace root after `scaffold_project`. The smoke procedure's section 5 also runs `pnpm install` AFTER all per-tool calls, not between scaffold and the rest. Either the tool flow needs an explicit install step (after scaffold or as a guard at the top of each downstream setup tool), or the smoke doc needs to surface a manual install step between section 4 and section 5. Even with B5 fixed, this gap remains a smoke trap for the drizzle / non-trivial-CLI paths.

  **B5 — `scaffold_project` leaves rogue create-next-app workspace files in `apps/web/`. ⭐ Root cause behind B1/B2/B3.**
  `create-next-app --use-pnpm` emits `apps/web/pnpm-workspace.yaml` (containing only `ignoredBuiltDependencies: [sharp, unrs-resolver]`) and `apps/web/pnpm-lock.yaml`. `scaffoldProject` does not delete these after the subprocess returns. Effect: every subsequent `pnpm <add|install>` invoked from inside `apps/web/` walks up, finds `apps/web/pnpm-workspace.yaml` first, treats `apps/web/` as the workspace root, sees only one project (itself), and fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND: @smoke-full/ui` (and similar) for any workspace dep.
  Reproduced and confirmed: from `apps/web/`, `pnpm m ls --depth=-1` listed only `@smoke-full/web`. After `rm apps/web/pnpm-workspace.yaml apps/web/pnpm-lock.yaml`, the same command from the same cwd correctly enumerated all 8 workspace projects, and shadcn's internal `pnpm add` then succeeded.
  Fix: in `scaffoldProject`, after `create-next-app` returns in `monorepo: full`/`minimal` modes (where the real workspace files live at `projectPath`), delete `apps/web/pnpm-workspace.yaml` and `apps/web/pnpm-lock.yaml`.

  **B6 — `execCommand` swallows silent failures across multiple tools.**
  Pattern thread through B1, B3 (and probably others not yet exercised): child CLI exits 0 having produced no expected output (because of upstream env breakage), `execCommand`'s success criterion is exit-code-only, calling tool reports success, callers are misled. MCP error contract should be stricter — verify expected output files / state post-run, not just exit code. Without that, callers can't distinguish tool success from tool no-op, and bugs like B3 require per-file disk inspection to detect.

  **B7 — Doc drift: section 4 schema-gen cwd assertion stale (post-`auth@latest` migration).**
  Section 4 line 192-194 asserts the better-auth CLI ran with cwd `packages/auth` for schema-gen. `getAuthSchemaCwd` (src/index.ts:3498-3500) intentionally returns `projectPath` (workspace root). The docstring at src/index.ts:3454-3466 documents this as a deliberate design choice for `auth@latest`. Smoke doc should be updated. (This is a doc-only fix — no code change needed.)

- Recovery actions taken during the run (Path A — manual recovery to keep the smoke moving):
  1. Removed orphan `packages/ui/components.json` (created during B2 diagnosis attempts; cross-workspace aliases inconsistent with the apps/web local-alias scheme we settled on).
  2. Removed `apps/web/pnpm-workspace.yaml` and `apps/web/pnpm-lock.yaml` (the B5 trigger).
  3. Ran `pnpm install` at workspace root (settled lockfile across all 8 workspace projects).
  4. Ran `pnpm dlx shadcn@latest init --preset b0 --template next --pointer` (no `--monorepo` flag) from `apps/web/` with `yes` piped to the overwrite prompt — wrote `apps/web/src/lib/utils.ts`, installed `clsx`/`tailwind-merge`, and updated `globals.css` with shadcn tokens.
  5. Ran `pnpm dlx shadcn@latest add --all -y -o` from `apps/web/` — populated 50+ shadcn primitives under `apps/web/src/components/ui/`.
  6. Ran the three better-auth-ui registry adds (`auth.json`, `settings.json`, `user-button.json`) from `apps/web/` — populated `apps/web/src/components/auth/**` with the missing components that B3 had silently dropped.
  - Trade-off accepted: `packages/ui/` is now empty (no components, no `components.json`). apps/web is self-contained with local `@/...` aliases instead of the docs-recommended cross-workspace aliases (`@<scope>/ui/...`). This trades monorepo-correctness for "smoke moves forward" — the deeper monorepo placement question lives with B2's follow-up.
  - Two non-blocking setup_shadcn side-effects skipped: Toaster import injection in `apps/web/src/app/layout.tsx` (runtime feature; doesn't break typecheck/build) and the chart/sidebar CSS token additions in `globals.css` (CSS fallbacks at runtime). If either becomes a Stage 4 blocker, we'll fold them in then.
  - Auth schema-gen + prisma migrate-dev (B1's fallback instructions) deferred — prisma migrate's runtime test is `docker compose run --rm migrate` in Stage 4, which validates Group K's templated `Dockerfile.migrate` mechanics regardless of whether the schema includes auth tables.

- Re-implementation opportunity (architectural — supersedes several of the per-bug fixes below for the `uiLibrary === 'shadcn'` paths):

  **R1 — Delegate the monorepo+shadcn scaffold to shadcn's own CLI.**
  shadcn CLI v4's `init` subcommand has flags that, in combination, scaffold the *entire* workspace (root files + apps/web + packages/ui + packages/eslint-config + packages/typescript-config + turbo + pnpm-workspace + components.json files + Button primitive + theme-provider + lib/utils.ts) in one shot — no `create-next-app` involvement, no rogue `apps/web/pnpm-workspace.yaml` (B5 root cause is eliminated by construction), no manual init+add dance (B2 is eliminated — shadcn's CLI is the one in charge of its own contract).

  Verified invocation forms (reference scaffold lives at `/tmp/test-2`, generated by the user before this run):
  ```sh
  # Full or minimal monorepo + shadcn:
  pnpm dlx shadcn@latest init --preset b0 --template next \
    --monorepo --pointer --name <projectName> --cwd <projectPath>

  # Flat (monorepo: 'none') + shadcn:
  pnpm dlx shadcn@latest init --preset b0 --template next \
    --no-monorepo --pointer --name <projectName> --cwd <projectPath>
  ```

  **What shadcn's monorepo init produces** (verified against `/tmp/test-2`):
  - **Workspace root:** `package.json` (turbo + prettier + tailwind-prettier + typescript), `pnpm-workspace.yaml` (`apps/*` + `packages/*`), `turbo.json` (build/dev/lint/typecheck/format tasks), root `tsconfig.json`, `.eslintrc.js`, `.prettierrc`, `.prettierignore`, `.npmrc`, `.gitignore`, `README.md`. `packageManager: pnpm@9.15.9`, `engines.node: >=20`.
  - **`apps/web/`:** Next.js app at *flat layout* `apps/web/app/...` (no `--src-dir`). `components.json` correctly aliased (mixed: local `@/components`/`@/hooks`/`@/lib` for app-specific stuff, cross-workspace `@workspace/ui/components` + `@workspace/ui/lib/utils` for shared). `tailwind.css` points at `../../packages/ui/src/styles/globals.css` so the design system genuinely lives in packages/ui. `tsconfig.json` extends `@workspace/typescript-config/nextjs.json` and declares both `@/*` and `@workspace/ui/*` path mappings. Includes a baseline `theme-provider.tsx` and empty `.gitkeep`-only `components/`, `hooks/`, `lib/`.
  - **`packages/ui/`:** name `@workspace/ui`, with proper `exports` for `./components/*`, `./lib/*`, `./hooks/*`, `./globals.css`, `./postcss.config`. Ships a Button primitive at `src/components/button.tsx`, `src/lib/utils.ts` (the `cn` helper), `src/styles/globals.css` (the *shared* design-system stylesheet), and its own `components.json`/`tsconfig.json`/`eslint.config.js`/`postcss.config.mjs`. All shadcn deps (`shadcn`, `radix-ui`, `clsx`, `tailwind-merge`, `tw-animate-css`, `class-variance-authority`, `lucide-react`, `next-themes`, `tailwindcss`, `@tailwindcss/postcss`) are pre-installed.
  - **`packages/eslint-config/`:** name `@workspace/eslint-config`, exports `./base`, `./next-js`, `./react-internal` (three eslint config flavors).
  - **`packages/typescript-config/`:** name `@workspace/typescript-config`, ships `base.json`, `nextjs.json`, `react-library.json`.

  **What next-mcp would still need to augment on top of shadcn's scaffold:**
  1. **Project-scoped package rename.** shadcn hardcodes `@workspace/...` as the scope; the `--name` flag only sets the project *directory* name (verified against [shadcn CLI docs](https://ui.shadcn.com/docs/cli)). next-mcp needs `@<projectName>/...` — requires a post-scaffold sweep across `package.json` `name` fields, all `dependencies`/`devDependencies` workspace specifiers, `tsconfig.json` `paths`, and `components.json` `aliases`. Doable with a recursive find/replace on `@workspace/` → `@<projectName>/`.
  2. **Database package** (`packages/db/`) — prisma | drizzle | mongoose adapter, schema, client.ts, package.json, tsconfig, scripts. Out of shadcn's scope.
  3. **Auth package** (`packages/auth/`) — better-auth, plus the better-auth-ui shadcn registry adds (still need separate `shadcn add` calls, but those will work once everything else is sane).
  4. **oRPC package** (`packages/orpc/`) when `rpc: 'orpc'` — out of shadcn's scope.
  5. **Docker layer** — `Dockerfile`, `Dockerfile.migrate`, `docker-compose.yml`, `.dockerignore`, plus root `package.json` docker scripts (`docker:build`/`docker:run`/`docker:dev:up`/`docker:dev:down`).
  6. **Testing setup** — vitest config files, test directories, root scripts, turbo task wiring.
  7. **`.env*`/`.env.example`/`.env.local`** at the workspace root.
  8. **Catalog block in `pnpm-workspace.yaml`** — shadcn's scaffold doesn't declare catalogs. next-mcp uses them for shared version pinning (`@types/node`, `eslint`, `typescript`, `vitest`, etc. all flow through `catalog:`). Append after init.
  9. **Version-pin alignment.** shadcn's scaffold pins `pnpm@9.15.9`, `next@16.1.6`, `node>=20`. next-mcp pins `pnpm@10.18.0`, `next@16.2.x`, `node>=24`. Either accept shadcn's pins as the new baseline (simpler, but means a downgrade for current users) or do a post-scaffold pin-bump pass (root + apps/web + packages/* package.json + `engines`).
  10. **`apps/web/src/` vs flat.** shadcn scaffolds `apps/web/app/...`; next-mcp's templates assume `apps/web/src/app/...`. Either (a) accept shadcn's flat convention and rewrite next-mcp's templated import paths, or (b) move shadcn's emitted `apps/web/{app,components,hooks,lib}` under a new `src/` after init. (a) is structurally cleaner; (b) preserves all existing template paths.
  11. **Plus everything `setup_authentication` already does post-shadcn:** the better-auth CLI schema-gen + migration, the API route handler, the proxy.ts, dynamic auth/account pages, AuthProvider injection into layout.tsx, etc. — none of this is shadcn's job.

  **Why this is high-leverage:**
  - **Eliminates B5 entirely.** No `create-next-app --use-pnpm` invocation → no rogue `apps/web/pnpm-workspace.yaml` → no shadowing → no `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` cascade.
  - **Eliminates B2 entirely.** shadcn's CLI is the one in charge of its own monorepo invocation contract; next-mcp doesn't have to track shadcn's flag-semantic changes across CLI versions.
  - **Reduces B3's failure surface significantly.** With B5 gone, the better-auth-ui `shadcn add` calls in `setup_authentication` will work. (B6's "verify outputs post-subprocess" hardening still wanted as defense-in-depth.)
  - **Cuts code surface area.** ~all of `scaffoldMonorepoRoot` and the manual `packages/eslint-config`/`packages/typescript-config`/`packages/ui` template emission goes away. The shadcn CLI is the single source of truth for the workspace skeleton.
  - **Improves UX.** Generated `apps/web/tailwind.css` correctly points at the *shared* design-system stylesheet in `packages/ui/src/styles/globals.css` — meaning a single place owns the project's design tokens, which is the actual point of putting shadcn in a monorepo. next-mcp's current setup_shadcn doesn't achieve this (apps/web has its own globals.css with no cross-workspace link).

  **Open questions / risks for the implementation session:**
  - **`--name` exact behavior:** docs say "the name for the new project" — need to actually run with `--name smoke-full --cwd /tmp` and verify *what* gets named (root `package.json` `name`? directory? both? does `@workspace/...` change? bet is that only the dir name + root `package.json` `name` change; the `@workspace/...` scope is fixed). The user's command form includes `--name <projectName>` so they may have already verified — worth confirming before committing.
  - **`--src-dir` layout decision** — see point 10 above. This is a meaningful structural choice for the templates.
  - **Version-pin policy** — see point 9 above. Either commit to shadcn's pins or do a bump pass.
  - **What happens for `uiLibrary !== 'shadcn'`?** This R1 path is shadcn-gated; the no-shadcn paths still need next-mcp's manual scaffolding (or a different upstream tool). Likely: keep two scaffold strategies — `scaffoldViaShadcn(...)` and `scaffoldManually(...)` — dispatched by `uiLibrary`.
  - **`uiLibrary === 'shadcn' && monorepo === 'minimal'`** — the `--monorepo` flag presumably scaffolds full (apps + packages + eslint-config + typescript-config). For "minimal" mode (apps/web only, no packages/), need to either (a) use `--no-monorepo` form and adjust, or (b) accept that "minimal" gets the same full-monorepo skeleton as "full" and prune unwanted packages post-init. Worth re-thinking what "minimal" means now that shadcn pre-pays the cost of the shared packages.

  This recommendation should be evaluated *before* tickets B5-fix and B2-fix below — if R1 lands, those tickets become moot.

- Follow-up tickets to file (proposed — not yet created in the issue tracker; ordered by leverage):
  1. **R1 spike: scaffold via `shadcn init` instead of `create-next-app` + manual workspace emission** (see "Re-implementation opportunity" above). Time-box one session against `/tmp/test-2` as the reference; output is a written decision doc — go/no-go and a migration plan. Supersedes tickets 2 + 3 if it lands.
  2. **`scaffold_project`: delete create-next-app-emitted `apps/web/pnpm-workspace.yaml` + `apps/web/pnpm-lock.yaml` post-subprocess.** Addresses **B5** — the root cause of B1/B3 and half of B2. Likely a one-line fix in `scaffoldProject`. *Do this regardless of R1's outcome — it's a small targeted fix that also helps if R1 takes longer to land.*
  3. **Tool pipeline: run `<pm> install` at workspace root after `scaffold_project`** (or as a guard at the top of each downstream `setup_*`). Addresses **B4**, defends against future regressions of the same family. Independent of R1.
  4. **`setup_shadcn`: align with shadcn CLI v4 existing-monorepo flow.** Drop `--monorepo` flag from `buildShadcnInitCommand`. Pre-emit `apps/web/components.json` + `packages/ui/components.json` declaratively per shadcn's docs. Addresses **B2**. *Mooted by R1 if R1 lands; otherwise still needed.*
  5. **`setup_*`: strengthen `execCommand` success criterion.** Verify expected output files / state post-subprocess; surface stderr on failure via MCP `isError: true`. Addresses **B6** — also makes B1/B3 self-diagnosing if they ever recur. Independent of R1 — value as defense-in-depth.
  6. **`setup_authentication`: wire `dotenv-cli` for prisma path** (currently drizzle-only at src/index.ts:1528-1534), OR rewrite `getAuthSchemaCommand` to invoke `<pm-dlx> dotenv-cli` instead of relying on a `dotenv` binary on PATH. Addresses **B1**. Independent of R1.
  7. **Smoke doc:** update section 4 line 192-194 schema-gen cwd assertion (`packages/auth` → `projectPath`). Update section 6 Variant B language so it doesn't assume the `--monorepo` flag's old semantic. Addresses **B7** + B2's doc surface. Doc-only.

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
