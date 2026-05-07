# Monorepo Support — Session Handoff (ARCHIVED)

> **🗄️ ARCHIVED — implementation complete (Groups A–J + post-J coverage audit + Group K).**
>
> All shipping work is in `feat/upgrade-packages` and the branch is ready for the smoke run + merge. This document is preserved for engineering archaeology — the **"In-context nuances"** sections per group document why specific decisions were made, the **"Footguns"** section captures codebase-specific traps, and the **"Plan deltas"** section records where execution diverged from the original plan. All of that remains useful to anyone touching this code in the future.
>
> **For current state:**
> - **Follow-ups / known gaps:** `docs/plans/2026-05-06-recommended-fixes.md` (Tier 1–7 punch list)
> - **Smoke procedure:** `docs/plans/2026-05-05-monorepo-smoke-test.md`
> - **Original plan:** `docs/plans/2026-05-05-monorepo-support-implementation.md`
> - **Design rationale:** `docs/plans/2026-05-05-monorepo-support-design.md`
>
> The "How to pick up", "Token budget", "Where to look next", and "Status by group" sections below are historical and no longer load-bearing. Don't update them — the relevant info has moved to the docs above.

## Where we are

| Field | Value |
|-------|-------|
| Branch | `feat/upgrade-packages` |
| Base commit (before any monorepo work) | `d40f4fb` |
| HEAD as of this handoff | `0f97cc5` |
| Tests passing | 176 / 176 (14 files) |
| Tooling | TypeScript, Zod 4, MCP SDK, Vitest 4, pnpm |

## Status by group

| Group | Status | Commits in this group |
|-------|--------|-----------------------|
| A — Schema + helpers (A1–A4) | ✅ done + reviewed | 6 (`9698311`, `26cc702`, `97f6984`, `51c0766`, `1817bad`, `2985b60`) |
| B — Dockerfile templating (B1–B2) | ✅ done + reviewed | 4 (`7f6bc97`, `da2669d`, `8135d35`, plus reviewer fix) |
| C — minimal monorepo scaffold (C1–C3) | ✅ done + reviewed | 3 (`fa7c2f3`, `06d47cf`, `759efc9`) |
| D — full mode `packages/*` (D1–D6) | ✅ done + reviewed | 6 (`3ee8e6d`, `7201b4a`, `c91af0e`, `b89b73a`, `83ed661`, `03cc8c9`) |
| E — `setup_shadcn` new init format (E1) | ✅ done + reviewed | 1 (`311617a`) |
| F — `setup_database` packages/db routing (F1) | ✅ done + reviewed | 3 (`4b4dc24`, `04eee45`, `21e8446`) |
| G — `setup_authentication` shadcn-registry rewire (G1–G3) | ✅ done + reviewed | 2 (`4429663`, `610611b`) |
| H — `generate_dockerfile` monorepo selection (H1) | ✅ done + reviewed (combined review) | 1 (`e82637b`) |
| I — README + validate + AGENTS.md/CLAUDE.md (I1, I2, +extension) | ✅ done + reviewed (combined review) | 3 (`d387336`, `e88ff88`, `1897a03`) |
| J — End-to-end smoke procedure (doc) | ✅ done | 1 (`2af0526`) |
| Coverage-gap fill (post-J audit) | ✅ done + reviewed | 1 (`0f97cc5`) |
| **All groups complete — ready for smoke run + merge** | — | — |

`git log --oneline d40f4fb..HEAD` shows the full commit list.

## How to pick up

1. **Re-create the TaskCreate tasks** for groups F, G, H, I (the existing plan's task structure). One task per group is fine — they were bundled this way for efficiency.
2. **Invoke the skill** `superpowers:subagent-driven-development` (or `superpowers:executing-plans` if you prefer fresh-session mode). Do NOT use plan mode.
3. **For each group**: dispatch implementer → spec reviewer → code-quality reviewer → fix loop if needed. Use the prompt templates from the skill, but pre-fill with the FULL task text from the plan (don't make subagents re-read the plan; paste the relevant section).

## What worked well in groups A–E (do this)

- **Bundle by group, not by task.** I dispatched one implementer per group (A1–A4 in one subagent, D1–D6 in one subagent). The plan's per-task TDD steps were preserved inside each dispatch. This saved roughly 4× the subagent invocations vs. one-per-task and the work is small enough not to risk context overflow inside the subagent.
- **Top-level exported helpers, not class methods**, when the helper is pure and unit-testable (`getAppPath`, `getShadcnRunner`, `substituteCatalog`, etc.). Class methods are reserved for things that legitimately need `this` (the actual MCP tool implementations).
- **Always provide the implementer with**: working dir, branch, base SHA, the FULL task text pasted, scene-setting context about what Groups A–E already added (so they reuse helpers vs. duplicating).
- **Spec reviewer goes BEFORE code quality reviewer.** Spec compliance is "did you build what was asked"; code quality is "is it well-built". Don't dispatch quality review until spec is ✅.
- **For Group E (single-task, low-risk)**, I combined spec + code review into one reviewer invocation. Saved ~30k tokens. Safe for groups with one task and clear scope.

## In-context nuances (not captured in commits)

These are decisions/observations from the conversation that would be hard to recover from code alone. Pay attention to these when reviewing or extending:

### Group A
- **`CATALOG_VERSIONS`** is exported (not module-private) because Group A4 needed it externally and ESLint flagged unused otherwise. Don't refactor it back to private.
- **`PackageManager` type alias** is exported at line ~248 of `src/index.ts`, derived as `NonNullable<ProjectConfig['architecture']['packageManager']>`. Use it on new helpers; don't accept loose `string`.
- **`substituteCatalog`** does a recursive scan after the three known sections (`dependencies`/`devDependencies`/`peerDependencies`) and throws on residual `"catalog:"` strings. This is intentional fail-loud — don't relax it.

### Group B
- **`__COREPACK_SETUP__` for bun = `'true'`** (a POSIX shell no-op), not `''`. Empty would produce invalid `RUN ` Dockerfile syntax. Don't change to `''`.
- **Placeholder substitution sorts keys by length descending** before `replaceAll` to prevent `__PM__` corrupting `__PM_DLX__`. Critical detail.
- **`__PM_PATH_SETUP__` placeholder** templates the `ENV PNPM_HOME=...` lines so they don't leak into npm/yarn/bun builds. Pnpm gets the two ENV lines, others get a `# no extra PATH setup` comment.

### Group C
- **`forceStandaloneOutput` was deleted** — `generateNextJSCustomCode` overwrites `apps/web/next.config.ts` from `next.config.template`, which already contains `output: 'standalone'`. Don't reintroduce a regex-based injector. If a future change needs to inject into an existing config file, do it via AST or just template-overwrite.
- **`buildCreateNextAppCommand(config, appDirName = './<config.name>')`** — the second arg lets monorepo mode pass `./web` and run from cwd `<projectPath>/apps/`. Don't break the default.
- **Per-app file ops use `appPath = getAppPath(config, projectPath)`**. Workspace-root ops (`scaffoldMonorepoRoot`, `installDependencies`) keep `projectPath`. Audit any new path operations for which side they belong on.

### Group D
- **`ORM_PACKAGE_SUBDIR`** Record gates `packages/db` emission on `orm !== 'none'` (in addition to `database !== 'none'`). A user can set `database: 'postgres'` + `orm: 'none'` in the schema; the gate prevents a Prisma fallback being silently emitted.
- **`packages/auth` is gated on `database !== 'none'`** because the auth template hard-codes `@<projectName>/db: workspace:*` as a runtime dep. better-auth requires a database anyway. **Tests must use `database: 'postgres', orm: 'prisma'` (or similar) when testing auth emission** — `database: 'none'` will not emit `packages/auth`.
- **`copyTemplateTree` always calls `substituteProjectName`** (no `.template`-suffix gate) — substitution is a no-op when no placeholder is present, so unconditional invocation is safer than the previous implicit naming contract.

### Group E
- **`buildShadcnInitCommand(packageManager, monorepoMode)`** returns the new format. Use this helper rather than rebuilding the string at call sites.
- **`setup_shadcn` also routes `globals.css` and `layout.tsx` writes through `appPath`**. These weren't called out in the plan but were broken in monorepo mode (`projectPath/src/app/...` doesn't exist when the app is at `apps/web/`). Same pattern likely applies to other tools — audit `setup_authentication`, `setup_database` for similar `projectPath/src/...` paths that should become `appPath/src/...`.
- **When `monorepo === 'full' && uiLibrary === 'shadcn'`**, `setup_shadcn` runs init+add-all twice: once in `apps/web`, once in `packages/ui`.

### Group F
- **Routing helpers (use these; don't recompute):**
  - `shouldRouteToDbPackage(config)` — gate, returns `true` only when `monorepo === 'full' && orm !== 'none'`. Mirrors Group D's `packages/db` emission gate.
  - `getDbBaseDir(config, projectPath)` — `<projectPath>/packages/db` when routing, else `getAppPath(...)`.
  - `getDbSrcDir(config, projectPath)` — `<base>/src` when routing, else `<base>/src/lib/db`.
  - `getPrismaOutputArg(config)` — schema-relative `--output` value, **derived** via `path.posix.relative` from `getDbSrcDir`'s shape so the two helpers can't drift. Returns `'../src/.prisma'` for full+orm, `'../src/lib/db/.prisma'` otherwise. Use `path.posix` for stability on Windows.
- **`prisma init` runs with `cwd = dbBaseDir`** so `prisma/schema.prisma` lands correctly. Don't change this back to `projectPath`.
- **`.env*` files always live at `projectPath`** (workspace root) in monorepo modes — same as before. Group F preserved this; do not move them under `apps/web` or `packages/db`.
- **`wireAppsWebToDbPackage`** (private method on the class):
  - Reads `<projectPath>/packages/db/package.json` to get the canonical `name` (don't recompute via `\`@${config.name}/db\`` — that fallback was deliberately removed because it could drift if Group D's naming convention changes).
  - Throws with a clear "Group D should have emitted it" message if the file is missing — this is an internal invariant violation, not a recoverable error.
  - Adds `dbPkgName: 'workspace:*'` under `apps/web/package.json` `dependencies`, idempotently.
  - Returns the `dbPkgName` so callers (`generateDatabaseInstructions`) can render the correct import string.
- **`rewriteDbImportsInTree(root, dbPkgName)`** (private method) — recursive walk over `apps/web/src` and `apps/web/app` (if present), only `.ts`/`.tsx`, skips `node_modules`/`.next`/`.prisma`/`.turbo`/`dist`/`public`. Regex is anchored on import context (`from|import|require`) so quoted strings inside `console.log("@/lib/db")` are not rewritten. Idempotent. Acceptable collateral: a JSDoc `@example import x from '@/lib/db'` line *will* be rewritten (the regex is text-based, not parser-based) — this was deliberately not fixed; ASTify if it ever becomes a problem.
- **`drizzle.config.ts.template` uses `__SCHEMA_PATH__`** placeholder; `setupDrizzle` substitutes `'./src/schema.ts'` for full mode, `'./src/lib/db/schema.ts'` otherwise. If you add new template fields, follow the same placeholder pattern instead of hardcoding paths.
- **`generateDatabaseInstructions` branches on `shouldRouteToDbPackage`** so the success-message import string and "files created in" line are correct per mode. The function now takes `(config, dbPkgName)` — the second arg is the workspace package name returned by `wireAppsWebToDbPackage`. When `dbPkgName` is `null` (monorepo:none/minimal or orm:none full), it falls back to `'@/lib/db'`.
- **`scaffoldMonorepoRoot` pins `packageManager: 'pnpm@10.18.0'`** (was `'pnpm@10'`). Bumped during F1 because the bare `'pnpm@10'` is rejected by Corepack as invalid semver and `'pnpm@10.0.0'` has a `pnpm dlx` workspace regression. **Don't revert** — the comment captures the reason. Strictly Group C territory but landed in Group F's diff.
- **`PRISMA_GENERATED_DIR = 'src/lib/db/.prisma'`** is now stale for monorepo:full (the actual generated client lives at `packages/db/src/.prisma`). Used in `.dockerignore` at `src/index.ts:1262` — Group H needs to update it.
- **`src/templates/packages/db/prisma/package.json.template`'s `clean` script (`rm -rf .prisma`) is stale**: in full mode the dir is at `src/.prisma` relative to the package, so the script's CWD assumption is wrong. Out of F1's scope; flag for Group D follow-up if needed.

### Group G
- **`setupAuthentication` was previously routing every file via raw `projectPath`** — broken in monorepo:minimal as well as full. Group G's audit fixed this: every app-level path now goes through `getAppPath(config, projectPath)`. Only `.env*` writes still anchor on `projectPath` (workspace root, same as F1). **If you add new tools that drop files into `apps/web`, audit them the same way before shipping.**
- **Routing helpers (mirror F1's pattern):**
  - `shouldRouteToAuthPackage(config)` — gate, returns `true` only when **all four** of: `monorepo === 'full' && auth === 'better-auth' && database !== 'none' && orm !== 'none'`. The `orm !== 'none'` clause was added in the fix-loop because `packages/auth/package.json.template` hard-codes `@<n>/db: workspace:*` — without orm there's no `packages/db` for that dep to resolve to. Don't relax the gate.
  - `getAuthFilePaths(config, projectPath)` — returns `{ serverPath, clientPath, indexPath }`. `indexPath` is `null` outside routed mode (no barrel needed). Use this; don't recompute paths inline.
- **Group D's `packages/auth` emission gate now also requires `orm !== 'none'`** to match `shouldRouteToAuthPackage`. The two gates must agree — if you ever change one, change both. Cross-link comment is at `generateFullModePackages`.
- **`getAdapterConfig` is mode-aware**: when `shouldRouteToDbPackage(config)` is true, the prisma/drizzle adapter import becomes `import { db } from "@<projectName>/db";` (instead of `@/lib/db`) so the auth code routed into `packages/auth/src/server.ts` can still import the db client. The legacy code path (non-full mode) is preserved verbatim. **If you add new auth adapters or change the db package name, update this branch.**
- **`getAuthSchemaCwd` / `getAuthMigrationCwd`**:
  - Schema-gen runs from `packages/auth` in routed mode (so `--config src/server.ts` resolves correctly), else from `appPath`.
  - Migration runs from `getDbBaseDir(config, projectPath)` when `shouldRouteToDbPackage` is true (so `prisma migrate dev` finds the schema F1 emitted at `packages/db/prisma/schema.prisma`), else from `appPath`. **The implementer flagged that real-install behavior couldn't be exercised in tests (skipInstall everywhere), so if a user reports a CLI failure, this is the first place to look.**
- **`auth-route.ts.template` and `auth-ui-provider.tsx.template` use placeholders** (`__AUTH_SERVER_IMPORT__` / `__AUTH_CLIENT_IMPORT__`) that `setupAuthentication` substitutes per mode. Other auth templates have no `@/lib/auth` literals (verified). When adding new auth templates, follow the placeholder pattern; don't hardcode `@/lib/auth` strings.
- **Subpath imports chosen** for `packages/auth`: `@<n>/auth/server` and `@<n>/auth/client`. The `exports` field in `src/templates/packages/auth/package.json.template` declares both subpaths. A barrel `index.ts` re-exports both for in-package consumers. The `apps/web` rewrite walker maps `@/lib/auth-client` → `<authPkgName>/client` and `@/lib/auth` → `<authPkgName>/server`.
- **`rewriteDbImportsInTree` was renamed to `rewriteImportsInTree`** and now takes `mappings: ImportRewriteMapping[]` (each `{ alias, target, preserveSubpath }`). Both db (one mapping) and auth (two mappings) reuse it. The function **sorts mappings by descending alias length internally** — callers don't need to order them. The auth callsite deliberately passes them in wrong order; the existing test then proves the internal sort works (regression guard). Don't "fix" the order at the callsite without removing the regression guard comment.
- **`wireAppsWebToAuthPackage`** mirrors F1's `wireAppsWebToDbPackage` invariant: throws on missing `packages/auth/package.json` (no silent fallback to `\`@${config.name}/auth\``). Returns the resolved `authPkgName: string` so callers can use the canonical name in instruction text and import-rewrite mappings.
- **`NEXT_MCP_RECORD_COMMANDS` env-var hook on `execCommand`** is a test-only short-circuit added to test the shadcn-registry install path without firing real commands. Production never sets it. The implementation is a single `if (process.env.NEXT_MCP_RECORD_COMMANDS)` early-return at the top of `execCommand`. **Don't extend this for non-test purposes** — if you need command capture in production, refactor properly.
- **Test pattern for command-recording**: G2's test uses two MCP clients — a non-recording scaffolder (so `create-next-app` actually runs) plus a recording auth-setup client (so the registry-install commands are captured without firing). See `tests/integration/tools/setup-authentication.test.ts:493-583` for the pattern. Reuse for any future tool whose `execCommand` calls you want to assert.

### Group H
- **`PRISMA_GENERATED_DIR` constant deleted, replaced by `getPrismaGeneratedIgnorePath(config)` helper** (top-level export, near `getPrismaOutputArg`). The helper reuses `shouldRouteToDbPackage` and `getDbSrcDir` so it can't drift from F1's path logic. Returns:
  - `none` → `'src/lib/db/.prisma'` (regression-preserved)
  - `minimal` → `'apps/web/src/lib/db/.prisma'`
  - `full + orm` → `'packages/db/src/.prisma'`
  - `full + orm:none` → falls back to `'apps/web/src/lib/db/.prisma'` (matches Group D's gate)
  - **Uses `path.posix` exclusively** so the path is stable on Windows. Don't switch to `path.join` or you'll produce backslash paths Docker doesn't recognize.
- **`generateDockerfile` template selection**: branches on `config.architecture.monorepo === 'none'`. Flat mode → `Dockerfile`, monorepo (any flavor) → `Dockerfile.monorepo` run through `substituteDockerfilePlaceholders(template, packageManager, config.name!)`. The output is always written to `<projectPath>/Dockerfile`.
- **`docker-compose.yml` adjustments in monorepo mode**: both `prismaCommand` (the inline `npx prisma migrate deploy && node server.js`) AND `prismaVolumes` (the host `./prisma:/app/prisma` mount and `./node_modules/.prisma` cache mount) are skipped. The Next.js standalone build is self-contained — Prisma engines and the generated client are baked in at build-time. Migrations run via the explicit `migrate` service. Combined gate: `if (orm === 'prisma' && !isMonorepo)`. Don't reintroduce the inline command unless you also fix the monorepo container layout.
- **`Dockerfile.migrate` is still emitted** for `orm === 'prisma' && database !== 'none'` regardless of mode, but **the template itself wasn't monorepo-adapted**. In `monorepo:full` mode the schema lives at `packages/db/prisma/schema.prisma`, which the existing `Dockerfile.migrate` won't find by default. **Group I should document this in the README** as: "monorepo Docker users must run `docker compose run --rm migrate` explicitly to apply schema changes; the migrate Dockerfile may need a `--schema` flag added for full-mode projects." A future task can fix the migrate template properly.
- **Don't add explicit `COPY packages/*/package.json` to Dockerfile.monorepo** — the template uses `turbo prune $PACKAGE --docker` in the deps stage, which produces a self-contained `out/json/` and `out/full/` workspace subset. Adding manual COPYs would duplicate work and be wrong if the project's package layout differs.

### Group I
- **`generateReadme` Project Structure section** branches on `architecture.monorepo` and mirrors `generateFullModePackages`'s emission gates inline (`hasDbPackage`, `hasAuthPackage`, etc.). The minor drift risk is acknowledged — if Group D's gates change, both `generateReadme` AND `generateAgentsMd` need synchronized updates. Consider extracting `hasDbPackageEmitted(config)` etc. helpers next to `shouldRouteToDbPackage` if drift becomes a problem.
- **Database Setup `cd packages/db &&` prefix** is applied for BOTH prisma and drizzle in monorepo:full mode (the plan only called out prisma, but drizzle.config.ts also lives in `packages/db` per Group F's `__SCHEMA_PATH__` substitution). Don't revert.
- **Docker migrate caveat** in README appears when `monorepo !== 'none' && orm === 'prisma' && database !== 'none'`. The full-mode-specific `--schema=./packages/db/prisma/schema.prisma` note is nested inside `isFullMonorepo`. Same gate is replicated in AGENTS.md.
- **`validateProject`'s `next.config.ts` check uses `getAppPath`** (so it resolves to `apps/web/next.config.ts` in monorepo modes). `tsconfig.json` and `package.json` checks remain at `projectPath` (workspace root). **Don't switch the latter two** — Group C emits a workspace-level `tsconfig.json` at the root.
- **Build/lint/typecheck all run from `projectPath`** (not from `apps/web`). Trusts Turbo (which Groups A-D set up as the canonical workspace runner via root scripts). The plan suggested `pnpm -r typecheck` etc., but the controller's pragmatic interpretation prevailed: don't switch to `-r` flags, let Turbo handle recursion. Documented in `e88ff88`'s commit message so a future maintainer doesn't reopen the question.
- **Lint and typecheck are best-effort**: the validator reads root `package.json` once and gates on `scripts.lint`, `scripts.typecheck`, `scripts['type-check']`. Missing scripts log a warning rather than fail. Typecheck-vs-type-check fallback (monorepo convention is `typecheck`, flat is `type-check`).
- **AGENTS.md** is generated at `<projectPath>/AGENTS.md` (workspace root, NOT under `apps/web/`). Branches on the same monorepo/orm/auth/ui/rpc gates as the README and the Group D emission gates. Import strings (`@<n>/db`, `@<n>/auth/server`, `@<n>/auth/client`) are computed once at the top of `generateAgentsMd` via `shouldRouteToDbPackage`/`shouldRouteToAuthPackage` — no inline gate recomputation.
- **CLAUDE.md** is a fixed 3-line literal pointing at AGENTS.md. No config-aware branching. `generateClaudeMd(projectPath)` takes only `projectPath` (no config). Don't add config awareness later — the whole point is "single source of truth in AGENTS.md".
- **All three docs are emitted in one `generate_readme` MCP tool call**. The success message lists all three filenames. Idempotent (overwrites on re-run, same as the original README behavior).
- **Group H carry-over**: AGENTS.md's "pitfalls" section documents (a) the monorepo+prisma+docker migrate-service requirement and (b) the `Dockerfile.migrate` schema-path caveat. Same content in the README's Docker section, gated identically.

### Group J
- **Smoke procedure at `docs/plans/2026-05-05-monorepo-smoke-test.md`** (~417 lines). Doc-only deliverable per the plan ("skipped in CI by default"). Covers an everything-on full-mode smoke + 4 companion variants (npm catalog, bun+sqlite+drizzle, minimal, flat regression). Per-tool spot-check checklist pulls assertions from actual implementation (verified against `getPrismaGeneratedIgnorePath`, the migrate service emission, `Dockerfile.monorepo` template, etc.).
- **Procedural concerns flagged in the smoke doc** (file as follow-ups if the team values automation):
  1. No headless drive mechanism for `next-mcp` — Step 3 lists three options (inspector, hypothetical `pnpm start`, manual JSON-RPC). Adding a `pnpm start` + `tools/smoke-call.ts` would make the smoke repeatable without inspector. **Recommended Group K candidate.**
  2. **`Dockerfile.migrate` is still the most likely failure point** in the actual smoke run — it wasn't monorepo-adapted in H, so the migrate service in full-mode docker-compose will fail to find the schema unless the user adds the `--schema` flag. Templating the schema path into `Dockerfile.migrate` is a clean Group K candidate too.
  3. Yarn is not in the smoke matrix — no current yarn user to validate against. Documented; add when needed.

## Footguns specific to this codebase

- **Pre-existing `Server` deprecation warnings** in `src/index.ts` (line numbers shift as the file grows). The MCP SDK marks `Server` deprecated in favor of `McpServer`. **Out of scope for monorepo work.** Ignore the diagnostics.
- **`pnpm test` runs `pretest` → `lint` → `clean` → `build` → vitest**. So lint and tsc errors block tests. Watch for ESLint complaints on unused exports, missing return types (`@typescript-eslint/explicit-function-return-type`), and import ordering.
- **Integration tests for `scaffold_project` use `skipInstall: true`** to avoid the multi-minute cost of running real `pnpm install`. Always pass `skipInstall: true` in new tests. Set `it(..., async () => {...}, 120000)` for the timeout because create-next-app downloads templates.
- **The `description` field in templates** — `<description>` placeholder. If `config.description` is missing, the substitution leaves an empty string. Cosmetic; not blocking.

## Token budget guidance

Based on Groups A–E:

| Group complexity | Implementer tokens | Reviewers tokens | ~Total |
|------------------|-------------------|------------------|--------|
| Single task, low risk (E) | ~50k | ~40k (combined review) | ~90k |
| Medium (A, B) | ~50–80k | ~80–110k | ~150k |
| Heavy with TDD + integration tests (C, D) | ~100k+ | ~80–130k | ~200–250k |

**Final actuals (all groups complete)**:
- ~~F (medium): ~150k~~ — **actual: ~250k** (implementer 130k + spec review 45k + code review 55k + fix-loop implementer 65k; the code-quality reviewer found 2 critical bugs requiring a full re-implementation pass)
- ~~G (3 sub-tasks, complex): ~250k~~ — **actual: ~425k** (implementer 145k + spec review 65k + code review 75k + fix-loop implementer 105k + code-quality re-review 30k; the fix-loop was lighter than F's because no critical bugs, only 1 BLOCKING Important + 3 cheap Importants)
- ~~H (small): ~80k~~ — **actual: ~110k** (implementer 70k + combined spec+code review 40k; **no fix-loop needed** — approved on first review pass thanks to thorough TDD and content assertions). Combined review approach saved ~30k.
- ~~I (small): ~80k~~ — **actual: ~250k** including the user-added AGENTS.md/CLAUDE.md extension (I1+I2 implementer 110k + I-extension implementer 75k + combined review 65k; **no fix-loop needed**). Combined review again proved effective for cohesive scope.
- ~~J (manual): not estimated~~ — **actual: ~50k** (single doc-writer subagent, no review — plan deliverable is the procedure itself). Trivial cost.

**Total spent on F+G+H+I+J: ~1.09M tokens** including reviews, fix-loops, and the AGENTS.md extension. Without fix-loops it would have been ~700k. Most expensive single phase: G's full pipeline at ~425k due to the Group D bug discovery + fix-loop.

**Lessons from F and G:**
- Budget for at least one fix-loop iteration on every medium/complex group. F missed cross-template breakage; G missed an unreachable-combo gate and lacked an exec-path test. Both required a re-implementation pass.
- **Push implementers to add content assertions** (read template output back, check imports/strings/CLI args) in addition to existence checks. Existence-only tests miss behavior bugs.
- **Push implementers to enumerate the full reachable mode-permutation matrix** — for any feature gated on `monorepo × auth × database × orm`, that's up to 24 combos. Most won't need their own test, but the gate logic must produce the right output for every reachable combo. F1 missed `full + ba + db + orm:none`; verify H doesn't have an analogous blind spot for PM × monorepo.

## Deltas to the plan from real execution

- **Group C did 2 commits, not 3** — C1+C2 were combined because the plan's commit step itself stages test+impl together.
- **Group E added two extra correctness fixes** (globals.css path, layout.tsx path) not called out in the plan — they were needed for monorepo correctness. Likely Groups F, G, H need similar audits.
- **Auth gating** — the plan didn't anticipate the `@<projectName>/db` workspace dep coupling. Group D fix `03cc8c9` added the gate. Group G's `setup_authentication` rewire should respect this same invariant.
- **Group F added a 3rd commit (the code-review fix pass)** — `4b4dc24` (impl) + `04eee45` (cleanup of unused param the controller spotted before spec review) + `21e8446` (fixes for 2 critical + 3 important code-review findings). The plan called for a single `feat(db): ...` commit; in practice it took three. Future medium-complexity groups should expect similar.
- **Plan's "rewrite any apps/web files that previously imported `@/lib/db`"** turned out to be a no-op pass for the current call graph (nothing in apps/web imports `@/lib/db` until *after* `setup_database` runs). The rewrite was still implemented as an idempotent contract for future tools. Group G's `setup_authentication` now relies on this — its auth files will import `@<n>/db` directly via the shadcn registry templates, but if `setup_database` runs again later, the rewrite is a safety net.
- **Group G shipped as 2 commits, not 3** — the plan called for one commit per subtask (G1, G2, G3). In practice the cross-cutting audit (path-correctness, mode-aware `getAdapterConfig`, schema/migration cwd, template placeholders) was a precondition for all three subtasks, so they bundled into one feature commit (`4429663`) plus one fix-loop commit (`610611b`). Splitting them would have required temporarily-incoherent intermediate states.
- **Group G discovered a Group D bug** — `packages/auth` was emitting whenever `auth === 'better-auth' && database !== 'none'`, but its `package.json.template` hard-codes `@<n>/db: workspace:*`, and `packages/db` requires `orm !== 'none'`. The combo `full + ba + db + orm:none` was previously an unresolvable workspace dep waiting to happen. G's fix-loop tightened both gates to require `orm !== 'none'`. **If you tweak Group D's `generateFullModePackages` later, keep the gates aligned with `shouldRouteToAuthPackage`.**
- **Group H shipped as 1 commit** (`e82637b`), approved on first review pass. The combined spec+code review approach worked well for a single-task group — saved ~30k tokens vs. separate reviews and didn't miss anything material. Use the same pattern for Group I if it stays small.
- **Group H deferred two issues to Group I**: (a) `Dockerfile.migrate` wasn't monorepo-adapted (the schema path inside the migrate container won't resolve in full mode); (b) the success message doesn't currently flag this. I should surface both to the user via README documentation.
- **Group I shipped as 3 commits** (`d387336`, `e88ff88`, `1897a03`) — the AGENTS.md/CLAUDE.md emission was added mid-implementation as a user-requested extension. All three reviewed in one combined pass and approved without a fix-loop. The `1897a03` extension brought the test count from 158 → 161 (+3 new tests). Resulting test suite: 161/161 across 13 files.
- **Group J shipped as 1 commit** (`2af0526`), pure documentation. No code change, no test impact. The plan called J "manual" — the deliverable is a runnable procedure doc, not an automated test.
- **Final shape — all 10 groups (A through J) complete**. 27 commits total since `d40f4fb`. Test count: 117 → 161 (+44 tests). Branch was ready for the actual smoke run + merge to main.
- **Post-J coverage audit pass** (`0f97cc5`): identified 6 critical + 4 important gaps. Filled the prioritized ones with +15 tests across 5 priority blocks: missing permutations (mongoose × full, drizzle adapter × full, Dockerfile mysql/sqlite × full), cross-tool e2e workflows (full + minimal mode chains), schema rejection (`rpc:orpc` requires `monorepo:full`), `rewriteImportsInTree` unit coverage, and re-run/idempotency observation tests. Test count: 161 → 176 (+15). Required one production change: extracted `rewriteImportsInTree` from a private class method to a top-level exported function so it could be unit-tested without instantiating the server. The class method became a 1-line delegating wrapper. Behavior verified byte-identical by code reviewer. **`ImportRewriteMapping` is now an exported type** — if you change its shape, audit downstream callers.

## Outstanding cleanup (low priority)

- A `probe-tmp.mjs` debug file appeared at the repo root during Group D execution and was deleted in this session. If you see it again, it's a debug artifact — safe to remove.
- The pre-existing TODO block at `src/index.ts:3-9` still mentions "User button from better-auth-ui". Worth tidying after Group G ships, but out of scope for the rewire itself.
- **Reviewer's deferred minors from F1** (all explicitly out of scope at the time, so still untouched):
  - `PRISMA_GENERATED_DIR` 4-line comment block could be a 1-liner (`src/index.ts:~59-62`).
  - The `pnpm@10.18.0` bump was bundled into F1's diff — could be split into its own `chore: pin pnpm to 10.18.0` commit retroactively if you care about clean history (`git rebase -i` territory; not worth it).
  - `rewriteImportsInTree` walks serially — `Promise.all(entries.map(...))` would parallelize. Optional. (Note: `rewriteDbImportsInTree` was renamed to `rewriteImportsInTree` in Group G.)
  - One test name reads "import-rewrite is a no-op" while the others use verb-first phrasing. Cosmetic.
  - Direct-driver dispatcher could use a 1-line "no `packages/db` to route to" comment.
- **Reviewer's deferred minors from Group G** (all explicitly out of scope, still untouched):
  - `String.replace` (single-arg) at the placeholder substitution sites in `setupAuthentication` could become `replaceAll` for defensiveness against future template edits.
  - The barrel `index.ts` for `packages/auth` is written inline as a string literal in `setupAuthentication` rather than from a template. Minor consistency issue with the rest of the auth files.
  - `auth-ui-provider.tsx.template` mixes single and double quotes (single in `'@/components/...'`, double in the substituted `"__AUTH_CLIENT_IMPORT__"`). Pre-existing inconsistency.
  - `wireAppsWebToAuthPackage` and `wireAppsWebToDbPackage` are 90% structural duplicates. If H or I adds a third "wire workspace dep" call (e.g., `@<n>/api`), that's the moment to extract a shared helper. Today only two callers — YAGNI defends keeping them.
  - Step-numbering comments in `setupAuthentication` got slightly out of sync (two "Step 12" comments). Cosmetic.
  - `registryInstallSummary` user-facing text doesn't distinguish which of the two registry-install calls failed when one fails. Logs have it; user-facing message is generic.
- **Reviewer's deferred minors from Group H** (still untouched):
  - `getPrismaGeneratedIgnorePath`'s final `path.posix.relative('.', ...)` call is a no-op since the path already starts with `./`. Cosmetic; output is correct.
  - `generateDockerfile` success message says "Dockerfile.migrate for running Prisma migrations" without caveat. In monorepo mode, the migrate template still hasn't been adapted (schema path won't resolve). Group I now surfaces this in the README; H's success message could be updated to match but isn't load-bearing.
- **Reviewer's deferred minors from Group I** (non-blocking — flagged in the combined review):
  - The `hasDbPackage`/`hasAuthPackage`/etc. predicates are duplicated inline in `generateReadme` and `generateAgentsMd`, and they re-state Group D's emission gates a third time. A `hasDbPackageEmitted(config)` helper next to `shouldRouteToDbPackage` would prevent drift if Group D's gates change. (Listed as Group K candidate above.)
  - `generateAgentsMd`'s pitfalls section recomputes `cd packages/db && ` and `pm === 'npm' ? 'npx' : ...` per ORM branch — these were already declared in `generateReadme` and could be hoisted, but the duplication is local to one function.
  - CLAUDE.md content is inline in `generateClaudeMd` rather than at module scope as a `const`. Single short literal — fine.
  - When `config.description` is provided without trailing punctuation, AGENTS.md's overview reads `<description> Stack: ...` without a period. Cosmetic; left as-is.

## Where to look next — the smoke run + potential Group K

All implementation groups (A-J) are complete. The only remaining work is the **manual end-to-end smoke** documented in `docs/plans/2026-05-05-monorepo-smoke-test.md`. Run it before merging to main; capture findings in the doc's "Findings" section per variant.

### Likely Group K candidates (file as separate tickets if the smoke surfaces issues)

1. **`Dockerfile.migrate` monorepo adaptation** — the migrate-service template still defaults to `prisma/schema.prisma` at workdir root. In monorepo:full mode the schema is at `packages/db/prisma/schema.prisma`, so the migrate service will fail unless the user manually adds `--schema=./packages/db/prisma/schema.prisma`. README + AGENTS.md document the workaround. A clean fix templates the schema path through `Dockerfile.migrate` similar to how `Dockerfile.monorepo` was templatized in Group B. **Most likely failure during the smoke run.**
2. **Headless smoke driver** (`pnpm start` + `tools/smoke-call.ts`) — the smoke procedure currently relies on the MCP inspector or manual JSON-RPC. A small JSON-driven runner would make the smoke repeatable in CI for future changes. ~50 LOC of code + a few tests.
3. **Yarn smoke variant** — yarn isn't currently in the smoke matrix because no validation user exists. Add when needed.
4. **Per-PM workspace recursion in `validateProject`** — if Turbo-delegation through root scripts proves insufficient (e.g., user removes Turbo), fall back to PM-specific `-r` flags. Documented but not implemented.
5. **`hasDbPackageEmitted(config)` etc. helpers** — currently inlined in three places (`generateReadme`, `generateAgentsMd`, Group D's `generateFullModePackages`). Extracting prevents drift if Group D's gates change.
