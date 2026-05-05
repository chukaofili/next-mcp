# Monorepo Support — Session Handoff

> **You are picking up subagent-driven execution of the monorepo support plan.**
>
> Read this doc first, then `docs/plans/2026-05-05-monorepo-support-implementation.md` (the actual plan). The design doc at `docs/plans/2026-05-05-monorepo-support-design.md` has rationale if you need to understand a decision.

## Where we are

| Field | Value |
|-------|-------|
| Branch | `feat/upgrade-packages` |
| Base commit (before any monorepo work) | `d40f4fb` |
| HEAD as of this handoff | `21e8446` |
| Tests passing | 126 / 126 (13 files) |
| Tooling | TypeScript, Zod 4, MCP SDK, Vitest 4, pnpm |

## Status by group

| Group | Status | Commits in this group |
|-------|--------|-----------------------|
| A — Schema + helpers (A1–A4) | ✅ done + reviewed | 6 (`9698311`, `26cc702`, `97f6984`, `51c0766`, `1817bad`, `2985b60`) |
| B — Dockerfile templating (B1–B2) | ✅ done + reviewed | 4 (`7f6bc97`, `da2669d`, `8135d35`, plus reviewer fix) |
| C — minimal monorepo scaffold (C1–C3) | ✅ done + reviewed | 3 (`fa7c2f3`, `06d47cf`, `759efc9`) |
| D — full mode `packages/*` (D1–D6) | ✅ done + reviewed | 6 (`3ee8e6d`, `7201b4a`, `c91af0e`, `b89b73a`, `83ed661`, `03cc8c9`) |
| E — `setup_shadcn` new init format (E1) | ✅ done + reviewed | 1 (`311617a`) |
| F — `setup_database` packages/db routing (F1) | ✅ done; code-quality re-review pending | 3 (`4b4dc24`, `04eee45`, `21e8446`) |
| **G — `setup_authentication` shadcn-registry rewire (G1–G3)** | **TODO — start here** | — |
| H — `generate_dockerfile` monorepo selection (H1) | TODO | — |
| I — README + validate (I1–I2) | TODO | — |
| J — End-to-end smoke | TODO (manual) | — |

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

**Estimated remaining**:
- ~~F (medium): ~150k~~ — **actual: ~250k** (implementer 130k + spec review 45k + code review 55k + fix-loop implementer 65k; the code-quality reviewer found 2 critical bugs requiring a full re-implementation pass)
- G (3 sub-tasks, complex): ~250k
- H (small): ~80k
- I (small): ~80k

**Total ~410k tokens** for G+H+I if you do per-group reviews. Cuts to ~290k if you combine spec + code review for the lighter groups (H, I).

**Lesson from F:** budget for at least one fix-loop iteration on medium-complexity groups. The implementer's first pass missed the cross-template breakage (drizzle config `schema:` path) and the user-facing instruction text in `generateDatabaseInstructions`. Both were behavior bugs that the existence-only tests didn't catch. For G/H, push the implementer to add **content** assertions (read template output back, check it parses/resolves correctly) in addition to existence checks.

## Deltas to the plan from real execution

- **Group C did 2 commits, not 3** — C1+C2 were combined because the plan's commit step itself stages test+impl together.
- **Group E added two extra correctness fixes** (globals.css path, layout.tsx path) not called out in the plan — they were needed for monorepo correctness. Likely Groups F, G, H need similar audits.
- **Auth gating** — the plan didn't anticipate the `@<projectName>/db` workspace dep coupling. Group D fix `03cc8c9` added the gate. Group G's `setup_authentication` rewire should respect this same invariant.
- **Group F added a 3rd commit (the code-review fix pass)** — `4b4dc24` (impl) + `04eee45` (cleanup of unused param the controller spotted before spec review) + `21e8446` (fixes for 2 critical + 3 important code-review findings). The plan called for a single `feat(db): ...` commit; in practice it took three. Future medium-complexity groups should expect similar.
- **Plan's "rewrite any apps/web files that previously imported `@/lib/db`"** turned out to be a no-op pass for the current call graph (nothing in apps/web imports `@/lib/db` until *after* `setup_database` runs). The rewrite was still implemented as an idempotent contract for future tools. Group G's `setup_authentication` now relies on this — its auth files will import `@<n>/db` directly via the shadcn registry templates, but if `setup_database` runs again later, the rewrite is a safety net.

## Outstanding cleanup (low priority)

- A `probe-tmp.mjs` debug file appeared at the repo root during Group D execution and was deleted in this session. If you see it again, it's a debug artifact — safe to remove.
- The pre-existing TODO block at `src/index.ts:3-9` still mentions "User button from better-auth-ui". Worth tidying after Group G ships, but out of scope for the rewire itself.
- **F1 code-quality re-review pending**: the implementer applied all 5 critical/important fixes in `21e8446` and tests are 126/126 green, but the code-quality reviewer hasn't been re-dispatched against the fix commit yet. The skill's review-loop says to re-review until approved. Cheap to do (~30k tokens) — just point a reviewer at `git diff 04eee45..21e8446`. Or skip if you're confident in the fixes; the diff is small and self-contained.
- **Reviewer's deferred minors from F1** (all explicitly out of scope at the time, so still untouched):
  - `PRISMA_GENERATED_DIR` 4-line comment block could be a 1-liner (`src/index.ts:~59-62`).
  - The `pnpm@10.18.0` bump was bundled into F1's diff — could be split into its own `chore: pin pnpm to 10.18.0` commit retroactively if you care about clean history (`git rebase -i` territory; not worth it).
  - `rewriteDbImportsInTree` walks serially — `Promise.all(entries.map(...))` would parallelize. Optional.
  - One test name reads "import-rewrite is a no-op" while the others use verb-first phrasing. Cosmetic.
  - Direct-driver dispatcher could use a 1-line "no `packages/db` to route to" comment.

## Where to look first when starting Group G

- The plan's Group G section (G1, G2, G3) is in `docs/plans/2026-05-05-monorepo-support-implementation.md`. Re-read all three subtasks before dispatching.
- Read `src/index.ts:setupAuthentication` (search for `private async setupAuthentication`). Note every path it writes to and which should be `appPath` vs. `<projectPath>/packages/auth/...`.
- **G1 — remove legacy `@daveyplate/better-auth-ui` install + globals.css import**: the npm dep was already removed from `PACKAGE_VERSIONS` in Group A (commit `26cc702`). Verify via `grep -n "daveyplate" src/index.ts`. The CSS import block to remove is at `src/index.ts:~1885-1892` (line numbers shift — search for `globals.css` in `setupAuthentication`).
- **G2 — install via shadcn registry**: use `getShadcnRunner(packageManager)` (already exported from Group A) — don't rebuild the runner string. The registry URLs are `https://better-auth-ui.com/r/auth.json`, `https://better-auth-ui.com/r/settings.json`, `https://better-auth-ui.com/r/user-button.json`. CWD must be `getAppPath(config, projectPath)` (the registry installs land in `apps/web` even in full mode — `packages/ui` only houses primitives, not auth pages). Skip these execs when `skipInstall` is true.
- **G3 — route auth core into `packages/auth`**: mirror the F1 pattern. Use a helper like `shouldRouteToAuthPackage(config)` (gate on `monorepo === 'full' && auth === 'better-auth' && database !== 'none'` — the database-gate matches Group D's `packages/auth` emission rule, see commit `03cc8c9`). Files: `auth.ts` → `packages/auth/src/server.ts`, `auth-client.ts` → `packages/auth/src/client.ts`, plus an `index.ts` re-exporting both. Add `@<n>/auth: workspace:*` to `apps/web/package.json`. Reuse `rewriteDbImportsInTree`'s walker pattern but parameterized — or factor a shared `rewriteImportsInTree(root, fromSpec, toSpec)` helper.
- **Audit shadcn-registry-installed files**: G2 installs auth pages into `apps/web/src/components/...` (shadcn's default). If `monorepo === 'full' && uiLibrary === 'shadcn'`, primitives live in `packages/ui` — but auth-page components from `better-auth-ui` should stay in `apps/web` because they're route-specific compositions, not reusable primitives. Confirm this with the registry's expected install paths before coding.

### Group F → G handoff invariants (must hold for G to compose correctly)

- `apps/web/package.json` contains `@<n>/db: workspace:*` after `setup_database` (full mode). G's auth code can therefore `import { db } from '@<n>/db'` directly from inside `packages/auth`.
- `wireAppsWebToDbPackage` throws on missing `packages/db/package.json`. G's analogous `wireAppsWebToAuthPackage` should follow the same invariant — no silent fallbacks.
- The shared `rewriteImportsInTree` helper (if extracted) must keep F's anchored regex pattern (`from|import|require`) — don't revert to the broader quoted-string match.
