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

  it('emits turbo.json with build/lint/typecheck/test task entries', async () => {
    const projectName = 'turbo-tasks-shape';
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
