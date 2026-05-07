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

describe('setup_shadcn tool — single add --all (R1)', () => {
  // Two clients on purpose: `scaffolder` runs without the recorder so the
  // shadcn-led scaffold actually fires and lays down apps/web (with the
  // R1 layout fixup applied) on disk; then `recorder` runs setup_shadcn
  // with NEXT_MCP_RECORD_COMMANDS set so the single `shadcn add --all`
  // execCommand call is captured to a JSONL file instead of spawning a
  // real shell.
  //
  // Pre-R1 setup_shadcn ran a four-command dance (init + add-all in
  // apps/web, init + add-all in packages/ui). After R1, scaffold_project
  // delegates the entire workspace skeleton to shadcn's monorepo init,
  // so setup_shadcn collapses to just the add --all leg — cross-workspace
  // alias routing in apps/web/components.json sends UI components to
  // packages/ui automatically.
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

  it('fires shadcn add --all in apps/web only (skipInstall: false)', async () => {
    const projectName = 'shadcn-single-add';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');

    // Scaffold with the non-recording client so apps/web (and
    // shadcn-emitted packages/ui) exist on disk. skipInstall: true keeps
    // it fast (we still pay the shadcn init network cost — that's
    // fundamental to R1).
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

    const recorded = (await fs.readFile(recordPath, 'utf-8'))
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { command: string; cwd: string; label: string });

    // Single recorded command: `shadcn add --all` against apps/web.
    const appAdd = recorded.find((r) => r.label === 'shadcn add all (apps/web)');
    expect(appAdd).toBeDefined();
    expect(appAdd!.cwd).toBe(appPath);
    expect(appAdd!.command).toContain('shadcn@latest add --all');

    // The pre-R1 dual-init dance is gone — neither shadcn init nor
    // packages/ui-targeted invocations should appear.
    expect(recorded.find((r) => r.label === 'shadcn init (apps/web)')).toBeUndefined();
    expect(recorded.find((r) => r.label === 'shadcn init (packages/ui)')).toBeUndefined();
    expect(recorded.find((r) => r.label === 'shadcn add all (packages/ui)')).toBeUndefined();
  }, 180000);
});
