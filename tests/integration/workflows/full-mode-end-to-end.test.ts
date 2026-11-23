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
  readFile,
} from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-to-end workflow tests — audit Priority 2.
 *
 * Each tool is tested in isolation in `tests/integration/tools/`. Bugs in the
 * seam between tools (e.g. `setup_authentication`'s db import string drifting
 * from what `setup_database` writes) are not caught by per-tool tests because
 * each one stubs the surrounding context. These tests exercise the realistic
 * order — `scaffold_project` → `setup_database` → `setup_authentication` →
 * `generate_dockerfile` → `generate_readme` — on one tempDir so cross-tool
 * regressions show up loudly.
 */

describe('full-mode end-to-end workflow', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir('next-mcp-e2e-full-');
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('scaffold + setup_database + setup_authentication + generate_dockerfile + generate_readme produces a coherent full-mode project', async () => {
    const projectName = 'e2e-full';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      description: 'End-to-end full-mode workflow regression test',
      architecture: {
        monorepo: 'full',
        packageManager: 'pnpm',
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
        testing: 'vitest',
        skipInstall: true,
      },
    });

    // 1. Scaffold — lays down apps/web, packages/eslint-config,
    //    packages/typescript-config, packages/ui (uiLibrary: 'shadcn'),
    //    pnpm-workspace.yaml, turbo.json, etc.
    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    // 2. setup_database — emits packages/db with prisma schema and the
    //    @<n>/db workspace dep wired into apps/web.
    const dbResult = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(dbResult)).toBe(true);

    // 3. setup_authentication — emits packages/auth with server.ts that
    //    imports `db` from @<n>/db (NOT @/lib/db) and wires the @<n>/auth
    //    workspace dep into apps/web.
    const authResult = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(authResult)).toBe(true);

    // 4. generate_dockerfile — emits Dockerfile (monorepo template),
    //    docker-compose.yml, .dockerignore (with packages/db/src/.prisma).
    const dockerResult = await client.callTool('generate_dockerfile', { config, projectPath });
    expect(client.isSuccess(dockerResult)).toBe(true);

    // 5. generate_readme — emits README.md, AGENTS.md, CLAUDE.md.
    const readmeResult = await client.callTool('generate_readme', { config, projectPath });
    expect(client.isSuccess(readmeResult)).toBe(true);

    // ---- Cross-tool seam assertions ----

    // apps/web/package.json must have BOTH workspace deps. If either tool's
    // wiring breaks, the dep is missing and `pnpm install` would fail.
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.dependencies?.[`@${projectName}/db`]).toBe('workspace:*');
    expect(appPkg.dependencies?.[`@${projectName}/auth`]).toBe('workspace:*');

    // packages/auth/src/server.ts must import db from the workspace package,
    // NOT @/lib/db (which doesn't resolve from packages/auth). This is the
    // load-bearing seam between setup_database and setup_authentication.
    const serverContent = await fs.readFile(
      path.join(projectPath, 'packages', 'auth', 'src', 'server.ts'),
      'utf-8'
    );
    expect(serverContent).toContain(`from "@${projectName}/db"`);
    expect(serverContent).not.toContain('from "@/lib/db"');

    // Dockerfile is the monorepo template (turbo prune workflow).
    const dockerfile = await readFile(path.join(projectPath, 'Dockerfile'));
    expect(dockerfile).toContain('turbo@^2 prune');
    expect(dockerfile).toContain(`@${projectName}/web`);

    // .dockerignore tracks the routed prisma client path.
    const dockerignore = await readFile(path.join(projectPath, '.dockerignore'));
    expect(dockerignore).toContain('packages/db/src/.prisma');

    // README.md "Project Structure" section lists all 5 expected packages
    // for full mode + prisma + better-auth + shadcn (no orpc).
    const readme = await readFile(path.join(projectPath, 'README.md'));
    expect(readme).toContain('## Project Structure');
    expect(readme).toContain('packages/db/');
    expect(readme).toContain('packages/auth/');
    expect(readme).toContain('packages/ui/');
    expect(readme).toContain('packages/eslint-config/');
    expect(readme).toContain('packages/typescript-config/');
    // orpc was deliberately omitted from this config — make sure the README
    // doesn't claim a packages/orpc that doesn't exist on disk.
    expect(readme).not.toContain('packages/orpc/');

    // AGENTS.md exists at the workspace root and references the workspace
    // db import string (not the legacy alias).
    expect(await fileExists(path.join(projectPath, 'AGENTS.md'))).toBe(true);
    const agentsMd = await readFile(path.join(projectPath, 'AGENTS.md'));
    expect(agentsMd).toContain(`@${projectName}/db`);

    // CLAUDE.md exists and points to AGENTS.md (it's a fixed pointer doc).
    expect(await fileExists(path.join(projectPath, 'CLAUDE.md'))).toBe(true);
    const claudeMd = await readFile(path.join(projectPath, 'CLAUDE.md'));
    expect(claudeMd).toContain('AGENTS.md');
  }, 120000);
});

describe('minimal-mode end-to-end workflow', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir('next-mcp-e2e-minimal-');
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('minimal-mode happy path produces files at apps/web/src/lib/* and still uses the monorepo Dockerfile template', async () => {
    // Minimal mode: workspaces + Turborepo with apps/web, but no shared
    // packages emitted. db/auth files therefore still live at the legacy
    // `apps/web/src/lib/...` paths. The Dockerfile is still the monorepo
    // template because monorepo !== 'none'.
    const projectName = 'e2e-minimal';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        packageManager: 'npm',
        database: 'sqlite',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const dbResult = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(dbResult)).toBe(true);

    const authResult = await client.callTool('setup_authentication', { config, projectPath });
    expect(client.isSuccess(authResult)).toBe(true);

    const dockerResult = await client.callTool('generate_dockerfile', { config, projectPath });
    expect(client.isSuccess(dockerResult)).toBe(true);

    const readmeResult = await client.callTool('generate_readme', { config, projectPath });
    expect(client.isSuccess(readmeResult)).toBe(true);

    // db files at the legacy `apps/web/src/lib/db` location.
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'client.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'index.ts'))).toBe(true);

    // Auth files at the legacy `apps/web/src/lib/auth*` locations.
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'auth-client.ts'))).toBe(true);

    // No packages/db or packages/auth in minimal mode — Group D only emits
    // shared packages in `monorepo: 'full'`.
    expect(await fileExists(path.join(projectPath, 'packages', 'db', 'package.json'))).toBe(false);
    expect(await fileExists(path.join(projectPath, 'packages', 'auth', 'package.json'))).toBe(false);

    // Dockerfile is still the monorepo template (monorepo !== 'none' in
    // minimal mode). The flat template would NOT contain `turbo prune`.
    const dockerfile = await readFile(path.join(projectPath, 'Dockerfile'));
    expect(dockerfile).toContain('turbo@^2 prune');
    // npm-specific install line.
    expect(dockerfile).toContain('npm ci');

    // README still emitted.
    expect(await fileExists(path.join(projectPath, 'README.md'))).toBe(true);
    // AGENTS.md uses the legacy `@/lib/db` import string in minimal mode
    // because db is NOT routed to packages/db.
    const agentsMd = await readFile(path.join(projectPath, 'AGENTS.md'));
    expect(agentsMd).toContain('@/lib/db');
  }, 120000);
});
