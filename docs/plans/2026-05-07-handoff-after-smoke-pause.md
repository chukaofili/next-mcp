# Handoff — Smoke Paused for Source-Side Fixes (2026-05-07)

> **Status:** Manual smoke (per [`2026-05-07-monorepo-smoke-test-v2.md`](./2026-05-07-monorepo-smoke-test-v2.md))
> ran the **everything-on full** variant end-to-end through the 7 generation
> tools but is **BLOCKED at §5 typecheck**. ~100 typecheck errors across 7
> categories, plus 6 confirmed tool regressions surfaced during generation.
> Variants A/B/C/D deferred. Source-side fixes required before re-running.
>
> Findings doc (canonical detail): [`2026-05-07-monorepo-smoke-findings.md`](./2026-05-07-monorepo-smoke-findings.md).
> Procedure (still authoritative): [`2026-05-07-monorepo-smoke-test-v2.md`](./2026-05-07-monorepo-smoke-test-v2.md).
> Next-session prompt: [`start-here.md`](./start-here.md).

## 1. TLDR

The everything-on full smoke executed all 7 MCP tool calls (scaffold_project →
setup_database → setup_authentication → setup_shadcn → generate_dockerfile →
generate_readme → validate_project). Each tool was followed by a verify
script that captured on-disk state to a file under `/tmp/next-mcp-smoke/verify/`.

Results:

- **Generation half:** scaffolded artifacts mostly correct after several
  operator-side patches mid-run. See §3.
- **Source-side patches landed mid-run:** orpc template `private: true`, prisma
  client factory shape (`createPrismaClient`), auth server factory shape
  (`createBetterAuth` / `createAuth`), `scripts/generate.ts` helper, root
  `db:auth:generate` script, auth-consumer templates at `templates/web/lib/*`.
  Some of these are committed; some are local-only — confirm with `git status`.
- **§5 typecheck:** 100+ errors across 7 categories; build/docker not attempted.
- **Confirmed tool regressions (6):**
  - **B1 regressed (new root cause)** in `setup_authentication` — auth schema-gen
    can't resolve `@<project>/db` because `dist/` doesn't exist yet at gen time.
  - **B6 hardening regressed** in `setup_authentication` — silent subprocess
    failure returns success-with-warning instead of `isError: true`.
  - **B6 hardening also missing** in `setup_database`'s prisma init subprocess —
    different code path, same problem.
  - **`generate_readme` ignores `config.name`** — generates a fresh random name
    on every call (`considerable-jade-app` → `governing-olive-app` → `decent-magenta-app`).
  - **`generate_readme` ignores `architecture.monorepo`** — produces flat-mode
    README + AGENTS.md regardless of config.
  - **`validate_project` is monorepo-blind** — looks for `next.config.*` at
    workspace root, never at `apps/web/`.
- **~25 other findings** (smaller bugs, design decisions, doc drift). Findings
  doc is the canonical detail.

## 2. Where the session ended

- **next-mcp branch:** `feat/upgrade-packages`. HEAD at session start was
  `d5aae9a`; **operator made source-side changes mid-run** that may or may
  not be committed. Run `git status` and `git log feat/upgrade-packages
  --oneline -10` first thing in the next session.
- **Smoke project:** `/tmp/next-mcp-smoke/smoke-full` — the in-flight scaffold
  with all operator-side patches applied. Treat as read-only reference; do
  NOT continue patching it. Re-scaffold from scratch after source fixes.
- **Verify outputs (read-only logs):** `/tmp/next-mcp-smoke/verify/` —
  `setup-database.txt`, `setup-authentication.txt`, `verify-setup-shadcn.txt`,
  `generate-dockerfile.txt`, `readme-and-validate.txt`,
  `readme-and-validate-rerun.txt`, `workaround-state.txt`, `typecheck.txt`.
  `typecheck.txt` (316 lines) has the canonical Category A–G error wall.
- **MCP server log:** `~/.next-mcp/next-mcp.log` — has tool subprocess output
  for setup_authentication, setup_shadcn, generate_dockerfile. NOT for
  generate_readme or validate_project (observability gap — see findings).

## 3. What passed in the generation half

Items below were verified during the run despite the eventual §5 block.

- **Scaffold_project (Path A, full):** §4.0 universal regression catches all
  PASS — no rogue `apps/web/pnpm-workspace.yaml`, no `apps/web/pnpm-lock.yaml`,
  workspace recognition from `apps/web` enumerates all 8 packages, zero
  `@workspace/...` strings remain (R1 rename pass clean). All 6 packages
  emitted (`db, auth, ui, orpc, eslint-config, typescript-config`). Catalog
  block populated. `apps/web/components.json` cross-workspace `tailwind.css`
  link works. `apps/web/src/{app,components,hooks,lib}` layout (§8.2 option
  (a)).
- **setup_database:** All §4 invariants pass on disk (db package shape, env
  files at workspace root with `DATABASE_URL`, no surviving `@/lib/db` imports
  in apps/web, `@<project>/db` wired into apps/web deps). Prisma generated
  client correctly at `packages/db/src/.prisma/`.
- **setup_authentication:** B3 catch ✅ (all 4 expected better-auth-ui registry
  components on disk + extras). `@<project>/auth` workspace dep wired into
  apps/web. Cross-workspace UI primitive routing works (~30 shadcn primitives
  deposited into `packages/ui/src/components/` from the auth registry).
- **setup_shadcn:** R1 collapse confirmed (single `shadcn add --all` call, no
  init). 55 primitives in `packages/ui/src/components/`, `apps/web/src/components/ui/`
  empty. Toaster auto-injected (but with wrong import path — see Category C).
- **generate_dockerfile:** Strong pass on §4 invariants (multi-stage Dockerfile,
  turbo prune, `pnpm install --frozen-lockfile`, no `__FOO__` placeholders;
  Dockerfile.migrate with correct prisma migrate deploy CMD; docker-compose.yml
  with app/migrate/db services and proper depends_on; `.dockerignore` has
  post-R1 `packages/db/src/.prisma`).

## 4. Source-side fix order (cascade-aware)

Fix in this order. After each group: rebuild `next-mcp` (`pnpm install &&
pnpm build`), re-run the unit/integration suite (`pnpm test`), and re-run the
headless smoke driver (`pnpm run smoke` from inside `next-mcp`) to catch
regressions in the test surface before re-attempting the manual smoke.

### Group 1 — Highest-leverage, blocks the typecheck wall

1. **`apps/web/tsconfig.json`: remove `paths.@<project>/ui/*`** (Category B).
   ~30 TS6307 errors disappear. The `package.json` `exports` map at packages/ui
   already handles resolution natively via pnpm workspace symlinks. The tsconfig
   `paths` mapping is redundant AND counterproductive in monorepo. Keep
   `paths.@/*` for the local `@/*` → `./src/*` mapping.
2. **TypeScript 6 dropped `baseUrl` — remove from emitted tsconfigs**
   (already operator-patched in the in-flight scaffold but template-side fix
   is needed). Likely candidates: `apps/web/tsconfig.json`, `packages/ui/tsconfig.json`,
   and probably the shared `@<project>/typescript-config/{base,nextjs,react-library}.json`
   configs (cleanest fix is at the shared layer).
3. **setup_authentication: install missing peer deps for better-auth-ui registry
   components** (Category A). ~40 TS2307 errors disappear. Add to apps/web deps:
   `@better-auth-ui/core`, `@better-auth-ui/react`, `@tanstack/react-query`,
   `sonner`, `date-fns`, `bowser`. Investigate why `better-auth/react` and
   `better-auth/social-providers` subpath imports fail (pnpm hoisting? package
   exports map?).

After Group 1, ~70 of ~100 typecheck errors should be cleared.

### Group 2 — Path-and-shape fixes

4. **setup_shadcn: Toaster injection uses wrong import path in monorepo**
   (Category C). Currently emits `@/components/ui/sonner` (flat); should emit
   `@<project>/ui/components/sonner` (monorepo). Detect monorepo at injection
   time.
5. **setup_authentication: post-shadcn-add rewrite of `../ui/X` →
   `@<project>/ui/components/X`** (Category D). better-auth-ui registry
   components hardcode flat-mode relative paths in
   `forgot-password.tsx`, `reset-password.tsx`, `sign-up.tsx`. Either
   post-process the emitted files or upstream a monorepo-aware option to
   better-auth-ui.
6. **scaffold_project: emit `apps/web/src/global.d.ts`** with `declare module
   '*.css'` (Category E). Side-effect CSS imports
   (`@<project>/ui/globals.css`) need this to satisfy TS.
7. **setup_authentication: clean up stale `Geist` import in layout.tsx**
   (Category G). TS6133 unused. Probably a stale fragment from an
   AuthProvider wrapping pass — clean it up at injection time.
8. **setup_shadcn: post-add augmentation moves `use-mobile.ts` from
   `apps/web/src/hooks/` to `packages/ui/src/hooks/`**. Sidebar.tsx imports
   from cross-workspace alias and breaks otherwise. Enumerate any other
   shadcn-emitted hooks that need similar relocation.

### Group 3 — Setup-tool regressions

9. **setup_authentication: B1 regression (new root cause).** Auth schema-gen
   subprocess (`pnpm dlx auth@latest generate`) can't resolve `@<project>/db`
   because `packages/db/dist/` doesn't exist. Fix candidates:
   - Run `pnpm --filter @<project>/db build` before invoking the subprocess.
     **Operator already adopted this for the in-flight workaround** —
     productionize it.
   - Switch `packages/db/package.json` `main` to `./src/index.ts` (jiti/tsx
     loaders resolve directly to source). Wider blast radius — affects every
     consumer of `@<project>/db`.
10. **setup_authentication: B6 hardening propagation gap.** Schema-gen
    subprocess failure returns success-with-warning instead of `isError:
    true`. Phase 2 hardening either didn't cover this path or regressed.
    Two fixes: (a) propagate failure to `isError: true`; (b) the response
    template should not start with ✅ when a critical step fell through.
11. **setup_database: B6 hardening also missing for prisma init subprocess.**
    Same shape as #10 but for the prisma init path. ALSO has an ordering bug
    (`pnpm exec prisma` runs before prisma is installed in `packages/db`) —
    fix by either pre-installing or switching to `pnpm dlx prisma init`.
12. **setup_database: align prisma `--output` subprocess arg with
    schema.prisma template.** Subprocess uses legacy `../src/lib/db/.prisma`
    while the on-disk schema uses `../src/.prisma`. Reconcile the two
    divergent code paths.
13. **generate_readme: detect project name from `package.json` at
    `projectPath`** instead of relying on `config.name`. Currently generates
    a fresh random name on every invocation (saw three: `considerable-jade-app`,
    `governing-olive-app`, `decent-magenta-app` — none matched the actual
    `smoke-full` name).
14. **generate_readme: respect `architecture.monorepo='full'`** (or detect
    from disk via `pnpm-workspace.yaml` + `apps/` + `packages/` presence).
    Currently produces flat-mode README + AGENTS.md regardless.
15. **generate_readme: include `docker compose run --rm migrate` reference**
    in README's Docker section. Currently missing.
16. **generate_readme: align with new manual-migrate design.** Replace
    `pnpm exec prisma migrate dev` with `pnpm --filter @<project>/db db:migrate`
    in README and AGENTS.md.
17. **validate_project: detect monorepo and look for `next.config.*` at
    `apps/web/`** in monorepo mode. Currently treats `<projectRoot>` as the
    search root unconditionally.
18. **generate_readme + validate_project: add file-logger entries** so their
    activity surfaces in `~/.next-mcp/next-mcp.log` like the other tools.

### Group 4 — Cross-cutting / pin-policy

19. **R1 catalog pin policy: keep typescript / @typescript-eslint / zod /
    react / tailwindcss bumps in lockstep.** typescript: ^6 forced upgrades
    that left peer deps unmet:
    - `@typescript-eslint/*@8.55.0` declares peer `typescript@">=4.8.4
      <6.0.0"` → six unmet-peer warnings.
    - `packages/ui` indirect deps want `zod@^4.0.0` / `>=4.4.2` (better-call,
      @better-auth-ui/react), `react@>=19.2.5` (have 19.2.4), `tailwindcss@>=4.2.4`
      (have 4.1.18) — all unmet.
    Fix at pin-policy level so all variants benefit.
20. **R1 catalog augmentation: silence `WARN Skip adding X to the default
    catalog because it already exists` noise.** Cosmetic but degrades log
    SNR. Likely fix: pre-check pnpm-workspace.yaml's existing catalog
    entries before re-adding.

### Group 5 — Deferred follow-ups (not blockers)

21. **better-auth-ui upstream: their emitted shadcn registry components fail
    strict TypeScript** (Category F: ~25 TS7006 implicit-any errors). File
    upstream issue. Until fixed, options for the scaffold: relax strict for
    `apps/web/src/components/auth/*`, OR add explicit types in a
    post-add augmentation, OR `// @ts-expect-error` blanket comments
    (worst).
22. **`db:auth:generate` script (operator-added mid-run): per-PM and per-ORM
    adaptation.** Current template is pnpm + prisma only. Need npx / bun x /
    yarn dlx variants and a drizzle equivalent (or gate the script to
    prisma+better-auth combos). Pick TODO in
    `packages/db/prisma/client.ts.template` while at it.
23. **`db:auth:generate` script: validate `--output` is append-safe vs
    overwrite-safe.** Operator perceived overwrite during the run; on-disk
    schema.prisma was healthy by end. If `auth@latest generate --output` is
    actually destructive, the script needs a merge step.
24. **scaffold_project: remove dangling empty directories.** `apps/web/src/lib/db/`
    and `apps/web/src/components/ui/` are scaffold-emitted but never populated
    in monorepo mode. Either skip creating or clean up post-augmentation.
25. **generate_dockerfile: pin pnpm version in Dockerfile + Dockerfile.migrate
    to `packageManager` field instead of `@latest`.** CI reproducibility.
26. **generate_dockerfile: docker-compose.yml `app` service should
    `depends_on.migrate: service_completed_successfully`.** Prevents
    app/migrate race on cold `docker compose up`.
27. **setup_authentication: BETTER_AUTH_SECRET differs across `.env` /
    `.env.example` / `.env.local`.** Cosmetic — `.env` and `.env.local`
    should share a value, `.env.example` should be a placeholder.

## 5. Validation plan after fixes land

1. **Rebuild next-mcp:** `pnpm install && pnpm build`. Lint + tsc clean.
2. **Run unit/integration tests:** `pnpm test`. Test baseline is 20 files /
   302 tests. **Some tests will need updating** to reflect the new prisma
   client factory shape and the corrected validate_project / generate_readme
   monorepo behavior. Don't be surprised if the baseline shifts upward (more
   tests) or some tests need rewriting; the assertions need to be checked
   against the new reality.
3. **Run headless smoke driver:** `pnpm run smoke` from inside `next-mcp`.
   This invokes scaffold_project for all 5 preset configs in ~6s
   (`skipInstall: true`). Catches generation-only regressions.
4. **Refresh shadcn fixtures if shadcn drifted:** `pnpm run refresh-shadcn-fixtures`.
   The integration suite consumes committed fixtures at
   `tests/fixtures/shadcn-{monorepo,flat}-init/` — refresh if shadcn upstream
   emits different files.
5. **Re-run manual everything-on full smoke** per
   [`2026-05-07-monorepo-smoke-test-v2.md`](./2026-05-07-monorepo-smoke-test-v2.md).
   Use a clean `/tmp/next-mcp-smoke/` (delete the in-flight scaffold first).
   No operator-side patches should be needed this time — if any are, that's
   a regression.
6. **If everything-on full passes through §5 + docker compose run --rm migrate
   cleanly**, proceed through Variants A → B → C → D-shadcn → D-non-shadcn.
   Each adds different coverage:
   - **Variant A** (full + npm): catalog substitution path + npm tooling.
   - **Variant B** (full + bun + sqlite + drizzle): bun base image, drizzle
     migrate path (first runtime test), no auth + no shadcn.
   - **Variant C** (minimal + pnpm + uiLibrary:none): minimal-mode scaffold
     shape, no `packages/` directory.
   - **Variant D** (flat — run twice): `monorepo: 'none'` regression baseline,
     once with shadcn (Path A flat) and once without (Path B flat).
7. **After all variants are green, open the merge PR**
   `feat/upgrade-packages` → `main`. Pull from the findings doc's per-variant
   sections for the PR description so reviewers see what was verified.

## 6. Smoke-v2 doc update needed

The smoke-v2 procedure doc has a few assertions that need updating to match
post-fix reality:

- **§4 setup_authentication success message:** currently says "✅ Database
  schema and migrations have been generated and applied automatically!" The
  new design (operator decision: prisma migrate is always manual) replaces
  this with "Schema generated. Run `pnpm --filter @<project>/db db:migrate`
  to apply migrations."
- **§4 setup_shadcn idempotency:** currently says "near-no-op". Reality is
  "idempotent in content, not in file timestamps" — `-o` makes shadcn rewrite
  every file each run.
- **§4 setup_shadcn use-mobile expectation:** currently expects
  `packages/ui/src/hooks/use-mobile.ts`. Confirm after the post-add
  augmentation lands; the spec is fine as-written if the augmentation
  relocates correctly.
- **§4 turbo.json `globalPassThroughEnv`:** spec says R1 augmentation
  populates this; current emission doesn't. Either fix the augmentation OR
  remove from spec (decide source-side).

## 7. Tasks deferred until after source fixes

- Variants A / B / C / D-shadcn / D-non-shadcn — per smoke-v2 §6.
- Merge PR `feat/upgrade-packages` → `main`.

These should be re-created as a fresh task list at the start of the post-fix
smoke continuation session — not carried over from this session.
