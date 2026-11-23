import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('validate_project tool', () => {
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

  it('should validate project with basic structure', async () => {
    const projectName = `base-components-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({ name: projectName });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('validate_project', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('validation completed successfully');
  });

  describe('monorepo-aware existence checks', () => {
    /**
     * Build a minimal on-disk shape that validateProject's existence checks expect,
     * without invoking the heavy `scaffold_project` flow. We cannot rely on
     * scaffold_project for these path-correctness assertions because it would
     * also bring in the package manager. With skipInstall=true the build phase
     * is short-circuited, so we can focus the assertion on path resolution.
     */
    async function makeWorkspace(
      projectPath: string,
      opts: { monorepo: 'none' | 'minimal' | 'full' }
    ) {
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({ name: 'ws', private: true, scripts: { build: 'echo ok' } }, null, 2)
      );
      await fs.writeFile(
        path.join(projectPath, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: {} }, null, 2)
      );

      if (opts.monorepo === 'none') {
        await fs.writeFile(path.join(projectPath, 'next.config.ts'), '// ok');
      } else {
        const appPath = path.join(projectPath, 'apps', 'web');
        await fs.mkdir(appPath, { recursive: true });
        await fs.writeFile(path.join(appPath, 'next.config.ts'), '// ok');
      }
    }

    it('should resolve next.config.ts at <projectPath>/next.config.ts when monorepo=none (regression)', async () => {
      const dir = await createTempDir();
      try {
        const projectPath = path.join(dir, 'flat');
        await makeWorkspace(projectPath, { monorepo: 'none' });

        const config = createMockConfig({
          name: 'flat',
          architecture: { monorepo: 'none', skipInstall: true },
        });

        const result = await client.callTool('validate_project', { config, projectPath });

        expect(client.isSuccess(result)).toBe(true);
        const text = client.getTextContent(result);
        expect(text).toContain('next.config.ts exists');
        expect(text).toContain('package.json exists');
        expect(text).toContain('tsconfig.json exists');
        expect(text).toContain('validation completed successfully');
        expect(text).not.toContain('Validation failed');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should resolve next.config.ts at apps/web for monorepo=minimal', async () => {
      const dir = await createTempDir();
      try {
        const projectPath = path.join(dir, 'min');
        await makeWorkspace(projectPath, { monorepo: 'minimal' });

        const config = createMockConfig({
          name: 'min',
          architecture: { monorepo: 'minimal', skipInstall: true },
        });

        const result = await client.callTool('validate_project', { config, projectPath });

        expect(client.isSuccess(result)).toBe(true);
        const text = client.getTextContent(result);
        expect(text).toContain('next.config.ts exists');
        expect(text).toContain('apps/web');
        expect(text).toContain('validation completed successfully');
        expect(text).not.toContain('Validation failed');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should resolve next.config.ts at apps/web for monorepo=full', async () => {
      const dir = await createTempDir();
      try {
        const projectPath = path.join(dir, 'full');
        await makeWorkspace(projectPath, { monorepo: 'full' });

        const config = createMockConfig({
          name: 'full',
          architecture: {
            monorepo: 'full',
            // The presence checks in validate_project don't require these to be wired,
            // but use a plausible config so we exercise the same code path real users hit.
            database: 'postgres',
            orm: 'prisma',
            auth: 'better-auth',
            uiLibrary: 'shadcn',
            skipInstall: true,
          },
        });

        const result = await client.callTool('validate_project', { config, projectPath });

        expect(client.isSuccess(result)).toBe(true);
        const text = client.getTextContent(result);
        expect(text).toContain('next.config.ts exists');
        expect(text).toContain('apps/web');
        expect(text).toContain('validation completed successfully');
        expect(text).not.toContain('Validation failed');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('should fail when monorepo=minimal but next.config.ts is at workspace root only', async () => {
      const dir = await createTempDir();
      try {
        // Create a flat-shaped workspace but tell validate_project it's monorepo=minimal.
        // The next.config.ts at <projectPath>/next.config.ts must NOT satisfy the
        // monorepo check — it's expected at apps/web.
        const projectPath = path.join(dir, 'mismatched');
        await makeWorkspace(projectPath, { monorepo: 'none' });

        const config = createMockConfig({
          name: 'mismatched',
          architecture: { monorepo: 'minimal', skipInstall: true },
        });

        const result = await client.callTool('validate_project', { config, projectPath });

        // The tool itself returns successfully (it never throws to MCP), but the
        // validation report inside should flag a failure.
        const text = client.getTextContent(result);
        expect(text).toContain('Validation failed');
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });
});
