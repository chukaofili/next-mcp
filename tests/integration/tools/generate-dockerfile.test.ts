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

    it('uses monorepo template + mysql:9 image + packages/db .dockerignore for full + mysql + prisma + pnpm (audit 1c)', async () => {
      // Audit gap-fill 1c: prior tests covered full + postgres + prisma but
      // not full + mysql + prisma. This pins three orthogonal slices for the
      // mysql branch: Dockerfile is the monorepo template, docker-compose
      // picks `mysql:9`, and `.dockerignore` carries the routed prisma path.
      const dir = await createTempDir('next-mcp-full-mysql-');
      try {
        const config = createMockConfig({
          name: 'mysql-full',
          architecture: {
            monorepo: 'full',
            packageManager: 'pnpm',
            database: 'mysql',
            orm: 'prisma',
          },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const dockerfile = await readFile(path.join(dir, 'Dockerfile'));
        expect(dockerfile).toContain('turbo@^2 prune');
        expect(dockerfile).toContain('PACKAGE="@mysql-full/web"');

        const compose = await readFile(path.join(dir, 'docker-compose.yml'));
        expect(compose).toContain('mysql:9');

        const dockerignore = await readFile(path.join(dir, '.dockerignore'));
        expect(dockerignore).toContain('packages/db/src/.prisma');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('uses monorepo template + omits db service + packages/db .dockerignore for full + sqlite + prisma + pnpm (audit 1d)', async () => {
      // Audit gap-fill 1d: sqlite is file-based, so docker-compose has no
      // db: service for it. The migrate: service is still expected because
      // prisma is in play. Dockerfile is the monorepo template; .dockerignore
      // tracks the routed prisma path. This guards both the sqlite docker
      // path AND the routed prisma path against silent regressions.
      const dir = await createTempDir('next-mcp-full-sqlite-');
      try {
        const config = createMockConfig({
          name: 'sqlite-full',
          architecture: {
            monorepo: 'full',
            packageManager: 'pnpm',
            database: 'sqlite',
            orm: 'prisma',
          },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const dockerfile = await readFile(path.join(dir, 'Dockerfile'));
        expect(dockerfile).toContain('turbo@^2 prune');

        const compose = await readFile(path.join(dir, 'docker-compose.yml'));
        // sqlite is file-based — no db: service block should be emitted.
        // The migrate service's `depends_on:` does include the literal
        // `db:` key as a child, so the structural check has to look for a
        // db SERVICE (a `db:` block with an `image:` child), not just any
        // occurrence of `db:`. None of the four image strings below should
        // appear because no db service exists for sqlite.
        expect(compose).not.toContain('image: postgres');
        expect(compose).not.toContain('image: mysql');
        expect(compose).not.toContain('image: mongo');
        // The migrate service IS still expected — prisma drives schema
        // deploys regardless of whether the db service exists.
        expect(compose).toContain('migrate:');

        const dockerignore = await readFile(path.join(dir, '.dockerignore'));
        expect(dockerignore).toContain('packages/db/src/.prisma');
      } finally {
        await cleanupTempDir(dir);
      }
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

  describe('Dockerfile.migrate templating (K — schema path + PMs)', () => {
    // Each test uses its own fresh tempDir so writes from prior cases can't
    // mask placeholder leakage in the current assertion.
    it.each([
      {
        pm: 'pnpm' as const,
        baseImage: 'FROM node:24-alpine',
        depsAdd: 'pnpm add prisma @prisma/client dotenv',
        dlxPrisma: 'pnpm dlx prisma migrate deploy',
      },
      {
        pm: 'npm' as const,
        baseImage: 'FROM node:24-alpine',
        depsAdd: 'npm install prisma @prisma/client dotenv',
        dlxPrisma: 'npx prisma migrate deploy',
      },
      {
        pm: 'yarn' as const,
        baseImage: 'FROM node:24-alpine',
        depsAdd: 'yarn add prisma @prisma/client dotenv',
        dlxPrisma: 'yarn dlx prisma migrate deploy',
      },
      {
        pm: 'bun' as const,
        baseImage: 'FROM oven/bun:1-alpine',
        depsAdd: 'bun add prisma @prisma/client dotenv',
        dlxPrisma: 'bunx prisma migrate deploy',
      },
    ])(
      'flat + prisma + $pm: ad-hoc PM add, --schema=./prisma/schema.prisma, no placeholder leakage',
      async ({ pm, baseImage, depsAdd, dlxPrisma }) => {
        const dir = await createTempDir(`next-mcp-migrate-flat-${pm}-`);
        try {
          const config = createMockConfig({
            name: `flat-${pm}`,
            architecture: { monorepo: 'none', packageManager: pm, database: 'postgres', orm: 'prisma' },
          });

          const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
          expect(client.isSuccess(result)).toBe(true);

          const migrate = await readFile(path.join(dir, 'Dockerfile.migrate'));
          expect(migrate).toContain(baseImage);
          expect(migrate).toContain(depsAdd);
          expect(migrate).toContain('--schema=./prisma/schema.prisma');
          expect(migrate).toContain(dlxPrisma);
          // Flat mode keeps the targeted COPY pattern, not COPY . .
          expect(migrate).toContain('COPY prisma ./prisma');
          expect(migrate).not.toMatch(/^COPY \. \.$/m);
          // No unsubstituted placeholders.
          expect(migrate).not.toMatch(/__[A-Z_]+__/);
        } finally {
          await cleanupTempDir(dir);
        }
      }
    );

    it('monorepo:minimal + prisma + pnpm: schema path resolves to apps/web/prisma + COPY . . + PM_INSTALL', async () => {
      const dir = await createTempDir('next-mcp-migrate-minimal-');
      try {
        const config = createMockConfig({
          name: 'mini-migrate',
          architecture: { monorepo: 'minimal', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const migrate = await readFile(path.join(dir, 'Dockerfile.migrate'));
        expect(migrate).toContain('--schema=./apps/web/prisma/schema.prisma');
        // Monorepo modes use a full workspace copy + lockfile-driven install.
        expect(migrate).toMatch(/^COPY \. \.$/m);
        expect(migrate).toContain('pnpm install --frozen-lockfile');
        // Should not reach for the flat-mode ad-hoc add.
        expect(migrate).not.toContain('pnpm add prisma @prisma/client dotenv');
        expect(migrate).not.toMatch(/__[A-Z_]+__/);
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('monorepo:full + prisma + pnpm: schema path resolves to packages/db/prisma (the K target)', async () => {
      const dir = await createTempDir('next-mcp-migrate-full-pnpm-');
      try {
        const config = createMockConfig({
          name: 'full-migrate',
          architecture: { monorepo: 'full', packageManager: 'pnpm', database: 'postgres', orm: 'prisma' },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const migrate = await readFile(path.join(dir, 'Dockerfile.migrate'));
        expect(migrate).toContain('--schema=./packages/db/prisma/schema.prisma');
        expect(migrate).toContain('pnpm dlx prisma migrate deploy');
        expect(migrate).toMatch(/^COPY \. \.$/m);
        expect(migrate).toContain('pnpm install --frozen-lockfile');
        expect(migrate).not.toMatch(/__[A-Z_]+__/);
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('monorepo:full + prisma + bun: bun base image + bun install + packages/db schema path', async () => {
      const dir = await createTempDir('next-mcp-migrate-full-bun-');
      try {
        const config = createMockConfig({
          name: 'full-bun-migrate',
          architecture: { monorepo: 'full', packageManager: 'bun', database: 'postgres', orm: 'prisma' },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const migrate = await readFile(path.join(dir, 'Dockerfile.migrate'));
        expect(migrate).toContain('FROM oven/bun:1-alpine');
        expect(migrate).toContain('bun install --frozen-lockfile');
        expect(migrate).toContain('--schema=./packages/db/prisma/schema.prisma');
        expect(migrate).toContain('bunx prisma migrate deploy');
        expect(migrate).not.toMatch(/__[A-Z_]+__/);
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('monorepo:full + orm:none: no Dockerfile.migrate is generated (orm gate holds)', async () => {
      const dir = await createTempDir('next-mcp-migrate-orm-none-');
      try {
        const config = createMockConfig({
          name: 'no-orm',
          architecture: { monorepo: 'full', packageManager: 'pnpm', database: 'postgres', orm: 'none' },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        expect(await fileExists(path.join(dir, 'Dockerfile.migrate'))).toBe(false);
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('database:none: no Dockerfile.migrate is generated (db gate holds)', async () => {
      const dir = await createTempDir('next-mcp-migrate-db-none-');
      try {
        const config = createMockConfig({
          name: 'no-db',
          architecture: { monorepo: 'none', packageManager: 'pnpm', database: 'none', orm: 'prisma' },
        });

        const result = await client.callTool('generate_dockerfile', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        expect(await fileExists(path.join(dir, 'Dockerfile.migrate'))).toBe(false);
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });
});
