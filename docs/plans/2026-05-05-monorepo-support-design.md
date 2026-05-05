# Monorepo Support — Design

## Goal

Allow `scaffold_project` to produce a pnpm-workspaces + Turborepo monorepo
where the Next.js app lives at `apps/web/`, with optional shared packages
under `packages/`. Downstream tools (`setup_database`, `setup_authentication`,
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
