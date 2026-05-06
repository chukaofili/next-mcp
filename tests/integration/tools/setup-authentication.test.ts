import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import {
  cleanupTempDir,
  createMockConfig,
  createTempDir,
  fileExists,
} from '../../helpers/test-utils.js';

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

  it('should attempt to setup better-auth', async () => {
    const projectName = 'auth-test-project';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('setup_authentication', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Better Auth + Better Auth UI has been configured successfully');
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

    expect(client.isSuccess(result)).toBe(false);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Better Auth requires a database');
  });

  it('does not modify globals.css and does not add @daveyplate/better-auth-ui as a dep (G1)', async () => {
    // G1 deleted both the legacy `@daveyplate/better-auth-ui/css` import block
    // and the npm install. This test guards both regressions at once: read the
    // app's globals.css and package.json after setup_authentication runs and
    // assert the legacy artifacts are absent.
    const projectName = `auth-g1-no-daveyplate_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    // Capture globals.css before auth setup so we can confirm it's unchanged.
    const globalsCssPath = path.join(projectPath, 'src', 'app', 'globals.css');
    const globalsCssBefore = (await fs.readFile(globalsCssPath, 'utf-8').catch(() => null)) ?? '';

    const result = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    const globalsCssAfter = await fs.readFile(globalsCssPath, 'utf-8');
    expect(globalsCssAfter).toBe(globalsCssBefore);
    expect(globalsCssAfter).not.toContain('@daveyplate/better-auth-ui');

    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(pkg.dependencies?.['@daveyplate/better-auth-ui']).toBeUndefined();
    expect(pkg.devDependencies?.['@daveyplate/better-auth-ui']).toBeUndefined();
  }, 120000);
});

describe('setup_authentication tool — monorepo:minimal', () => {
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

  it('writes auth files into apps/web in minimal mode and skips packages/auth', async () => {
    const projectName = 'minimal-auth';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    // Auth files land at the legacy `apps/web/src/lib/...` (NOT at projectPath).
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth-client.ts'))).toBe(true);
    // packages/auth is NOT used in minimal mode (Group D doesn't emit it).
    expect(await fileExists(path.join(projectPath, 'packages', 'auth', 'src', 'server.ts'))).toBe(false);

    // Route/component-level files also live in apps/web.
    expect(await fileExists(path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'providers', 'auth-ui-provider.tsx'))).toBe(true);

    // The auth-server import in legacy mode resolves to the local `@/lib/auth`.
    const routeContent = await fs.readFile(
      path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'),
      'utf-8'
    );
    expect(routeContent).toContain("from '@/lib/auth'");
    expect(routeContent).not.toContain('__AUTH_SERVER_IMPORT__');

    // Adapter import in auth.ts uses the legacy `@/lib/db` alias because db
    // is NOT routed to packages/db in minimal mode.
    const authContent = await fs.readFile(path.join(appPath, 'src', 'lib', 'auth.ts'), 'utf-8');
    expect(authContent).toContain('from "@/lib/db"');
  }, 120000);
});

describe('setup_authentication tool — monorepo:full', () => {
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

  it('routes auth core into packages/auth and wires apps/web dep', async () => {
    const projectName = 'full-auth-prisma-route';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const authPkgDir = path.join(projectPath, 'packages', 'auth');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    // Headless server config + typed client + barrel land in packages/auth/src.
    expect(await fileExists(path.join(authPkgDir, 'src', 'server.ts'))).toBe(true);
    expect(await fileExists(path.join(authPkgDir, 'src', 'client.ts'))).toBe(true);
    expect(await fileExists(path.join(authPkgDir, 'src', 'index.ts'))).toBe(true);

    // Did NOT write to legacy `apps/web/src/lib/auth*`.
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth.ts'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth-client.ts'))).toBe(false);

    // Route/component-level files still live in apps/web.
    expect(await fileExists(path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'providers', 'auth-ui-provider.tsx'))).toBe(true);

    // apps/web/package.json contains the workspace dep on `@<name>/auth`.
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.dependencies?.[`@${projectName}/auth`]).toBe('workspace:*');

    // The barrel re-exports both subpaths.
    const indexContent = await fs.readFile(path.join(authPkgDir, 'src', 'index.ts'), 'utf-8');
    expect(indexContent).toContain("export * from './server'");
    expect(indexContent).toContain("export * from './client'");

    // The headless server config imports `db` from the workspace package
    // (NOT `@/lib/db` — that alias doesn't resolve from packages/auth).
    const serverContent = await fs.readFile(path.join(authPkgDir, 'src', 'server.ts'), 'utf-8');
    expect(serverContent).toContain(`from "@${projectName}/db"`);
    expect(serverContent).not.toContain('from "@/lib/db"');
    expect(serverContent).not.toContain('__ADAPTER_IMPORT__');

    // The route handler imports auth from the workspace subpath, not `@/lib/auth`.
    const routeContent = await fs.readFile(
      path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'),
      'utf-8'
    );
    expect(routeContent).toContain(`from '@${projectName}/auth/server'`);
    expect(routeContent).not.toContain("from '@/lib/auth'");

    // The AuthUIProvider imports authClient from the workspace subpath.
    const providerContent = await fs.readFile(
      path.join(appPath, 'src', 'providers', 'auth-ui-provider.tsx'),
      'utf-8'
    );
    expect(providerContent).toContain(`from "@${projectName}/auth/client"`);
    expect(providerContent).not.toContain('from "@/lib/auth-client"');

    // The success message reflects the routed layout — it mentions
    // `packages/auth/src/server.ts` and the workspace import specifier.
    const text = client.getTextContent(result) ?? '';
    expect(text).toContain('packages/auth/src/server.ts');
    expect(text).toContain(`@${projectName}/auth/server`);
    // And it must NOT lie about updating globals.css (the G1 regression line).
    expect(text).not.toContain('Updated src/app/globals.css');
  }, 120000);

  it('rewrites pre-existing apps/web @/lib/auth(-client) imports to workspace subpaths', async () => {
    const projectName = 'full-auth-import-rewrite';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    // Pre-create a file in apps/web/src that imports from both legacy aliases.
    const targetFile = path.join(appPath, 'src', 'example-auth-consumer.ts');
    await fs.writeFile(
      targetFile,
      [
        "import { auth } from '@/lib/auth';",
        "import { authClient } from '@/lib/auth-client';",
        "const note = '@/lib/auth tip';", // string literal — must NOT be rewritten
        '',
        'export const refs = { auth, authClient, note };',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    const rewritten = await fs.readFile(targetFile, 'utf-8');

    // Real imports rewritten — order matters: `@/lib/auth-client` must reach
    // `<pkg>/client` (NOT `<pkg>/server-client`) and `@/lib/auth` must reach
    // `<pkg>/server` without consuming the longer specifier.
    expect(rewritten).toContain(`from '@${projectName}/auth/server'`);
    expect(rewritten).toContain(`from '@${projectName}/auth/client'`);
    expect(rewritten).not.toContain("from '@/lib/auth'");
    expect(rewritten).not.toContain("from '@/lib/auth-client'");

    // Plain string literal containing `@/lib/auth` is preserved verbatim
    // (regression guard for the import-context anchor).
    expect(rewritten).toContain("const note = '@/lib/auth tip';");
  }, 120000);
});
