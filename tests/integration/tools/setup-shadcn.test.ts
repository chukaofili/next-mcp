import { promises as fs } from 'node:fs';
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

describe('setup_shadcn tool — dual-init recording (full + shadcn)', () => {
  // Two clients on purpose: `scaffolder` runs without the recorder so
  // create-next-app actually fires and lays down `apps/web` AND
  // `packages/ui` on disk; then `recorder` runs setup_shadcn with
  // NEXT_MCP_RECORD_COMMANDS set so the four shadcn execCommand calls
  // (init + add-all in apps/web, init + add-all in packages/ui) are
  // captured to a JSONL file instead of spawning real shells. This
  // asserts the dual-init contract for monorepo:full + uiLibrary:shadcn
  // — a future short-circuit removing the packages/ui leg would otherwise
  // ship silently with the existing skipInstall-only test coverage.
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

  it('fires shadcn init in both apps/web and packages/ui (skipInstall: false)', async () => {
    const projectName = 'shadcn-dual-init';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const uiPath = path.join(projectPath, 'packages', 'ui');

    // Scaffold with the non-recording client so apps/web AND packages/ui
    // exist on disk. skipInstall: true keeps it fast (create-next-app
    // passes --skip-install).
    const scaffoldConfig = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        packageManager: 'pnpm',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'shadcn',
        testing: 'none',
        skipInstall: true,
      },
    });
    const scaffold = await scaffolder.callTool('scaffold_project', { config: scaffoldConfig, targetPath: tempDir });
    expect(scaffolder.isSuccess(scaffold)).toBe(true);

    // Reset the JSONL recorder so this test sees only its own commands.
    await fs.writeFile(recordPath, '');

    // Now invoke setup_shadcn via the recorder client with
    // skipInstall: false. The four shadcn execCommand calls will be
    // recorded as JSONL lines instead of spawning real shells.
    const setupConfig = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        packageManager: 'pnpm',
        database: 'none',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'shadcn',
        testing: 'none',
        skipInstall: false,
      },
    });

    const result = await recorder.callTool('setup_shadcn', { config: setupConfig, projectPath });
    expect(recorder.isSuccess(result)).toBe(true);

    // Parse the JSONL recorder. Each line is one execCommand invocation.
    const recorded = (await fs.readFile(recordPath, 'utf-8'))
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { command: string; cwd: string; label: string });

    // Find both init invocations. We assert against label so we don't
    // accidentally pick up an unrelated `shadcn` invocation from
    // elsewhere in the pipeline.
    const appInit = recorded.find((r) => r.label === 'shadcn init (apps/web)');
    const uiInit = recorded.find((r) => r.label === 'shadcn init (packages/ui)');
    const appAdd = recorded.find((r) => r.label === 'shadcn add all (apps/web)');
    const uiAdd = recorded.find((r) => r.label === 'shadcn add all (packages/ui)');

    expect(appInit).toBeDefined();
    expect(uiInit).toBeDefined();
    expect(appAdd).toBeDefined();
    expect(uiAdd).toBeDefined();

    // The cwd routing is the load-bearing assertion: apps/web init runs
    // in apps/web, packages/ui init runs in packages/ui. Same cwd routing
    // applies to the matching `add --all` invocations.
    expect(appInit!.cwd).toBe(appPath);
    expect(uiInit!.cwd).toBe(uiPath);
    expect(appAdd!.cwd).toBe(appPath);
    expect(uiAdd!.cwd).toBe(uiPath);
  }, 120000);
});
