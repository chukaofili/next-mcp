import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ProjectConfigSchema } from '../../../src/index.js';
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

  it('rejects better-auth + database:none at schema-parse time', () => {
    // Tier 3 promoted this combo from a runtime error in setup_authentication
    // ('Better Auth requires a database. Please select a database option.')
    // to a Zod refine on ProjectConfigSchema, so it now fails at the MCP
    // boundary before any tool dispatches. The runtime guard is kept as
    // defense-in-depth.
    expect(() =>
      ProjectConfigSchema.parse({
        architecture: {
          database: 'none',
          orm: 'none',
          auth: 'better-auth',
        },
      })
    ).toThrow(ZodError);

    try {
      ProjectConfigSchema.parse({
        architecture: {
          database: 'none',
          orm: 'none',
          auth: 'better-auth',
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).message).toContain('Better Auth requires a database');
    }
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

    // Route + proxy (headless) live in apps/web. The registry-dependent
    // presentation layer (auth-ui-provider, dynamic pages, user-button) is
    // NOT emitted under `skipInstall: true` because the imports it relies
    // on (`@/components/auth/...`) are only created by the `shadcn add`
    // calls that this branch skips.
    expect(await fileExists(path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'proxy.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'providers', 'auth-ui-provider.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'app', 'auth', '[path]', 'page.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'app', 'account', '[path]', 'page.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'components', 'auth', 'user-button.tsx'))).toBe(false);

    // The auth-server import in legacy mode resolves to the local `@/lib/auth`.
    const routeContent = await fs.readFile(
      path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'),
      'utf-8'
    );
    expect(routeContent).toContain("from '@/lib/auth'");
    expect(routeContent).not.toContain('__AUTH_SERVER_IMPORT__');

    // Without `packages/auth` (no routing), better-auth helpers come from the
    // upstream subpaths — and apps/web declares `better-auth` directly.
    expect(routeContent).toContain("from 'better-auth/next-js'");
    expect(routeContent).not.toContain('__BETTER_AUTH_NEXTJS_IMPORT__');
    const proxyContent = await fs.readFile(path.join(appPath, 'src', 'proxy.ts'), 'utf-8');
    expect(proxyContent).toContain('from "better-auth/cookies"');
    expect(proxyContent).not.toContain('__BETTER_AUTH_COOKIES_IMPORT__');
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.dependencies?.['better-auth']).toBeDefined();

    // The layout AuthProvider injection is also gated (it imports the
    // registry-dependent provider), so the as-shipped layout still has
    // {children} unwrapped under `skipInstall`.
    const layoutContent = await fs.readFile(path.join(appPath, 'src', 'app', 'layout.tsx'), 'utf-8');
    expect(layoutContent).not.toContain('AuthProvider');

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

    // Headless route + proxy live in apps/web. Under `skipInstall: true`
    // the registry-dependent presentation layer (AuthUIProvider, dynamic
    // route pages, user-button shim, layout AuthProvider injection) is
    // intentionally not emitted — its imports only resolve after the
    // skipped `shadcn add` calls run.
    expect(await fileExists(path.join(appPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'proxy.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'providers', 'auth-ui-provider.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'app', 'auth', '[path]', 'page.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'app', 'account', '[path]', 'page.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'src', 'components', 'auth', 'user-button.tsx'))).toBe(false);
    const layoutContent = await fs.readFile(path.join(appPath, 'src', 'app', 'layout.tsx'), 'utf-8');
    expect(layoutContent).not.toContain('AuthProvider');

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

    // route.ts and proxy.ts route their better-auth helper imports through
    // `@<name>/auth/exports` so apps/web doesn't have to declare a direct
    // `better-auth` dep — the curated re-exports module owns that.
    expect(routeContent).toContain(`from '@${projectName}/auth/exports'`);
    expect(routeContent).not.toContain("from 'better-auth/next-js'");
    const proxyContent = await fs.readFile(path.join(appPath, 'src', 'proxy.ts'), 'utf-8');
    expect(proxyContent).toContain(`from "@${projectName}/auth/exports"`);
    expect(proxyContent).not.toContain('from "better-auth/cookies"');

    // packages/auth/src/re-exports.ts exists and exports the shape we promise
    // through the `./exports` subpath.
    const reExportsContent = await fs.readFile(
      path.join(authPkgDir, 'src', 're-exports.ts'),
      'utf-8'
    );
    expect(reExportsContent).toContain("from 'better-auth/cookies'");
    expect(reExportsContent).toContain("from 'better-auth/next-js'");
    expect(reExportsContent).toContain("from 'better-auth/node'");

    // packages/auth/package.json declares the `./exports` subpath (so consumers
    // can resolve `@<name>/auth/exports`) and drops the now-redundant
    // db:generate / db:migrate scripts (auth:generate at the project root
    // covers schema gen; the previous scripts pointed at a non-existent
    // `better-auth` CLI binary).
    const authPkgJson = JSON.parse(
      await fs.readFile(path.join(authPkgDir, 'package.json'), 'utf-8')
    );
    // Subpath exports point at compiled JS (./dist/...) so Next.js can
    // resolve them via `exports` without `transpilePackages`. The build
    // script (`tsc -b`) emits the dist files.
    expect(authPkgJson.exports['./exports']).toMatchObject({
      types: './dist/re-exports.d.ts',
      default: './dist/re-exports.js',
    });
    expect(authPkgJson.scripts.build).toContain('tsc -b');
    expect(authPkgJson.scripts['db:generate']).toBeUndefined();
    expect(authPkgJson.scripts['db:migrate']).toBeUndefined();

    // apps/web does NOT declare `better-auth` directly — the workspace dep on
    // `@<name>/auth` is the only auth-related entry it needs.
    expect(appPkg.dependencies?.['better-auth']).toBeUndefined();
    expect(appPkg.devDependencies?.['better-auth']).toBeUndefined();

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

  it('routes drizzle adapter into packages/auth/src/server.ts (audit 1b)', async () => {
    // Audit gap-fill 1b: G1's tests covered full + prisma and full + orm:none.
    // The drizzle branch of `getAdapterConfig` is unexercised — if it ever
    // regresses (wrong adapter import path, wrong `provider:` value, or the
    // db import string drifts), no test catches it. This test pins:
    //   - server.ts is at packages/auth/src/server.ts (routed)
    //   - adapter import string: `better-auth/adapters/drizzle`
    //   - body: `drizzleAdapter(db, {`
    //   - `provider: "pg"` for postgres
    //   - db import resolves to the workspace `@<n>/db`, NOT `@/lib/db`
    const projectName = 'full-auth-drizzle-route';
    const projectPath = path.join(tempDir, projectName);
    const authPkgDir = path.join(projectPath, 'packages', 'auth');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    // Run setup_database first so packages/db is on disk before auth wires
    // its workspace dep — mirrors the realistic tool order.
    const dbResult = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(dbResult)).toBe(true);

    const authResult = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(authResult)).toBe(true);

    expect(await fileExists(path.join(authPkgDir, 'src', 'server.ts'))).toBe(true);

    const serverContent = await fs.readFile(path.join(authPkgDir, 'src', 'server.ts'), 'utf-8');
    // Adapter import must be exactly the drizzle subpath.
    expect(serverContent).toContain('import { drizzleAdapter } from "better-auth/adapters/drizzle"');
    // Body uses drizzleAdapter (not prismaAdapter) and pins `provider: "pg"`
    // for postgres (drizzle's enum, distinct from prisma's `postgresql`).
    expect(serverContent).toContain('drizzleAdapter(db, {');
    expect(serverContent).toContain('provider: "pg"');
    // db import is the workspace package, not the legacy alias.
    expect(serverContent).toContain(`from "@${projectName}/db"`);
    expect(serverContent).not.toContain('from "@/lib/db"');
    // No leaked placeholders.
    expect(serverContent).not.toContain('__ADAPTER_IMPORT__');
  }, 120000);

  it('documents observed re-run behavior on the same project (audit 5b)', async () => {
    // Audit gap-fill 5b: mirror of 5a but for setup_authentication. The point
    // is to PIN today's behavior (success + content stable) so a silent
    // change in re-run policy fails loudly. The test runs setup_database
    // first because setup_authentication requires the workspace db package
    // to exist in full mode.
    const projectName = 'full-auth-rerun';
    const projectPath = path.join(tempDir, projectName);
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

    const dbResult = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(dbResult)).toBe(true);

    const first = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(first)).toBe(true);

    const serverPathFile = path.join(authPkgDir, 'src', 'server.ts');
    const clientPathFile = path.join(authPkgDir, 'src', 'client.ts');
    const indexPathFile = path.join(authPkgDir, 'src', 'index.ts');
    const firstServer = await fs.readFile(serverPathFile, 'utf-8');
    const firstClient = await fs.readFile(clientPathFile, 'utf-8');
    const firstIndex = await fs.readFile(indexPathFile, 'utf-8');

    // Second run.
    const second = await client.callTool('setup_authentication', { config, projectPath });

    // Observed behavior today: re-running succeeds. If this changes
    // (e.g. the tool starts erroring out on a non-empty packages/auth),
    // update the assertion together with the policy change.
    expect(client.isSuccess(second)).toBe(true);

    const secondServer = await fs.readFile(serverPathFile, 'utf-8');
    const secondClient = await fs.readFile(clientPathFile, 'utf-8');
    const secondIndex = await fs.readFile(indexPathFile, 'utf-8');
    expect(secondServer).toBe(firstServer);
    expect(secondClient).toBe(firstClient);
    expect(secondIndex).toBe(firstIndex);

    // apps/web/package.json still has the auth workspace dep (no drift).
    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.[`@${projectName}/auth`]).toBe('workspace:*');
  }, 180000);

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

    // Under `skipInstall: false`, the registry-dependent presentation layer
    // (provider, dynamic auth/account pages, user-button shim) IS emitted —
    // the imports it produces resolve to the components added by the
    // (recorded) shadcn calls above. This is the positive complement to
    // the `skipInstall: true` tests that assert these files are absent.
    expect(await fileExists(path.join(appPath, 'src', 'providers', 'auth-ui-provider.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'app', 'auth', '[path]', 'page.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'app', 'account', '[path]', 'page.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'components', 'auth', 'user-button.tsx'))).toBe(true);

    // Layout was patched to wrap children in <AuthProvider>.
    const layoutContent = await fs.readFile(path.join(appPath, 'src', 'app', 'layout.tsx'), 'utf-8');
    expect(layoutContent).toContain('AuthProvider');
    expect(layoutContent).toContain('<AuthProvider>');
  }, 180000);
});

describe('setup_authentication tool — skipInstall split', () => {
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

  it('skipInstall: true success message lists the manual follow-up (install + shadcn add URLs + re-run)', async () => {
    // Codex flagged that under `skipInstall: true`, setup_authentication used
    // to write templates that imported registry-generated modules (e.g.
    // `@/components/auth/auth-provider`) without ever creating those modules,
    // leaving the project uncompilable. The fix splits the writes:
    //   - headless layer (server, client, route, proxy, barrel) is always emitted
    //   - registry-dependent layer (provider, dynamic pages, user-button,
    //     layout AuthProvider injection) is gated on `!skipInstall`
    // and the success message must surface the exact follow-up steps the user
    // needs to run to bring the project to a fully-configured state. This
    // test guards the message contract.
    const projectName = 'skip-install-followup';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
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

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result) ?? '';
    // Mentions skipInstall as the cause and explains what was skipped.
    expect(text).toContain('skipInstall: true');
    expect(text).toContain('UI registry components');
    // Enumerates the three follow-up commands explicitly.
    expect(text).toContain('pnpm install');
    expect(text).toContain('pnpm dlx shadcn@latest add https://better-auth-ui.com/r/auth.json');
    expect(text).toContain('pnpm dlx shadcn@latest add https://better-auth-ui.com/r/settings.json');
    expect(text).toContain('https://better-auth-ui.com/r/user-button.json');
    // Tells the user to re-run with skipInstall: false to finish the setup.
    expect(text).toContain('re-run');
    expect(text).toContain('setup_authentication');

    // Generated-files list reflects what was actually written: the headless
    // files appear, the registry-dependent ones must not (or the message
    // would lie about scaffolding).
    expect(text).toContain('packages/auth/src/server.ts');
    expect(text).toContain('apps/web/src/app/api/auth/[...all]/route.ts');
    expect(text).toContain('apps/web/src/proxy.ts');
    expect(text).not.toContain('apps/web/src/providers/auth-ui-provider.tsx');
    expect(text).not.toContain('apps/web/src/app/auth/[path]/page.tsx');
    expect(text).not.toContain('apps/web/src/components/auth/user-button.tsx');

    // Quick-start hint is suppressed (UserButton component does not exist
    // yet, so telling the user to import it would be misleading).
    expect(text).not.toContain('import { UserButton }');
  }, 120000);

  it('flat mode under skipInstall also splits headless vs registry-dependent files', async () => {
    // Same contract as the routed-mode test above, but for `monorepo: 'none'`
    // — exercises the second call site (paths under `<projectRoot>/src/...`
    // instead of `apps/web/src/...`).
    const projectName = 'skip-install-flat';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'none',
        packageManager: 'pnpm',
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

    // Headless files exist at the flat layout.
    expect(await fileExists(path.join(projectPath, 'src', 'lib', 'auth.ts'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'src', 'lib', 'auth-client.ts'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'src', 'app', 'api', 'auth', '[...all]', 'route.ts'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'src', 'proxy.ts'))).toBe(true);

    // Registry-dependent files are NOT written.
    expect(await fileExists(path.join(projectPath, 'src', 'providers', 'auth-ui-provider.tsx'))).toBe(false);
    expect(await fileExists(path.join(projectPath, 'src', 'app', 'auth', '[path]', 'page.tsx'))).toBe(false);
    expect(await fileExists(path.join(projectPath, 'src', 'app', 'account', '[path]', 'page.tsx'))).toBe(false);
    expect(await fileExists(path.join(projectPath, 'src', 'components', 'auth', 'user-button.tsx'))).toBe(false);

    // Layout was NOT patched (the AuthProvider import would be unresolvable).
    const layoutContent = await fs.readFile(path.join(projectPath, 'src', 'app', 'layout.tsx'), 'utf-8');
    expect(layoutContent).not.toContain('AuthProvider');

    // The follow-up message points at the project root cwd (not apps/web)
    // because that's where shadcn add must run in flat mode.
    const text = client.getTextContent(result) ?? '';
    expect(text).toContain('the project root');
    expect(text).not.toContain('run from apps/web');
  }, 120000);
});

describe('auth:generate root script', () => {
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

  it('flat mode + better-auth + drizzle: root package.json has auth:generate + dotenv-cli devDep', async () => {
    const projectName = 'auth-gen-flat';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'none',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(pkg.scripts['auth:generate']).toBe(
      'dotenv -e .env -- pnpm dlx auth@latest generate -y --config src/lib/auth.ts --output src/lib/db/schema/auth.ts'
    );
    expect(pkg.devDependencies['dotenv-cli']).toBeDefined();
  }, 120000);

  it('minimal mode does NOT inject auth:generate into apps/web (only into root)', async () => {
    const projectName = 'auth-gen-minimal';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    // Root package.json carries the script with paths under apps/web.
    const rootPkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(rootPkg.scripts['auth:generate']).toBe(
      'dotenv -e .env -- pnpm dlx auth@latest generate -y --config apps/web/src/lib/auth.ts --output apps/web/src/lib/db/schema/auth.ts'
    );
    expect(rootPkg.devDependencies['dotenv-cli']).toBeDefined();

    // apps/web/package.json must not have it — the script is workspace-root only.
    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.scripts?.['auth:generate']).toBeUndefined();
    expect(appPkg.devDependencies?.['dotenv-cli']).toBeUndefined();
  }, 120000);

  it('full mode + drizzle: root script targets packages/auth + packages/db schema', async () => {
    const projectName = 'auth-gen-full';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'better-auth',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const rootPkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(rootPkg.scripts['auth:generate']).toBe(
      'dotenv -e .env -- pnpm dlx auth@latest generate -y --config packages/auth/src/server.ts --output packages/db/src/schema/auth.ts'
    );
    expect(rootPkg.devDependencies['dotenv-cli']).toBeDefined();
  }, 120000);

  it('non-drizzle ORMs do not get auth:generate (Prisma uses its own migrate flow)', async () => {
    const projectName = 'auth-gen-prisma-skip';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'none',
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

    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(pkg.scripts['auth:generate']).toBeUndefined();
    expect(pkg.devDependencies?.['dotenv-cli']).toBeUndefined();
  }, 120000);

  it('auth:none does not get auth:generate', async () => {
    const projectName = 'auth-gen-no-auth';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'none',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    expect(pkg.scripts?.['auth:generate']).toBeUndefined();
    expect(pkg.devDependencies?.['dotenv-cli']).toBeUndefined();
  }, 120000);
});
