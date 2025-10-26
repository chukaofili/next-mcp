import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createPackageJson, createTempDir } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('install_dependencies tool', () => {
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

  // Skip by default as installing dependencies can be slow and requires network
  it.skip('should install dependencies', async () => {
    // Create a minimal package.json
    await createPackageJson(tempDir, { name: 'test-install' });

    const config = createMockConfig({
      architecture: {
        packageManager: 'npm',
      },
    });

    const result = await client.callTool('install_dependencies', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    // Installation may take time and require network access
  });

  it('should handle install_dependencies call', async () => {
    await createPackageJson(tempDir, { name: 'test-handle' });

    const config = createMockConfig({
      architecture: {
        packageManager: 'npm',
      },
    });

    const result = await client.callTool('install_dependencies', {
      config,
      projectPath: tempDir,
    });

    // Should at least respond without crashing
    expect(result).toBeDefined();
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
  });

  it('should support different package managers', async () => {
    await createPackageJson(tempDir, { name: 'test-pm' });

    const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'];

    for (const pm of packageManagers) {
      const config = createMockConfig({
        architecture: { packageManager: pm },
      });

      const result = await client.callTool('install_dependencies', {
        config,
        projectPath: tempDir,
      });

      // Should handle each package manager
      expect(result).toBeDefined();
      const text = client.getTextContent(result);
      expect(text).toBeDefined();
    }
  });
});
