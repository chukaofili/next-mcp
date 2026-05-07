import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ProjectConfigSchema } from '../../../src/index.js';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('scaffold_project tool — monorepo:minimal', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 60000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should scaffold a minimal monorepo with apps/web + workspace root files', async () => {
    const projectName = 'minimal-monorepo';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');

    // 1. apps/web/package.json exists
    expect(await fileExists(path.join(appPath, 'package.json'))).toBe(true);

    // 2. pnpm-workspace.yaml exists at workspace root (default packageManager is pnpm)
    expect(await fileExists(path.join(projectPath, 'pnpm-workspace.yaml'))).toBe(true);

    // 3. turbo.json exists at workspace root
    expect(await fileExists(path.join(projectPath, 'turbo.json'))).toBe(true);

    // 4. Root package.json exists at workspace root
    expect(await fileExists(path.join(projectPath, 'package.json'))).toBe(true);

    // 5. apps/web/package.json has name: '@<projectName>/web'
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.name).toBe(`@${projectName}/web`);

    // 6. apps/web/next.config.{ts,js,mjs} has output: 'standalone'
    const candidates = ['next.config.ts', 'next.config.mjs', 'next.config.js'];
    let nextConfigContent: string | null = null;
    for (const c of candidates) {
      const p = path.join(appPath, c);
      if (await fileExists(p)) {
        nextConfigContent = await fs.readFile(p, 'utf-8');
        break;
      }
    }
    expect(nextConfigContent).not.toBeNull();
    expect(nextConfigContent!).toMatch(/output:\s*['"]standalone['"]/);
  }, 120000);

  it('deletes create-next-app workspace leftovers in apps/web (B5 regression)', async () => {
    // create-next-app --use-pnpm leaves an apps/web/pnpm-workspace.yaml
    // (containing only `ignoredBuiltDependencies: [sharp, unrs-resolver]`)
    // and an apps/web/pnpm-lock.yaml. Both shadow the real workspace one
    // level up, breaking every later `pnpm <add|install>` from inside
    // apps/web with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND. scaffoldProject must
    // delete both files in monorepo modes after create-next-app returns.
    // See docs/plans/2026-05-05-monorepo-smoke-test.md → B5 + design doc
    // §6.4 for rationale; the assertion here mirrors smoke-v2 §4.0.
    const projectName = 'b5-regression';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const appPath = path.join(tempDir, projectName, 'apps', 'web');
    expect(await fileExists(path.join(appPath, 'pnpm-workspace.yaml'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'pnpm-lock.yaml'))).toBe(false);
  }, 120000);
});

describe('scaffold_project tool — monorepo:full', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 60000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('always emits eslint-config and typescript-config', async () => {
    const projectName = 'full-baseline';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);

    const eslintPkgPath = path.join(projectPath, 'packages', 'eslint-config', 'package.json');
    const tsPkgPath = path.join(projectPath, 'packages', 'typescript-config', 'package.json');

    expect(await fileExists(eslintPkgPath)).toBe(true);
    expect(await fileExists(tsPkgPath)).toBe(true);

    const eslintPkg = JSON.parse(await fs.readFile(eslintPkgPath, 'utf-8'));
    const tsPkg = JSON.parse(await fs.readFile(tsPkgPath, 'utf-8'));

    expect(eslintPkg.name).toBe(`@${projectName}/eslint-config`);
    expect(tsPkg.name).toBe(`@${projectName}/typescript-config`);
  }, 120000);

  it('full mode + postgres/prisma generates packages/db', async () => {
    const projectName = 'full-db-prisma';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const dbDir = path.join(projectPath, 'packages', 'db');

    expect(await fileExists(path.join(dbDir, 'package.json'))).toBe(true);
    expect(await fileExists(path.join(dbDir, 'tsconfig.json'))).toBe(true);
    expect(await fileExists(path.join(dbDir, 'eslint.config.mjs'))).toBe(true);

    const dbPkg = JSON.parse(await fs.readFile(path.join(dbDir, 'package.json'), 'utf-8'));
    expect(dbPkg.name).toBe(`@${projectName}/db`);
    expect(dbPkg.scripts['db:migrate']).toBe('prisma migrate dev');

    // Workspace exports point at compiled JS (./dist/...) so apps/web
    // resolves through Next.js's `exports` reader without needing
    // `transpilePackages`. The build script must produce those dist
    // files (prisma generate first, then tsc -b).
    expect(dbPkg.main).toBe('./dist/index.js');
    expect(dbPkg.types).toBe('./dist/index.d.ts');
    expect(dbPkg.exports['.']).toMatchObject({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
    expect(dbPkg.scripts.build).toContain('prisma generate');
    expect(dbPkg.scripts.build).toContain('tsc -b');
    // Cleaning includes the dist output so re-builds start fresh.
    expect(dbPkg.scripts.clean).toContain('dist');

    // Runtime deps that the generated client.ts + prisma.config.ts actually
    // import must be declared on packages/db, not apps/web. Under strict pnpm
    // a workspace package cannot resolve a dep declared only on a sibling.
    // The client.ts.template is dialect-agnostic now (bare PrismaClient),
    // so no adapter / driver deps are wired by default.
    expect(dbPkg.dependencies['@prisma/client']).toBeDefined();
    expect(dbPkg.dependencies.dotenv).toBeDefined();
    expect(dbPkg.devDependencies.prisma).toBeDefined();
    expect(dbPkg.dependencies['@prisma/adapter-pg']).toBeUndefined();
    expect(dbPkg.dependencies.pg).toBeUndefined();

    // The runtime db deps must not duplicate onto apps/web — apps/web
    // consumes db only via the workspace `@<project>/db: workspace:*` dep
    // (added later by setup_database via wireAppsWebToDbPackage; not yet
    // present after scaffold_project alone).
    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.['@prisma/adapter-pg']).toBeUndefined();
    expect(appPkg.dependencies?.['@prisma/client']).toBeUndefined();
    expect(appPkg.dependencies?.pg).toBeUndefined();
    expect(appPkg.dependencies?.dotenv).toBeUndefined();
    expect(appPkg.devDependencies?.prisma).toBeUndefined();

    // The `prebuild: prisma generate` script must NOT be added to apps/web
    // when prisma is routed to packages/db. apps/web has no prisma binary
    // (the dep moved to packages/db with the routed-deps fix), and
    // packages/db's own `build` script (prisma generate && tsc -b) covers
    // codegen — turbo's `^build` dependsOn ensures it runs before apps/web
    // builds.
    expect(appPkg.scripts?.prebuild).toBeUndefined();

    // apps/web declares both `typecheck` (no hyphen — turbo's task graph
    // and validate_project both call this exact name) and the legacy
    // `type-check` alias. Without `typecheck`, turbo silently skips
    // apps/web during root-level typechecking — TS errors in the main
    // app would slip through the validation pipeline.
    expect(appPkg.scripts?.typecheck).toBe('tsc --noEmit');
    expect(appPkg.scripts?.['type-check']).toBe('tsc --noEmit');

    // Docker helper scripts live on the workspace root in monorepo mode
    // (Dockerfile + docker-compose.yml are emitted there, not in apps/web).
    // Putting them on apps/web would point users at the wrong build context.
    expect(appPkg.scripts?.['docker:build']).toBeUndefined();
    expect(appPkg.scripts?.['docker:run']).toBeUndefined();
    expect(appPkg.scripts?.['docker:dev:up']).toBeUndefined();
    expect(appPkg.scripts?.['docker:dev:down']).toBeUndefined();

    // The root package.json has the docker:* scripts so `pnpm docker:build`
    // from the workspace root works.
    const rootPkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(rootPkg.scripts['docker:build']).toBe(`docker build -t ${projectName} .`);
    expect(rootPkg.scripts['docker:run']).toBe(`docker run -p 3000:3000 ${projectName}`);
    expect(rootPkg.scripts['docker:dev:up']).toBe('docker-compose -f docker-compose.yml up');
    expect(rootPkg.scripts['docker:dev:down']).toBe('docker-compose -f docker-compose.yml down');
  }, 120000);

  it('full mode + postgres/drizzle routes driver deps to packages/db', async () => {
    const projectName = 'full-db-drizzle-pg';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const dbPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'packages', 'db', 'package.json'), 'utf-8')
    );
    expect(dbPkg.dependencies['drizzle-orm']).toBeDefined();
    expect(dbPkg.dependencies.pg).toBeDefined();
    expect(dbPkg.dependencies.dotenv).toBeDefined();
    expect(dbPkg.devDependencies['drizzle-kit']).toBeDefined();

    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.['drizzle-orm']).toBeUndefined();
    expect(appPkg.dependencies?.pg).toBeUndefined();
    expect(appPkg.devDependencies?.['drizzle-kit']).toBeUndefined();
  }, 120000);

  it('full mode + mysql/drizzle routes mysql2 to packages/db', async () => {
    const projectName = 'full-db-drizzle-mysql';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'mysql',
        orm: 'drizzle',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const dbPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'packages', 'db', 'package.json'), 'utf-8')
    );
    expect(dbPkg.dependencies.mysql2).toBeDefined();

    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.mysql2).toBeUndefined();
  }, 120000);

  it('full mode + sqlite/drizzle routes better-sqlite3 to packages/db', async () => {
    const projectName = 'full-db-drizzle-sqlite';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'sqlite',
        orm: 'drizzle',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const dbPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'packages', 'db', 'package.json'), 'utf-8')
    );
    expect(dbPkg.dependencies['better-sqlite3']).toBeDefined();
    expect(dbPkg.devDependencies['@types/better-sqlite3']).toBeDefined();

    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.['better-sqlite3']).toBeUndefined();
    expect(appPkg.devDependencies?.['@types/better-sqlite3']).toBeUndefined();
  }, 120000);

  it('full mode + better-auth generates packages/auth', async () => {
    const projectName = 'full-auth';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const authPkgPath = path.join(projectPath, 'packages', 'auth', 'package.json');

    expect(await fileExists(authPkgPath)).toBe(true);

    const authPkg = JSON.parse(await fs.readFile(authPkgPath, 'utf-8'));
    expect(authPkg.name).toBe(`@${projectName}/auth`);
  }, 120000);

  it('full mode + shadcn generates packages/ui with components.json + utils', async () => {
    const projectName = 'full-ui';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'shadcn',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const uiDir = path.join(projectPath, 'packages', 'ui');

    expect(await fileExists(path.join(uiDir, 'package.json'))).toBe(true);
    expect(await fileExists(path.join(uiDir, 'components.json'))).toBe(true);
    expect(await fileExists(path.join(uiDir, 'src', 'lib', 'utils.ts'))).toBe(true);
    expect(await fileExists(path.join(uiDir, 'src', 'styles', 'globals.css'))).toBe(true);

    const uiPkg = JSON.parse(await fs.readFile(path.join(uiDir, 'package.json'), 'utf-8'));
    expect(uiPkg.name).toBe(`@${projectName}/ui`);

    // R1: shadcn's monorepo init emits packages/ui with its own
    // lint/format/typecheck scripts. The pre-R1 `ui:add` convenience
    // script (a wrapper around `shadcn add` from packages/ui) is not
    // emitted by shadcn — users invoke `shadcn add` directly via dlx
    // through the apps/web entry point post-R1, with the cross-workspace
    // alias routing in components.json sending primitives to packages/ui.
    expect(uiPkg.scripts).toBeDefined();
    expect(typeof uiPkg.scripts.lint).toBe('string');
    expect(typeof uiPkg.scripts.typecheck).toBe('string');

    // apps/web carries `@<project>/ui: workspace:*` so the rewritten
    // shadcn imports in generate_base_components (and any user code)
    // resolve through the workspace package — without this dep the
    // generated app couldn't reach packages/ui at all.
    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.[`@${projectName}/ui`]).toBe('workspace:*');
  }, 120000);

  it('full mode + orpc generates packages/orpc with router and middleware', async () => {
    const projectName = 'full-orpc';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        rpc: 'orpc',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const orpcDir = path.join(projectPath, 'packages', 'orpc');

    expect(await fileExists(path.join(orpcDir, 'package.json'))).toBe(true);

    const routerPath = path.join(orpcDir, 'src', 'router.ts');
    expect(await fileExists(routerPath)).toBe(true);
    const routerContent = await fs.readFile(routerPath, 'utf-8');
    expect(routerContent).toContain('AppRouter');

    expect(await fileExists(path.join(orpcDir, 'src', 'middleware', 'auth.ts'))).toBe(true);
    expect(await fileExists(path.join(orpcDir, 'src', 'procedures', 'health', 'router.ts'))).toBe(
      true
    );

    // The orpc package must NOT ship `test` / `test:integration` scripts
    // unless we also emit a vitest dep + the integration config they
    // reference. Today neither is scaffolded, so the scripts have to
    // stay absent — otherwise `pnpm --filter @<name>/orpc test` and the
    // root `turbo run test` would both fail immediately.
    const orpcPkg = JSON.parse(await fs.readFile(path.join(orpcDir, 'package.json'), 'utf-8'));
    expect(orpcPkg.scripts.test).toBeUndefined();
    expect(orpcPkg.scripts['test:integration']).toBeUndefined();
    expect(orpcPkg.devDependencies?.vitest).toBeUndefined();

    // apps/web is wired to the orpc workspace + has a callable RPC route.
    // Without these, `rpc: 'orpc'` would scaffold an unreachable package
    // and the user would see no RPC endpoint at runtime.
    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.[`@${projectName}/orpc`]).toBe('workspace:*');
    expect(appPkg.dependencies?.['@orpc/server']).toBeDefined();

    const routePath = path.join(
      projectPath,
      'apps',
      'web',
      'src',
      'app',
      'api',
      'rpc',
      '[[...rest]]',
      'route.ts'
    );
    expect(await fileExists(routePath)).toBe(true);
    const routeContent = await fs.readFile(routePath, 'utf-8');
    // Imports the router from the workspace package (not a relative
    // path), uses the RPCHandler from @orpc/server/fetch, and exposes
    // GET/POST so Next.js dispatches both verbs.
    expect(routeContent).toContain(`from '@${projectName}/orpc'`);
    expect(routeContent).toContain("from '@orpc/server/fetch'");
    expect(routeContent).toContain('export const GET = handle');
    expect(routeContent).toContain('export const POST = handle');
    // Placeholder must be substituted, not leaked.
    expect(routeContent).not.toContain('__ORPC_PACKAGE_IMPORT__');
  }, 120000);

  it('full mode + database:postgres + orm:none does NOT emit packages/db', async () => {
    const projectName = 'full-db-no-orm';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const dbDir = path.join(projectPath, 'packages', 'db');

    expect(await fileExists(dbDir)).toBe(false);
  }, 120000);

  it('emits turbo.json with build/lint/typecheck/test task entries when a runner is configured', async () => {
    const projectName = 'turbo-tasks-shape';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'vitest',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const turboPath = path.join(tempDir, projectName, 'turbo.json');
    expect(await fileExists(turboPath)).toBe(true);

    const turboRaw = await fs.readFile(turboPath, 'utf-8');
    const turbo = JSON.parse(turboRaw);

    expect(turbo.$schema).toBe('https://turbo.build/schema.json');
    expect(turbo.tasks).toBeDefined();
    expect(Object.keys(turbo.tasks).sort()).toEqual(
      ['build', 'clean', 'dev', 'lint', 'lint:fix', 'test', 'test:watch', 'typecheck'].sort()
    );
    expect(turbo.tasks.build.dependsOn).toEqual(['^build']);
    expect(turbo.tasks.build.outputs).toEqual(
      expect.arrayContaining(['.next/**', '!.next/cache/**', 'dist/**'])
    );
    expect(turbo.tasks.dev.persistent).toBe(true);
    expect(turbo.tasks.dev.cache).toBe(false);
    expect(turbo.tasks.lint.dependsOn).toEqual(['^build']);
    expect(turbo.tasks.typecheck.dependsOn).toEqual(['^build']);
    expect(turbo.tasks.test.dependsOn).toEqual(['^build']);
    expect(turbo.tasks['test:watch'].persistent).toBe(true);
    expect(turbo.tasks['test:watch'].cache).toBe(false);
  }, 120000);

  it('drops test/test:watch from turbo.json + root scripts when testing: none', async () => {
    // turbo 2 errors with "Could not find task `test`" when no workspace
    // implements the script. Shipping a broken `pnpm test` (or `pnpm
    // pipeline`) is worse than shipping no `pnpm test`, so the root
    // package.json prunes the test scripts AND turbo.json drops the
    // matching tasks when `testing: 'none'`.
    const projectName = 'turbo-no-tests';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });
    expect(client.isSuccess(result)).toBe(true);

    const projectPath = path.join(tempDir, projectName);
    const turbo = JSON.parse(await fs.readFile(path.join(projectPath, 'turbo.json'), 'utf-8'));
    expect(turbo.tasks.test).toBeUndefined();
    expect(turbo.tasks['test:watch']).toBeUndefined();
    // The non-test tasks survive intact.
    expect(turbo.tasks.build).toBeDefined();
    expect(turbo.tasks.lint).toBeDefined();
    expect(turbo.tasks.typecheck).toBeDefined();

    const rootPkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(rootPkg.scripts.test).toBeUndefined();
    expect(rootPkg.scripts['test:watch']).toBeUndefined();
    // `pipeline` is collapsed to `build lint` (no test task to run).
    expect(rootPkg.scripts.pipeline).toBe('turbo run build lint');
  }, 120000);

  it('globalPassThroughEnv contains only NODE_ENV when auth:none + database:none', async () => {
    const projectName = 'turbo-env-bare';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const turboPath = path.join(tempDir, projectName, 'turbo.json');
    const turbo = JSON.parse(await fs.readFile(turboPath, 'utf-8'));

    expect(turbo.globalPassThroughEnv).toEqual(['NODE_ENV']);
  }, 120000);

  it('globalPassThroughEnv contains DATABASE_URL but no better-auth vars when auth:none + database:postgres', async () => {
    const projectName = 'turbo-env-db-only';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const turboPath = path.join(tempDir, projectName, 'turbo.json');
    const turbo = JSON.parse(await fs.readFile(turboPath, 'utf-8'));

    expect(turbo.globalPassThroughEnv).toContain('NODE_ENV');
    expect(turbo.globalPassThroughEnv).toContain('DATABASE_URL');
    expect(turbo.globalPassThroughEnv).not.toContain('BETTER_AUTH_SECRET');
    expect(turbo.globalPassThroughEnv).not.toContain('BETTER_AUTH_URL');
    expect(turbo.globalPassThroughEnv).not.toContain('NEXT_PUBLIC_BETTER_AUTH_URL');
  }, 120000);

  it('globalPassThroughEnv contains all five vars when auth:better-auth + database:postgres', async () => {
    const projectName = 'turbo-env-full';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const turboPath = path.join(tempDir, projectName, 'turbo.json');
    const turbo = JSON.parse(await fs.readFile(turboPath, 'utf-8'));

    expect([...turbo.globalPassThroughEnv].sort()).toEqual(
      [
        'NODE_ENV',
        'DATABASE_URL',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'NEXT_PUBLIC_BETTER_AUTH_URL',
      ].sort()
    );
  }, 120000);

  it('rejects monorepo:full + auth:better-auth + database:none at schema-parse time', () => {
    // Previously: scaffold_project tolerated this combo and the test asserted
    // it did NOT emit packages/auth. Tier 3 promotes the underlying rule
    // (better-auth requires a database) to a Zod refine on
    // ProjectConfigSchema, so the combo can no longer reach scaffold dispatch.
    expect(() =>
      ProjectConfigSchema.parse({
        name: 'full-auth-no-db',
        architecture: {
          monorepo: 'full',
          database: 'none',
          orm: 'none',
          auth: 'better-auth',
          uiLibrary: 'none',
          testing: 'none',
          skipInstall: true,
        },
      })
    ).toThrow(ZodError);
  });
});
