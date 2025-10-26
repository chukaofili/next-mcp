import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists } from '../../helpers/test-utils.js';

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
    const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'];

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
});
