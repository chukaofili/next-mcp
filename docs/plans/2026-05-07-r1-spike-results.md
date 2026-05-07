# R1 Phase 0 Spike — Results & Decision

> Phase 0 derisking spike for R1 (the monorepo+shadcn scaffolding refactor).
> Source spec: [`2026-05-07-monorepo-shadcn-refactor-design.md`](./2026-05-07-monorepo-shadcn-refactor-design.md).
> Companion procedure (post-R1): [`2026-05-07-monorepo-smoke-test-v2.md`](./2026-05-07-monorepo-smoke-test-v2.md).
> Driving prompt: [`refacto-prompt.md`](./refacto-prompt.md).
>
> Run on `feat/upgrade-packages` HEAD `3843166`, 2026-05-07. No code changes
> to next-mcp. The output is this written go/no-go and an annotated patch
> sketch for Phase 4.

---

## TL;DR — Recommendation: **Go for Phase 4**

The R1 architecture works. `pnpm install`, `pnpm typecheck`, and
`pnpm build` (apps/web → Next 16.1.6 standalone output) all came up
green on the manually-augmented `/tmp/r1-spike-1/r1-spike-1` after
applying the §6.2 augmentation list (with corrections, see below). No
augmentation step was a hard blocker. The shadcn-led scaffold is
fundamentally compatible with next-mcp's downstream tools.

The design doc's §6.2 augmentation list is **mostly right** but
**incomplete in three concrete ways** that Phase 4 must add:

1. The rename pass needs to *also* set `apps/web/package.json.name`
   from `web` → `@<projectName>/web` — a **new edit**, not part of the
   `@workspace/*` substring rewrite.
2. shadcn's `packages/typescript-config/base.json` is incompatible
   with what next-mcp templates assume; the right fix is *targeted
   per-package patches* (e.g. `types: ["node"]` on packages/orpc and
   any other Node-runtime package), **not** a wholesale base.json
   replacement.
3. `apps/web/next.config.mjs` (shadcn) does not declare
   `output: 'standalone'`. Phase 4's augmentation must patch this in;
   `generateNextJSCustomCode` writes to the wrong filename
   (`next.config.ts`, not `.mjs`) and the wrong layout (`src/app/...`
   vs shadcn's `app/...`). Both of these are §8.2 layout fallout.

**Update (2026-05-07, post-review):** the two "latent bugs" originally
filed below as B8 and B9 turned out to be either non-bugs or already
fixed:

- **B8 — withdrawn.** The original observation was that
  `packages/orpc/typecheck` failed with "Cannot find name 'process'"
  unless `types: ["node"]` was added to its tsconfig. Root cause was
  not the orpc template — it was that the spike inherited shadcn's
  `packages/typescript-config/base.json`, which declares
  `lib: ["es2022", "DOM", "DOM.Iterable"]`. That `lib` clamp shadows
  the default node-globals discovery. **next-mcp's own base.json has
  no `lib` clamp**, so in the real flow `@types/node` resolves
  automatically and orpc typechecks without any `types` field. The
  Phase 4 augmentation must therefore replace shadcn's `base.json`
  (and `nextjs.json` / `react-library.json`) with next-mcp's — that
  collapses this entire diagnostic into a single "swap the
  typescript-config" augmentation pass. **Not a bug in the orpc
  template; not a separate ticket.**
- **B9 — fixed.** `src/templates/packages/db/prisma/package.json.template`
  has been updated to ship `prisma: ^7` and `@prisma/client: ^7`,
  bringing the template into alignment with `PACKAGE_VERSIONS` and
  eliminating the dual source of truth.

---

## What was actually done

1. Reproduced the canonical scaffold at `/tmp/r1-spike-1/r1-spike-1`
   via `pnpm dlx shadcn@latest init --preset b0 --template next
   --monorepo --pointer --name r1-spike-1` (with `--silent`). Verified
   it is byte-identical to `/tmp/test-2` except for the `name` field
   in root `package.json`. (See §1 / §8.1 below.)
2. Applied the eleven §6.2 augmentation passes manually to the
   spike-1 scaffold. Documented each pass's outcome below.
3. Ran the runtime checks from smoke v2 §5: `pnpm install`,
   `pnpm typecheck`, `pnpm build` (per-package). Skipped
   `docker build` / `docker compose run --rm migrate` because they
   depend on `generate_dockerfile` output (out of R1 scope; templates
   align with the augmented layout — verified below).
4. Re-ran shadcn init with `--no-monorepo --name r1-spike-2` into
   `/tmp/r1-spike-2/r1-spike-2` to characterize the flat-dispatch
   shape (§6.3 / §8.4 / §8.6 inputs).

---

## §8 questions answered

### §8.1 — what does `--name` actually rename?

**Empirically verified.** `--name <NAME>` renames exactly two things:

1. The *directory* shadcn scaffolds into. Specifically: shadcn
   creates `<cwd>/<NAME>/` as a *subdirectory of cwd* and scaffolds
   inside it. It does **not** scaffold in-place even if `cwd` is
   empty. The driving prompt's `mkdir -p /tmp/r1-spike-1 && cd
   /tmp/r1-spike-1 && shadcn init --name r1-spike-1` produced
   `/tmp/r1-spike-1/r1-spike-1/` (double-nested) for this reason.

   **Implication for R1:** `scaffoldViaShadcnMonorepo` should pass
   `--cwd <parentDir> --name <projectName>` and let shadcn create
   `<projectName>` inside. Don't pre-create the project dir.

2. The root `package.json` `name` field (`"name": "<NAME>"`).

`--name` does **not** rename:

- The `@workspace/*` package scope. All 34 non-lockfile occurrences
  of `@workspace/...` in `/tmp/r1-spike-1/r1-spike-1/` are
  byte-identical to `/tmp/test-2`'s.
- Any nested `package.json` `name` field. Specifically:
  - `apps/web/package.json` `name === "web"` (just `"web"`, no
    scope) — **a literal `@workspace/` → `@<NAME>/` rewrite would
    skip this entirely.**
  - `packages/ui/package.json` `name === "@workspace/ui"` (handled
    by the rename pass).
  - `packages/eslint-config/package.json`, `packages/typescript-config/package.json`
    similarly carry `@workspace/...` names (handled).

**Concrete files containing `@workspace/...` that the rename pass
must rewrite** (verified by grep against the freshly-scaffolded
spike-1):

```
package.json (root devDeps)
tsconfig.json (extends)
README.md (sample import)
apps/web/package.json (deps)
apps/web/postcss.config.mjs (re-export)
apps/web/components.json (utils + ui aliases — components/hooks/lib stay local)
apps/web/tsconfig.json (extends + paths)
apps/web/eslint.config.js (import)
apps/web/next.config.mjs (transpilePackages)
apps/web/app/layout.tsx (import)
apps/web/app/page.tsx (import)
packages/ui/package.json (name + devDeps)
packages/ui/components.json (5 alias values)
packages/ui/tsconfig.json (extends + paths)
packages/ui/tsconfig.lint.json (extends)
packages/ui/eslint.config.js (import)
packages/ui/src/components/button.tsx (import)
packages/eslint-config/package.json (name)
packages/eslint-config/README.md
packages/typescript-config/package.json (name)
packages/typescript-config/README.md
```

Note that the rename touches **source files** (`.tsx`, `.mjs`), not
just configs. Design doc §6.2 step 1 already lists `.ts/.tsx/.js/.mjs`
in the file globs, so this is correctly covered there.

**Required correction to design doc §6.2 step 1:**
The augmentation must also explicitly set `apps/web/package.json.name`
to `@<projectName>/web`. The current §6.2 wording says "all
`package.json` `name` fields" but a literal substring rewrite of
`@workspace/` won't touch a field whose value is just `"web"`.
Same applies for any future package shadcn ships whose name happens
to lack the `@workspace/` prefix.

### §8.2 — `apps/web/src/` vs flat `apps/web/app/`

shadcn produces flat `apps/web/app/...`. The spike kept the flat
layout (design doc §8.2 recommendation (b)) and the build chain
worked. But the spike *also* surfaced two concrete code paths in
next-mcp that hard-code `src/` and `.ts` and need updating to match
flat-mode reality:

- `generateNextJSCustomCode` (`src/index.ts:2287-2310`) writes:
  - `next.config.ts` — but shadcn ships `next.config.mjs`. After
    `generateNextJSCustomCode` runs, **both files would exist**.
    Next.js's behavior with two configs is to prefer `.ts` if both
    are present, which would cause shadcn's `transpilePackages`
    setting to be lost. The augmentation must instead **patch**
    shadcn's existing `next.config.mjs` to add `output: 'standalone'`.
  - `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` — but
    shadcn's app is at `apps/web/app/`, not `apps/web/src/app/`.
    Result: privacy/terms pages would land at the wrong nesting
    level, unreachable by Next's router.
- `getAuthFilePaths`, `getAppPath`, and similar resolvers in
  `src/index.ts` assume `apps/web/src/...`. These need updating
  if R1 commits to flat layout.

**Empirical answer:** Flat layout works for the build pipeline. The
gap is Phase 4 implementation effort: the §8.2 fallout list is
larger than the design doc enumerated. **Recommend option (b)** as
the design doc said — adopt shadcn's flat convention — but budget
the per-template sweep accordingly.

### §8.3 — version-pin policy

**Empirically verified.** shadcn's monorepo init pins:

- `pnpm@9.15.9` (root `packageManager`) — overridden to `pnpm@10.18.0`
  by the augmentation.
- `engines.node: ">=20"` — overridden to `>=24`, with `engines.pnpm:
  >=10` added.
- `next: 16.1.6` (apps/web `dependencies`) — matches next-mcp's
  baseline; no override needed.
- `react: ^19.2.4` (apps/web `dependencies`) — matches.
- **`typescript: 5.9.3`** (root `devDependencies`, *literal pin*).
  **Design doc §8.3 claim "matches" is wrong.** next-mcp's
  `CATALOG_VERSIONS` (`src/index.ts:119-127`) declares
  `typescript: '^6'`. The spike confirmed this matters: with the
  shadcn-shipped `5.9.3` in place and the catalog block declaring
  `typescript: ^6`, the install picks up `5.9.3` (the literal wins).
  **Bumping the root pin to `^6`** caused pnpm to install
  `typescript@6.0.3` and was required for the catalog reference
  semantics to be coherent. Phase 4's pin-alignment augmentation
  must explicitly set `devDependencies.typescript = "^6"` (or
  remove the literal pin and let the catalog provide it).

**Required correction to design doc §8.3:** strike "(matches)" from
the typescript line; replace with: `typescript@5.9.3` (vs next-mcp's
catalog `^6` — must be overridden by the pin-alignment
augmentation). 

**No correction needed for the pnpm/node lines** — those were already
flagged as needing override.

### §8.4 — `monorepo: 'minimal'` semantics

Out of empirical scope this session (Phase 4 will exercise minimal
mode with full smoke). What the spike *does* tell us:

- shadcn's `--monorepo` flag scaffolds the full skeleton (apps/web +
  packages/ui + packages/eslint-config + packages/typescript-config)
  unconditionally. There is no shadcn flag to pre-prune to apps/web
  only.
- shadcn's `--no-monorepo` flag (verified in `/tmp/r1-spike-2`)
  produces a single-package flat app — no `apps/`, no `packages/`,
  no `pnpm-workspace.yaml`. Materially different shape from
  `--monorepo`'s output.
- The design doc §8.4 option (a) ("treat minimal as full skeleton
  but db/auth/orpc gated off") is implementable: just call
  `--monorepo` and skip the gated emitters. This is what the spike
  did (the spike didn't actually emit packages/db /auth /orpc; it
  copied them manually for runtime testing). The shadcn-emitted
  packages/ui + packages/eslint-config + packages/typescript-config
  are present in both "full" and what would be "minimal" — that's
  consistent with §8.4 option (a)'s recommendation.

**Recommendation stays (a) per design doc**, with the changelog note
the design doc already calls out (existing minimal users would see
new `packages/*` directories appear).

### §8.5 — guarding against shadcn CLI breaking changes

Policy decision deferred to Phase 4. Spike has no new data — but
notes that the shadcn CLI version visible in `pnpm dlx shadcn@latest
init` between my two spike invocations differed (next pin moved from
`16.1.6` → `16.1.7` between r1-spike-1 and r1-spike-2 runs done
minutes apart). Real-world drift risk is non-zero even within a
session. **Pinning to `shadcn@<known-good>`** in `scaffoldViaShadcnMonorepo`
is well-motivated.

### §8.6 — npm / yarn / bun

shadcn's CLI **does not** offer a `--packageManager` flag (verified
against `pnpm dlx shadcn@latest init --help`). What it always emits:

- Monorepo mode: `pnpm-workspace.yaml`, `package.json` with
  `packageManager: pnpm@9.15.9` and `engines.node: ">=20"`. The
  package manager pinning is *unconditional*.
- Flat mode: **no** `packageManager` field, **no** `pnpm-workspace.yaml`,
  no `engines` block. The flat output is package-manager-agnostic by
  default.

**Augmentation overrides required for non-pnpm in monorepo mode**
(this matches design doc §8.6's list, confirmed empirically):

- Override `packageManager` field (or delete it).
- Add `workspaces: ["apps/*", "packages/*"]` to root `package.json`
  (npm/yarn classic workspace declaration).
- Delete `pnpm-workspace.yaml` (catalog refs become literal versions
  via `substituteCatalog`).
- Run `<pm> install` instead of pnpm.

Flat mode + non-pnpm is simpler — no pnpm-workspace.yaml exists, so
the augmentation just runs `<pm> install` and is otherwise a no-op
on the package-manager axis.

---

## Augmentation pass-by-pass results (against §6.2)

The eleven passes from §6.2, applied to `/tmp/r1-spike-1/r1-spike-1`:

### 1. Project-scope rename — ✅ green, with addendum

`@workspace/` → `@r1-spike-1/` substring rewrite touched 21 files
(see §8.1 list above). **Plus** an explicit edit of
`apps/web/package.json.name` from `web` → `@r1-spike-1/web` (the
substring rewrite missed this because `web` is unscoped). Post-pass
grep shows zero `@workspace/` residue outside `pnpm-lock.yaml`
(which regenerates).

### 2. pnpm-workspace catalog block — ✅ green

Replaced the two-line `packages: ["apps/*", "packages/*"]` with the
seven-line catalog block that mirrors `src/templates/pnpm-workspace.yaml.template`.
`pnpm install` accepted it cleanly. (Several "Skip adding X to the
default catalog because it already exists" warnings appeared — these
are pnpm informationals when a package's `catalog:` reference is
already present in the workspace catalog. Not blocking.)

### 3. Pin alignment — ✅ green, but with §8.3 correction

Updated:
- `packageManager`: `pnpm@9.15.9` → `pnpm@10.18.0`
- `engines.node`: `>=20` → `>=24`
- `engines.pnpm`: `>=10` (added)
- `devDependencies.typescript`: `5.9.3` → `^6` (this was added later
  after typecheck failed; **design doc §8.3 missed this**, see §8.3
  above).

### 4. Layout decision — ✅ kept flat (§8.2 recommendation (b))

No-op for the spike, but flagged the §8.2 fallout in
`generateNextJSCustomCode` and path resolvers (above).

### 5. `.env*` at workspace root — ✅ green

Wrote `.env`, `.env.example`, `.env.local` with placeholder content
(`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/r1_spike_1`).

### 6. Docker scripts in root `package.json` — ✅ green

Added `docker:build`, `docker:run`, `docker:dev:up`, `docker:dev:down`
mirroring `scaffoldMonorepoRoot`'s lines 1543-1549.

### 7. dotenv-cli + auth:generate — skipped (prisma path, per spike scope)

Flag for Phase 4 / B1: per the smoke v1 finding B1, this conditional
is currently drizzle-only. Phase 3 (per the design doc's plan) will
either wire dotenv-cli for the prisma path or rewrite
`getAuthSchemaCommand` to use `<pm-dlx> dotenv-cli`. R1 inherits
whatever shape Phase 3 lands.

### 8. Test-script pruning — skipped (testing=vitest in this config)

### 9. Emit packages/db, packages/auth, packages/orpc — ⚠️ partial green

Copied the template trees with `<projectName>` substitution applied.
What landed:

- `packages/db/`: `eslint.config.mjs`, `tsconfig.json` (from db/ siblings),
  `package.json` (from db/prisma/) — **3 files, no `src/`**. (Real
  next-mcp flow: `setup_database` would emit `src/client.ts`,
  `src/index.ts`, `prisma/schema.prisma` afterwards.)
- `packages/auth/`: `eslint.config.mjs`, `tsconfig.json`, `package.json`,
  `src/re-exports.ts` — **4 files, partial `src/`**. (Real flow:
  `setup_authentication` adds `src/server.ts`, `src/client.ts`,
  `src/index.ts`.)
- `packages/orpc/`: full template tree, **11 files** including
  `src/router.ts`, `src/middleware/*`, `src/procedures/health/router.ts`.

**Surprise:** the templates use `catalog:` references in their
`package.json`s. For pnpm, this works — pnpm resolves catalog refs
against the workspace catalog block. For non-pnpm, `copyPackageTemplate`
in `src/index.ts:1615` calls `substituteCatalog` to resolve them to
literal versions. R1 needs the same hook (the spike skipped it for
pnpm; would surface as breakage for npm/yarn/bun).

### 10. patchDbWorkspacePackageJson — ✅ green, but B9 found

Merged `@prisma/client: ^7`, `dotenv: ^17`, devDep `prisma: ^7` into
`packages/db/package.json` (per `getDbDeps` for prisma+postgres in
`src/index.ts:228-238`).

**B9** (new): the template ships `@prisma/client: ^6` and `prisma: ^6`.
After the patcher merges, the values are `^7` (PACKAGE_VERSIONS wins
on key collision). This isn't a bug per se but the dual source of
truth for the prisma version is a code smell — should be reconciled.

### 11. updateGitignore + apps/web tweaks — ⚠️ partial

- `updateGitignore` (`src/index.ts:1462-1477`) operates on `appPath`
  (`apps/web`) and looks for `.env*` pattern to inject `!.env.ci`
  after. shadcn does NOT emit an `apps/web/.gitignore`, only a
  workspace-root `.gitignore`. **The current implementation no-ops
  silently in this case.** R1 must either:
  - Operate on the workspace-root `.gitignore` (which lists `.env`,
    `.env.local`, etc. enumerated — no wildcard, regex won't match)
    *and* add a `.env*` + `!.env.ci` pair if missing, or
  - Skip the `apps/web/.gitignore` operation explicitly when a shadcn
    scaffold is in use.
- `createDirectoryStructure` and `updatePackageJson` — not exercised
  in the spike; Phase 4 must verify they cope with shadcn's
  flat-layout `apps/web/`.
- `generateNextJSCustomCode` — see §8.2 fallout above (writes wrong
  filename + wrong path).

---

## Runtime-check results (smoke v2 §5 against augmented spike-1)

| Step | Result | Notes |
|------|--------|-------|
| `pnpm install` | ✅ green | 8 workspace projects resolved, 5.6s, no errors. The B5 "rogue `apps/web/pnpm-workspace.yaml`" condition is **eliminated by construction** — shadcn's init doesn't run `create-next-app --use-pnpm`, so the rogue file is never written. |
| `pnpm typecheck` | ✅ green (after fixes) | 5/5 packages. Required: stub `packages/db/src/index.ts` (real flow: setup_database emits) + `types: ["node"]` patch on `packages/orpc/tsconfig.json` (B8). |
| `pnpm build` (apps/web) | ✅ green | Next 16.1.6 standalone build, `apps/web/.next/standalone/apps/web/server.js` emitted. Required: patching `output: 'standalone'` into `apps/web/next.config.mjs`. |
| `pnpm build` (db) | ⚠️ blocked | `prisma generate` fails — no schema. Setup_database emits the schema in real flow; out of R1 scope. |
| `pnpm build` (orpc) | ✅ green | `tsc -b` produced `dist/`. Turbo emits a benign "no output files found" warning because `turbo.json`'s `outputs` for `build` doesn't list `dist/**`. Pre-existing, not R1-induced. |
| `docker build .` | 🔵 deferred | Requires `generate_dockerfile` output (unchanged by R1; templates align with the augmented layout). |
| `docker compose run --rm migrate` | 🔵 deferred | Requires schema + Dockerfile.migrate (same reasoning). |

The two ⚠️/🔵 items are **downstream-tool dependencies**, not R1
architectural risks. R1's scaffold + augmentation produces a
workspace whose paths align with what those tools expect.

---

## Patch sketch for the R1 implementation (Phase 4)

This is the order-of-operations that worked end-to-end in the manual
spike. Express in code as `scaffoldViaShadcnMonorepo(config, projectPath)`,
called from `scaffoldProject` per design doc §6.1.

```
scaffoldViaShadcnMonorepo(config, projectPath):
  // (0) Resolve target. shadcn creates `<cwd>/<name>/` so pass the parent.
  parentDir = path.dirname(projectPath)
  projectName = config.name

  // (1) Pinned shadcn invocation. Per §8.5, pin the version, don't @latest.
  exec(`pnpm dlx shadcn@<pinned> init --preset b0 --template next \
    --monorepo --pointer --silent --name ${projectName} --cwd ${parentDir}`)

  // After this returns, projectPath is populated with shadcn's monorepo
  // skeleton. apps/web is at flat layout (no src/).

  // (2) Project-scope rename — TWO things, not one:
  //   (2a) Substring rewrite @workspace/ → @<projectName>/ across
  //        all .json/.ts/.tsx/.js/.mjs/.md files (see §8.1 file list).
  //   (2b) Explicit edit: apps/web/package.json `name` from "web"
  //        → `@<projectName>/web`. The substring rewrite would miss
  //        this — `web` is unscoped.
  await renameWorkspaceScope(projectPath, projectName)
  await renameAppPackageJsonName(projectPath, projectName)

  // (3) Catalog block. Append next-mcp's `catalog:` block to the
  //     shadcn-shipped `pnpm-workspace.yaml` (currently just
  //     `packages: ["apps/*", "packages/*"]`). Reuse CATALOG_VERSIONS.
  await appendCatalogBlock(projectPath, CATALOG_VERSIONS)

  // (4) Pin alignment. Mutate root package.json:
  //     - packageManager: pnpm@10.18.0 (vs shadcn's 9.15.9)
  //     - engines.node: ">=24" (vs shadcn's ">=20")
  //     - engines.pnpm: ">=10" (add)
  //     - devDependencies.typescript: "^6" (vs shadcn's literal "5.9.3")
  //       — design doc §8.3 missed this; bump is required for catalog
  //       semantics.
  await alignPins(projectPath)

  // (5) Layout — keep flat. Don't move shadcn's app/ under src/.
  //     Phase 4 must update next-mcp's path resolvers (getAppPath,
  //     getAuthFilePaths, etc.) to accept the flat layout when
  //     uiLibrary === 'shadcn'.

  // (6) .env, .env.example, .env.local at workspace root.
  await ensureEnvFilesAtRoot(projectPath, config)

  // (7) Docker scripts in root package.json (mirror lines 1543-1549
  //     of current scaffoldMonorepoRoot).
  await addDockerScripts(projectPath, projectName)

  // (8) Conditional: dotenv-cli + auth:generate (drizzle path; B1
  //     fix in Phase 3 may also extend this to prisma).
  if (getAuthGenerateScript(config)) {
    await addAuthGenerateWiring(projectPath, config)
  }

  // (9) Conditional: prune test scripts when testing === 'none'.
  if (config.architecture.testing === 'none') {
    await pruneTestScripts(projectPath)
  }

  // (10) Conditional packages: db / auth / orpc (per existing
  //      hasDbPackageEmitted / hasAuthPackageEmitted / hasOrpcPackageEmitted
  //      gates). Reuse copyPackageTemplate — applies <projectName>
  //      and substituteCatalog.
  if (hasDbPackageEmitted(config)) {
    await copyPackageTemplate(config, projectPath, 'db', ORM_PACKAGE_SUBDIR[orm])
    await patchDbWorkspacePackageJson(config, projectPath)  // (B9: reconcile dual source of truth eventually)
  }
  if (hasAuthPackageEmitted(config)) await copyPackageTemplate(...)
  if (hasOrpcPackageEmitted(config)) await copyPackageTemplate(...)

  // (11) Replace shadcn's typescript-config files with next-mcp's.
  //      shadcn ships `packages/typescript-config/{base,nextjs,react-library}.json`
  //      with a restrictive `lib: ["es2022", "DOM", "DOM.Iterable"]`
  //      that shadows the default node-globals resolution and breaks
  //      `tsc --noEmit` for non-Next packages (the original "B8"
  //      observation). next-mcp's own `src/templates/packages/typescript-config/`
  //      doesn't clamp `lib`, so swapping it in resolves typecheck
  //      across all packages with no per-package patches.
  //      Heads up: next-mcp's `base.json` declares `composite: true`,
  //      and apps/web's shadcn-emitted `tsconfig.json` doesn't carry
  //      `references`. If composite stays on after the swap, apps/web
  //      surfaces TS6307 ("File ... not listed within the file list
  //      of project ..."). Phase 4 must either (a) override
  //      `composite` to false in `apps/web/tsconfig.json`, or (b)
  //      drop `composite: true` from next-mcp's base.json (it's
  //      load-bearing for project-references mode, which next-mcp
  //      doesn't actually use). (b) is cleaner.
  await replaceTypescriptConfigPackage(projectPath)

  // (12) Patch apps/web/next.config.mjs with `output: 'standalone'`
  //      INSTEAD of running generateNextJSCustomCode's existing
  //      next.config.ts emission (which would create a duplicate
  //      file in the wrong format). Ditto: privacy/terms pages
  //      land at apps/web/app/privacy/page.tsx — not src/app/...
  await patchNextConfigMjs(projectPath)
  await emitFlatLayoutPages(projectPath)  // privacy/terms

  // (13) updateGitignore. Operate on workspace-root .gitignore
  //      since shadcn doesn't emit apps/web/.gitignore. Add `.env*`
  //      and `!.env.ci` lines if missing.
  await updateGitignore(projectPath)
```

`scaffoldViaShadcnFlat` (§6.3) is a much smaller helper:

```
scaffoldViaShadcnFlat(config, projectPath):
  exec(`pnpm dlx shadcn@<pinned> init --preset b0 --template next \
    --no-monorepo --pointer --silent --name ${projectName} --cwd ${parentDir}`)
  // shadcn's flat output has no @workspace/, no packageManager, no
  // pnpm-workspace.yaml. Just augment with what next-mcp's flat
  // mode currently emits via scaffoldFlat (docker scripts in app's
  // package.json, .env files, layout fixups, conditional db/auth
  // routed to apps/<name>/src/lib/db etc.).
  await augmentFlat(config, projectPath)
```

---

## Findings to fold back into design doc / new tickets

- **§8.1 correction**: rename pass needs `apps/web/package.json.name`
  edit as a separate step (not just substring rewrite). Update §6.2
  step 1 wording.
- **§8.3 correction**: strike "(matches)" from typescript pin line.
  next-mcp catalog has `^6`; shadcn ships literal `5.9.3`. Override
  required.
- **§6.2 step 4 expansion**: layout-flat decision has knock-on
  effects in `generateNextJSCustomCode` (writes wrong filename +
  wrong path), `getAppPath`, `getAuthFilePaths`, etc. Enumerate
  these in the §8.2 fallout list.
- **§6.2 step 11 clarification**: `updateGitignore` no-ops on shadcn
  output (no `apps/web/.gitignore`, root `.gitignore` regex doesn't
  match). Decide: extend it to operate on workspace root, or skip
  for shadcn paths.
- **§6.2 add a step**: replace shadcn's `packages/typescript-config/`
  contents (`base.json`, `nextjs.json`, `react-library.json`) with
  next-mcp's own. shadcn's `base.json` clamps `lib` to
  `["es2022", "DOM", "DOM.Iterable"]`, which suppresses node-globals
  resolution for non-Next packages. Phase 4 also needs to decide on
  `composite` — see the patch sketch's pass (11) note.
- **B8 — withdrawn.** See "Update" note in the TL;DR — the
  observed error was caused by shadcn's restrictive
  `packages/typescript-config/base.json` `lib` clamp, not by anything
  in next-mcp's orpc template. Folded into the Phase 4 augmentation
  task to swap shadcn's typescript-config out for next-mcp's.
- **B9 — fixed.** Prisma version aligned in
  `src/templates/packages/db/prisma/package.json.template`.

---

## Reference scaffolds preserved

- `/tmp/test-2` — original canonical reference (untouched).
- `/tmp/r1-spike-1/r1-spike-1` — augmented spike, full-mode, post all
  passes including runtime patches. Buildable; `pnpm install`,
  `pnpm typecheck`, and apps/web `pnpm build` all green.
- `/tmp/r1-spike-2/r1-spike-2` — flat-mode reference (`--no-monorepo`).
  Not augmented; kept as a shape reference for §6.3 and §8.6.
