import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists, readFile } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generate_readme tool', () => {
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

  it('should generate README with minimal config', async () => {
    const config = createMockConfig({
      name: 'test-readme-app',
      architecture: {
        database: 'none',
        auth: 'none',
        testing: 'none',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Generated comprehensive README.md with project documentation');

    // Verify file was actually created
    const readmePath = path.join(tempDir, 'README.md');
    expect(await fileExists(readmePath)).toBe(true);
  });

  it('should generate README with full config', async () => {
    const config = createMockConfig({
      name: 'full-stack-app',
      description: 'A comprehensive test application',
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
        testing: 'vitest',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Generated comprehensive README.md with project documentation');

    // Verify file was actually created
    const readmePath = path.join(tempDir, 'README.md');
    expect(await fileExists(readmePath)).toBe(true);
  });

  it('should handle different package managers', async () => {
    const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'] as const;

    for (const pm of packageManagers) {
      const config = createMockConfig({
        architecture: { packageManager: pm },
      });

      const result = await client.callTool('generate_readme', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);

      const text = client.getTextContent(result);
      expect(text).toBeDefined();
      expect(text).toContain('Generated comprehensive README.md with project documentation');
      // Verify file was actually created
      const readmePath = path.join(tempDir, 'README.md');
      expect(await fileExists(readmePath)).toBe(true);
    }
  });

  describe('monorepo-aware project structure', () => {
    it('should keep src/app at the root for monorepo: none (regression)', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'flat-app',
          architecture: {
            monorepo: 'none',
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            testing: 'vitest',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        // Flat-mode structure block contains bare src/ paths.
        expect(readme).toContain('├── src/');
        expect(readme).toContain('│   ├── app/');
        // No workspace layout markers.
        expect(readme).not.toContain('apps/web/');
        expect(readme).not.toContain('packages/');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should show apps/web/src/* for monorepo: minimal', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'min-app',
          architecture: {
            monorepo: 'minimal',
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            testing: 'vitest',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        // Workspace layout: apps/ tree appears in the project-structure block.
        expect(readme).toContain('├── apps/');
        // The legacy bare-root marker (`├── src/`) must not appear in minimal mode.
        expect(readme).not.toMatch(/^├── src\//m);
        // Minimal mode does not emit packages/* — so README should not list any package folders.
        expect(readme).not.toContain('packages/db');
        expect(readme).not.toContain('packages/auth');
        expect(readme).not.toContain('packages/ui');
        expect(readme).not.toContain('packages/eslint-config');
        // Per-workspace filter command should appear in scripts.
        expect(readme).toContain('--filter @min-app/web dev');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should list packages/db|auth|ui|eslint-config|typescript-config for monorepo:full + db+orm+ba+shadcn', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'full-app',
          architecture: {
            monorepo: 'full',
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            testing: 'vitest',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).toContain('├── apps/');
        expect(readme).toContain('packages/db/');
        expect(readme).toContain('packages/auth/');
        expect(readme).toContain('packages/ui/');
        expect(readme).toContain('packages/eslint-config/');
        expect(readme).toContain('packages/typescript-config/');
        // rpc is none -> orpc must NOT appear
        expect(readme).not.toContain('packages/orpc/');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should omit db/auth/ui/orpc packages for monorepo:full when database is none', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'full-bare',
          architecture: {
            monorepo: 'full',
            database: 'none',
            orm: 'none',
            auth: 'none',
            uiLibrary: 'none',
            testing: 'none',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).toContain('├── apps/');
        expect(readme).toContain('packages/eslint-config/');
        expect(readme).toContain('packages/typescript-config/');
        expect(readme).not.toContain('packages/db');
        expect(readme).not.toContain('packages/auth');
        expect(readme).not.toContain('packages/ui');
        expect(readme).not.toContain('packages/orpc');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should list packages/orpc when rpc=orpc in monorepo:full', async () => {
      const dir = await createTempDir();
      try {
        // rpc=orpc only valid with monorepo:'full' per schema refine.
        const config = createMockConfig({
          name: 'full-orpc',
          architecture: {
            monorepo: 'full',
            rpc: 'orpc',
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            testing: 'vitest',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).toContain('packages/orpc/');
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });

  describe('monorepo-aware Database Setup', () => {
    it('should instruct cd packages/db before prisma migrate in monorepo:full + prisma', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'mig-app',
          architecture: {
            monorepo: 'full',
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            testing: 'none',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).toContain('cd packages/db');
        expect(readme).toContain('prisma migrate dev');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should keep flat prisma migrate instructions in monorepo:none', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'flat-mig',
          architecture: {
            monorepo: 'none',
            database: 'postgres',
            orm: 'prisma',
            auth: 'none',
            testing: 'none',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).toContain('prisma migrate dev');
        // Flat mode does not need cd packages/db.
        expect(readme).not.toContain('cd packages/db');
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });

  describe('Docker monorepo migrate caveat', () => {
    it('should mention docker compose run --rm migrate for monorepo + prisma', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'mig-docker',
          architecture: {
            monorepo: 'full',
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            testing: 'none',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).toContain('docker compose run --rm migrate');
        // Schema-path note for Dockerfile.migrate adjustment.
        expect(readme).toContain('packages/db/prisma/schema.prisma');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should not include monorepo migrate caveat for flat + prisma', async () => {
      const dir = await createTempDir();
      try {
        const config = createMockConfig({
          name: 'flat-docker',
          architecture: {
            monorepo: 'none',
            database: 'postgres',
            orm: 'prisma',
            auth: 'none',
            testing: 'none',
          },
        });

        const result = await client.callTool('generate_readme', { config, projectPath: dir });
        expect(client.isSuccess(result)).toBe(true);

        const readme = await readFile(path.join(dir, 'README.md'));
        expect(readme).not.toContain('docker compose run --rm migrate');
        expect(readme).not.toContain('packages/db/prisma/schema.prisma');
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });
});
