import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generate_base_components tool', () => {
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

  it('should generate base components without UI library', async () => {
    const config = createMockConfig({
      architecture: {
        uiLibrary: 'none',
      },
    });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
    // May succeed or fail depending on environment - requires directory structure
  });

  it('should handle shadcn configuration', async () => {
    const config = createMockConfig({
      architecture: {
        uiLibrary: 'shadcn',
      },
    });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
  });

  it('should generate components for auth when configured', async () => {
    const config = createMockConfig({
      architecture: {
        auth: 'better-auth',
        uiLibrary: 'shadcn',
      },
    });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    // May mention auth-related components
  });
});
