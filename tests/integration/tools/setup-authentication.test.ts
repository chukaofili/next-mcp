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

    // Real imports rewritten correctly. The callsite in
    // `wireAppsWebToAuthPackage` deliberately passes mappings in
    // shorter-prefix-first order (`@/lib/auth` before `@/lib/auth-client`) to
    // exercise the internal sort in `rewriteImportsInTree` — this assertion
    // is therefore also the regression guard for that sort: if it ever
    // breaks, `@/lib/auth-client` would end up rewritten to
    // `<pkg>/server-client` (the shorter alias partially consuming the
    // longer one) and these `toContain` checks would fail.
    expect(rewritten).toContain(`from '@${projectName}/auth/server'`);
    expect(rewritten).toContain(`from '@${projectName}/auth/client'`);
    expect(rewritten).not.toContain(`from '@${projectName}/auth/server-client'`);
    expect(rewritten).not.toContain("from '@/lib/auth'");
    expect(rewritten).not.toContain("from '@/lib/auth-client'");

    // Plain string literal containing `@/lib/auth` is preserved verbatim
    // (regression guard for the import-context anchor).
    expect(rewritten).toContain("const note = '@/lib/auth tip';");
  }, 120000);

  it('rewriteImportsInTree sorts longest-prefix-first regardless of input order', async () => {
    // Defense-in-depth regression for Important #3 of the code-review pass.
    // We exercise the same code path as the previous test but with a file
    // that ALSO contains string literals whose substrings overlap with the
    // shorter alias — proving that even in pathological input, the walker's
    // internal sort guarantees the longer alias wins. The file shape is
    // chosen to fail loudly if `rewriteImportsInTree` ever stops sorting:
    // a regression would leave the `auth-client` import partially rewritten.
    const projectName = 'full-auth-sort-regression';
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

    // Create a file that imports the longer alias FIRST in source order so
    // a naive scanner would have already touched the bytes when the shorter
    // mapping runs. The internal sort makes input order at the callsite
    // irrelevant.
    const target = path.join(appPath, 'src', 'sort-regression.ts');
    await fs.writeFile(
      target,
      [
        "import { authClient } from '@/lib/auth-client';",
        "import { auth } from '@/lib/auth';",
        '',
        'export const refs = { auth, authClient };',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    const rewritten = await fs.readFile(target, 'utf-8');
    expect(rewritten).toContain(`from '@${projectName}/auth/client'`);
    expect(rewritten).toContain(`from '@${projectName}/auth/server'`);
    // The fail-mode of a broken sort: `@/lib/auth` consuming the prefix of
    // `@/lib/auth-client` and producing `<pkg>/server-client`. Catch it.
    expect(rewritten).not.toContain('/auth/server-client');
    expect(rewritten).not.toContain("from '@/lib/auth'");
    expect(rewritten).not.toContain("from '@/lib/auth-client'");
  }, 120000);

  it('full + better-auth + postgres + orm:none falls back to legacy apps/web/src/lib (no packages/auth)', async () => {
    // Important #1 regression. `shouldRouteToAuthPackage` now also requires
    // `orm !== 'none'` because the packages/auth template hard-codes
    // `@<projectName>/db: workspace:*` and packages/db is only emitted when
    // an ORM is configured. Routing without packages/db would break
    // pnpm install AND the better-auth CLI's `--config src/server.ts` path
    // resolution from apps/web cwd.
    const projectName = 'full-auth-no-orm';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'none',
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

    // Auth files land at the legacy `apps/web/src/lib/...` (NOT packages/auth).
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth-client.ts'))).toBe(true);

    // packages/auth must NOT exist — Group D's gate now requires `orm !==
    // 'none'`. If the gate ever drifts, pnpm install fails on an
    // unresolvable `@<n>/db: workspace:*` workspace dep.
    expect(await fileExists(path.join(projectPath, 'packages', 'auth'))).toBe(false);
    expect(await fileExists(path.join(projectPath, 'packages', 'auth', 'package.json'))).toBe(false);

    // apps/web/package.json must NOT contain the auth workspace dep —
    // wireAppsWebToAuthPackage is gated on shouldRouteToAuthPackage and
    // never runs in this combo.
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.dependencies?.[`@${projectName}/auth`]).toBeUndefined();

    // Route handler still imports from the legacy local alias because
    // routing didn't engage.
    const routeContent = await fs.readFile(
      path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'),
      'utf-8'
    );
    expect(routeContent).toContain("from '@/lib/auth'");
    expect(routeContent).not.toContain(`from '@${projectName}/auth/server'`);
  }, 120000);
});

describe('setup_authentication tool — shadcn-registry install', () => {
  // Two clients on purpose: `scaffolder` runs without the recorder so
  // create-next-app actually fires and lays down `apps/web` on disk; then
  // `recorder` runs setup_authentication with NEXT_MCP_RECORD_COMMANDS set so
  // the shadcn-registry execCommand calls are captured to a JSONL file
  // instead of triggering real network / package-manager I/O. This is the
  // lightest-touch way to assert the registry-install code path under
  // skipInstall: false without paying its full cost.
  let scaffolder: MCPTestClient;
  let recorder: MCPTestClient;
  let tempDir: string;
  let recordPath: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    tempDir = await createTempDir();
    recordPath = path.join(tempDir, 'execcommand-record.jsonl');
    await fs.writeFile(recordPath, '');

    scaffolder = new MCPTestClient();
    await scaffolder.connect(serverPath);

    recorder = new MCPTestClient();
    await recorder.connect(serverPath, { NEXT_MCP_RECORD_COMMANDS: recordPath });
  }, 30000);

  afterAll(async () => {
    await scaffolder.disconnect();
    await recorder.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('runs shadcn add for both better-auth-ui registry URLs with cwd = apps/web (skipInstall: false)', async () => {
    const projectName = 'shadcn-registry-install';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');

    // Scaffold with the non-recording client so apps/web is laid down on
    // disk. skipInstall: true keeps it fast (create-next-app passes
    // --skip-install).
    const scaffoldConfig = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        packageManager: 'pnpm',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });
    const scaffold = await scaffolder.callTool('scaffold_project', { config: scaffoldConfig, targetPath: tempDir });
    expect(scaffolder.isSuccess(scaffold)).toBe(true);

    // Reset the JSONL recorder so this test sees only its own commands.
    await fs.writeFile(recordPath, '');

    // Now invoke setup_authentication via the recorder client with
    // skipInstall: false. The shadcn-registry execCommand calls will be
    // recorded as JSONL lines instead of spawning real shells.
    const authConfig = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        packageManager: 'pnpm',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: false,
      },
    });

    const result = await recorder.callTool('setup_authentication', { config: authConfig, projectPath });
    expect(recorder.isSuccess(result)).toBe(true);

    // Parse the JSONL recorder. Each line is one execCommand invocation.
    const recorded = (await fs.readFile(recordPath, 'utf-8'))
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { command: string; cwd: string; label: string });

    // Find both registry-install calls. We assert against label so we don't
    // accidentally pick up an unrelated `shadcn` invocation from elsewhere
    // in the pipeline (e.g. setup_shadcn).
    const authRegistry = recorded.find((r) => r.label === 'better-auth-ui auth registry');
    const settingsAndButton = recorded.find(
      (r) => r.label === 'better-auth-ui settings/user-button registry'
    );

    expect(authRegistry).toBeDefined();
    expect(settingsAndButton).toBeDefined();

    // First call: auth.json registry, cwd = apps/web (route-coupled — never
    // installed into packages/ui even when uiLibrary: 'shadcn'), runner is
    // pnpm dlx (chosen via packageManager: 'pnpm'), `-y` flag passed.
    expect(authRegistry!.cwd).toBe(appPath);
    expect(authRegistry!.command).toContain('pnpm dlx shadcn@latest add');
    expect(authRegistry!.command).toContain('https://better-auth-ui.com/r/auth.json');
    expect(authRegistry!.command).toMatch(/\s-y(\s|$)/);

    // Second call: both settings.json and user-button.json on the same
    // shadcn add invocation (one network round-trip), same cwd.
    expect(settingsAndButton!.cwd).toBe(appPath);
    expect(settingsAndButton!.command).toContain('pnpm dlx shadcn@latest add');
    expect(settingsAndButton!.command).toContain('https://better-auth-ui.com/r/settings.json');
    expect(settingsAndButton!.command).toContain('https://better-auth-ui.com/r/user-button.json');
    expect(settingsAndButton!.command).toMatch(/\s-y(\s|$)/);

    // Success message reflects the install ran (not the skipInstall message).
    const text = recorder.getTextContent(result) ?? '';
    expect(text).not.toContain('Skipped better-auth-ui shadcn-registry installation');
  }, 180000);
});
