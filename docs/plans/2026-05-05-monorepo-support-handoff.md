# Monorepo Support — Session Handoff

> **You are picking up subagent-driven execution of the monorepo support plan.**
>
> Read this doc first, then `docs/plans/2026-05-05-monorepo-support-implementation.md` (the actual plan). The design doc at `docs/plans/2026-05-05-monorepo-support-design.md` has rationale if you need to understand a decision.

## Where we are

| Field | Value |
|-------|-------|
| Branch | `feat/upgrade-packages` |
| Base commit (before any monorepo work) | `d40f4fb` |
| HEAD as of this handoff | `311617a` |
| Tests passing | 117 / 117 (12 files) |
| Tooling | TypeScript, Zod 4, MCP SDK, Vitest 4, pnpm |

## Status by group

| Group | Status | Commits in this group |
|-------|--------|-----------------------|
| A — Schema + helpers (A1–A4) | ✅ done + reviewed | 6 (`9698311`, `26cc702`, `97f6984`, `51c0766`, `1817bad`, `2985b60`) |
| B — Dockerfile templating (B1–B2) | ✅ done + reviewed | 4 (`7f6bc97`, `da2669d`, `8135d35`, plus reviewer fix) |
| C — minimal monorepo scaffold (C1–C3) | ✅ done + reviewed | 3 (`fa7c2f3`, `06d47cf`, `759efc9`) |
| D — full mode `packages/*` (D1–D6) | ✅ done + reviewed | 6 (`3ee8e6d`, `7201b4a`, `c91af0e`, `b89b73a`, `83ed661`, `03cc8c9`) |
| E — `setup_shadcn` new init format (E1) | ✅ done + reviewed | 1 (`311617a`) |
| **F — `setup_database` packages/db routing (F1)** | **TODO — start here** | — |
| G — `setup_authentication` shadcn-registry rewire (G1–G3) | TODO | — |
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
- F (medium): ~150k
- G (3 sub-tasks, complex): ~250k
- H (small): ~80k
- I (small): ~80k

**Total ~560k tokens** for F+G+H+I if you do per-group reviews. Cuts to ~400k if you combine spec + code review for the lighter groups (H, I).

## Deltas to the plan from real execution

- **Group C did 2 commits, not 3** — C1+C2 were combined because the plan's commit step itself stages test+impl together.
- **Group E added two extra correctness fixes** (globals.css path, layout.tsx path) not called out in the plan — they were needed for monorepo correctness. Likely Groups F, G, H need similar audits.
- **Auth gating** — the plan didn't anticipate the `@<projectName>/db` workspace dep coupling. Group D fix `03cc8c9` added the gate. Group G's `setup_authentication` rewire should respect this same invariant.

## Outstanding cleanup (low priority)

- A `probe-tmp.mjs` debug file appeared at the repo root during Group D execution and was deleted in this session. If you see it again, it's a debug artifact — safe to remove.
- The pre-existing TODO block at `src/index.ts:3-9` still mentions "User button from better-auth-ui". Worth tidying after Group G ships, but out of scope for the rewire itself.

## Where to look first when starting Group F

- Read `src/index.ts:setupDatabase` (search for `private async setupDatabase`).
- Note all paths it writes to and which should be `appPath` vs. workspace-root.
- The plan's Group F section is short — re-read it before dispatching the implementer.
- The Prisma-specific `PRISMA_OUTPUT_PATH` and `PRISMA_GENERATED_DIR` constants near the top of the file may need to be path-aware in monorepo:full mode (the schema lives in `packages/db/prisma/`, so the generated client output path changes).
