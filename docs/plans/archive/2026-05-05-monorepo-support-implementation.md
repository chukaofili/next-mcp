# Monorepo Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `architecture.monorepo` (`'none' | 'minimal' | 'full'`) and `architecture.rpc` (`'none' | 'orpc'`) to `scaffold_project`, producing a Turborepo + workspaces layout (`apps/web/` + optional `packages/*`) with all four package managers supported. Update `setup_shadcn` to the new `--preset b0 --template next [--monorepo] --pointer` invocation, and rewire `setup_authentication` to install `@daveyplate/better-auth-ui` via the shadcn registry instead of as an npm package.

**Architecture:** Single source of truth (`config.architecture.monorepo`) routes file destinations through a `getAppPath` helper. `'minimal'` writes `apps/web/` plus root workspace files; `'full'` additionally generates conditional `packages/*` (eslint-config, typescript-config, plus db/auth/ui/orpc gated on other config fields). pnpm uses `pnpm-workspace.yaml` + catalogs; npm/yarn/bun get a substituted root `workspaces` field with literal versions.

**Tech Stack:** TypeScript, MCP SDK, Zod 4, Turborepo 2, pnpm/npm/yarn/bun workspaces, Vitest 4. The whole change set lives in `src/index.ts` plus new template wiring; templates already exist under `src/templates/`.

---

## Reference

- **Design doc:** `docs/plans/2026-05-05-monorepo-support-design.md`
- **Schema location:** `src/index.ts:113-161` (`ProjectConfigSchema`)
- **Constants location:** `src/index.ts:64-110` (`PACKAGE_VERSIONS`, `CREATE_NEXT_APP_VERSION`)
- **Tool dispatch:** `src/index.ts:262-281` (switch in `setRequestHandler`)
- **Tools:** `scaffoldProject` (416), `setupShadcn` (973), `setupDatabase` (TBD line), `setupAuthentication` (1754), `generateDockerfile` (TBD), `validateProject`, `generateReadme`
- **Existing tests:** `tests/unit/config.test.ts`, `tests/integration/tools/*.test.ts`

---

## Task Group A — Schema, Constants, Helpers

### Task A1: Add `monorepo` and `rpc` fields to schema with cross-field validation

**Files:**
- Modify: `src/index.ts:113-161` (`ProjectConfigSchema`)
- Test: `tests/unit/config.test.ts`

**Step 1: Write the failing test**

```ts
// in tests/unit/config.test.ts
describe('ProjectConfigSchema — monorepo & rpc', () => {
  it('defaults monorepo to "none" and rpc to "none"', () => {
    const c = ProjectConfigSchema.parse({ name: 'x', architecture: {} });
    expect(c.architecture.monorepo).toBe('none');
    expect(c.architecture.rpc).toBe('none');
  });

  it('accepts valid combinations', () => {
    expect(() => ProjectConfigSchema.parse({
      name: 'x',
      architecture: { monorepo: 'full', rpc: 'orpc' },
    })).not.toThrow();
  });

  it('rejects rpc:orpc without monorepo:full', () => {
    expect(() => ProjectConfigSchema.parse({
      name: 'x',
      architecture: { monorepo: 'minimal', rpc: 'orpc' },
    })).toThrow(/rpc.*orpc.*monorepo.*full/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- config.test`
Expected: FAIL — schema doesn't have those fields.

**Step 3: Implement**

Add to the `architecture` z.object():

```ts
monorepo: z.enum(['none', 'minimal', 'full']).default('none').describe('...'),
rpc: z.enum(['none', 'orpc']).default('none').describe('...'),
```

Add `.refine(...)` on the outer schema:

```ts
.refine(
  (cfg) => !(cfg.architecture.rpc === 'orpc' && cfg.architecture.monorepo !== 'full'),
  { message: 'rpc: "orpc" requires monorepo: "full"' }
)
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- config.test`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts tests/unit/config.test.ts
git commit -m "feat(schema): add monorepo and rpc architecture fields with cross-field validation"
```

---

### Task A2: Split `PACKAGE_VERSIONS` into `CATALOG_VERSIONS` and remove `@daveyplate/better-auth-ui`

**Files:**
- Modify: `src/index.ts:65-110`

**Step 1: Add `CATALOG_VERSIONS` const**

Just below `PACKAGE_VERSIONS`, add:

```ts
const CATALOG_VERSIONS: Record<string, string> = {
  '@types/node': '^25',
  typescript: '^6',
  eslint: '^10',
  vitest: '^4',
  dotenv: '^17',
  'better-auth': '^1',
  '@better-auth/api-key': '^1',
};
```

**Step 2: Remove `@daveyplate/better-auth-ui`**

Delete the line `'@daveyplate/better-auth-ui': '^3',` from `PACKAGE_VERSIONS`.

**Step 3: Verify build**

Run: `pnpm build`
Expected: succeeds. (TypeScript will flag any orphan reference; fix in Task G1.)

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: introduce CATALOG_VERSIONS and drop legacy better-auth-ui dep"
```

---

### Task A3: Add `getAppPath` and `getShadcnRunner` helpers

**Files:**
- Modify: `src/index.ts` (inside `NextMCPServer` class, near `getPackageRunner` at line 311)
- Test: `tests/unit/helpers.test.ts`

**Step 1: Failing test**

```ts
describe('getAppPath', () => {
  it('returns projectPath when monorepo:none', () => {
    expect(getAppPath({ architecture: { monorepo: 'none' } } as any, '/p'))
      .toBe('/p');
  });
  it('returns apps/web when monorepo:minimal', () => {
    expect(getAppPath({ architecture: { monorepo: 'minimal' } } as any, '/p'))
      .toBe('/p/apps/web');
  });
  it('returns apps/web when monorepo:full', () => {
    expect(getAppPath({ architecture: { monorepo: 'full' } } as any, '/p'))
      .toBe('/p/apps/web');
  });
});

describe('getShadcnRunner', () => {
  it.each([
    ['pnpm', 'pnpm dlx'],
    ['npm', 'npx'],
    ['yarn', 'yarn dlx'],
    ['bun', 'bunx --bun'],
  ])('%s -> %s', (pm, expected) => {
    expect(getShadcnRunner(pm)).toBe(expected);
  });
});
```

(Export the helpers from `src/index.ts` as named exports for testing.)

**Step 2: Run; expect FAIL**

**Step 3: Implement**

```ts
function getAppPath(config: ProjectConfig, projectPath: string): string {
  return config.architecture.monorepo === 'none'
    ? projectPath
    : path.join(projectPath, 'apps/web');
}

function getShadcnRunner(packageManager: string): string {
  switch (packageManager) {
    case 'pnpm': return 'pnpm dlx';
    case 'yarn': return 'yarn dlx';
    case 'bun':  return 'bunx --bun';
    case 'npm':
    default:     return 'npx';
  }
}
```

**Step 4: Run; expect PASS**

**Step 5: Commit**

```bash
git add src/index.ts tests/unit/helpers.test.ts
git commit -m "feat: add getAppPath and getShadcnRunner helpers"
```

---

### Task A4: Add `substituteCatalog` and `substituteProjectName` helpers

**Files:**
- Modify: `src/index.ts`
- Test: `tests/unit/helpers.test.ts`

**Step 1: Failing test**

```ts
describe('substituteProjectName', () => {
  it('replaces <projectName> placeholder', () => {
    expect(substituteProjectName('@<projectName>/web', 'my-app')).toBe('@my-app/web');
  });
});

describe('substituteCatalog', () => {
  const catalog = { typescript: '^6', '@types/node': '^25' };

  it('passes through for pnpm', () => {
    const json = '{"devDependencies":{"typescript":"catalog:"}}';
    expect(substituteCatalog(json, 'pnpm', catalog)).toBe(json);
  });

  it('substitutes literal versions for npm', () => {
    const json = '{"devDependencies":{"typescript":"catalog:","@types/node":"catalog:"}}';
    const result = JSON.parse(substituteCatalog(json, 'npm', catalog));
    expect(result.devDependencies.typescript).toBe('^6');
    expect(result.devDependencies['@types/node']).toBe('^25');
  });

  it('throws on unknown catalog entry', () => {
    const json = '{"dependencies":{"unknown-dep":"catalog:"}}';
    expect(() => substituteCatalog(json, 'npm', catalog))
      .toThrow(/unknown-dep/);
  });
});
```

**Step 2: Run; expect FAIL**

**Step 3: Implement**

```ts
function substituteProjectName(content: string, projectName: string): string {
  return content.replaceAll('<projectName>', projectName)
                .replaceAll('__PROJECT_NAME__', projectName);
}

function substituteCatalog(
  packageJsonContent: string,
  packageManager: string,
  catalog: Record<string, string>
): string {
  if (packageManager === 'pnpm') return packageJsonContent;

  const pkg = JSON.parse(packageJsonContent);
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (version === 'catalog:') {
        if (!(name in catalog)) {
          throw new Error(`No CATALOG_VERSIONS entry for "${name}" (required by ${section})`);
        }
        deps[name] = catalog[name];
      }
    }
  }
  return JSON.stringify(pkg, null, 2) + '\n';
}
```

**Step 4: PASS**

**Step 5: Commit**

```bash
git add src/index.ts tests/unit/helpers.test.ts
git commit -m "feat: add catalog substitution and project-name placeholder helpers"
```

---

## Task Group B — Multi-PM Dockerfile substitution

### Task B1: Implement `substituteDockerfilePlaceholders`

**Files:**
- Modify: `src/index.ts`
- Test: `tests/unit/helpers.test.ts`

**Step 1: Failing test (covers each PM and confirms `@<projectName>` substitution still works)**

```ts
describe('substituteDockerfilePlaceholders', () => {
  const tpl = `RUN __COREPACK_SETUP__\nFROM __BASE_IMAGE__\nRUN __PM_INSTALL__\nARG PACKAGE="@__PROJECT_NAME__/web"\nCOPY --from=deps /app/out/__LOCKFILE__ ./\n`;

  it('substitutes for pnpm', () => {
    const out = substituteDockerfilePlaceholders(tpl, 'pnpm', 'my-app');
    expect(out).toContain('FROM node:24-alpine');
    expect(out).toContain('pnpm install --frozen-lockfile');
    expect(out).toContain('pnpm-lock.yaml');
    expect(out).toContain('@my-app/web');
  });

  it('substitutes for bun (different base image)', () => {
    const out = substituteDockerfilePlaceholders(tpl, 'bun', 'my-app');
    expect(out).toContain('FROM oven/bun:1-alpine');
    expect(out).toContain('bun install --frozen-lockfile');
    expect(out).toContain('bun.lockb');
  });
});
```

**Step 2: Run; expect FAIL**

**Step 3: Implement** — see Dockerfile templating table in design doc.

**Step 4: PASS**

**Step 5: Commit**

```bash
git add src/index.ts tests/unit/helpers.test.ts
git commit -m "feat: substitute PM-specific placeholders in Dockerfile.monorepo"
```

---

### Task B2: Replace literal pnpm calls in `Dockerfile.monorepo` template with placeholders

**Files:**
- Modify: `src/templates/docker/Dockerfile.monorepo`

Walk through the file and replace literal pnpm/lockfile/base-image text with the placeholders consumed in B1: `__BASE_IMAGE__`, `__COREPACK_SETUP__`, `__PM__`, `__PM_DLX__`, `__PM_INSTALL__`, `__PM_RUN__`, `__LOCKFILE__`, `__CACHE_MOUNT__`. Re-verify by hand that the pnpm output still matches the previously-fixed file.

Run: visually diff against the prior pnpm-only file; values for `pnpm` should produce an identical Dockerfile.

**Step 4: Commit**

```bash
git add src/templates/docker/Dockerfile.monorepo
git commit -m "refactor(docker): templatize Dockerfile.monorepo with PM placeholders"
```

---

## Task Group C — `scaffold_project` monorepo flow (`'minimal'`)

### Task C1: Failing integration test for `'minimal'` scaffold

**Files:**
- Create: `tests/integration/tools/scaffold-project-monorepo.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mcpClient, makeTmpDir } from '../../helpers/mcp-test-client';

describe('scaffold_project — monorepo:minimal', () => {
  it('produces apps/web + workspace root files (pnpm)', async () => {
    const tmp = await makeTmpDir();
    await mcpClient.call('scaffold_project', {
      config: { name: 'mr-app', architecture: { monorepo: 'minimal', database: 'none', auth: 'none', uiLibrary: 'none', skipInstall: true } },
      targetPath: tmp,
    });
    const root = path.join(tmp, 'mr-app');
    await expect(fs.access(path.join(root, 'apps/web/package.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'pnpm-workspace.yaml'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'turbo.json'))).resolves.toBeUndefined();

    const apps = JSON.parse(await fs.readFile(path.join(root, 'apps/web/package.json'), 'utf-8'));
    expect(apps.name).toBe('@mr-app/web');

    const next = await fs.readFile(path.join(root, 'apps/web/next.config.ts'), 'utf-8').catch(() => fs.readFile(path.join(root, 'apps/web/next.config.mjs'), 'utf-8'));
    expect(next).toMatch(/output:\s*['"]standalone['"]/);
  }, 120000);
});
```

**Step 2: Run; expect FAIL**

---

### Task C2: Implement minimal monorepo scaffolding

**Files:**
- Modify: `src/index.ts:416-470` (`scaffoldProject` method)
- Modify: post-process helpers around `createDirectoryStructure`, `updatePackageJson`, `generateNextJSCustomCode`

**Sub-steps:**

1. After the existing `execCommand(createCommand, ...)` succeeds, branch on `config.architecture.monorepo !== 'none'`. In that case, the create-next-app `targetPath` should be `<projectPath>/apps/web`, not `<projectPath>`. Adjust `buildCreateNextAppCommand` so the project name passed to create-next-app becomes `apps/web` when in monorepo mode (or equivalently chdir the cwd appropriately).
2. Add a new method `scaffoldMonorepoRoot(config, projectPath)` that:
   - Writes `pnpm-workspace.yaml` (pnpm only) from the template, populating the `catalog:` block with `CATALOG_VERSIONS`.
   - For npm/yarn/bun: skip `pnpm-workspace.yaml`; instead inject `"workspaces": ["apps/*", "packages/*"]` into the root `package.json`.
   - Reads `package.json.template`, applies `substituteProjectName` (→ name) and `substituteCatalog` (per PM) and writes to `<projectPath>/package.json`.
   - Reads `tsconfig.json.template` → `<projectPath>/tsconfig.json`.
   - Reads `turbo.json.template` → `<projectPath>/turbo.json`.
   - Reads `.gitignore.template` → `<projectPath>/.gitignore` (merge if create-next-app already wrote one).
3. Add `forceStandaloneOutput(appPath)` that reads `next.config.{ts,js,mjs}`, ensures `output: 'standalone'` is set inside the exported config, writes back. Use a regex-based approach or simple AST.
4. Add `renameAppPackage(appPath, projectName)`: opens `apps/web/package.json`, sets `name: "@<projectName>/web"`, writes back.
5. Add `ensureEnvExample(appPath)`: writes `apps/web/.env.example` with the same content as the existing `.env.ci.template` (or a minimal placeholder) if create-next-app didn't make one.
6. Wire the order: `execCommand(create-next-app)` → `renameAppPackage` → `forceStandaloneOutput` → `ensureEnvExample` → `scaffoldMonorepoRoot` → existing `createDirectoryStructure`/`updatePackageJson` (path-aware) → `installDependencies`.
7. `installDependencies` must run from `projectPath` (workspace root) when monorepo, not from `apps/web`.

**Step 3: Run integration test from C1**

Run: `pnpm test:integration -- scaffold-project-monorepo`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(scaffold): generate apps/web + workspace root for monorepo:minimal"
```

---

### Task C3: Path-aware `createDirectoryStructure`, `updatePackageJson`, `generateNextJSCustomCode`

**Files:**
- Modify: `src/index.ts:438-440` and the implementations of those methods.

For each, replace `projectPath` with `getAppPath(config, projectPath)` so per-app file ops land inside `apps/web/` when monorepo.

Add unit tests asserting that the paths returned by these methods (extracted via factoring) match expectations for each `monorepo` value.

```bash
git add src/index.ts tests/unit/helpers.test.ts
git commit -m "refactor(scaffold): route per-app file ops through getAppPath"
```

---

## Task Group D — `'full'` mode `packages/*` generation

### Task D1: `'full'`-mode integration test (eslint-config + typescript-config always)

**Files:**
- Create: in `tests/integration/tools/scaffold-project-monorepo.test.ts` extend the `describe`.

```ts
it('full mode generates eslint-config and typescript-config', async () => {
  const tmp = await makeTmpDir();
  await mcpClient.call('scaffold_project', {
    config: { name: 'fmr', architecture: { monorepo: 'full', database: 'none', auth: 'none', uiLibrary: 'none', skipInstall: true } },
    targetPath: tmp,
  });
  const root = path.join(tmp, 'fmr');
  await expect(fs.access(path.join(root, 'packages/eslint-config/package.json'))).resolves.toBeUndefined();
  await expect(fs.access(path.join(root, 'packages/typescript-config/package.json'))).resolves.toBeUndefined();
  const ec = JSON.parse(await fs.readFile(path.join(root, 'packages/eslint-config/package.json'), 'utf-8'));
  expect(ec.name).toBe('@fmr/eslint-config');
});
```

**Step 2: Run; expect FAIL.**

### Task D2: Implement always-on `'full'` packages

**Files:**
- Modify: `src/index.ts`, add method `generateFullModePackages(config, projectPath)`.

```ts
private async generateFullModePackages(config: ProjectConfig, projectPath: string) {
  if (config.architecture.monorepo !== 'full') return;
  await this.copyPackageTemplate(config, projectPath, 'eslint-config');
  await this.copyPackageTemplate(config, projectPath, 'typescript-config');
  // Conditional packages added in D3-D6
}

private async copyPackageTemplate(config, projectPath, pkgName, srcSubdir = pkgName) {
  // Recursive copy of src/templates/packages/<srcSubdir>/ to <projectPath>/packages/<pkgName>/
  // Apply substituteProjectName + substituteCatalog (only to .json files) + .template extension stripping.
}
```

Hook `generateFullModePackages` into `scaffoldProject` after `scaffoldMonorepoRoot`.

**Step 3: PASS the D1 test.**

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(scaffold): emit eslint-config + typescript-config in monorepo:full"
```

### Task D3: Conditional `packages/db` (per ORM)

**Files:**
- Modify: `src/index.ts` (`generateFullModePackages` extension)
- Test: extend the integration test

```ts
it('full mode + prisma generates packages/db with prisma scripts', async () => {
  // ... database: 'postgres', orm: 'prisma'
  const pkg = JSON.parse(await fs.readFile(`${root}/packages/db/package.json`, 'utf-8'));
  expect(pkg.scripts['db:migrate']).toBe('prisma migrate dev');
});
```

In `generateFullModePackages`, after the always-on packages, branch on `config.architecture.database !== 'none'` and call `copyPackageTemplate(..., 'db', \`db/\${orm}\`)`. The shared `tsconfig.json.template` and `eslint.config.mjs.template` live one level up at `packages/db/` (not under the orm subdir) — flatten when copying.

**Step 4: Commit**

```bash
git commit -m "feat(scaffold): emit packages/db with ORM-specific package.json"
```

### Task D4: Conditional `packages/auth`

Similar shape to D3. Test asserts `packages/auth/package.json` has `name: '@<n>/auth'` and lists `better-auth: 'catalog:'` (or substituted literal version when not pnpm).

```bash
git commit -m "feat(scaffold): emit packages/auth when better-auth selected"
```

### Task D5: Conditional `packages/ui`

Similar. Also copies `components.json.template`, `src/lib/utils.ts.template`, `src/styles/globals.css.template`.

```bash
git commit -m "feat(scaffold): emit packages/ui when shadcn selected"
```

### Task D6: Conditional `packages/orpc`

Similar. Recursively copies the entire `packages/orpc/` template tree (including all middleware + procedures source). Test asserts the router file is present and exports `AppRouter`.

```bash
git commit -m "feat(scaffold): emit packages/orpc when rpc:orpc + monorepo:full"
```

---

## Task Group E — `setup_shadcn` updates

### Task E1: New init command format with `--monorepo` flag

**Files:**
- Modify: `src/index.ts:1005` (`setupShadcn`)
- Test: `tests/integration/tools/setup-shadcn.test.ts` extension

The new command:

```ts
const monorepoFlag = config.architecture.monorepo !== 'none' ? ' --monorepo' : '';
const runner = this.getShadcnRunner(config.architecture.packageManager);
const shadcnInitCommand = `${runner} shadcn@latest init --preset b0 --template next${monorepoFlag} --pointer`;
```

The cwd for `execCommand` becomes `getAppPath(config, projectPath)` (so init runs inside `apps/web` for monorepo).

When `monorepo === 'full'` and `uiLibrary === 'shadcn'`, `setup_shadcn` ALSO runs `shadcn init` against `<projectPath>/packages/ui` (after primitives are added there). Defer the `shadcn add --all` to `packages/ui` in that case so primitives land inside the package, not duplicated in `apps/web`.

Tests: assert the executed command for each PM matches the expected format.

```bash
git add src/index.ts tests/integration/tools/setup-shadcn.test.ts
git commit -m "feat(shadcn): use preset/template/pointer init format with --monorepo"
```

---

## Task Group F — `setup_database` monorepo branching

### Task F1: Route DB sources to `packages/db` in `'full'` mode

**Files:**
- Modify: `src/index.ts` `setupDatabase` and any helpers it calls.
- Test: `tests/integration/tools/setup-database.test.ts` extension.

For `monorepo === 'full'`:
- Place schema files (`prisma/schema.prisma`, `drizzle/...`) inside `packages/db/`.
- Place client/index source files inside `packages/db/src/`.
- Add a `@<n>/db: workspace:*` entry to `apps/web/package.json` dependencies.
- Rewrite any `apps/web` files that previously imported `@/lib/db` to import `@<n>/db` instead.

For `monorepo === 'minimal'` or `'none'`: existing behavior, paths derived through `getAppPath`.

```bash
git commit -m "feat(db): route schema and client into packages/db when monorepo:full"
```

---

## Task Group G — `setup_authentication` rewire to shadcn registry

### Task G1: Remove `@daveyplate/better-auth-ui` install + CSS import

**Files:**
- Modify: `src/index.ts:671` (the `additionalDeps['@daveyplate/better-auth-ui']` line — delete)
- Modify: `src/index.ts:1885-1892` (the globals.css import block — delete entirely)
- Test: `tests/integration/tools/setup-authentication.test.ts` — assert that `globals.css` is NOT modified, and that no npm package by that name is added to `package.json`.

```bash
git commit -m "feat(auth): remove legacy daveyplate/better-auth-ui npm install + css import"
```

### Task G2: Add shadcn-registry installs as part of `setupAuthentication`

**Files:**
- Modify: `src/index.ts` `setupAuthentication`

After the layout/component templates are dropped:

```ts
const runner = this.getShadcnRunner(config.architecture.packageManager);
const cwd = getAppPath(config, projectPath);
this.execCommand(`${runner} shadcn@latest add https://better-auth-ui.com/r/auth.json -y`, cwd, 'better-auth-ui auth registry');
this.execCommand(`${runner} shadcn@latest add https://better-auth-ui.com/r/settings.json https://better-auth-ui.com/r/user-button.json -y`, cwd, 'better-auth-ui settings/user-button registry');
```

(If `skipInstall` is true, skip these.)

Test: the integration test stubs `execCommand` and asserts both URLs are invoked.

```bash
git commit -m "feat(auth): install better-auth-ui via shadcn registry"
```

### Task G3: Route auth source to `packages/auth` in `'full'` mode

Mirrors F1: when `monorepo === 'full'` and `auth === 'better-auth'`, write `auth.ts` → `packages/auth/src/server.ts` and `auth-client.ts` → `packages/auth/src/client.ts`. Add an `index.ts` that re-exports both. Update `apps/web` imports.

```bash
git commit -m "feat(auth): route auth core into packages/auth when monorepo:full"
```

---

## Task Group H — `generate_dockerfile` monorepo

### Task H1: Pick template based on `monorepo` flag

**Files:**
- Modify: `src/index.ts` `generateDockerfile`

```ts
const templateName = config.architecture.monorepo === 'none'
  ? 'Dockerfile'
  : 'Dockerfile.monorepo';
let dockerfile = await fs.readFile(path.join(__dirname, 'templates/docker', templateName), 'utf-8');
if (templateName === 'Dockerfile.monorepo') {
  dockerfile = substituteDockerfilePlaceholders(dockerfile, config.architecture.packageManager, config.name!);
}
await fs.writeFile(path.join(projectPath, 'Dockerfile'), dockerfile);
```

Update `docker-compose.yml` build context: when monorepo, the build context is `.` (project root), and the Dockerfile path stays at the root.

Test: assert the generated `Dockerfile` for each PM contains the expected install command.

```bash
git commit -m "feat(docker): use Dockerfile.monorepo with PM substitution when monorepo:!=none"
```

---

## Task Group I — README + validate_project

### Task I1: README reflects workspace layout

**Files:**
- Modify: `src/index.ts` `generateReadme`

When `monorepo !== 'none'`, the generated README documents:
- Workspace layout (`apps/web`, `packages/*`)
- Root scripts (`pnpm dev`, `pnpm build`, etc., calling Turbo)
- Per-app commands

```bash
git commit -m "feat(readme): document workspace layout for monorepo projects"
```

### Task I2: validate_project runs from workspace root

**Files:**
- Modify: `src/index.ts` `validateProject`

When monorepo, replace `pnpm typecheck` etc. invoked at `projectPath` with `pnpm -r typecheck`/`pnpm -r lint`/`pnpm -r test` invoked at `projectPath` (workspace root).

```bash
git commit -m "feat(validate): run validation across workspaces in monorepo mode"
```

---

## Task Group J — End-to-end smoke

### Task J1: Full integration smoke (manual one-time)

Run by hand (skipped in CI by default):

```sh
mkdir -p /tmp/next-mcp-smoke && cd /tmp/next-mcp-smoke
node ~/projects/chukaofili/next-mcp/dist/index.js  # via inspector or direct call
# scaffold a full-mode pnpm + postgres + prisma + better-auth + shadcn + orpc project
cd <generated>
pnpm install
pnpm build
pnpm typecheck
docker build .
```

Document any rough edges discovered as follow-up tickets in the design doc.

```bash
git commit -m "docs(plans): smoke-test notes for monorepo support"
```

---

## Definition of Done

- All unit + integration tests pass: `pnpm test`
- A fresh full-mode pnpm project (with postgres/prisma/better-auth/shadcn/orpc) builds and typechecks
- A fresh minimal-mode npm project scaffolds without `pnpm-workspace.yaml` and with `workspaces` in root `package.json`
- A fresh full-mode bun project produces a working `Dockerfile.monorepo`
- Existing flat-mode projects still scaffold identically (regression check via existing tests)
- README + design doc cross-link

---

## Notes for the implementer

- **Read the design doc first** (`docs/plans/2026-05-05-monorepo-support-design.md`). It captures all the decisions and trade-offs that aren't obvious from the code.
- **Be ruthless about path correctness.** Every place that today says `projectPath` for a per-app concern needs to go through `getAppPath`. Workspace-root concerns (root package.json, turbo.json, pnpm-workspace.yaml) stay at `projectPath`.
- **Don't double-install.** `installDependencies` must run once at the workspace root, not once per package.
- **Test on all four package managers.** The catalog substitution and shadcn runner tables are the things most likely to break per-PM.
- **The `apps/web` create-next-app trick.** create-next-app expects a single project name. Either `cd` into a tmp dir before running it, or pass `apps/web` as the "name" and it'll create that nested directory structure. Pick whichever fits the existing `buildCreateNextAppCommand` cleanly.
