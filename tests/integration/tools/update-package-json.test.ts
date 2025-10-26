import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createPackageJson, createTempDir, fileExists, readFile } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('update_package_json tool', () => {
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

  it('should update package.json with dependencies', async () => {
    // Create initial package.json
    await createPackageJson(tempDir, { name: 'test-app' });

    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
        testing: 'vitest',
      },
    });

    const result = await client.callTool('update_package_json', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();

    // Verify package.json was updated
    const packageJsonPath = path.join(tempDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath));

    // Should have dependencies or devDependencies
    expect(packageJson.dependencies || packageJson.devDependencies).toBeDefined();
  });

  it('should handle minimal configuration', async () => {
    await createPackageJson(tempDir, { name: 'minimal-app' });

    const config = createMockConfig({
      architecture: {
        database: 'none',
        orm: 'none',
        auth: 'none',
        testing: 'none',
      },
    });

    const result = await client.callTool('update_package_json', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();

    // Verify package.json exists
    expect(await fileExists(path.join(tempDir, 'package.json'))).toBe(true);
  });

  it('should add scripts to package.json', async () => {
    await createPackageJson(tempDir, { name: 'scripts-test' });

    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
      },
    });

    const result = await client.callTool('update_package_json', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();

    const packageJsonPath = path.join(tempDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath));

    // Should have scripts
    expect(packageJson.scripts).toBeDefined();
  });
});
