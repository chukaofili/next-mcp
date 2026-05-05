# Monorepo Support — Design

## Goal

Allow `scaffold_project` to produce a workspaces + Turborepo monorepo where
the Next.js app lives at `apps/web/`, with optional shared packages under
`packages/`. Supports all four package managers (pnpm, npm, yarn, bun).
Downstream tools (`setup_database`, `setup_authentication`,
`generate_dockerfile`, etc.) understand the layout and write files to the
correct location.

## Schema

Two new fields on `architecture`:

```ts
monorepo: z
  .enum(['none', 'minimal', 'full'])
  .default('none')
  .describe(
    'Monorepo layout. `none` = flat project. `minimal` = workspaces + Turborepo with apps/web and an empty packages/ placeholder. `full` = minimal plus opinionated shared packages (eslint-config, typescript-config, and conditionally db/auth/ui/orpc based on the rest of the config).'
  );

rpc: z
  .enum(['none', 'orpc'])
  .default('none')
  .describe(
    'RPC layer. `orpc` generates an oRPC router with type-safe procedures. Only takes effect when `monorepo === \'full\'` (emits `packages/orpc`); ignored otherwise.'
  );
```

The set of generated `packages/*` is derived from `database`, `auth`,
`uiLibrary`, and `rpc`.

## Layout

### `monorepo: 'minimal'`

```
<project>/
├── apps/
│   └── web/                  # Next.js app (output of create-next-app)
├── packages/                 # empty, .gitkeep so the workspace glob has a target
├── package.json              # workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json             # solution-style, references apps/web
├── .gitignore
└── README.md
```

### `monorepo: 'full'`

Always-generated packages: `eslint-config`, `typescript-config`.

Conditional packages (driven by other config fields):

| Condition                       | Package         | Contents                                    |
| ------------------------------- | --------------- | ------------------------------------------- |
| `database !== 'none'`           | `packages/db`   | ORM schema + client export                  |
| `auth === 'better-auth'`        | `packages/auth` | Better Auth config + server/client utilities |
| `uiLibrary === 'shadcn'`        | `packages/ui`   | shadcn primitives + `cn` util               |
| `rpc === 'orpc'`                | `packages/orpc` | oRPC router, procedures, server adapter; `apps/web` mounts the handler and imports the client |

`apps/web` consumes them via workspace dependencies. Example tree with
`database: 'postgres'`, `orm: 'prisma'`, `auth: 'better-auth'`,
`uiLibrary: 'shadcn'`:

```
<project>/
├── apps/web/
├── packages/
│   ├── eslint-config/
│   ├── typescript-config/
│   ├── db/
│   ├── auth/
│   └── ui/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

## Package Naming

All generated packages are namespaced under the project name:

- `@<projectName>/web`
- `@<projectName>/db`
- `@<projectName>/auth`
- `@<projectName>/ui`
- `@<projectName>/orpc`
- `@<projectName>/eslint-config`
- `@<projectName>/typescript-config`

`<projectName>` is the validated `config.name` (already exists on
`ProjectConfigSchema`). Matches the convention in
`src/templates/docker/Dockerfile.monorepo` (`@__PROJECT_NAME__/web`).

## Workspace Tooling

Workspaces + Turborepo when `monorepo !== 'none'`. Turbo is always used; the
underlying workspace mechanism follows `architecture.packageManager`:

| PM    | Workspace declaration                                                  | Lockfile             |
| ----- | ---------------------------------------------------------------------- | -------------------- |
| pnpm  | `pnpm-workspace.yaml` (+ no `workspaces` field in root `package.json`) | `pnpm-lock.yaml`     |
| npm   | `workspaces: ["apps/*","packages/*"]` in root `package.json`           | `package-lock.json`  |
| yarn  | `workspaces: ["apps/*","packages/*"]` in root `package.json`           | `yarn.lock`          |
| bun   | `workspaces: ["apps/*","packages/*"]` in root `package.json`           | `bun.lockb`          |

### `pnpm-workspace.yaml` (pnpm only)

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":  { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "dev":    { "cache": false, "persistent": true },
    "lint":   { "dependsOn": ["^build"] },
    "test":   { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

### Root `package.json`

Scripts call into Turbo. Shape varies slightly by package manager:

```json
{
  "name": "<projectName>",
  "private": true,
  "scripts": {
    "build":     "turbo run build",
    "dev":       "turbo run dev",
    "lint":      "turbo run lint",
    "test":      "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": { "turbo": "^2" },
  "engines": { "node": ">=24" }
}
```

For npm/yarn/bun, also include `"workspaces": ["apps/*","packages/*"]`. For
pnpm, omit `workspaces` (handled by `pnpm-workspace.yaml`) and set
`packageManager: "pnpm@10"` plus `engines.pnpm: ">=10"`.

## Tool Routing

Downstream tools read `config.architecture.monorepo` to decide where to
write. No filesystem probing.

A small helper resolves the per-app path:

```ts
private getAppPath(config: ProjectConfig, projectPath: string): string {
  return config.architecture.monorepo === 'none'
    ? projectPath
    : path.join(projectPath, 'apps/web');
}
```

Tool-by-tool behavior:

| Tool                         | Behavior when `monorepo !== 'none'`                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scaffold_project`           | Run `create-next-app` into `apps/web`, then write workspace root files (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, root `tsconfig.json`, root `.gitignore`). When `monorepo === 'full'`, additionally generate the conditional `packages/*`. |
| `setup_shadcn`               | Operate inside `apps/web`. When `monorepo === 'full'`, generated primitives are emitted into `packages/ui` and `apps/web` is rewritten to import from `@<projectName>/ui`. |
| `setup_database`             | Schema and client live in `apps/web/src/lib/db` for `'minimal'`. For `'full'`, they live in `packages/db` and `apps/web` imports `@<projectName>/db`. |
| `setup_authentication`       | Same split: `'minimal'` → `apps/web/src/lib/auth`. `'full'` → `packages/auth`.                                     |
| `generate_base_components`   | Always inside `apps/web`. (Reusable primitives belong to `packages/ui` only when `'full'` + shadcn.)               |
| `generate_dockerfile`        | When `monorepo !== 'none'`, copy `Dockerfile.monorepo` template; substitute `__PROJECT_NAME__` and PM-specific placeholders (see Dockerfile templating). Update `docker-compose.yml` so build context is the workspace root. |
| `validate_project`           | Run validation from the workspace root (`pnpm -r typecheck`, `pnpm -r lint`).                                     |
| `generate_readme`            | Document workspace layout, root scripts, and per-app commands.                                                    |

## Scaffolding Sequence (when `monorepo !== 'none'`)

1. Create the project root directory `<targetPath>/<name>`.
2. Run `create-next-app` with output directed into `<projectPath>/apps/web`.
3. Write workspace root files: `package.json`, `pnpm-workspace.yaml`,
   `turbo.json`, root `tsconfig.json`, root `.gitignore`.
4. Rewrite `apps/web/package.json` `name` field to `@<projectName>/web`.
5. Ensure `apps/web/next.config.*` has `output: 'standalone'` (required by the
   monorepo Dockerfile).
6. If `monorepo === 'full'`, generate conditional `packages/*` and add their
   workspace deps to `apps/web/package.json`.
7. Install once at the root (`pnpm install`) unless `skipInstall` is true.

## Dockerfile Templating

`Dockerfile.monorepo` already uses `__PROJECT_NAME__` substitution. Extend
the same mechanism for package-manager-specific commands so a single template
serves all four PMs:

| Placeholder           | pnpm                              | npm                          | yarn                         | bun                          |
| --------------------- | --------------------------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| `__PM__`              | `pnpm`                            | `npm`                        | `yarn`                       | `bun`                        |
| `__PM_DLX__`          | `pnpm dlx`                        | `npx`                        | `yarn dlx`                   | `bunx`                       |
| `__PM_INSTALL__`      | `pnpm install --frozen-lockfile`  | `npm ci`                     | `yarn install --immutable`   | `bun install --frozen-lockfile` |
| `__PM_RUN__`          | `pnpm`                            | `npm run`                    | `yarn`                       | `bun run`                    |
| `__LOCKFILE__`        | `pnpm-lock.yaml`                  | `package-lock.json`          | `yarn.lock`                  | `bun.lockb`                  |
| `__COREPACK_SETUP__`  | `corepack enable && corepack prepare pnpm@latest --activate` | `corepack enable && corepack prepare npm@latest --activate` | `corepack enable && corepack prepare yarn@stable --activate` | (no-op; bun is preinstalled or installed via curl) |
| `__CACHE_MOUNT__`     | `--mount=type=cache,id=pnpm,target=/pnpm/store` | `--mount=type=cache,id=npm,target=/root/.npm` | `--mount=type=cache,id=yarn,target=/usr/local/share/.cache/yarn` | `--mount=type=cache,id=bun,target=/root/.bun/install/cache` |

The bun base image becomes `oven/bun:1-alpine` instead of `node:24-alpine`;
the `Dockerfile.monorepo` template uses a `__BASE_IMAGE__` placeholder for
this. (For Node-based PMs the base stays `node:24-alpine`.)

## Catalog Strategy

Several package.json templates declare dependencies as `"catalog:"` (e.g.
`"typescript": "catalog:"`, `"@types/node": "catalog:"`). pnpm reads these
from `pnpm-workspace.yaml`'s `catalog:` block. **Other package managers
don't support catalog references**, so we substitute at scaffold time.

**Source of truth**: a `CATALOG_VERSIONS` map in `src/index.ts` (extends or
replaces the existing `PACKAGE_VERSIONS` constant) holding `{ name → version }`
for every catalog entry.

**Substitution at scaffold time**:

| PM    | Behavior                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------- |
| pnpm  | Emit `pnpm-workspace.yaml` with `catalog:` block populated from `CATALOG_VERSIONS`. Leave `"catalog:"` references in package.json files untouched. |
| npm/yarn/bun | Skip `pnpm-workspace.yaml`. In every emitted package.json, walk `dependencies` / `devDependencies` and replace any value `"catalog:"` with `CATALOG_VERSIONS[name]`. Fail fast with a clear error if the catalog has no entry for the requested name. |

Templates always use `"catalog:"` so a single template body serves all four
PMs; the substitution layer is the only place package-manager logic lives.

## Better Auth UI — shadcn Registry Install

Better Auth UI moved from a single npm package (`@daveyplate/better-auth-ui`)
to a shadcn-registry distribution. Install method is now a registry add via
the shadcn CLI; the components are emitted as local files into the consuming
app/package, with `@better-auth-ui/react` and `@better-auth-ui/core` as the
underlying npm dependencies.

**`setup_authentication` runs (in addition to existing steps):**

```sh
<runner> shadcn@latest add https://better-auth-ui.com/r/auth.json
<runner> shadcn@latest add https://better-auth-ui.com/r/settings.json https://better-auth-ui.com/r/user-button.json
```

`<runner>` follows `architecture.packageManager`:

| PM    | Runner       |
| ----- | ------------ |
| pnpm  | `pnpm dlx`   |
| npm   | `npx`        |
| yarn  | `yarn dlx`   |
| bun   | `bunx --bun` |

**Files emitted by the registry** (auto-installed as registry dependencies):

- `src/components/auth/auth-provider.tsx` (and `error-toaster.tsx`)
- `src/components/auth/auth.tsx` (the new `<Auth />` component, replaces `<AuthView />`)
- `src/components/auth/sign-in.tsx`, `sign-up.tsx`, `forgot-password.tsx`,
  `reset-password.tsx`, `sign-out.tsx`
- `src/components/auth/settings/settings.tsx` (replaces `<AccountView />`)
- `src/components/auth/user/user-button.tsx`

**Templates we still own and write** (updated for new imports):

- `auth-ui-provider.tsx.template` → wraps the registry's `AuthProvider` with
  project-specific config (authClient, navigate via `useRouter`, Link). Lives
  at `src/providers/auth-ui-provider.tsx`.
- `auth-page.tsx.template` → mounts `<Auth path={path} />`.
- `account-page.tsx.template` → mounts `<Settings path={path} />`.
- `user-button.tsx.template` → re-exports the registry's `UserButton`.

**Removed**: the CSS import `@import "@daveyplate/better-auth-ui/css"` is no
longer needed (the shadcn registry components style themselves via the
project's tailwind/shadcn setup).

**Dependency changes (`PACKAGE_VERSIONS` in `src/index.ts`)**:

- Remove: `'@daveyplate/better-auth-ui': '^3'`
- The registry items declare `@better-auth-ui/react`, `@better-auth-ui/core`,
  `@tanstack/react-query`, `lucide-react`, and pull in the `sonner` shadcn
  registry item — all installed automatically by `shadcn add`. We don't need
  to track these in our `PACKAGE_VERSIONS` (shadcn handles it).

## shadcn `init` Command

`setup_shadcn` invokes shadcn's `init` with the **base preset, Next.js
template, and pointer mode**. Adds `--monorepo` when `architecture.monorepo`
is `'minimal'` or `'full'`:

```sh
# monorepo mode
<runner> shadcn@latest init --preset b0 --template next --monorepo --pointer

# flat mode
<runner> shadcn@latest init --preset b0 --template next --pointer
```

`<runner>` per PM:

| PM    | Runner       |
| ----- | ------------ |
| pnpm  | `pnpm dlx`   |
| npm   | `npx`        |
| yarn  | `yarn dlx`   |
| bun   | `bunx --bun` |

The user can later switch presets/templates with their own `shadcn init`.

## Template Inventory

### Already authored (root + per-package shells)

```
src/templates/
├── pnpm-workspace.yaml.template          # workspace + catalog (pnpm only)
├── package.json.template                 # root workspace package.json
├── tsconfig.json.template                # solution-style root tsconfig
├── turbo.json.template                   # turbo task pipelines
├── .gitignore.template                   # workspace-level gitignore
├── docker/Dockerfile.monorepo            # multi-PM monorepo Dockerfile
└── packages/
    ├── eslint-config/
    │   ├── package.json.template
    │   ├── base.js
    │   ├── next.js
    │   └── react-internal.js
    ├── typescript-config/
    │   ├── package.json.template
    │   ├── base.json
    │   ├── nextjs.json                  # extends base.json
    │   └── react-library.json
    ├── orpc/
    │   ├── package.json.template
    │   ├── tsconfig.json.template
    │   ├── eslint.config.mjs.template
    │   └── src/
    │       ├── index.ts.template
    │       ├── router.ts.template
    │       ├── types.ts.template
    │       ├── middleware/{auth,context,index,pipeline}.ts.template
    │       └── procedures/health/router.ts.template
    ├── db/
    │   ├── tsconfig.json.template
    │   ├── eslint.config.mjs.template
    │   ├── prisma/package.json.template
    │   ├── drizzle/package.json.template
    │   └── mongoose/package.json.template
    ├── auth/
    │   ├── package.json.template
    │   ├── tsconfig.json.template
    │   └── eslint.config.mjs.template
    └── ui/
        ├── package.json.template
        ├── tsconfig.json.template
        ├── eslint.config.mjs.template
        ├── components.json.template      # shadcn config for the package
        └── src/
            ├── lib/utils.ts.template     # cn() helper
            └── styles/globals.css.template
```

### Source-file mapping for `'full'` mode packages

The package shells above provide the wrapper (package.json, tsconfig,
eslint.config). The actual source files come from existing flat-layout
templates with destinations rewritten by the scaffold logic:

| Existing template                                        | Flat dest                          | `'full'` dest                             |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `database/prisma/index.ts.template`                      | `apps/web/src/lib/db/index.ts`     | `packages/db/src/index.ts`                |
| `database/prisma/client.ts.template`                     | `apps/web/src/lib/db/client.ts`    | `packages/db/src/client.ts`               |
| `database/drizzle/{client,index,schema,drizzle.config}.ts.template` | `apps/web/src/lib/db/...` | `packages/db/src/...`                     |
| `database/mongoose/{connection,index}.ts.template`       | `apps/web/src/lib/db/...`          | `packages/db/src/...`                     |
| `auth/auth.ts.template`                                  | `apps/web/src/lib/auth.ts`         | `packages/auth/src/server.ts`             |
| `auth/auth-client.ts.template`                           | `apps/web/src/lib/auth-client.ts`  | `packages/auth/src/client.ts`             |
| `auth/auth-route.ts.template`                            | `apps/web/src/app/api/auth/...`    | `apps/web/src/app/api/auth/...` (still in app — it's a Next.js route handler) |
| `auth/{auth,account,user-button}-*.template`             | `apps/web/...`                     | `apps/web/...` (page components stay in the app) |
| Prisma `schema.prisma`                                   | `apps/web/prisma/schema.prisma`    | `packages/db/prisma/schema.prisma`        |
| `next.config.template`                                   | project root                       | `apps/web/next.config.*`                  |

`packages/auth` exposes `index.ts` that re-exports `client` and `server`.
`apps/web` imports `@<projectName>/auth/server` for server code,
`@<projectName>/auth/client` for the React client.

`packages/ui` doesn't have shadcn primitives pre-baked — instead, it ships
with its own `components.json` so users (and our `setup_shadcn` tool) can
run `shadcn@latest add <component>` against the package itself, dropping
primitives into `packages/ui/src/components/`. `apps/web` imports them as
`@<projectName>/ui/components/<component>`.

## Constraints / Open Items

- **`.env.example` requirement.** The monorepo Dockerfile does
  `COPY $PACKAGE_PATH/.env* ./$PACKAGE_PATH/`. Scaffolding must always emit at
  least one `.env*` file in `apps/web` so the COPY doesn't fail.
- **`output: 'standalone'`.** Must be set in `apps/web/next.config.*` for the
  Dockerfile's standalone copy to work. Already a step in the sequence above.
- **`rpc === 'orpc'` requires `monorepo === 'full'`.** Validate at
  config-parse time and emit a clear error if the user sets `rpc: 'orpc'`
  without `monorepo: 'full'` (rather than silently ignoring it).
- **Existing tests.** `tests/` references the flat layout. Add a parallel
  monorepo integration test rather than modifying existing ones.
