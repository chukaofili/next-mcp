import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SMOKE_SCRIPT = path.join(REPO_ROOT, 'tools', 'smoke.ts');

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the smoke driver via tsx (the same way `pnpm run smoke` invokes it).
 * Buffers stdout / stderr and resolves with the exit code.
 *
 * NOTE: this file used to also include a green-path test that ran the full
 * 5-preset matrix as a subprocess. That was removed because the dedicated
 * `Run smoke driver (skipInstall)` step in .github/workflows/test.yml runs
 * the same matrix via `pnpm run smoke` — running it twice per CI job was
 * pure duplication. The single CLI-shape check below stays here because it
 * exercises the argument-parsing path without spinning up the MCP server.
 */
function runSmoke(args: string[] = [], timeoutMs = 60_000): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', SMOKE_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`smoke driver timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

describe('tools/smoke.ts headless driver', () => {
  it('exits 2 with a clear message when given an unknown preset name', async () => {
    const result = await runSmoke(['not-a-real-preset'], 30_000);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown preset: not-a-real-preset');
    // The error lists the available preset names so an operator can recover
    // without having to dig through tools/smoke.ts.
    expect(result.stderr).toContain('full-everything-on');
  }, 60_000);
});
