# AGENTS.md

Canonical orientation for Claude Code (and other coding agents) working in this repository.

## Overview

This repo is an MCP server that scaffolds production-ready Next.js applications via 8 tools (`scaffold_project`, `generate_dockerfile`, `setup_shadcn`, `generate_base_components`, `setup_database`, `setup_authentication`, `validate_project`, `generate_readme`). The architecture is deliberately compact: a single-file `src/index.ts` (~4500 lines) holds the schema, module-scope routing helpers (`getAppPath`, `shouldRouteToDbPackage`, the `hasXPackageEmitted` family, `wireAppsWebToWorkspacePackage`), the placeholder/catalog substitution pipeline, and the `NextMCPServer` class. The published artifact is the MCP server itself — invoked over stdio by Claude Desktop / Cursor / Gemini CLI. It is **not** a CLI tool; do not add `commander` argparsing or REPL behavior. The SDK migration to `McpServer.registerTool` is done (post-OoS-1); do not regress to the legacy handler-list shape.

## Tool surface

All 8 tools are registered via `registerTool` inside `NextMCPServer.setupToolHandlers` (`src/index.ts`):

- **`scaffold_project`** — bootstraps the project (flat or monorepo), runs `create-next-app`, wires workspace files, emits `packages/*` per the emission gates.
- **`generate_dockerfile`** — emits the production `Dockerfile` (or `Dockerfile.monorepo` for workspace modes), `Dockerfile.migrate`, `docker-compose.yml`, and `.dockerignore`.
- **`setup_shadcn`** — runs `shadcn init` + component install. Full + shadcn dual-inits `apps/web` and `packages/ui`.
- **`generate_base_components`** — emits app shell, layouts, and page stubs under `getAppPath(...)`.
- **`setup_database`** — emits Prisma/Drizzle/Mongoose config and routes sources via `shouldRouteToDbPackage`.
- **`setup_authentication`** — emits better-auth server + client, login/signup pages, and (in full mode) wires `apps/web` against `packages/auth` as `workspace:*`.
- **`validate_project`** — runs validation checks against an already-generated project.
- **`generate_readme`** — emits the project's `README.md`.

## Configuration schema

`ProjectConfigSchema` (in `src/index.ts`, ~line 755) is the source of truth for the MCP boundary. The architecture object carries: `typescript`, `reactCompiler`, `skipInstall`, `packageManager`, `database`, `orm`, `auth`, `uiLibrary`, `stateManagement`, `testing`, `monorepo`, `rpc`.

The schema carries three cross-field refines (Tier 3):

1. **`rpc: 'orpc'` requires `monorepo: 'full'`** — refine on the parent object.
2. **`auth: 'better-auth'` requires `database !== 'none'`** — refine; error names valid databases.
3. **ORM/database compatibility** — `superRefine` keyed off `ORM_DATABASE_COMPATIBILITY` (the canonical map). `mongoose ↔ mongodb` only; `drizzle` excludes `mongodb`; `prisma` accepts all four.

**Don't add new architecture fields without** updating both the schema (with a `.describe(...)` and a default) and any tools that branch on the field. If the new field interacts with another, add a refine — schema-level rejection is the contract; runtime checks duplicating schema rules are an anti-pattern.

## Monorepo modes

Three modes:

- **`none`** — flat Next.js project at `projectPath`.
- **`minimal`** — workspace root + `apps/web`. Emits `pnpm-workspace.yaml` (or pm-equivalent), `turbo.json`, root `package.json` with workspace scripts. **No `packages/*`.**
- **`full`** — minimal plus opinionated shared packages: `packages/{db,auth,ui,orpc,eslint-config,typescript-config}`. Conditional emission via the gates below.

**Package-emission gates** (all module-scope-exported in `src/index.ts`):

- `hasDbPackageEmitted(config)` — full mode + `database !== 'none'` + `orm !== 'none'`.
- `hasAuthPackageEmitted(config)` — `hasDbPackageEmitted` AND `auth === 'better-auth'`.
- `hasUiPackageEmitted(config)` — full mode + `uiLibrary === 'shadcn'`.
- `hasOrpcPackageEmitted(config)` — full mode + `rpc === 'orpc'` (the schema refine guarantees the implication).

**Path-routing rules:**

- App-level paths (anything that lives under the Next.js app: `src/app`, `src/components`, etc.) MUST go through `getAppPath(config, projectPath)`. Bare `path.join(projectPath, 'src/...')` is a bug in monorepo modes.
- DB sources MUST route through `shouldRouteToDbPackage(config)` — usually via `getDbBaseDir(config, projectPath)` and `getDbSrcDir(config, projectPath)`.
- For new file emissions: ask "is this an app-level file or a workspace-root file?" first, then pick the helper.

## Workspace-package wiring contract

`wireAppsWebToWorkspacePackage` (module-scope, `src/index.ts` ~line 964) is the shared helper for adding `<package-name>: 'workspace:*'` to `apps/web/package.json`. It is the single source of truth for db-package and auth-package wiring (both `wireAppsWebToDbPackage` and `wireAppsWebToAuthPackage` delegate to it).

**The G fix-loop "no silent fallback" contract:** if `packages/<dir>/package.json` is missing, or its `name` field is missing/empty, the helper THROWS with a clear hint message. It does not derive a fallback name from `config.name`. New callers of this helper must respect that contract — every emission path that produces a package the helper later consumes must guarantee the `name` field is present and non-empty.

If you add a new `packages/<x>` that `apps/web` should depend on: emit a real `package.json` with a real `name`, then call `wireAppsWebToWorkspacePackage(...)` from the relevant tool. Do not fork the helper.

## Templates

`src/templates/` holds every file template the tools emit. Subdirectories: `auth/`, `database/`, `docker/`, `packages/`. Top-level: `next.config.template`, `package.json.template`, `pnpm-workspace.yaml.template`, `tsconfig.json.template`, `turbo.json.template`, plus a few page templates.

**Placeholder convention.** Path-substitution placeholders use `__SCREAMING_SNAKE_CASE__`. Two helpers do the substitution:

- `substituteDockerfilePlaceholders` — shared PM placeholders (`__PM_INSTALL__`, `__PM_DLX__`, etc.) for `Dockerfile` / `Dockerfile.monorepo`.
- `substituteMigrateDockerfilePlaceholders` — adds the migrate-specific `__SCHEMA_HOST_PATH__`, `__MIGRATE_COPY__`, `__MIGRATE_DEPS_INSTALL__`, `__MIGRATE_CMD__`.

**Catalog substitution.** `substituteCatalog(content, packageManager, CATALOG_VERSIONS)` rewrites pnpm `catalog:` references to literal versions when the package manager is not pnpm. Apply it to every emitted `package.json` (root + `apps/*` + `packages/*`) when `packageManager !== 'pnpm'`.

The `postbuild` step copies `src/templates/` → `dist/templates/`. Read templates via `fs.readFile(path.join(__dirname, 'templates', ...))`.

## Tests

`pnpm test` builds (`pretest: pnpm run build`) and runs vitest. The split:

- `tests/unit/` — pure-function tests (substitution helpers, routing helpers, schema refines).
- `tests/integration/tools/` — end-to-end tool tests via `MCPTestClient`, a JSON-RPC stdio client. One file per tool plus a few cross-tool tests.

**The `NEXT_MCP_RECORD_COMMANDS` hook.** `execCommand` in `src/index.ts` honors this env var: when set, it captures would-be shell calls (cwd + argv) into a per-process file instead of executing them. Use this in integration tests when you need to assert shell behavior without actually running `<pm> install` or `shadcn init`. See:

- `tests/integration/tools/setup-authentication.test.ts` (~line 579+)
- `tests/integration/tools/setup-shadcn.test.ts` (~line 69+)

Current baseline: 230 tests across 18 files. Lint clean.

## Smoke driver

`pnpm run smoke` (or `pnpm smoke <preset-name>` to run one) drives the MCP server over stdio for five preset configs and runs the canonical 8-tool sequence end-to-end. Defined in `tools/smoke.ts`. Default mode passes `skipInstall: true` so generation is verified without the multi-minute `<pm> install` + build pass — runs in ~6s total. Runs on every PR via CI.

The five presets (named in the source):

- `full-everything-on` — full + pnpm + postgres + prisma + better-auth + shadcn + orpc.
- `variant-a-full-npm` — full + npm + (orpc:'none') — exercises catalog substitution.
- `variant-b-full-bun-sqlite-drizzle` — full + bun + sqlite + drizzle (no auth/ui/orpc).
- `variant-c-minimal-pnpm` — minimal mode regression.
- `variant-d-flat-regression` — flat mode regression.

**Don't break the preset list** without updating `docs/plans/2026-05-05-monorepo-smoke-test.md` to match. The smoke driver is the cheapest signal you have that a refactor didn't silently regress an end-to-end path.

## Conventions / do's and don'ts

**Do:**

- DO use `getAppPath`, `shouldRouteToDbPackage`, `getDbBaseDir`, `getDbSrcDir`, and the `hasXPackageEmitted` family for path routing. Don't reinvent.
- DO route cross-field validation through schema refines. Don't add runtime checks that duplicate schema-level rules.
- DO use `replaceAll` (not single-arg `replace`) at every placeholder substitution site. Single-arg `replace` only swaps the first occurrence and bit us during the polish bundle.
- DO add new templates under `src/templates/` and read them via `fs.readFile(path.join(__dirname, 'templates', ...))`. The `postbuild` step copies them into `dist/`.
- DO use POSIX path separators in placeholders and emitted strings — outputs must be stable on Windows hosts.
- DO use `wireAppsWebToWorkspacePackage` for any new `apps/web` → `packages/<x>` workspace wiring.

**Don't:**

- DON'T edit the archived handoff doc (`docs/plans/2026-05-05-monorepo-support-handoff.md`). It's pinned for historical context.
- DON'T introduce new architecture fields without updating the schema (refines included), the integration tests, and at least the relevant smoke preset.
- DON'T silently fall back when a workspace-emitted file is missing — throw with a clear hint message (per the G fix-loop contract).
- DON'T regress the `registerTool` shape — the legacy handler-list approach is gone (post-OoS-1) and re-introducing it loses the per-tool inputSchema validation.
- DON'T commit changes that fail `pnpm lint` (the `prebuild` step runs lint, so build will fail too).

## Plan docs (pointers)

- **`docs/plans/2026-05-05-monorepo-smoke-test.md`** — the manual smoke procedure. Now scoped to install/build/docker after Tier 5a's `pnpm smoke` covers the generation half on every PR.
- **`docs/plans/2026-05-06-recommended-fixes.md`** — the punch list with progress at the top: Tiers 2–6 + OoS-1 + OoS-2 done; Tier 1 (manual install/build/docker run-through) pending; Tier 5b (yarn variant) deferred; Tier 7 explicitly skipped.
- **`docs/plans/2026-05-06-prompts.md`** — operational prompts for fresh sessions.
- **`docs/plans/2026-05-05-monorepo-support-implementation.md`** — original implementation plan (historical reference).
- **`docs/plans/2026-05-05-monorepo-support-design.md`** — original design doc (historical reference).
- **`docs/plans/2026-05-05-monorepo-support-handoff.md`** — ARCHIVED. Read for past decisions; do not edit.

## Current state

- HEAD `3c4044c` (verify with `git log --oneline -1`).
- 230 tests across 18 files. Lint clean. Smoke green for all 5 presets.
- Branch is `feat/upgrade-packages`. Merge to `main` is gated on Tier 1 (manual install/build/docker run-through against the smoke presets).
