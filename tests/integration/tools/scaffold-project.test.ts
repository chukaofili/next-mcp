import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, TestProjectConfig } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('scaffold_project tool', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 60000); // Longer timeout for full scaffolding

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should scaffold minimal project', async () => {
    const config = createMockConfig({
      name: 'minimal-scaffold',
      architecture: {
        database: 'none',
        orm: 'none',
        auth: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Successfully created Next.js project');
  }, 60000);

  it('should scaffold full-featured project', async () => {
    const config = createMockConfig({
      name: 'full-scaffold',
      description: 'A fully-featured Next.js application',
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
        testing: 'vitest',
        packageManager: 'pnpm',
        skipInstall: true,
      },
    });

    const result = await client.callTool('scaffold_project', {
      config,
      targetPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Successfully created Next.js project');
  }, 60000);

  it('should handle different configurations', async () => {
    const configs: TestProjectConfig['architecture'][] = [
      { database: 'mysql', orm: 'drizzle' },
      { database: 'mongodb', orm: 'mongoose' },
      { database: 'sqlite', orm: 'prisma' },
    ];

    for (const arch of configs) {
      const config = createMockConfig({
        architecture: { ...arch, skipInstall: true },
      });

      const result = await client.callTool('scaffold_project', {
        config,
        targetPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);

      const text = client.getTextContent(result);
      expect(text).toBeDefined();
      expect(text).toContain('Successfully created Next.js project');
    }
  }, 60000);
});
