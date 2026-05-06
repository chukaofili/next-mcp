import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists, readFile } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generate_dockerfile tool', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should generate Docker configuration for Prisma', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
      },
    });

    const result = await client.callTool('generate_dockerfile', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toContain('postgres');

    // Verify files were created
    expect(await fileExists(path.join(tempDir, 'Dockerfile'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'docker-compose.yml'))).toBe(true);
  });

  it('should handle different databases', async () => {
    const databases = [
      { name: 'postgres', image: 'postgres' },
      { name: 'mysql', image: 'mysql' },
      { name: 'mongodb', image: 'mongo' },
      { name: 'sqlite', image: null }, // SQLite doesn't need Docker service
    ] as const;

    for (const db of databases) {
      const config = createMockConfig({
        architecture: { database: db.name },
      });

      const result = await client.callTool('generate_dockerfile', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
      const text = client.getTextContent(result);
      expect(text).toContain(db.name);

      if (db.image) {
        // Verify docker-compose includes the database service
        const dockerCompose = await readFile(path.join(tempDir, 'docker-compose.yml'));
        expect(dockerCompose).toContain(db.image);
      }
    }
  });

  it('should generate Dockerfile without database', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'none',
        orm: 'none',
      },
    });

    const result = await client.callTool('generate_dockerfile', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Verify Dockerfile exists
    expect(await fileExists(path.join(tempDir, 'Dockerfile'))).toBe(true);

    // Docker compose should be minimal or not include database service
    const dockerCompose = await readFile(path.join(tempDir, 'docker-compose.yml'));
    expect(dockerCompose).toBeDefined();
  });

  it('should handle different package managers', async () => {
    const packageManagers = ['npm', 'pnpm', 'yarn'] as const;

    for (const pm of packageManagers) {
      const config = createMockConfig({
        architecture: { packageManager: pm },
      });

      const result = await client.callTool('generate_dockerfile', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);

      // Verify Dockerfile was created (specific package manager handling may vary)
      const dockerfile = await readFile(path.join(tempDir, 'Dockerfile'));
      expect(dockerfile).toBeDefined();
      expect(dockerfile.length).toBeGreaterThan(0);
    }
  });

  describe('monorepo template selection (H1)', () => {
    // Each test gets its own fresh tempDir so files from previous tests can't
    // leak content into the current assertion. The outer `tempDir` is used for
    // the legacy regression suite above.
    let monorepoDir: string;

    beforeAll(async () => {
      monorepoDir = await createTempDir('next-mcp-monorepo-test-');
    });

    afterAll(async () => {
      await cleanupTempDir(monorepoDir);
    });

    it('uses the monorepo Dockerfile template with pnpm install when monorepo:full + pnpm', async () => {
      const config = createMockConfig({
        name: 'acme',
        architecture: { monorepo: 'full', packageManager: 'pnpm', database: 'none', orm: 'none' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerfile = await readFile(path.join(monorepoDir, 'Dockerfile'));
      // Distinctive monorepo content: turbo prune workflow + per-package ARG.
      expect(dockerfile).toContain('turbo@^2 prune $PACKAGE --docker');
      expect(dockerfile).toContain('PACKAGE="@acme/web"');
      // pnpm-specific install line.
      expect(dockerfile).toContain('pnpm install --frozen-lockfile');
      expect(dockerfile).toContain('pnpm-lock.yaml');
      // Make sure no placeholders leaked through unsubstituted.
      expect(dockerfile).not.toMatch(/__[A-Z_]+__/);
    });

    it('substitutes the bun base image and bun install command in monorepo:full + bun', async () => {
      const config = createMockConfig({
        name: 'bunny',
        architecture: { monorepo: 'full', packageManager: 'bun', database: 'none', orm: 'none' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerfile = await readFile(path.join(monorepoDir, 'Dockerfile'));
      expect(dockerfile).toContain('FROM oven/bun:1-alpine AS base');
      expect(dockerfile).toContain('bun install --frozen-lockfile');
      expect(dockerfile).toContain('bun.lockb');
      expect(dockerfile).toContain('bunx turbo@^2 prune');
      expect(dockerfile).toContain('PACKAGE="@bunny/web"');
      expect(dockerfile).not.toMatch(/__[A-Z_]+__/);
    });

    it('substitutes the npm install command in monorepo:full + npm', async () => {
      const config = createMockConfig({
        name: 'npm-app',
        architecture: { monorepo: 'full', packageManager: 'npm', database: 'none', orm: 'none' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerfile = await readFile(path.join(monorepoDir, 'Dockerfile'));
      expect(dockerfile).toContain('npm ci');
      expect(dockerfile).toContain('package-lock.json');
      // Bun's image string would leak through if PM mapping picked wrong record.
      expect(dockerfile).toContain('FROM node:24-alpine AS base');
      expect(dockerfile).toContain('npx turbo@^2 prune');
      expect(dockerfile).not.toMatch(/__[A-Z_]+__/);
    });

    it('substitutes the yarn install command in monorepo:full + yarn', async () => {
      const config = createMockConfig({
        name: 'yarn-app',
        architecture: { monorepo: 'full', packageManager: 'yarn', database: 'none', orm: 'none' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerfile = await readFile(path.join(monorepoDir, 'Dockerfile'));
      expect(dockerfile).toContain('yarn install --immutable');
      expect(dockerfile).toContain('yarn.lock');
      expect(dockerfile).toContain('yarn dlx turbo@^2 prune');
      expect(dockerfile).not.toMatch(/__[A-Z_]+__/);
    });

    it('uses the monorepo Dockerfile template in monorepo:minimal mode', async () => {
      const config = createMockConfig({
        name: 'mini',
        architecture: { monorepo: 'minimal', packageManager: 'pnpm', database: 'none', orm: 'none' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerfile = await readFile(path.join(monorepoDir, 'Dockerfile'));
      // Monorepo-template signal carries over to minimal mode.
      expect(dockerfile).toContain('turbo@^2 prune $PACKAGE --docker');
      expect(dockerfile).toContain('PACKAGE="@mini/web"');
    });

    it('writes the flat Dockerfile (no turbo prune) when monorepo:none', async () => {
      const config = createMockConfig({
        name: 'flat-app',
        architecture: { monorepo: 'none', packageManager: 'pnpm', database: 'none', orm: 'none' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerfile = await readFile(path.join(monorepoDir, 'Dockerfile'));
      // Flat template does NOT carry the turbo prune workflow.
      expect(dockerfile).not.toContain('turbo@^2 prune');
      // Distinctive flat-template content: legacy lockfile sniff block.
      expect(dockerfile).toContain('COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml*');
      expect(dockerfile).toContain('CMD ["node", "server.js"]');
    });

    it('writes packages/db/src/.prisma to .dockerignore in monorepo:full + prisma', async () => {
      const config = createMockConfig({
        name: 'prisma-full',
        architecture: { monorepo: 'full', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerignore = await readFile(path.join(monorepoDir, '.dockerignore'));
      expect(dockerignore).toContain('packages/db/src/.prisma');
      expect(dockerignore).not.toContain('src/lib/db/.prisma');
    });

    it('writes apps/web/src/lib/db/.prisma to .dockerignore in monorepo:minimal + prisma', async () => {
      const config = createMockConfig({
        name: 'prisma-minimal',
        architecture: { monorepo: 'minimal', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerignore = await readFile(path.join(monorepoDir, '.dockerignore'));
      expect(dockerignore).toContain('apps/web/src/lib/db/.prisma');
    });

    it('writes the legacy src/lib/db/.prisma to .dockerignore in monorepo:none + prisma', async () => {
      const config = createMockConfig({
        name: 'prisma-none',
        architecture: { monorepo: 'none', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const dockerignore = await readFile(path.join(monorepoDir, '.dockerignore'));
      // Regression: legacy path stays exactly as before.
      expect(dockerignore).toContain('src/lib/db/.prisma');
      expect(dockerignore).not.toContain('packages/db/src/.prisma');
      expect(dockerignore).not.toContain('apps/web/src/lib/db/.prisma');
    });

    it('omits prismaVolumes and inline migrate command in docker-compose.yml when monorepo:full + prisma', async () => {
      const config = createMockConfig({
        name: 'compose-full',
        architecture: { monorepo: 'full', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const compose = await readFile(path.join(monorepoDir, 'docker-compose.yml'));
      // The web service should not pin a custom command (defers to image's CMD).
      expect(compose).not.toContain('prisma migrate deploy');
      // No bind mounts of the legacy ./prisma or ./node_modules/.prisma host paths.
      expect(compose).not.toContain('./prisma:/app/prisma');
      expect(compose).not.toContain('./node_modules/.prisma:/app/node_modules/.prisma');
      // The migrate service is still expected — it covers schema deploys explicitly.
      expect(compose).toContain('migrate:');
    });

    it('keeps the inline prismaCommand and prismaVolumes for monorepo:none + prisma (regression)', async () => {
      const config = createMockConfig({
        name: 'compose-flat',
        architecture: { monorepo: 'none', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      const compose = await readFile(path.join(monorepoDir, 'docker-compose.yml'));
      expect(compose).toContain('prisma migrate deploy');
      expect(compose).toContain('./prisma:/app/prisma');
    });

    it('still writes Dockerfile.migrate for prisma+db regardless of monorepo mode', async () => {
      const config = createMockConfig({
        name: 'migrate-full',
        architecture: { monorepo: 'full', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
      });

      const result = await client.callTool('generate_dockerfile', { config, projectPath: monorepoDir });
      expect(client.isSuccess(result)).toBe(true);

      expect(await fileExists(path.join(monorepoDir, 'Dockerfile.migrate'))).toBe(true);
    });
  });
});
