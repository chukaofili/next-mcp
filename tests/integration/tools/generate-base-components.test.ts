import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists } from '../../helpers/test-utils.js';

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
    const projectName = `base-components-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({
      name: projectName,
      architecture: {
        uiLibrary: 'none',
      },
    });
    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Created reusable Button component with Tailwind CSS');
  });

  it('should handle shadcn configuration', async () => {
    const projectName = `base-components-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({
      name: projectName,
      architecture: {
        uiLibrary: 'shadcn',
      },
    });
    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Using shadcn/ui Button');
  });

  it('should generate components for auth when configured', async () => {
    const projectName = `base-components-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({
      name: projectName,
      architecture: {
        auth: 'better-auth',
        uiLibrary: 'shadcn',
      },
    });
    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Created authentication-related components');
  });

  it('writes app-level files at <projectPath>/src/... in monorepo:none mode', async () => {
    const projectName = `base-components-flat_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'none',
        uiLibrary: 'none',
      },
    });
    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Files land at the flat <projectPath>/src/... layout.
    expect(await fileExists(path.join(projectPath, 'src/app/page.tsx'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'src/app/api/health/route.ts'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'src/components/ui/button.tsx'))).toBe(true);

    // No stray apps/web tree should be created in flat mode.
    expect(await fileExists(path.join(projectPath, 'apps/web'))).toBe(false);
  }, 60000);

  it('writes app-level files at <projectPath>/apps/web/src/... in monorepo:minimal mode', async () => {
    const projectName = `base-components-minimal_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps/web');

    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });
    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Files land at the apps/web layout.
    expect(await fileExists(path.join(appPath, 'src/app/page.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/app/api/health/route.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/components/ui/button.tsx'))).toBe(true);

    // The buggy stray top-level write must NOT happen.
    expect(await fileExists(path.join(projectPath, 'src/app/page.tsx'))).toBe(false);
  }, 120000);

  it('writes app-level files at <projectPath>/apps/web/src/... in monorepo:full + shadcn mode', async () => {
    const projectName = `base-components-full_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps/web');

    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'shadcn',
        testing: 'none',
        skipInstall: true,
      },
    });
    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('generate_base_components', {
      config,
      projectPath,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Page and API route still land at the apps/web layout.
    expect(await fileExists(path.join(appPath, 'src/app/page.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/app/api/health/route.ts'))).toBe(true);

    // Custom Button is skipped under shadcn.
    expect(await fileExists(path.join(appPath, 'src/components/ui/button.tsx'))).toBe(false);

    // No stray top-level src/ tree in monorepo mode.
    expect(await fileExists(path.join(projectPath, 'src'))).toBe(false);
  }, 120000);
});
