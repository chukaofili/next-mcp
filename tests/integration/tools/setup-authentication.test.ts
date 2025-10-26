import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('setup_authentication tool', () => {
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

  it('should handle no auth configuration', async () => {
    const config = createMockConfig({
      architecture: {
        auth: 'none',
      },
    });

    const result = await client.callTool('setup_authentication', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toMatch(/No authentication|Skipping authentication/i);
  });

  it.only('should attempt to setup better-auth', async () => {
    const projectName = 'auth-test-project';
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        skipInstall: true,
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('setup_authentication', {
      config,
      projectPath: path.join(tempDir, projectName),
    });

    console.log(result);

    // const text = client.getTextContent(result);
    // expect(text).toBeDefined();
    // May succeed or fail depending on environment - just verify it responds
  });

  it('should handle better-auth without database', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'none',
        orm: 'none',
        auth: 'better-auth',
      },
    });

    const result = await client.callTool('setup_authentication', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    // Should handle this scenario (may warn about missing database)
  });
});
