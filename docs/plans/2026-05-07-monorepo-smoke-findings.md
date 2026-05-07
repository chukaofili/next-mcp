# Monorepo Smoke Test — Findings (2026-05-07 run)

> Companion to [`2026-05-07-monorepo-smoke-test-v2.md`](./2026-05-07-monorepo-smoke-test-v2.md).
> That doc is the procedure / source of truth; this one captures the
> per-variant outcomes of a specific run so smoke-v2 stays a clean
> spec. Earlier runs were captured inline in smoke-v2 §9 and in v1's
> findings — see those for prior history.
>
> Fill in **during the run**, one subsection per variant. Empty
> bullets are fine — leave them as a record that the variant was
> attempted and passed.

## Run metadata

- Branch: `feat/upgrade-packages`
- HEAD SHA: `d5aae9a` (`fix(scaffold): three Codex-flagged R1 regressions` — newer than the smoke-v2 prompt's referenced `368ad49`; recent commits since: `d5aae9a, 2cfc26c, 368ad49`)
- Test baseline: 20 files / 302 tests passing (per smoke-v2 header)
- Driver: MCP Inspector (Option B) — `npx @modelcontextprotocol/inspector node ~/projects/chukaofili/next-mcp/dist/index.js`
- Operator: Chuka Ofili
- Host (OS / Docker runtime / Node / pnpm): macOS (Darwin 25.4.0) / Docker 29.4.2 desktop-linux / Node 24.15.0 / pnpm 10.33.3
- Network notes (registry availability, shadcn CLI version observed): TBD — record on first scaffold_project run (shadcn CLI version is currently `@latest`, design doc §8.5)

## Per-variant findings

### Everything-on full (pnpm + postgres + prisma + better-auth + shadcn + orpc)

- Date run: 2026-05-07
- Run by: Chuka Ofili (driving) + Claude Code (Opus 4.7) interpreter session
- Driver: MCP Inspector (Option B) → `node dist/index.js`
- Project: `/tmp/next-mcp-smoke/smoke-full`

#### Pre-run sanity (§3 step 1–2)

- ✅ `pnpm install && pnpm build` clean — lockfile no-op, lint clean, `tsc -b` clean, postbuild copied templates.
- ✅ `node v24.15.0`, `pnpm 10.33.3`, `docker 29.4.2 desktop-linux`. HEAD `d5aae9a`. Tree clean.

#### `scaffold_project` (§4 Path A)

- ✅ All four §4.0 universal regression catches PASS — no rogue `apps/web/pnpm-workspace.yaml` or `apps/web/pnpm-lock.yaml`, `pnpm m ls` from `apps/web` enumerates all 8 workspaces, zero `@workspace/...` strings remain after R1 rename pass.
- ✅ `apps/web/`, `packages/{ui,db,auth,orpc,eslint-config,typescript-config}` all present. R1 conditional augmentation wired in db/auth/orpc per the everything-on combo gates.
- ✅ Root `package.json`: `name === "smoke-full"`, `packageManager === "pnpm@10.18.0"` (R1 pin-alignment overwrote shadcn's default), `engines.node === ">=24"`, `engines.pnpm === ">=10"`, all 4 docker scripts present.
- ✅ `pnpm-workspace.yaml` catalog block present (R1 augmentation appended). 7 entries: `@types/node ^25`, `typescript ^6`, `eslint ^10`, `vitest ^4`, `dotenv ^17`, `better-auth ^1`, `@better-auth/api-key ^1`. Bleeding-edge majors all resolved cleanly (verified `typescript@6.0.3` at root install).
- ✅ Shadcn-emitted cross-workspace design link intact: `apps/web/components.json` `tailwind.css === "../../packages/ui/src/styles/globals.css"`, `aliases.ui === "@smoke-full/ui/components"`, `aliases.utils === "@smoke-full/ui/lib/utils"`.
- ✅ `apps/web/src/{app,components,hooks,lib}` layout (§8.2 option (a)) — `theme-provider.tsx` under `src/components`, `.gitkeep`s in empty subdirs, orpc handler stubs at `src/app/api/rpc/`.
- ✅ `packages/ui` shadcn-emitted with R1 rename: `@smoke-full/ui` name, all standard shadcn deps + exports map (`./globals.css`, `./postcss.config`, `./lib/*`, `./components/*`, `./hooks/*`).
- ✅ `packages/eslint-config` exports for `./base`, `./next-js`, `./react-internal`. `packages/typescript-config` private, named.
- **Notable observation: `packages/orpc/package.json` was missing `"private": true`** AND had `"version": "1.0.0"` while sibling workspace packages were `0.x.x` — would cause `pnpm publish -r` to publish only orpc by default. **Fixed during the run** by updating the orpc package template; not re-tested in this scaffold but the template change is what matters for future runs.
- **Notable observation: `turbo.json` has no `globalPassThroughEnv`** despite smoke-v2 §4 saying R1 augmentation should populate it from config. Either doc drift or a missing R1 augmentation pass — needs source-side check (`scaffoldMonorepoRoot` / equivalent) post-variant to determine which.
- **Cosmetic:** `apps/web/tsconfig.json` `include` lists `next.config.ts`, but actual file is `next.config.mjs` — dead path, harmless.
- **Operator note:** first `scaffold_project` invocation produced an auto-named project (`considerable-jade-app`) because the inspector form didn't carry the top-level `name` field. Restarted with full payload; not a tool bug.

#### `setup_database` (§4) — **first-run failure, B6 hardening regression**

- **🚨 BLOCKER: `setup_database` first invocation against fresh scaffold logged `level:error` from `pnpm exec prisma init` (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prisma" not found`) but returned `success` to the MCP client, then logged `level:warn message:"prisma init failed - user will need to run manually"`.** Two underlying bugs bundled:
  1. **Ordering bug:** `pnpm exec prisma` runs before prisma is installed in `packages/db`. Either the `pnpm install` after mutating `packages/db/package.json` deps is missing, or `pnpm exec` is the wrong invocation here — should be `pnpm dlx prisma init` (slow first-run, no install dep) or interlocked with `pnpm install` first. Reproduces 100% on first run from a fresh scaffold.
  2. **B6 propagation gap:** subprocess failure logged at `level:error` but not propagated to `isError: true` on the MCP response. Per smoke-v2 §4 setup_authentication, R1 Phase 2 hardened this for the better-auth-ui subprocess; the same hardening was not applied to `setup_database`'s prisma init subprocess. A user on Inspector with no log access (or pre-`~/.next-mcp/next-mcp.log` tooling) would think it worked. Without the log, this would be invisible.
  - Second-run "success" only because `pnpm install` ran somewhere between attempts; it's a workaround, not a fix.
- **Bug: subprocess `--output` arg disagrees with on-disk schema.prisma + emitted client.** Logged failing-first-run command was `pnpm exec prisma init ... --output ../src/lib/db/.prisma` (legacy pre-R1 path). But `packages/db/prisma/schema.prisma` on disk has `generator client { output = "../src/.prisma" }` and the generated client artifacts (`browser.ts`, `client.ts`, `enums.ts`, `models.ts`, `internal/...`) **correctly** landed at `packages/db/src/.prisma` per §4 post-R1 expectation. So the tool has two divergent code paths: the prisma-init subprocess uses a stale `--output`, while the schema.prisma template/second-run path writes the correct path. If anyone fixes only the ordering bug above without aligning the subprocess `--output`, the client will land at the wrong path. Investigate both `getPrismaInitArgs` (or equivalent) and the schema.prisma template emission together — align them.
- **Misleading success message:** tool reported `Environment variable added to .env` (singular). On disk all three of `.env`, `.env.example`, `.env.local` were updated with `DATABASE_URL`. Functionality correct, message wrong. Cosmetic — fix the response string.
- **Cosmetic: `.env.example` contains real default URL instead of placeholder.** Workspace-root `.env.example` reads `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/smoke-full?schema=public"` — which is the same as `.env.local`. Convention is placeholders (`<user>`, `<password>`, etc.) so the example file gives a structural hint rather than a real default that gets blindly committed. Low priority.
- **Bug (new): dangling empty `apps/web/src/lib/db/` directory.** Created by `scaffold_project` at scaffold time, never populated by anything (post-R1 the db code lives in `packages/db` and `apps/web` imports from `@smoke-full/db`). Empty dir is harmless but visually misleading and would confuse new contributors reading the tree. Either skip creating it during scaffold or clean up after setup_database. Likely site: scaffold_project's apps/web augmentation passes (or the `moveAppsWebFlatToSrc` helper).
- **§4 invariants summary:** all on-disk §4 setup_database assertions PASS — db package shape, env files at workspace root with `DATABASE_URL`, no surviving `@/lib/db` imports in apps/web, `@smoke-full/db: workspace:*` now in apps/web deps (resolves finding #1 db half). Outstanding: finding #1 auth half (waiting on setup_authentication).

#### `setup_authentication` (§4) — **B1 not fixed (new root cause), B6 hardening regressed**

- **🚨 BLOCKER (B1 regression, new root cause).** Auth schema generation subprocess (`pnpm dlx dotenv-cli -e .env -- pnpm dlx auth@latest generate -y --config packages/auth/src/server.ts`) failed with `MODULE_NOT_FOUND` resolving `/private/tmp/next-mcp-smoke/smoke-full/packages/auth/node_modules/@smoke-full/db/dist/index.js`. R1 Phase 3 patched the original B1 (dotenv binary on PATH) but a different resolution failure surfaced behind it. The auth CLI uses jiti to load `packages/auth/src/server.ts`, which imports `db` from `@smoke-full/db`. Per `packages/db/package.json`, `main: "./dist/index.js"`, but `packages/db/dist/` doesn't exist because nothing has built `packages/db` yet (just scaffolded + `prisma generate` ran, leaving `src/.prisma/` artifacts only). Schema-gen has therefore never produced better-auth tables (User/Session/Account/Verification all MISSING from `packages/db/prisma/schema.prisma`).
  - **Fix candidates:**
    1. Run `pnpm --filter @smoke-full/db build` (or equivalent) before invoking `auth@latest generate`.
    2. Switch `packages/db/package.json` `main` to `./src/index.ts` so jiti/tsx loaders resolve directly to source. Wider blast radius — affects every consumer of `@smoke-full/db`.
    3. Add a `dev`/`source` conditional exports map resolving to `.ts` for tooling consumers.
  - Smoke-v2 §4 says the §8 schema-gen `cwd` decision was settled: `getAuthSchemaCwd` always returns `projectPath` (workspace root). Confirmed in log — subprocess ran from workspace root and called the auth CLI with `--config packages/auth/src/server.ts`. The cwd is correct; it's the dependency resolution that's broken.
- **🚨 BLOCKER (B6 hardening regression).** Tool response is the literal "✅ Better Auth + Better Auth UI has been configured successfully!\n\n⚠️ Manual setup required..." mixed message — exactly what smoke-v2 §4 says R1 Phase 2 was supposed to eliminate. Outer MCP response is `success`, not `isError: true`. The error is embedded inside the response body's "Reason:" block, but a user on Inspector with no log access would see ✅ first, miss the ⚠️, and try to use a half-configured project. R1 Phase 2 either didn't cover `setup_authentication`'s schema-gen path or regressed since landing. **Two fixes needed:** (a) when schema-gen subprocess fails, return `isError: true` with the failure surfaced cleanly; (b) the success-message branch should not start with ✅ when a critical step fell through to manual.
- **🚨 BLOCKER (consequence): better-auth tables missing from schema.prisma.** Direct consequence of the failed schema-gen. Manual workaround per the tool's "Next Steps" block: run the schema-gen command after building packages/db, then `prisma migrate dev`. Smoke can't proceed to docker-compose migrate without a real schema.
- **Verify-then-flag: `pnpm dlx auth@latest` package name is suspicious.** Subprocess invokes `pnpm dlx auth@latest generate` — npm registry's `auth` package may not be the better-auth CLI. The pnpm dlx cache path includes better-auth-1.6.9's transitive deps so it appears to resolve to the right binary, but **verify**: should this be `better-auth@latest` instead? If `auth` happens to be a different abandoned/squatted package today, this could break or be hijacked tomorrow.
- **Cross-cutting (peer-dep cascade from `typescript: ^6` catalog pin).** `pnpm install` log surfaces unmet peer warnings:
  - `@typescript-eslint/*` 8.55.0 declares peer `typescript@">=4.8.4 <6.0.0"` — found 6.0.3 (all six packages emit this).
  - `packages/ui`: better-call 1.3.5 wants `zod@^4.0.0`, found 3.25.76 (catalog has zod via dep, not a catalog entry); `@better-auth-ui/react` 1.6.5 wants `zod@>=4.4.2`, `react@>=19.2.5`, `react-dom@>=19.2.5`, `tailwindcss@>=4.2.4` — all unmet by current pins.
  - **Implication:** the R1 pin policy moved `typescript` to `^6` (and similarly aggressive on other catalogs) but didn't propagate the bump to `@typescript-eslint/*`, `zod`, `react`, `tailwindcss`. Either roll back individual catalog entries to compatible versions OR upgrade those plugins/peers in lockstep. **This will repeat in every variant** unless fixed at pin-policy level. Filed as **cross-cutting**.
- **Cross-cutting (catalog re-registration noise).** Every `pnpm install` after a dep mutation produces a wall of `WARN Skip adding X to the default catalog because it already exists as ^N`. Cosmetic but noisy — degrades log signal-to-noise. Probably the R1 augmentation tries to register catalog entries that the existing pnpm-workspace.yaml already declares. Investigate whether the augmentation can pre-check before re-adding.
- **Notable (positive): cross-workspace UI primitives routing works.** better-auth-ui's `pnpm dlx shadcn@latest add` from `apps/web/` correctly deposited ~30 shadcn primitives into `packages/ui/src/components/` (avatar, button, calendar, card, checkbox, combobox, dropdown-menu, field, input, input-group, label, popover, select, separator, skeleton, slider, sonner, spinner, switch, tabs, textarea) plus globals.css updates. Strong positive confirmation that R1's cross-workspace alias design intent is honored by shadcn-style downstream consumers.
- **§4 invariants that PASS:**
  - **B3 catch ✅** — all four §4-required files on disk: `auth.tsx`, `auth-provider.tsx`, `settings/settings.tsx`, `user/user-button.tsx`, plus extras (sign-in/up/out, forgot-password, reset-password, provider-button(s), additional-field, error-toaster, settings/{account,security}/*, user/{user-avatar,user-button,user-view}).
  - **Finding #1 fully resolved ✅** — both `@smoke-full/db: workspace:*` and `@smoke-full/auth: workspace:*` now in apps/web deps.
  - `packages/auth/{server,client,index,re-exports}.ts` all present.
  - `server.ts` correctly imports `db` from `@smoke-full/db`.
  - App routes: `apps/web/src/app/api/auth/[...all]/route.ts`, `apps/web/src/app/auth/[path]/page.tsx`, `apps/web/src/app/account/[path]/page.tsx`.
  - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` added to all three root env files (with distinct random secrets per file — that may itself be a minor concern, see below).
- **Sub-finding (env secret distinct per file):** each of `.env`, `.env.example`, `.env.local` got a different `BETTER_AUTH_SECRET` value. Probably the augmentation generates a new secret on each write rather than once-per-tool-call. Cosmetic but slightly counter to convention — `.env` and `.env.local` should typically share a value (since one shadows the other in next.js), and `.env.example` should have a placeholder rather than a real-looking secret.

#### `setup_authentication` blocker resolution — source-side fix-up applied mid-run

> Operator made template-level changes to next-mcp source code mid-smoke to unblock the everything-on full smoke. The current `/tmp/next-mcp-smoke/smoke-full` directory has the OLD-template emissions (it was scaffolded before these source changes) but a manual workaround was applied to its on-disk state so the rest of the smoke can continue. **The new shapes need to be exercised by a fresh scaffold** — flagging Variant A (full + npm + prisma) and Variant D-shadcn as the canonical regression checks for the new shape going forward.

- **Adopted Option A for blocker #1**: source change adds a `pnpm --filter @<project>/db build` step before the auth generate subprocess. Resolves the `MODULE_NOT_FOUND` on `@<project>/db/dist/index.js`.
- **Verify-then-flag closed**: `pnpm dlx auth@latest` package name confirmed acceptable. Operator decision: leave as-is, no follow-up needed. Removing this from the follow-up list.
- **NEW — Prisma client shape change (BREAKING)**: `packages/db/prisma/client.ts.template` no longer exports a `db` instance directly; it now exports a **factory function** the consumer calls at runtime with the database URL. Reason: the auth CLI's jiti loader needs the URL at evaluation time, not at build/import time. **A `TODO` comment is left in `client.ts.template`** to be picked up.
  - **Blast radius:** every consumer of `@<project>/db` must update its import:
    - `packages/auth/src/server.ts.template` ✅ updated by operator.
    - `packages/orpc/src/*.template` — **TBD: did operator update?** orpc may import db; if so, it needs the new shape. Verify before next variant.
    - `apps/web/src/lib/db/*` (flat mode) — **TBD**: flat mode emits a local db module; does it follow the new factory pattern or stay instance-based? Smoke-v2 §4 called out flat mode's db semantics as unchanged, but the breaking change to the prisma client means flat mode is implicated too.
    - Any tests / app code that imports `db` directly.
  - **Validation gates:** Variant A re-tests this in monorepo+prisma with npm catalog substitution. Variant D-shadcn re-tests it in flat mode. Variant B (drizzle) is unaffected by this specific change.
- **NEW — `scripts/generate.ts` helper at generated project root**: serves as the `--config` for the auth CLI, replacing the previous direct `--config packages/auth/src/server.ts`. Generated project's root package.json now has:
  ```
  "db:auth:generate": "pnpm dlx @dotenvx/dotenvx run -- pnpm dlx auth@latest generate --output ./packages/db/prisma/schema.prisma --config ./scripts/generate.ts"
  ```
  Several follow-ups baked into this:
  - **Per-PM script template**: needs adapting from `pnpm dlx` to `npx` / `bun x` / `yarn dlx` for variants A / B / D-non-shadcn.
  - **Per-ORM script template**: drizzle (variant B) doesn't use `auth@latest generate`; needs its own equivalent for drizzle's schema-gen path (or N/A if drizzle's auth-table generation is different).
  - **dotenv-cli → @dotenvx/dotenvx**: this is a dep change. Verify `@dotenvx/dotenvx` is actually `dotenvx` from the `dotenvx` org on npm and not a typo'd squat.
  - **Schema output target changed**: previously the auth CLI wrote tables into wherever it inferred from `--config`; now `--output ./packages/db/prisma/schema.prisma` is explicit. Cleaner, but verify it appends to the existing schema.prisma rather than overwriting it (current schema has the prisma generator + datasource blocks at the top — overwrite would clobber those).
- **NEW — Design decision: `prisma migrate` is now manual.** Operator: "this step always needs to be done manually by the user after they have setup their db url." `setup_authentication` should no longer attempt `prisma migrate` automatically. **This changes smoke-v2 §4 spec** — the §4 success message expectation `"✅ Database schema and migrations have been generated and applied automatically!"` is now wrong. New expected message should call out the manual migrate step using `pnpm --filter @<project>/db db:migrate` (canonical) instead of `pnpm exec prisma migrate dev`. Smoke-v2 §4 setup_authentication assertions need a doc update — recommend filing as a separate doc-bookkeeping commit when fixes land.
- **Manual workaround applied to `/tmp/next-mcp-smoke/smoke-full`** to continue the smoke:
  1. `pnpm --filter @smoke-full/db build` — built packages/db so jiti can resolve.
  2. Auth generate command run via the new `db:auth:generate` script equivalent (or directly).
  3. `prisma migrate dev` skipped (DB URL not configured locally; per the new design decision this is correct — migrate happens via `docker compose run --rm migrate` later in §5).
- **Implication for the rest of this variant**: setup_shadcn / generate_dockerfile / generate_readme / validate_project / install / build / docker — all unchanged by these fixes; the everything-on full smoke can validate them. The B1/B6/migrate-flow regressions need a re-scaffold (Variant A or a fresh everything-on re-run after merge) to confirm the new shape works end-to-end.
- **Workaround verification (verify-workaround-state.sh):**
  - `packages/db/dist/` built ✅ — `client.{js,d.ts}`, `index.{js,d.ts}`, `.prisma/` all present.
  - `packages/db/src/client.ts` is **new factory shape** ✅ — `export const createPrismaClient = (opts: CreatePrismaOpts) => PrismaClient` with `PrismaPg` adapter for postgres. TODO comment on line 1 (multi-DB support deferred).
  - `packages/auth/src/server.ts` is **new factory shape** ✅ — exports `createBetterAuth(db)`, `createAuth({ db })`, `destroyAuthInstance()`, type `Auth`. Type-only import of `PrismaClient` from `@smoke-full/db`. Singleton pattern with `authInstance`.
  - `scripts/generate.ts` ✅ at scaffold root, composing `createPrismaClient(...)` + `createAuth({ db })`.
  - Root `package.json` has `"db:auth:generate"` ✅.
  - `schema.prisma` healthy ✅ — generator + datasource blocks AND User/Session/Account/Verification tables all present. **Open question:** operator perceived overwrite, but on-disk reality is clean. Either `auth@latest generate --output` actually merges (good) or operator manually re-added the generator/datasource blocks after seeing overwrite (the script needs a safer pattern). Follow-up: validate `--output` semantics empirically — write the script with an explicit merge step if the CLI is destructive.
- **Sub-finding (verify pending):** `apps/web/src/app/api/auth/[...all]/route.ts`, `apps/web/src/proxy.ts`, `apps/web/src/providers/auth-ui-provider.tsx`, `apps/web/src/app/layout.tsx`'s AuthProvider wrapping — generated by setup_authentication using the **old `auth` instance** template. After the factory-shape pivot, they likely still do `import { auth } from "@smoke-full/auth"` and would break at typecheck. Will hit during the §5 typecheck step. **Action needed at source side: update those templates too** to import `createAuth` and instantiate it (probably wired through a context/provider).

#### `setup_shadcn` (§4) — R1 collapse confirmed; one routing finding

- ✅ **R1 collapse confirmed.** Single tool action: `pnpm dlx shadcn@latest add --all -y -o` from `apps/web/`. **No `shadcn init` invocation** (per log).
- ✅ **Cross-workspace routing for `ui` and `utils` aliases works.** 55 primitives landed in `packages/ui/src/components/`; `apps/web/src/components/ui/` is empty. Strong positive confirmation of R1's design intent.
- ✅ Toaster auto-injected into `apps/web/src/app/layout.tsx` (log line: "Injected Toaster into apps/web/src/app/layout.tsx").
- ✅ `packages/ui/src/lib/utils.ts` preserved untouched.
- ✅ No duplicate primitives between `apps/web/src/components/ui` (empty) and `packages/ui/src/components` (55 files).
- **Finding (routing): `use-mobile.ts` lands in `apps/web/src/hooks/`, not `packages/ui/src/hooks/`.** Smoke-v2 §4 says it should be in `packages/ui/src/hooks/use-mobile.ts`. Root cause: `apps/web/components.json` has `aliases.hooks: "@/hooks"` (local), while `aliases.ui` and `aliases.utils` are cross-workspace. shadcn add ran from apps/web, so hooks went local. Three resolutions: (1) update §4 spec to expect app-local — recommended, since app-local hooks is the conventional pattern and use-mobile is app-scope in practice; (2) augment `apps/web/components.json` to set `hooks: "@<project>/ui/hooks"` cross-workspace; (3) post-add augmentation that relocates known-shared shadcn hooks to packages/ui. Decision needed at source side.
- **Cosmetic: TooltipProvider not auto-wrapped.** shadcn's add output ends with a "remember to wrap RootLayout with TooltipProvider" reminder. Toaster wrapping was auto-injected; TooltipProvider wasn't. Follow-up: extend the layout.tsx wrapping augmentation to handle tooltip too, OR document as expected-manual.
- **Cosmetic: `apps/web/src/components/ui/` is dangling empty.** Created by scaffold_project, never populated post-R1. Same pattern as `apps/web/src/lib/db/`. Cleanup follow-up.
- **Cosmetic: `-o` (override) means shadcn rewrites all primitives on every run.** Smoke-v2 §4's "near-no-op idempotency" claim is technically wrong — re-runs touch every file. No functional issue (templates are deterministic) but worth wording the spec more accurately: "idempotent in content, not in file timestamps".

#### `generate_dockerfile` (§4) — strong pass with two minor findings

- ✅ **All §4 invariants pass.** Dockerfile (multi-stage, node:24-alpine, turbo prune line, pnpm install --frozen-lockfile, no `__FOO__` placeholders), Dockerfile.migrate (node:24-alpine, COPY . . monorepo mode, prisma migrate deploy CMD with correct post-R1 schema path, no placeholders), docker-compose.yml (app/migrate/db services, migrate depends on db:service_healthy, app has no inline prisma migrate, db is postgres:17-alpine with healthcheck), .dockerignore contains post-R1 `packages/db/src/.prisma` (line 30) and no legacy `src/lib/db/.prisma`.
- ✅ **Group K + OoS-2 templating substitution working end-to-end.** This is the first runtime test of the post-R1 monorepo Dockerfile.migrate emission for prisma — substitution is clean.
- ✅ **Positive design observation (not a finding).** Dockerfile sets `ARG DATABASE_URL="postgresql://dummy:dummy@..."` so `prisma generate` at build time has a value without leaking real creds into the layer cache. Good defensive practice — keep it.
- **Minor (CI reproducibility): `corepack prepare pnpm@latest --activate`** in both Dockerfile and Dockerfile.migrate. Should pin to the workspace's `packageManager` field (`pnpm@10.18.0`) for reproducible builds; with `@latest`, the same Dockerfile could resolve to different pnpm versions over time. Same applies to npm / bun / yarn variants when their respective Dockerfiles emit.
- **Operator-flow gap: `app` service does NOT depend on `migrate` completion.** Both depend on `db: service_healthy` only — they start in parallel. `docker compose up` (no args) would race app's startup against migrations and likely hit "table does not exist" before tables exist. Two fix options: (a) add `app.depends_on.migrate: condition: service_completed_successfully` for prod-like usage, or (b) document the manual sequence (`docker compose run --rm migrate` then `docker compose up app`) in README. Recommend (a) as the safer default; doesn't break dev because `docker compose up app` will also bring up migrate and wait.

#### `generate_readme` (§4) — **monorepo-blind output (provisional pending re-run)**

> First call appears to have run with operator-side config gaps OR a tool regression. Will re-confirm with explicit canonical payload — see #provisional notes below.

- **🚨 Wrong project name in README and AGENTS.md.** README header `# governing-olive-app` (line 2) and AGENTS.md `governing-olive-app codebase` (line 283), but the actual `package.json` name is `smoke-full`. Either the operator omitted `config.name` and the tool generated a fresh random name (same root cause as the first scaffold's "considerable-jade-app"), OR the tool ignores `config.name` and always generates fresh. **Either way, a real bug:** generate_readme should detect the project name from `package.json` at `projectPath` rather than depending on the operator passing it.
- **🚨 README's Project Structure section is flat-mode.** Shows `src/`, `prisma/`, `next.config.ts` at root — but this is a `monorepo: full` project with `apps/web/`, `packages/{db,auth,ui,orpc,eslint-config,typescript-config}/`. Either operator omitted `architecture.monorepo: 'full'` OR the tool ignores it.
- **🚨 AGENTS.md explicitly states `monorepo: none`** (line 287). Same root cause as above. AGENTS.md "Where to find things" all point at flat-mode paths (`src/lib/db/`, `src/lib/auth.ts`, `src/components/auth/`) instead of monorepo paths.
- **§4 invariants that FAIL:**
  - `@smoke-full/db` reference NOT in AGENTS.md.
  - `@smoke-full/auth/server` reference NOT in AGENTS.md.
  - `docker compose run --rm migrate` reference NOT in README.
- **Misaligned with new design: README still suggests `pnpm exec prisma migrate dev`** (line 64). Per the new manual-migrate decision the canonical command should be `pnpm --filter @<project>/db db:migrate`.
- **CLAUDE.md ✅** is correctly a one-line pointer at AGENTS.md.
- **🚨 CONFIRMED tool regression.** Re-run with explicit canonical config (`name: 'smoke-full'`, `architecture.monorepo: 'full'`, full architecture block) produced README header `# decent-magenta-app` and AGENTS.md still saying `monorepo: none` and flat-mode paths. **Third random name this run** (after `considerable-jade-app` and `governing-olive-app`) — confirms the tool ignores `config.name` AND ignores `architecture.monorepo`. Two underlying fixes:
  1. **Project name resolution:** prefer `package.json` `name` field at `<projectPath>` first, fall back to `config.name`, only last-resort generate a random name (and even then, persist it to package.json so re-runs are stable).
  2. **Monorepo detection:** prefer `architecture.monorepo` if passed, fall back to detecting from disk (presence of `pnpm-workspace.yaml` and `apps/` + `packages/` dirs). Currently the tool seems to default to flat regardless of config.
- **Observability gap:** `generate_readme`'s log entries do NOT appear in `~/.next-mcp/next-mcp.log` (the tool ran four times across this variant, no log lines visible in the `tail -100` of the verify output — either the tool doesn't log via the file logger or its entries are sub-100 from the older entries). Most other tools log a "Generated X" / subprocess output line at info-level; generate_readme should match.

#### `validate_project` (§4) — **monorepo-blind: looks at projectRoot for `next.config.*`**

- **🚨 Validation failed:** `next.config.{ts,mjs,js} not found at <projectRoot>` — but `apps/web/next.config.mjs` exists on disk. Per smoke-v2 §4: validate_project should report `next.config.*` found at `apps/web/next.config.*` for monorepo mode (the workspace-root config; `src/` move only relocates app/components/hooks/lib).
- **🚨 CONFIRMED tool regression.** Re-run with explicit canonical config (`architecture.monorepo: 'full'`) produced the same `next.config.{ts,mjs,js} not found at <projectRoot>` error. Tool always looks at `<projectRoot>` regardless of config. **Fix:** detect monorepo (or honor `architecture.monorepo`) and look for `next.config.*` at `apps/web/` in monorepo mode. Otherwise the tool's only useful output is `package.json exists ✅`, which adds no value.
- **Observability gap:** like generate_readme, validate_project's calls did not appear in the MCP log tail. Whether the tool logs at all is open.

#### §5 build pass — **BLOCKED at typecheck (100+ errors across 7 categories)**

> Operator hand-fixed `baseUrl` removal and `use-mobile.ts` placement before running typecheck; even with those workarounds, typecheck fails with a wall of errors. Variant marked **completed (blocked)** — pause and fix at source level before re-running. Categories enumerated below; full output at `/tmp/next-mcp-smoke/verify/typecheck.txt` (316 lines).

- **🚨 Category A — Missing peer deps for better-auth-ui registry components (~40 TS2307 errors).** Registry adds emit code that imports modules the scaffold never installs. Missing in `apps/web/package.json` deps: `@better-auth-ui/core`, `@better-auth-ui/react`, `@tanstack/react-query`, `sonner`, `date-fns`, `bowser`. Subpath imports also fail: `better-auth/react`, `better-auth/social-providers`, plus the bare `better-auth` (odd given catalog has it — possibly a hoisting / pnpm-config issue). Fix: setup_authentication should add these to apps/web's deps when the better-auth-ui registry pulls them in (or run `shadcn add` with auto-install flags + a manifest of expected peers).
- **🚨 Category B — `paths` vs `include` mismatch in apps/web/tsconfig.json (~30 TS6307 errors).** `paths.@smoke-full/ui/*` maps to `../../packages/ui/src/*`, but apps/web's `include` glob (`**/*.ts`) is rooted at apps/web — TypeScript pulls in cross-workspace files via paths-resolution but fails because they're not in `include`. **Fix:** remove `paths.@smoke-full/ui/*` from apps/web/tsconfig.json. The `package.json` `exports` map at packages/ui already handles resolution natively via pnpm workspace symlinks. The tsconfig `paths` mapping is redundant AND counterproductive in monorepo mode. (Keep `paths.@/*` for the local `@/*` → `./src/*` mapping; that one is fine.)
- **🚨 Category C — Toaster injection used wrong import path.** `apps/web/src/app/layout.tsx` line 3 has `import { Toaster } from "@/components/ui/sonner"` — flat-mode path. Should be `import { Toaster } from "@smoke-full/ui/components/sonner"` since primitives live in packages/ui in monorepo. Fix: setup_shadcn's "Inject Toaster" augmentation needs a monorepo-aware import path (`@<project>/ui/components/sonner`) instead of `@/components/ui/sonner`.
- **🚨 Category D — better-auth-ui registry components hardcode `../ui/X` relative paths (~5 errors in `forgot-password`, `reset-password`, `sign-up`).** Imports like `import { Label } from "../ui/label"` resolve to `apps/web/src/components/ui/label` — empty in monorepo. The registry components assume flat shadcn layout. Fix: post-shadcn-add augmentation that rewrites `../ui/X` → `@<project>/ui/components/X` in the registry-emitted files. (Or upstream a monorepo-aware option in better-auth-ui's registry.)
- **🚨 Category E — CSS module type declarations missing.** `import "@smoke-full/ui/globals.css"` in layout.tsx fails with TS2882 ("Cannot find module or type declarations for side-effect import"). Need a `declare module '*.css'` somewhere reachable (next-env.d.ts extension, or a global.d.ts in apps/web). Fix: scaffold_project should emit a `apps/web/src/global.d.ts` with `declare module '*.css'` (or extend next-env.d.ts).
- **🚨 Category F — Strict-mode failures in better-auth-ui's emitted code (~25 TS7006 errors).** Files: `additional-field.tsx`, `account-settings.tsx`, `change-password.tsx`, `linked-accounts.tsx`, `security-settings.tsx`, `sign-in.tsx`, `sign-up.tsx`, `user-button.tsx`, `auth.tsx`, `error-toaster.tsx`. `Parameter X implicitly has an 'any' type` everywhere. **Upstream issue** — better-auth-ui's published shadcn registry emits code that doesn't survive strict TypeScript. Options: (a) file upstream issue + relax strict only for `apps/web/src/components/auth/*` until fixed, (b) auto-patch the relevant params with explicit types in a post-add augmentation, (c) accept these errors and use `// @ts-expect-error` blanket comments (worst).
- **🚨 Category G — Other.** TS6133 unused `Geist` import in layout.tsx (stale from setup_authentication patch — needs cleanup). TS2664 module augmentation of `@better-auth-ui/core` fails (downstream of A — fixes when peer dep is installed).
- **Cascade analysis:** Fixing Categories A + B alone would eliminate ~70 of ~100 errors. Categories C + D + E are smaller but still each an independent template-level fix. Category F is upstream + scaffold-side relaxation. **No reasonable in-flight workaround** for the in-flight scaffold — re-scaffold + source-side fixes is the right path.
- **Build/docker pass not attempted.** Without typecheck passing, neither `pnpm build` (turbo runs typecheck as part of build) nor `docker build .` (which runs the same build inside the container via `pnpm turbo build --filter=$PACKAGE...`) would succeed. Marking everything-on full as **blocked at §5** for this run.

#### Variant outcome

- **Status: BLOCKED at §5 typecheck.** Generation half complete (with operator-side patches for orpc-private, prisma+auth factory shape, baseUrl removal, use-mobile relocation, schema.prisma manual handling). Build/docker pass not attempted due to typecheck wall.
- **Critical path:** R1's auth-stack templates need substantial fixes before this variant can complete. Categories A + B + C + D + E are template-level R1 regressions; Category F needs upstream collaboration.
- **Recommendation for next steps:** move to Variants C and D-non-shadcn (which skip setup_authentication and setup_shadcn) to get a cleaner read on non-auth-stack regressions before sinking time into auth-stack fixes.

#### Findings draft status

- Notable observations + errors above written 2026-05-07 mid-run, with operator confirmation. Will revisit/refine `globalPassThroughEnv` and prisma `--output` items after source-side checks.

#### Follow-up tickets to file

- `setup_database: run pnpm install before pnpm exec prisma init` — fixes the ordering bug that breaks first runs from a fresh scaffold.
- `setup_database: propagate prisma init subprocess failure to MCP isError:true` — closes the B6 propagation gap missed by R1 Phase 2 (which only covered better-auth-ui).
- `setup_database: align prisma --output subprocess arg with schema.prisma template (../src/.prisma)` — the subprocess uses legacy `../src/lib/db/.prisma` while the on-disk schema + client artifacts use `../src/.prisma`. Two divergent code paths need to be reconciled.
- `setup_database: response message says "added to .env" but updates .env/.env.example/.env.local` — fix wording so users aren't surprised by the extra files.
- `scaffold_project: dangling empty apps/web/src/lib/db/ directory left after augmentation` — either skip creating it or clean up after setup_database.
- `next-mcp: .env.example should use placeholders, not the same default as .env.local` — minor, but conventional.
- `setup_authentication: B1 regressed (new root cause) — auth schema-gen subprocess can't resolve @<name>/db because packages/db hasn't been built` — fix by either pre-building packages/db before invoking auth generate, or pointing packages/db's `main` at `./src/index.ts` for jiti-based loaders.
- `setup_authentication: B6 hardening regressed — schema-gen subprocess failure returns success message with "✅ ... ⚠️ Manual setup required" instead of isError:true` — Phase 2 hardening either didn't cover this path or regressed; the response template should not start with ✅ when a critical step fell through.
- `setup_authentication: BETTER_AUTH_SECRET differs across .env / .env.example / .env.local` — cosmetic; conventionally `.env` and `.env.local` share a value, and `.env.example` should be a placeholder.
- `next-mcp: pick up TODO in packages/db/prisma/client.ts.template (left mid-fix)` — operator-flagged; resolve before merging the new prisma-client factory shape.
- `next-mcp: per-PM adaptation of root db:auth:generate script` — current template uses `pnpm dlx ... pnpm dlx auth@latest generate ...`; needs `npx ... npx auth@latest generate ...` (variant A), `bun x ... bun x auth@latest generate ...` (variant B if better-auth path were active there), `yarn dlx ... yarn dlx auth@latest generate ...` (yarn — out-of-scope). Same for the dotenvx invocation.
- `next-mcp: per-ORM adaptation of root db:auth:generate script` — drizzle path (variant B) does not use `auth@latest generate`; either gate the script to prisma+better-auth combos or add a drizzle equivalent.
- `next-mcp: verify @dotenvx/dotenvx package is the canonical dotenvx fork (not a squat) and document the dep migration from dotenv-cli` — small-but-real supply-chain check.
- `next-mcp: confirm db:auth:generate --output appends to schema.prisma rather than overwriting it` — current schema.prisma starts with prisma generator + datasource blocks; an overwrite would clobber them. If overwrite is the actual behavior, the script needs a merge step or the auth tables need to be emitted to a separate file that gets included.
- `next-mcp: smoke-v2 §4 doc update — setup_authentication success message no longer mentions automatic migrate` — replace the "✅ Database schema and migrations have been generated and applied automatically!" expectation with a manual-migrate-prompted message that references `pnpm --filter @<project>/db db:migrate`.
- `next-mcp: confirm packages/orpc consumer of @<project>/db is updated for new factory shape` — operator-listed TBD; orpc may import db, in which case it needs the new createDb-style import to remain compatible.
- `next-mcp: confirm flat-mode (variant D) db consumer pattern in apps/web/src/lib/db/*` — flat mode emits a local db module; verify it either follows the new factory pattern or stays compatible after the breaking change.
- `setup_authentication: update apps/web auth-consumer templates for factory shape` — `apps/web/src/app/api/auth/[...all]/route.ts`, `apps/web/src/proxy.ts`, `apps/web/src/providers/auth-ui-provider.tsx`, `apps/web/src/app/layout.tsx` all generated with old `import { auth } from "@<project>/auth"` shape. With the factory pivot, they need updating to instantiate via `createAuth(...)` (likely through a provider). Will surface as typecheck failures in §5.
- `setup_shadcn: decide hooks alias policy` — option (1) update smoke-v2 §4 to expect `apps/web/src/hooks/use-mobile.ts` (recommended), or (2) augment apps/web components.json `aliases.hooks` to cross-workspace, or (3) post-shadcn-add augmentation to relocate known shared hooks. Pick one, document it.
- `setup_shadcn: extend layout.tsx wrapping augmentation to TooltipProvider` — Toaster wrapping happens; TooltipProvider doesn't. Either extend the augmentation or document as expected-manual in README/AGENTS.
- `scaffold_project: dangling empty apps/web/src/components/ui/ directory` — created at scaffold, never populated post-R1 (primitives go cross-workspace to packages/ui). Same cleanup follow-up as the apps/web/src/lib/db/ dangler.
- `next-mcp: smoke-v2 §4 setup_shadcn idempotency wording` — say "idempotent in content, not in file timestamps" since `-o` means shadcn rewrites every primitive each run.
- `db:auth:generate script: validate --output is append-safe vs overwrite-safe` — operator perceived overwrite; on-disk reality is clean. Source-side test: scaffold a fresh project, hand-edit the prisma generator output path, then run `db:auth:generate`. If overwrite, the edit gets clobbered; need a merge strategy.
- `generate_dockerfile: pin pnpm version in Dockerfile + Dockerfile.migrate to packageManager field instead of @latest` — applies to all four PMs.
- `generate_dockerfile: docker-compose.yml app service should depend_on migrate: service_completed_successfully` — prevents app/migrate race on cold `docker compose up`.
- `generate_readme: detect project name from package.json at projectPath instead of relying on config.name` — first call generated `governing-olive-app` instead of using the on-disk `smoke-full`. Same fall-back pattern needed for monorepo detection (read pnpm-workspace.yaml / apps,packages dirs).
- `generate_readme: respect architecture.monorepo='full' (or detect from disk)` — first call produced flat-mode README + AGENTS.md content despite a monorepo project on disk.
- `generate_readme: align with new manual-migrate design` — replace `pnpm exec prisma migrate dev` with `pnpm --filter @<project>/db db:migrate` in README and AGENTS.md.
- `generate_readme: include `docker compose run --rm migrate` in README's Docker section` — currently missing.
- `validate_project: detect monorepo layout and look for next.config.* at apps/web/`; — currently treats `<projectRoot>` as the search root unconditionally.
- `next-mcp: TypeScript 6 dropped baseUrl — remove from emitted tsconfigs` — `apps/web/tsconfig.json`, `packages/ui/tsconfig.json`, and likely others. Cleanest fix is at the shared `@<project>/typescript-config/*` configs.
- `setup_shadcn: post-add augmentation must move use-mobile.ts to packages/ui/src/hooks/` — sidebar.tsx imports from cross-workspace alias; current setup leaves use-mobile in apps/web only. Enumerate any other shared shadcn hooks too.
- `apps/web/tsconfig.json: remove paths.@<project>/ui/*` — redundant with package.json exports + pnpm workspace symlinks, AND breaks include-rooted file checks (causes ~30 TS6307 errors). Keep paths.@/* for the local @/* mapping.
- `setup_shadcn: Toaster injection uses wrong import path in monorepo` — emits `@/components/ui/sonner` (flat), should emit `@<project>/ui/components/sonner` (monorepo). Detect monorepo at injection time.
- `setup_authentication: install missing peer deps for better-auth-ui registry components` — `@better-auth-ui/core`, `@better-auth-ui/react`, `@tanstack/react-query`, `sonner`, `date-fns`, `bowser`. May also need pnpm hoisting config for `better-auth` subpath imports (`/react`, `/social-providers`).
- `setup_authentication: post-shadcn-add rewrite of ../ui/X → @<project>/ui/components/X` in better-auth-ui registry-emitted files in monorepo mode — they hardcode flat-mode relative paths.
- `scaffold_project: emit apps/web/src/global.d.ts with `declare module '*.css'`` — needed for side-effect CSS imports (`@<project>/ui/globals.css`).
- `setup_authentication: clean up stale Geist import in layout.tsx` — TS6133 unused.
- `next-mcp: investigate strict-TS failures inside better-auth-ui's emitted shadcn registry components` — file upstream issue OR add explicit `any` annotations as scaffold-side post-processing OR relax strict checks for `apps/web/src/components/auth/*`.
- `next-mcp: investigate turbo.json globalPassThroughEnv augmentation` — verify whether the augmentation pass exists and ran. Either fix the augmentation or correct smoke-v2 §4 spec.
- `next-mcp: orpc package template missing "private": true and uses version "1.0.0"` — **fixed in-flight during the smoke run by operator**; tracked here for changelog completeness.

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

## Cross-cutting findings

> Use this section for anything that surfaced across multiple
> variants (e.g. shadcn CLI drift, dependency-pin mismatch, registry
> flake) so it isn't buried under one variant's heading.

- **R1 catalog pin policy creates a peer-dep cascade.** Surfaced first under everything-on full's `setup_authentication` `pnpm install`. Catalog declares `typescript: ^6`, which resolves to `typescript@6.0.3`. But:
  - `@typescript-eslint/*@8.55.0` declares peer `typescript@">=4.8.4 <6.0.0"` → six unmet-peer warnings.
  - `packages/ui` indirect deps want `zod@^4.0.0` / `>=4.4.2` (better-call, @better-auth-ui/react), `react@>=19.2.5` (have 19.2.4), `tailwindcss@>=4.2.4` (have 4.1.18) — all unmet.
  - **Recommendation:** R1's pin policy needs to keep typescript / @typescript-eslint / zod / react / tailwindcss bumps in lockstep, OR roll back individual catalog majors to compatible versions. This will repeat in every variant; fix at pin-policy level rather than per-variant.
- **R1 catalog augmentation produces noisy `pnpm install` warnings.** Every dep-mutating tool's post-install logs are flooded with `WARN Skip adding X to the default catalog because it already exists as ^N` (~20 lines per install). Likely root: the augmentation tries to register catalog entries that pnpm-workspace.yaml already declares. Cosmetic but degrades log signal-to-noise — investigate whether augmentation can pre-check before re-adding.

## Follow-up tickets

> Title + one-line summary + suggested file path / area. File the
> actual issue separately and link it back here once it has a number.

-
