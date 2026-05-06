# Recommended Fixes — Post-Monorepo-Support Punch List

> **Status:** Snapshot at HEAD `259eb0b` (branch `feat/upgrade-packages`, 185/185 tests passing across 14 files).
> **Scope:** Everything that's known-untested, known-deferred, or otherwise needs follow-up after Groups A–J + the post-J coverage audit + Group K (Dockerfile.migrate adaptation).
> **How to use:** Each tier below is independently triageable. File individual issues from the items inside; pull from Tier 1+2 when scoping pre-merge work, Tier 3+4 for the next planning cycle.
>
> **Progress:**
>
> - Tier 1 — pending (gated on smoke run; Tier 5a's `pnpm smoke` now runs the generation half on every PR).
> - Tier 2 — ✅ done (commits `4f8f5cf`, `7c95c0e`, `6d061ed`, `7bee294`, plus the post-2c audit follow-ups `f3170a1` and `a60d9b3`).
> - Tier 3 — ✅ done (commits `2e16c93`, `487a417`).
> - Tier 4a — ✅ done (commits `bf2248f`, `9042359`).
> - Tier 4b — ✅ done (extracts shared `wireAppsWebToWorkspacePackage` helper at module scope; both `wireAppsWebToDbPackage` and `wireAppsWebToAuthPackage` delegate to it; G fix-loop "no silent fallback" contract preserved; +6 direct unit tests).
> - Tier 5a — ✅ done (commits `5a692da`, `6ae790e`). `--full` flag (real `<pm> install` + build per preset) still deferred. Tier 5b (yarn variant) deferred per the plan note (add when there's a yarn user to validate against).

---

## Tier 1 — Real-runtime untested (smoke-run targets)

These shipped as templated/coded logic but were never exercised end-to-end. **Every test in the suite passes `skipInstall: true`**, so the entire shell-out and Docker-build surface is unverified. The smoke procedure (`docs/plans/2026-05-05-monorepo-smoke-test.md`) is the first time these run for real. **Treat each as a bug candidate until proven otherwise.**

| Item                                                                                            | Untested behavior                                                           | Failure mode                                                                                                | First-look files                                                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm install` of generated full-mode workspace                                                 | Workspace dep resolution (`@<n>/db: workspace:*`, `@<n>/auth: workspace:*`) | Missing `pnpm-workspace.yaml` glob, wrong `name` in a `packages/*/package.json`, catalog-substitution drift | `src/index.ts:scaffoldMonorepoRoot`, `src/templates/packages/*/package.json.template`    |
| `turbo build` against generated `turbo.json`                                                    | Task wiring (build/lint/typecheck/test)                                     | Missing `tasks` entries; a workspace's script not surfaced via Turbo                                        | `src/templates/turbo.json.template`, root `package.json.template`                        |
| `docker build .` against `Dockerfile.monorepo` × 4 PMs                                          | Multi-stage build with turbo-prune                                          | Wrong `COPY` path in deps stage, missing lockfile, base-image mismatch                                      | `src/templates/docker/Dockerfile.monorepo`, `substituteDockerfilePlaceholders`           |
| `docker compose run --rm migrate` × 4 PMs × 3 monorepo modes                                    | Group K's new templated `Dockerfile.migrate`                                | `COPY . .` filtering via `.dockerignore`; `__PM_DLX__` resolution inside `sh -c`; schema path substitution  | `src/templates/docker/Dockerfile.migrate`, `substituteMigrateDockerfilePlaceholders`     |
| better-auth CLI schema-gen with cwd = `packages/auth`, `--config src/server.ts`                 | Group G's chosen cwd                                                        | CLI may not write the schema fragment to the right location; may need `--output` or post-processing         | `src/index.ts:getAuthSchemaCwd`, `getAuthSchemaCommand`                                  |
| Drizzle CLI (`generate`/`push`/`migrate`) with cwd = `packages/db`, schema at `./src/schema.ts` | Group F's chosen cwd + `__SCHEMA_PATH__` substitution                       | drizzle-kit may not find the schema; migrations dir path                                                    | `src/index.ts:setupDrizzle`, `src/templates/database/drizzle/drizzle.config.ts.template` |

**Action:** run the smoke procedure; populate the "Findings" section in `docs/plans/2026-05-05-monorepo-smoke-test.md`; file any failures from this tier as new issues.

---

## Tier 2 — Tools not yet audited for monorepo correctness

Production code paths that **may** still use bare `projectPath` instead of `getAppPath`/the routing helpers. None of these blocked any group's reviews because nobody traced them, but they're plausibly broken.

### 2a. `generate_base_components`

- **Coverage today:** 3 tests in `tests/integration/tools/generate-base-components.test.ts`, **zero monorepo coverage**.
- **Risk:** if the tool writes to `<projectPath>/src/components/...` directly (rather than `getAppPath(config, projectPath)/src/components`), it's broken in monorepo:minimal and full mode.
- **Audit shape:** open `src/index.ts:generateBaseComponents` (search for the method), grep its body for `path.join(projectPath` — every match should be either `.env*` or workspace-root concern. App-level paths must go through `getAppPath`.
- **Effort:** ~30 min audit + 1 fix commit if needed + 2-3 monorepo tests.

### 2b. `setup_shadcn` × full × dual-init

- **Behavior:** when `monorepo === 'full' && uiLibrary === 'shadcn'`, `setup_shadcn` should run `shadcn init` in **both** `apps/web` AND `packages/ui` (per Group E's design).
- **Test coverage:** existing tests verify `packages/ui/components.json` ends up emitted (via `scaffold_project`), but **no test asserts the dual-init actually fires both `execCommand` calls** with correct cwds.
- **Risk:** if the dispatch logic in `setupShadcn` accidentally short-circuits, only one init runs. Tests pass but real users get a half-configured `packages/ui`.
- **Test pattern:** reuse the `NEXT_MCP_RECORD_COMMANDS` env-var hook from G2 to capture both `shadcn init` invocations and assert their cwds.
- **Effort:** ~1 test, low risk.

### 2c. `turbo.json` task configuration

- **Behavior:** root scripts (`<pm> build`, `<pm> lint`, etc.) delegate to Turbo. Turbo needs matching `tasks` entries in `turbo.json`.
- **Test coverage:** none — the template is just emitted as-is, no assertion that its content is correct for the workspace structure.
- **Risk:** if a future change adds a new package without a corresponding `turbo.json` task, root scripts silently skip it. Validate-project would not catch this.
- **Audit:** read `src/templates/turbo.json.template`; confirm tasks for `build`, `lint`, `typecheck`, `test`, and that `dependsOn`/`outputs` are correct for each.
- **Effort:** ~30 min audit + parameterized test asserting the template's parsed JSON shape.

---

## Tier 3 — Cross-field schema constraints

Currently only `rpc: 'orpc'` requires `monorepo: 'full'` at schema-parse time. Other illegal combos error at runtime in setup tools. Promoting them to schema-level refines makes errors land earlier and clearer:

- **`auth: 'better-auth' + database: 'none'`** — currently throws inside `setupAuthentication` ("Better Auth requires a database. Please select a database option."). Schema refine would catch this at config-parse.
- **`orm: 'mongoose' + database: !== 'mongodb'`** — currently caught inside `setupDatabase`'s `validCombinations` table. Could move to schema.
- **`orm: 'drizzle' + database: 'mongodb'`** — also runtime-checked.
- **`uiLibrary: 'shadcn' + monorepo: 'minimal'`** — _probably_ fine, but worth verifying that the shadcn init actually works in minimal mode. If it doesn't, gate it.

**Effort:** ~1 hour to write the refines + tests + update error messages. Nice ergonomic win, no runtime behavior change.

**Reference:** `src/index.ts:ProjectConfigSchema` (search for the existing `.refine(` call for the rpc/monorepo gate).

---

## Tier 4 — Helper extractions (anti-drift)

Same boolean expression repeated in 3 places means a single missed update creates silent inconsistency. Listed in the handoff doc; non-blocking but should happen before the next monorepo-touching feature.

### 4a. Package-emission gate helpers

Extract these next to `shouldRouteToDbPackage`:

```ts
export function hasDbPackageEmitted(config: ProjectConfig): boolean {
  return (
    config.architecture.monorepo === 'full' &&
    config.architecture.database !== 'none' &&
    config.architecture.orm !== 'none'
  );
}
export function hasAuthPackageEmitted(config: ProjectConfig): boolean {
  return hasDbPackageEmitted(config) && config.architecture.auth === 'better-auth';
}
export function hasUiPackageEmitted(config: ProjectConfig): boolean {
  return config.architecture.monorepo === 'full' && config.architecture.uiLibrary === 'shadcn';
}
export function hasOrpcPackageEmitted(config: ProjectConfig): boolean {
  return config.architecture.monorepo === 'full' && config.architecture.rpc === 'orpc';
}
```

Then replace the inline expressions in:

- `src/index.ts:generateFullModePackages` (Group D)
- `src/index.ts:generateReadme` Project Structure section
- `src/index.ts:generateAgentsMd` package layout section

**Effort:** small refactor; existing tests cover the behavior. Add unit tests for each helper.

### 4b. `wireAppsWebToWorkspacePackage` extraction — ✅ done

`wireAppsWebToDbPackage` and `wireAppsWebToAuthPackage` were 90% structural duplicates (resolve canonical name from `packages/<dir>/package.json`, throw on missing, add `<name>: 'workspace:*'` to `apps/web/package.json`, return resolved name). YAGNI originally defended keeping them while there were only two callers; the user opted to extract now anyway since a third caller (`@<n>/api` for future Group H+ work) is plausible.

The shared logic lives at module scope (`wireAppsWebToWorkspacePackage` in `src/index.ts`, next to the other exported scaffolding helpers like `getAppPath` / `shouldRouteToDbPackage`). Both class methods now call into it and keep their own per-caller import-rewrite work.

**Contract preserved:** the G fix-loop's "no silent fallback" guarantee carried forward unchanged — a missing `packages/<dir>/package.json`, an unparsable file, or a missing/empty `name` field all throw with the helper name, the package dir, and a caller-specific actionable hint. No fallback to a hand-derived name. Direct unit tests in `tests/unit/wire-apps-web-to-workspace-package.test.ts` lock in happy-path, idempotency, and every throw path.

---

## Tier 5 — Tooling for repeatable smoke

### 5a. Headless smoke driver

Currently `docs/plans/2026-05-05-monorepo-smoke-test.md` step 3 lists three driving options: MCP inspector (interactive), hypothetical `pnpm start`, manual JSON-RPC. None are CI-friendly.

**Proposal:** add `pnpm start` script + `tools/smoke-call.ts` (~50 LOC) that issues the JSON-RPC sequence over stdio for a given config preset. CI runs it on every PR with `--skipInstall` to verify generation, occasionally with `--full` for the actual install/build/docker-build.

**Effort:** ~half-day. Code + 2-3 tests + CI workflow integration.

### 5b. Yarn smoke variant

Smoke matrix today covers pnpm, npm, bun. Yarn excluded because there's no validation user. Add when needed; the `substituteDockerfilePlaceholders` and `substituteCatalog` helpers already support yarn — only the smoke procedure documents the gap.

---

## Tier 6 — Deferred reviewer minors (cosmetic / low-value)

All flagged during F/G/H/I/K reviews and explicitly deferred. None blocking. Group together as a "polish pass" if motivated.

### From F1

- `rewriteImportsInTree` walks serially; `Promise.all(entries.map(...))` would parallelize. Optional perf.
- `pnpm@10.18.0` pin bundled into F1's diff (could split retroactively; not worth the rebase).
- One test name reads `import-rewrite is a no-op` while peers use verb-first phrasing. Cosmetic.

### From G

- `String.replace` (single-arg) at placeholder substitution sites → `replaceAll` for defensiveness against future template edits with multiple occurrences.
- Barrel `index.ts` for `packages/auth` written inline as a string literal in `setupAuthentication`; could templatize for parity with the other auth files.
- `src/templates/auth/auth-ui-provider.tsx.template` mixes single and double quotes (pre-existing). `auth-route.ts.template` is single-quote consistent.
- `setupAuthentication`'s step-numbering comments have two "Step 12" comments after Group G's diff.
- `registryInstallSummary` user-facing text doesn't distinguish which of the two registry-install calls failed when one fails; logs have it.

### From H

- `getPrismaGeneratedIgnorePath`'s `path.posix.relative('.', ...)` is a no-op (cosmetic — output is correct).

### From I

- `generateAgentsMd`'s pitfalls section recomputes `cd packages/db && ` and `pm === 'npm' ? 'npx' : ...` per ORM branch; could hoist.
- CLAUDE.md content is inline in `generateClaudeMd` rather than a module-scope `const`. Single short literal — fine either way.
- When `config.description` is provided without trailing punctuation, AGENTS.md overview reads `<description> Stack: ...` without a period.

### From K

- `Dockerfile.migrate`'s `pnpm-workspace.yaml*` glob is dead code in flat mode (legacy artifact, harmless).
- `COPY . .` in monorepo mode bloats migrate-image build context if user has stale `.next/` or `node_modules/` (not a correctness issue, build perf only). Also confirm that the `.dockerignore` properly excludes those in the generated monorepo (it should, but worth verifying).

---

## Tier 7 — Documentation edge cases

- **AGENTS.md is regenerated, not synced.** If a user adds their own packages or restructures, AGENTS.md won't auto-update on subsequent `generate_readme` calls (it'd overwrite, but the user has to re-run the tool). Documented as a maintenance note in the generated file's footer; no CI/pre-commit hook to catch drift.
- **README + AGENTS.md content duplication** — same package list rendered twice with slightly different wording. Tier 4a's helper extraction reduces the drift surface but doesn't unify the rendering.
- **`rewriteImportsInTree` is text-based, not parser-based.** JSDoc `@example import x from '...'` lines get rewritten too. Acknowledged in the function's own docstring; would need an AST-based approach to fix properly.

---

## Recommended sequencing

1. **Run the smoke** (`docs/plans/2026-05-05-monorepo-smoke-test.md`). File any Tier 1 failures as bugs immediately. **This is the gating step before merging the monorepo branch to `main`.**
2. **Audit Tier 2** (especially `generate_base_components` and `setup_shadcn` dual-init) — small, finite work that fits in one focused session.
3. **Tier 3 schema refines** — clean ergonomic win, no behavior change. Good "polish before merge" candidate.
4. **Tier 4 extractions** — do before the next big monorepo-touching feature so the new feature can use the helpers.
5. **Tier 5 (smoke driver)** — when CI signal becomes valuable enough.
6. **Tier 6 minors** — opportunistic polish pass, e.g., before a major version bump.
7. **Tier 7** — accept-as-is unless they cause real friction.

---

## Out of scope for this list

- Pre-existing `Server` deprecation warnings in `src/index.ts:3-9` (MCP SDK migration to `McpServer`) — orthogonal to monorepo work, but called out in CLAUDE.md and the original handoff doc as a future migration. File separately if/when prioritized.
- `Dockerfile.migrate`'s reliance on `prisma migrate deploy` — works for prisma but the file isn't useful for drizzle/mongoose. The current gate (`orm === 'prisma' && database !== 'none'`) only emits it in the prisma case, which is correct, but a future Drizzle-equivalent would need its own template.
