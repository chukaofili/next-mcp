# Monorepo Support — End-to-End Smoke Test v2

> **Status (2026-05-07): R1 + Phases 5/6 shipped on `feat/upgrade-packages`.**
> R1 commits `755bd3a..eda5d71` + docs banner `90f47ad`; Phase 5
> (test-suite fixture bypass) `77e8dac`; Phase 6 (smoke driver R1
> rename invariant) `12a5090`. Path A (shadcn-led) is now the
> codebase's actual flow when `uiLibrary === 'shadcn'`. Path B
> (non-shadcn fallback) keeps its v1 shape with the B5 cleanup applied.
> The smoke driver (`pnpm run smoke`) and the integration suite both
> exercise this; the manual procedure below stays the canonical
> install/build/docker validation path.
>
> **Decisions landed (no longer conditional):** §8.1 rename pass
> behavior (verified empirically — `--name` does not rewrite the
> `@workspace/` scope), §8.2 layout (option (a) — `apps/web/src/`),
> §8.3 version-pin policy (option (b) — post-scaffold pin-bump),
> §8.4 minimal mode (option (a) — shadcn full skeleton minus
> per-feature packages). §8.5 (shadcn version pinning) is the only
> design-doc §8 question still open; the smoke matrix tracks shadcn
> drift in lieu of a hard pin. See the design doc's §8 inline notes
> for full rationale.
>
> Run this by hand before merging `feat/upgrade-packages` into `main`.
> CI does not execute this — it requires a Docker daemon, network
> access for the shadcn registry plus the `better-auth-ui` registry,
> and several minutes of `pnpm install` + `docker build` time per
> variant. The headless smoke driver (`pnpm run smoke`) covers the
> generation half (skipInstall: true) on every PR; this manual
> procedure is the install/build/docker pass it cannot run headlessly.
>
> **Companion docs:**
> - v1 procedure (pre-R1) lives at
>   [`2026-05-05-monorepo-smoke-test.md`](./2026-05-05-monorepo-smoke-test.md).
>   Kept for audit trail. Findings from the 2026-05-07 v1 run are the
>   source data for this v2 rewrite — see appendix A for what changed.
> - Implementation plan and design decisions:
>   [`2026-05-07-monorepo-shadcn-refactor-design.md`](./2026-05-07-monorepo-shadcn-refactor-design.md).
> - Out-of-scope follow-ups (yarn variant, `--full` smoke driver flag):
>   [`2026-05-06-recommended-fixes.md`](./2026-05-06-recommended-fixes.md).

## 1. Purpose

This smoke test exercises the post-R1 `next-mcp` tool surface against
a real filesystem and a real Docker daemon. It validates two
substantively different scaffold paths that R1 introduces:

- **Path A — shadcn-led scaffold** (when `uiLibrary === 'shadcn'`):
  `scaffold_project` delegates to `pnpm dlx shadcn@<pinned> init` with
  `--monorepo` (full/minimal) or `--no-monorepo` (flat), then augments
  the result with project-scoped rename, catalog block, version-pin
  alignment, `.env*` files, docker scripts, and the conditional db /
  auth / orpc packages.
- **Path B — fallback scaffold** (when `uiLibrary !== 'shadcn'`):
  existing `create-next-app + scaffoldMonorepoRoot +
  generateFullModePackages` flow, *with the B5 fix* — i.e. the rogue
  `apps/web/pnpm-workspace.yaml` and `apps/web/pnpm-lock.yaml` from
  `create-next-app --use-pnpm` are deleted before any downstream tool
  runs.

The integration suite (`tests/integration/tools/*`, refreshed in R1
Phase 5) covers each tool in isolation with `skipInstall: true` and
stubbed shells. Generation-only assertions (file existence, JSON shape,
substituted placeholders) live there. **This smoke is the runtime
test** of:

- the shadcn-led scaffold actually building under turbo + standalone +
  Docker
- the augmentation passes (project-scope rename, catalog substitution
  for non-pnpm, pin alignment, `apps/web/src/` layout fixup via
  `moveAppsWebFlatToSrc`) producing a coherent workspace
- the better-auth CLI working against the new schema cwd
- the templated `Dockerfile.migrate` (Group K + OoS-2) actually building
  and `docker compose run --rm migrate` succeeding for each monorepo
  mode × package manager × ORM combo
- **B1, B2, B3, B5 staying fixed** — explicit invariants in §4 below
  catch regressions

Run this **after R1 has landed and the integration suite is green**
and before opening the merge PR. If anything fails, capture it in the
Findings section at the bottom and file follow-up tickets.

## 2. Prerequisites

- pnpm `10.18+` (matches the workspace's pinned `packageManager` —
  R1's pin-alignment augmentation preserves this; see design doc §8.3).
- Node 24+ (matches `engines.node` per pin policy).
- Docker daemon running (Colima, Docker Desktop, OrbStack — any will
  do) — needed for the `docker build .` step.
- Network access to the npm registry, GitHub, and these shadcn-related
  endpoints:
  - `https://ui.shadcn.com/r/...` and the shadcn CLI distribution
    (used by `scaffold_project`'s `shadcn init` invocation)
  - `https://better-auth-ui.com/r/auth.json`,
    `https://better-auth-ui.com/r/settings.json`,
    `https://better-auth-ui.com/r/user-button.json` (used by
    `setup_authentication`)
- Roughly 5–10 minutes per smoke variant. The R1-introduced shadcn
  init front-loads more work into `scaffold_project` than v1, so
  expect step (3) below to take longer per variant; it pays for itself
  by simplifying `setup_shadcn`.

## 3. The full-mode "everything-on" smoke

The reference smoke. Walk through this top-to-bottom; the companion
variants in §6 are abbreviated forms of this same procedure.

```sh
# 1. Build the MCP server from source
cd ~/projects/chukaofili/next-mcp
pnpm install && pnpm build

# 2. Smoke directory (cleaned each run so prior state cannot mask bugs)
rm -rf /tmp/next-mcp-smoke && mkdir -p /tmp/next-mcp-smoke
cd /tmp/next-mcp-smoke

# 3. Drive the MCP server. Pick ONE of:
#
#    Option A: pnpm smoke (headless driver — generation-only signal)
#             For all five preset configs end-to-end in ~6s with
#             skipInstall: true. CI runs this on every PR. Useful for
#             a smoke gate before doing the manual install/build/docker
#             pass below.
pnpm run smoke              # all five presets
pnpm run smoke variant-a-full-npm   # one preset
#
#    Option B: MCP inspector (interactive, recommended for the
#             install/build/docker pass)
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
#
#    NOTE — what's different vs v1: scaffold_project now does much
#    more work. With uiLibrary === 'shadcn' && monorepo !== 'none', it
#    delegates to `shadcn init --monorepo --name smoke-full --cwd
#    /tmp/next-mcp-smoke/smoke-full`, then runs ~10 augmentation
#    passes. Expect this single tool call to take 60–120s.

# 5. After scaffold returns success, call (in this order):
#
#    setup_database         { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    setup_authentication   { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    setup_shadcn           { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    generate_dockerfile    { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    generate_readme        { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#    validate_project       { config: <same>, projectPath: "/tmp/next-mcp-smoke/smoke-full" }
#
#    NOTE — what's different vs v1: setup_shadcn collapses to a
#    single `shadcn add --all -y -o` invocation against the
#    already-initialized workspace. It no longer runs `shadcn init` —
#    that happened in scaffold_project. Expect setup_shadcn's runtime
#    to drop dramatically vs v1.

# 6. Inspect the result
cd /tmp/next-mcp-smoke/smoke-full
ls -la
ls -la apps/web packages

# 7. Build steps (see §5 for what to watch for)
pnpm install        # should be a near-no-op — scaffold_project already installed
pnpm typecheck      # root delegates to turbo run typecheck
pnpm build          # turbo build across workspaces
docker build .      # uses the generated monorepo Dockerfile
docker compose run --rm migrate
```

## 4. Per-tool spot-check checklist

After each tool call, verify the assertions below before moving on. A
failure here is a blocker — stop, capture it, and file a follow-up.

### 4.0 Universal regression catches (run after `scaffold_project`, before any other tool)

These guard against the v1-era bugs B1/B2/B3/B5. Failures here are
**critical regressions** of the R1 work.

**Note:** as of commit `12a5090`, the third check (no surviving
`@workspace/` substrings) is enforced programmatically by
`tools/smoke.ts` — `R1_RENAME_INVARIANT` is applied to
`full-everything-on`, `variant-a-full-npm`, and
`variant-d-flat-regression`. CI catches it on every PR. The
shell-grep equivalent below is kept here so a manual smoke run can
verify it directly without depending on the headless driver.

```sh
cd /tmp/next-mcp-smoke/smoke-full

# B5 regression catch — apps/web MUST NOT have its own pnpm-workspace.yaml
# or pnpm-lock.yaml (these are create-next-app leftovers in v1's
# fallback path; in R1's shadcn path they never get created in the
# first place; in R1's non-shadcn path they're explicitly deleted).
test ! -e apps/web/pnpm-workspace.yaml  || { echo "B5 REGRESSION: apps/web/pnpm-workspace.yaml exists"; exit 1; }
test ! -e apps/web/pnpm-lock.yaml       || { echo "B5 REGRESSION: apps/web/pnpm-lock.yaml exists"; exit 1; }

# Workspace recognition — pnpm m ls from inside apps/web MUST
# enumerate all workspace projects (8 in everything-on full). In v1
# this returned only the apps/web project itself due to B5.
( cd apps/web && pnpm m ls --depth=-1 | grep -q '@smoke-full/ui' ) \
  || { echo "B5 REGRESSION: pnpm from apps/web cannot see workspace deps"; exit 1; }

# Project-scope rename — there must be ZERO `@workspace/...` strings
# left over from the shadcn scaffold. R1's augmentation pass renames
# everything to `@<projectName>/...`. (Path A only — skip this for
# Path B / non-shadcn variants.)
! grep -r --include='*.json' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  '@workspace/' . 2>/dev/null \
  || { echo "R1 RENAME REGRESSION: @workspace/ strings remain"; exit 1; }
```

### `scaffold_project` (full + shadcn — Path A)

Tool runtime is significantly longer than v1 because shadcn init runs
inside it. Expect 60–120s on a warm cache.

**Workspace root invariants** (from shadcn init, augmented by R1):

- `apps/web/`, `packages/ui/`, `packages/eslint-config/`,
  `packages/typescript-config/` all exist (shadcn always emits these
  under `--monorepo`).
- `packages/db/`, `packages/auth/`, `packages/orpc/` exist (the R1
  augmentation pass adds these per the everything-on combo gates).
- Root `package.json`:
  - `name === "smoke-full"`.
  - `packageManager === "pnpm@10.18.0"` (R1 pin-alignment augmentation
    overwrites shadcn's default `pnpm@9.15.9` per design doc §8.3).
  - `engines.node === ">=24"`, `engines.pnpm === ">=10"`.
  - `devDependencies` contains `@smoke-full/eslint-config: workspace:*`
    and `@smoke-full/typescript-config: workspace:*` (rename from
    `@workspace/...`), `turbo`, `typescript`, `prettier`,
    `prettier-plugin-tailwindcss`.
  - `scripts` contains the standard turbo passes (`build`, `dev`,
    `lint`, `typecheck`, `format`) AND the docker scripts (`docker:build`,
    `docker:run`, `docker:dev:up`, `docker:dev:down`).
  - When `testing === 'none'` (not this variant): no `test`/`test:watch`
    scripts.
  - Conditional: when better-auth + drizzle, `auth:generate` script
    present and `dotenv-cli` in devDependencies. (Not this variant —
    we're prisma.)
- `pnpm-workspace.yaml`:
  - `packages: ["apps/*", "packages/*"]`.
  - **Catalog block present** (R1 augmentation appends it; shadcn's
    scaffold doesn't include catalogs). Catalog declares
    `@types/node`, `eslint`, `typescript`, `vitest`, `dotenv`,
    `better-auth`, `@better-auth/api-key`.
- `turbo.json` with the standard task graph; `globalPassThroughEnv`
  populated from config.
- Root `tsconfig.json` exists.
- `.gitignore` and `.env.example` exist at workspace root.
- **No** `pnpm-lock.yaml` at apps/web (per §4.0 above).

**`apps/web/` invariants:**

- **Layout (§8.2 landed option (a) — `src/`):** files emitted under
  `apps/web/src/{app,components,hooks,lib}/...` after
  `moveAppsWebFlatToSrc` runs. Empty subdirs (`components/`, `hooks/`,
  `lib/`) carry `.gitkeep`. `apps/web/components/theme-provider.tsx`
  also moves under `src/`. Workspace-root configs stay flat:
  `apps/web/components.json`, `apps/web/eslint.config.js`,
  `apps/web/postcss.config.mjs`, `apps/web/next.config.mjs` (or
  `.ts`). `apps/web/tsconfig.json` `paths.@/*` is `["./src/*"]` and
  `apps/web/components.json` `tailwind.css` resolves to
  `../../packages/ui/src/styles/globals.css` (one extra level up
  vs flat).
- `apps/web/package.json`:
  - `name === "@smoke-full/web"`. `--name` does NOT rewrite the
    `@workspace/` scope (verified empirically — see spike-results
    §8.1 / design doc §8.1); the rename pass is what changes
    `@workspace/web` → `@smoke-full/web`.
  - `dependencies` contains `@smoke-full/ui: workspace:*`,
    `@smoke-full/db: workspace:*`, `@smoke-full/auth: workspace:*`,
    `@smoke-full/orpc: workspace:*`.
- `apps/web/components.json` (shadcn-emitted, R1-rename-augmented):
  - `aliases.ui === "@smoke-full/ui/components"`,
    `aliases.utils === "@smoke-full/ui/lib/utils"` (cross-workspace).
  - `aliases.components`, `aliases.hooks`, `aliases.lib` are local
    (`@/components`, `@/hooks`, `@/lib` — or `#components` etc. if
    the package.json#imports approach is used; check whichever shadcn
    emits).
  - `tailwind.css === "../../packages/ui/src/styles/globals.css"`.
    **This is the cross-workspace design-system link v1 didn't
    achieve.**
- `apps/web/tsconfig.json`:
  - `extends` includes `@smoke-full/typescript-config/nextjs.json`.
  - `paths` includes both the local `@/*` mapping (post-`src/` move
    points at `./src/*`) and `@smoke-full/ui/*` pointing at
    `../../packages/ui/src/*`.

**`packages/ui/` invariants** (shadcn-emitted, R1-rename-augmented):

- `packages/ui/package.json`:
  - `name === "@smoke-full/ui"`.
  - `exports` map covers `./globals.css`, `./postcss.config`,
    `./lib/*`, `./components/*`, `./hooks/*`.
  - All shadcn deps pre-installed: `clsx`, `tailwind-merge`,
    `tw-animate-css`, `class-variance-authority`, `radix-ui`,
    `lucide-react`, `next-themes`, `tailwindcss`, `@tailwindcss/postcss`,
    `react`, `react-dom`, `zod`, `shadcn`.
- `packages/ui/components.json` — cross-workspace aliases pointing at
  itself (`@smoke-full/ui/components`, `@smoke-full/ui/lib/utils`,
  etc.).
- `packages/ui/src/components/button.tsx` (shadcn's baseline Button —
  more primitives get added by `setup_shadcn`).
- `packages/ui/src/lib/utils.ts` (the `cn` helper).
- `packages/ui/src/styles/globals.css` — **the** shared design-system
  stylesheet.
- `packages/ui/eslint.config.js`, `tsconfig.json`, `postcss.config.mjs`.

**`packages/eslint-config/` and `packages/typescript-config/`**
(shadcn-emitted, R1-rename-augmented):

- `packages/eslint-config/package.json` `name === "@smoke-full/eslint-config"`,
  with `exports` for `./base`, `./next-js`, `./react-internal`.
- `packages/typescript-config/package.json` `name === "@smoke-full/typescript-config"`.
  Files: `base.json`, `nextjs.json`, `react-library.json`.

**Workspace state invariants** (R1 augmentation runs `pnpm install`):

- `pnpm-lock.yaml` at workspace root.
- `node_modules/` populated; running `pnpm typecheck` should not require
  any further install.

### `setup_database`

Same invariants as v1 — `setup_database` is unaffected by R1.

- `packages/db/prisma/schema.prisma` exists.
- `packages/db/src/client.ts` and `packages/db/src/index.ts` exist.
- `packages/db/package.json` `name === "@smoke-full/db"`.
- `apps/web/package.json` `dependencies` contains
  `"@smoke-full/db": "workspace:*"`.
- `.env`, `.env.example`, and `.env.local` at the workspace root each
  contain a `DATABASE_URL=` line.
- Any pre-existing `@/lib/db` imports in apps/web have been rewritten
  to `@smoke-full/db`.

### `setup_authentication`

R1 makes two changes here:
- B1 fix lands (Phase 3): `getAuthSchemaCommand` invokes
  `<pm-dlx> dotenv-cli` instead of relying on a `dotenv` binary on
  PATH. The schema-gen subprocess should now actually run successfully
  on the prisma path.
- B6 hardening lands (Phase 2): silent failures of the better-auth-ui
  registry adds (or any other subprocess) raise `isError: true`
  instead of falling through to a "Manual setup required" warning
  with no error.

- `packages/auth/src/server.ts`, `packages/auth/src/client.ts`, and
  `packages/auth/src/index.ts` exist.
- `packages/auth/src/server.ts` imports `db` from `@smoke-full/db`.
- `apps/web/package.json` `dependencies` contains
  `"@smoke-full/auth": "workspace:*"`.
- **B3 regression catch**: better-auth-ui registry components actually
  on disk under `apps/web/src/components/auth/...` (§8.2 landed `src/`):
  - `apps/web/src/components/auth/auth.tsx`
  - `apps/web/src/components/auth/auth-provider.tsx`
  - `apps/web/src/components/auth/settings/settings.tsx`
  - `apps/web/src/components/auth/user/user-button.tsx`
- The better-auth CLI ran with cwd `projectPath` (workspace root) for
  schema-gen and `packages/db` for migrations. (Verified in source —
  `getAuthSchemaCwd` always returns `projectPath` post-R1; see
  `src/index.ts:4095`. This corrects the v1 doc's incorrect cwd
  assertion that pointed schema-gen at `packages/auth`.) Verify by
  checking the tool's log output OR by checking that
  `packages/db/prisma/schema.prisma` now contains better-auth tables
  (`User`, `Session`, `Account`, `Verification`).
- Tool response message reads "✅ Database schema and migrations have
  been generated and applied automatically!" — NOT "⚠️ Manual setup
  required." (The latter is the B1 failure branch and indicates B1
  isn't fixed.)

### `setup_shadcn`

R1 simplifies this dramatically. Runtime should drop from ~30s in v1
to ~5–10s.

- Single tool action: `pnpm dlx shadcn@<pinned> add --all -y -o` from
  `apps/web/`. shadcn auto-routes UI primitives to `packages/ui` via
  the cross-workspace alias in `apps/web/components.json`.
- **No `shadcn init` invocation.** That was scaffold_project's job; if
  the tool log shows an `init` call, R1 didn't fully land in this
  area.
- Post-conditions:
  - `packages/ui/src/components/` populated with shadcn primitives
    (50+ files: accordion, alert, button, card, dialog, sonner,
    table, tooltip, etc.). Button was already there from
    scaffold_project's shadcn init; the rest are added here.
  - `packages/ui/src/hooks/use-mobile.ts` exists.
  - `packages/ui/src/lib/utils.ts` already existed from
    scaffold_project — should be untouched here.
  - `apps/web/src/components/ui/` does NOT have shadcn primitives —
    they live in `packages/ui`. (V1 had them in apps/web because of
    the local-alias fallback during the manual-recovery path; R1's
    cross-workspace aliases route them to `packages/ui` by design.)
- Idempotency: re-running `setup_shadcn` should be a near-no-op (most
  files marked "skipped" by shadcn — files might be identical).

### `generate_dockerfile`

Same invariants as v1 (Group K + OoS-2). `generate_dockerfile` is
unaffected by R1; the templated Dockerfile.migrate substitution logic
already targets the right paths.

- `Dockerfile` at the workspace root contains a
  `RUN ... turbo@^2 prune $PACKAGE --docker` line (monorepo template).
- The pruned-install step uses `pnpm install --frozen-lockfile`
  (substituted into `__PM_INSTALL__`).
- `.dockerignore` contains `packages/db/src/.prisma`, NOT
  `src/lib/db/.prisma`.
- `docker-compose.yml`'s `app:` service does NOT carry an inline
  `prisma migrate deploy` command (deferred to the migrate service).
- `docker-compose.yml` has a `migrate:` service that builds from
  `Dockerfile.migrate` and depends on `db` healthy.
- `Dockerfile.migrate` exists and contains:
  - `node:24-alpine` base image (pnpm/npm/yarn) or
    `oven/bun:1-alpine` (bun).
  - `RUN <corepack setup>`-substituted text.
  - `COPY . .` (monorepo mode).
  - `RUN pnpm install --frozen-lockfile` (or per-PM equivalent).
  - Final CMD: `["sh", "-c", "<__MIGRATE_CMD__>"]` where
    `__MIGRATE_CMD__` is per ORM:
    - prisma full mode: `<pm-dlx> prisma migrate deploy --schema=./packages/db/prisma/schema.prisma`
    - drizzle full mode: `<pm-dlx> drizzle-kit migrate --config=./packages/db/drizzle.config.ts`
  - **No unsubstituted `__SOMETHING__` placeholders** —
    `grep '__[A-Z_]+__' Dockerfile.migrate` must be empty.

### `generate_readme`

Same invariants as v1.

- `README.md` "Project Structure" section lists `apps/web/`,
  `packages/db/`, `packages/auth/`, `packages/ui/`, `packages/orpc/`,
  `packages/eslint-config/`, `packages/typescript-config/`.
- Docker section mentions `docker compose run --rm migrate`.
- `README.md` does NOT contain the legacy "you may need to pass
  `--schema=./packages/db/prisma/schema.prisma`" workaround note.
- `AGENTS.md` exists at the workspace root with the `@smoke-full/db`
  and `@smoke-full/auth/server` import strings.
- `CLAUDE.md` exists and is a one-line pointer at `AGENTS.md`.

### `validate_project`

Same invariants as v1.

- Reports `next.config.{ts,mjs}` found at `apps/web/next.config.*`
  (workspace-root config — the `src/` move only relocates `app/`,
  `components/`, `hooks/`, `lib/`).
- Reports the workspace files present (`pnpm-workspace.yaml`,
  `turbo.json`).
- Reports each emitted `packages/*` directory.

## 5. Build steps (after all generation)

Same as v1 — these are the runtime checks the smoke fundamentally
exists for. Stop and investigate on the first failure.

- **`pnpm install`** — should be a near-no-op (R1's
  `scaffold_project` already ran install). Watch for: lockfile
  drift (would indicate the augmentation passes weren't fully
  reflected in the install scaffold did).

- **`pnpm typecheck`** (or `pnpm -r typecheck`) — should pass
  clean. Failures here are usually rename-pass regressions: a
  `@workspace/...` string survived somewhere, or the
  `apps/web/tsconfig.json` `paths` weren't updated for the §8.2
  layout decision, or `packages/ui`'s `exports` are misconfigured
  for some import path.

- **`pnpm build`** — Turbo build. Should produce
  `apps/web/.next/standalone/`. Watch for: package-name mismatches
  in turbo's filter graph (rename pass missed a callsite),
  cross-workspace import resolution failures from packages/ui to
  apps/web, missing `output: 'standalone'` in next config.

- **`docker build .`** — should produce a runnable image. Watch for:
  - `turbo prune` failure → workspace setup is wrong (probably the
    root `package.json` `workspaces` field for non-pnpm, or the
    rename pass broke turbo's module graph).
  - Prisma client generation failure → `packages/db/src/.prisma`
    path mis-emitted.
  - Layer caching surprises — note them but not necessarily a bug.

- **`docker compose run --rm migrate`** — first end-to-end test of
  Group K's templated `Dockerfile.migrate`. Same watch list as v1:
  - Schema-not-found → substituted `--schema=...` path doesn't
    match what `COPY . .` landed in the migrate image. Capture the
    literal CMD line and the full error.
  - Workspace dep resolution failure during `__PM_INSTALL__` →
    `packages/db` or its transitive deps not findable.
  - Slow build → expected for the unoptimized `COPY . .` plus full
    workspace install. Tracked in recommended-fixes Tier 6.
  - For variant B (bun + sqlite + drizzle): `Dockerfile.migrate`
    MUST exist and `docker-compose.yml` MUST have a `migrate:`
    service (gate is `(prisma || drizzle) && db !== 'none'`).
    Mongoose configs remain excluded.

## 6. Companion smokes (light variants)

Each runs the same procedure as §3, with a different config.

### Variant A — Full + npm + postgres + prisma + better-auth + shadcn (no rpc)

Catches the **npm catalog substitution path** (npm has no native
catalog; R1's augmentation substitutes literal versions into the root
`workspaces` package.json). This still exercises Path A (shadcn-led
scaffold), so the §4.0 universal regression catches still apply.

```diff
- "packageManager": "pnpm",
+ "packageManager": "npm",
- "rpc": "orpc",
+ "rpc": "none",
```

Run §3–§5, replacing `pnpm` with `npm` (`npm install`,
`npm run typecheck`, `npm run build`).

Additional Variant A invariants:
- Root `package.json` has `workspaces: ["apps/*", "packages/*"]`
  (npm-style), NOT `pnpm-workspace.yaml`.
- Catalog values are substituted as literal versions in root
  `package.json` and per-package `package.json`s.
- `packageManager` field is overridden to npm's pin (per design doc
  §8.6).

### Variant B — Full + bun + sqlite + drizzle (no auth, no shadcn)

This variant is **Path B (non-shadcn fallback)** because
`uiLibrary === 'none'`. It's the highest-value variant for testing R1's
B5 fix in the fallback path — confirms `apps/web/pnpm-workspace.yaml`
+ `apps/web/pnpm-lock.yaml` get cleaned up after `create-next-app`.

Also catches: **bun's different base image** in the Dockerfile and the
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
DOES have a `migrate:` service and `Dockerfile.migrate` IS emitted at
the project root (post-OoS-2 the gate is
`(prisma || drizzle) && db !== 'none'`). The substituted CMD must be
the drizzle form. Bun's base image in `Dockerfile.monorepo` should be
`oven/bun:1-alpine`.

**§4.0 universal regression catches still apply** — these are the
load-bearing checks that Path B's B5 fix is in place. The
`@workspace/...` rename catch is N/A for Path B (only Path A uses
shadcn's scaffold).

### Variant C — Minimal + pnpm (no db, no auth, no shadcn)

§8.4 landed option (a): `monorepo: 'minimal'` with
`uiLibrary: 'shadcn'` produces shadcn's full skeleton minus the
per-feature db/auth/orpc packages. With `uiLibrary: 'none'`, minimal
stays close to v1's semantic (apps/web only). This variant tests
`uiLibrary: 'none'` to keep it fast and non-shadcn:

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

This is **Path B (non-shadcn fallback)**. Confirm: only `apps/web/`
and root workspace files exist; no `packages/` directory at all.

### Variant D — Flat (`monorepo: 'none'`) regression

Confirms **flat mode still works identically to pre-monorepo behaviour
in both Path A (shadcn) and Path B (non-shadcn) flat dispatch**. Run
this variant TWICE — once with `uiLibrary: 'shadcn'` to exercise
`scaffoldViaShadcnFlat`, once with `uiLibrary: 'none'` to exercise the
non-shadcn flat fallback.

```diff
- "monorepo": "full",
+ "monorepo": "none",
- "rpc": "orpc",
+ "rpc": "none",
```

Confirm: no `apps/`, no `packages/`, no `pnpm-workspace.yaml`, no
`turbo.json`. The Dockerfile is the flat one (no `turbo prune`). This
is the regression baseline — if anything here behaves differently from
`main`, that's a bug.

## 7. Known limitations / where to capture findings

- **shadcn CLI version pinning is deferred** (design doc §8.5). The
  `init`/`add` invocations currently target `shadcn@latest` rather
  than a pinned version, so this smoke is the periodic check that
  catches shadcn drift. Pinning is mechanically a one-line change
  (`shadcn@latest` → `shadcn@<version>`) and tracked as a follow-up.
  If a smoke run flags an augmentation regression caused by shadcn,
  pin in lockstep with the fix and refresh the committed fixtures
  via `pnpm run refresh-shadcn-fixtures`.

- **R1's augmentation passes are the load-bearing custom code.** The
  rename pass especially — a single missed callsite would surface as
  a typecheck or build failure in §5. The §4.0 universal regression
  catch's grep is the canonical "no `@workspace/`" assertion;
  `tools/smoke.ts`'s `R1_RENAME_INVARIANT` enforces the same
  invariant programmatically (see commit `12a5090`).

- **Auto-rerun-friendly:** all tools should be idempotent. A re-run of
  the full §3 procedure on an existing smoke directory should produce
  the same final state without duplicating files or scripts.
  Verify by running §3 twice in succession and diffing — only
  `node_modules/` and `pnpm-lock.yaml` should change between runs.

- **Headless smoke driver** — `tools/smoke.ts` (Tier 5a, R1 Phase 5/6
  refresh) drives the MCP server over stdio for all five preset
  configs in seconds. CI runs it on every PR. As of Phase 5
  (`77e8dac`), the integration test suite consumes committed shadcn
  fixtures at `tests/fixtures/shadcn-{monorepo,flat}-init/` via
  `vitest`'s globalSetup, dropping wall-time from ~168s to ~22s.
  The smoke driver is intentionally untouched by the fixture work —
  it always invokes a real `pnpm dlx shadcn@latest init` as the
  canonical runtime check. The manual install / build / docker pass
  (§5 + the migrate end-to-end) is still done by hand. A `--full`
  flag for the driver to chain `<pm> install` + `<pm> build` is a
  future extension, tracked in `2026-05-06-recommended-fixes.md`.

- **Out-of-scope follow-ups.** Tier 5b (yarn variant), the `--full`
  smoke flag, and the recommended-fixes Tiers 2-6 + OoS-1/OoS-2 land
  separately. R1 + Phases 5/6 (this smoke's gating refactor) are
  shipped; the manual install/build/docker pass is the only
  remaining merge-gate.

## 8. Acceptance criteria

The smoke is "green" when:

- All six smoke configs (everything-on full + variants A, B, C, D-shadcn,
  D-non-shadcn) scaffold cleanly without errors from any tool. Five
  of these (full + A + B + C + D-shadcn) are exercised headlessly by
  `pnpm run smoke` on every PR; D-non-shadcn (Path B flat) is
  manual-only here.
- The §4.0 universal regression catches all pass on every variant
  (no rogue `apps/web/pnpm-workspace.yaml`, no `@workspace/...`
  strings on Path A variants, workspace recognition works from
  apps/web). The rename catch is enforced programmatically by
  `R1_RENAME_INVARIANT` in `tools/smoke.ts` for the three Path A
  presets it covers; the manual sweep here covers the rest.
- `setup_authentication` returns the success-with-auto-applied
  message, NOT the "Manual setup required" fallback (B1 confirmed
  fixed).
- The everything-on full smoke gets all the way through `docker build`
  AND `docker compose run --rm migrate` with no manual fixes.
- All exercised package managers' lockfiles install (variants A and B
  exercise npm and bun; the everything-on smoke covers pnpm; yarn is
  not in the smoke matrix — tracked in `2026-05-06-recommended-fixes.md`
  Tier 5b).
- Findings (if any) are recorded below and filed as separate follow-up
  tickets / issues.

## 9. Findings

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

### Variant D — Flat regression (shadcn)

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant D' — Flat regression (non-shadcn)

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

---

## Appendix A — What changed from v1

For readers cross-referencing
[`2026-05-05-monorepo-smoke-test.md`](./2026-05-05-monorepo-smoke-test.md):

### Procedure (§3)

- **Tool-call sequence is unchanged**, but `scaffold_project`'s runtime
  grew (60–120s) and `setup_shadcn`'s runtime shrunk (~5–10s) because
  the shadcn `init` work moved from the latter into the former.
- **Stage 4 install step (`pnpm install`) is now a near-no-op** because
  scaffold_project's R1 augmentation pass already ran install. v1's
  procedure ran install for the first time at this point.

### Per-tool checklist (§4)

- **New §4.0 universal regression catches** — three blocker checks
  that didn't exist in v1 (rogue apps/web workspace files, workspace
  recognition from apps/web, `@workspace/...` rename completeness).
  These guard against B1/B2/B3/B5 ever returning.
- **`scaffold_project`** invariants substantially rewritten — the
  shape of the output workspace changed (shadcn-led skeleton vs
  next-mcp's manual emission). Cross-workspace `tailwind.css` link is
  a new positive assertion that v1 never had.
- **`setup_authentication`** — B1 fix changes the success-message
  branch (auto-applied vs manual instructions). B3 regression catches
  added (verify registry components actually on disk). Schema-gen cwd
  assertion corrected per design doc §8.5 (`projectPath`, not
  `packages/auth` — fixes v1 finding B7).
- **`setup_shadcn`** — collapsed from the v1 init+add+init+add dance
  to a single `add --all` invocation. Idempotency expectation added.
- **`generate_dockerfile`** / **`generate_readme`** /
  **`validate_project`** — invariants unchanged (R1 doesn't touch
  these tools).
- **`setup_database`** — invariants unchanged.

### Companion smokes (§6)

- **Variant D** is now run twice — once shadcn (Path A flat dispatch),
  once non-shadcn (Path B flat dispatch). v1 only ran the non-shadcn
  flat case.
- **Variant C** asserts `monorepo: 'minimal' + uiLibrary: 'none'`
  (Path B). §8.4 landed option (a) — `monorepo: 'minimal' +
  uiLibrary: 'shadcn'` produces shadcn's full skeleton minus the
  per-feature db/auth/orpc packages — but the smoke variant tests the
  Path B shape because that's where the regression risk lives.

### Acceptance criteria (§8)

- New positive criterion: §4.0 catches pass on every variant.
- New positive criterion: setup_authentication doesn't print "Manual
  setup required" (B1 confirmed fixed).

### Sections unchanged

- §2 Prerequisites (essentially the same).
- §5 Build steps (the runtime test stays the same — that's the point
  of the smoke).
- §7 Known limitations (refreshed wording but same scope).
- §9 Findings template (same per-variant subsection layout).
