import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
    const projectName = `shadcn-setup-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({
      name: projectName,
      architecture: {
        uiLibrary: 'shadcn',
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });
    await client.callTool('create_directory_structure', { config, projectPath });
    await client.callTool('generate_nextjs_custom_code', { config, projectPath });

    const result = await client.callTool('setup_shadcn', { config, projectPath });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Skipped installation of shadcn/ui');
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

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Shadcn/ui setup skipped');
  });
});
