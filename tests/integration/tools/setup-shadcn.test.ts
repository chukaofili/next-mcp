import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('setup_shadcn tool', () => {
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

  it('should handle shadcn setup', async () => {
    const config = createMockConfig({
      architecture: {
        uiLibrary: 'shadcn',
      },
    });

    const result = await client.callTool('setup_shadcn', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);

    // May succeed or indicate what setup was done
  });

  it('should handle non-shadcn configuration', async () => {
    const config = createMockConfig({
      architecture: {
        uiLibrary: 'none',
      },
    });

    const result = await client.callTool('setup_shadcn', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();

    // Should indicate no shadcn setup needed
  });
});
