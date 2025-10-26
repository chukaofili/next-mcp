import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, dirExists } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('create_directory_structure tool', () => {
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

  it('should create basic directory structure', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'none',
        auth: 'none',
        stateManagement: 'none',
        testing: 'none',
      },
    });

    const result = await client.callTool('create_directory_structure', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Verify all additional directories created by the tool
    // (Note: Basic src/app structure is created by create-next-app, not this tool)
    const expectedDirs = ['src/components/ui', 'src/components/forms', 'src/lib', 'src/hooks'];

    for (const dir of expectedDirs) {
      expect(await dirExists(path.join(tempDir, dir))).toBe(true);
    }
  });

  it('should create database directories when database is configured', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
      },
    });

    const result = await client.callTool('create_directory_structure', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Verify database directories
    expect(await dirExists(path.join(tempDir, 'src/lib/db'))).toBe(true);
  });

  it('should create auth directories when auth is configured', async () => {
    const config = createMockConfig({
      architecture: {
        auth: 'better-auth',
      },
    });

    const result = await client.callTool('create_directory_structure', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Verify auth directories
    expect(await dirExists(path.join(tempDir, 'src/components/auth'))).toBe(true);
  });

  it('should create all directories for full stack config', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
        testing: 'vitest',
        stateManagement: 'zustand',
      },
    });

    const result = await client.callTool('create_directory_structure', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Verify all additional directories created by the tool
    const expectedDirs = [
      'src/components/ui',
      'src/components/forms',
      'src/components/auth',
      'src/lib',
      'src/lib/db',
      'src/hooks',
      'src/stores', // Added because stateManagement !== 'none'
      'src/tests', // Added because testing !== 'none'
    ];

    for (const dir of expectedDirs) {
      expect(await dirExists(path.join(tempDir, dir))).toBe(true);
    }
  });
});
