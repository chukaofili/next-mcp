import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createNextAppMock, createTempDir } from '../../helpers/test-utils.js';

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
    const config = createMockConfig();

    // Create mock Next.js project structure (simulates create-next-app)
    await createNextAppMock(tempDir, {
      name: config.name,
      typescript: config.architecture.typescript,
      appRouter: config.architecture.appRouter,
    });
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
    await client.callTool('create_directory_structure', {
      config,
      projectPath: tempDir,
    });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Created reusable Button component with Tailwind CSS');
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
    expect(text).toContain('Using shadcn/ui Button');
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
    expect(text).toContain('Created authentication-related components');
  });
});
