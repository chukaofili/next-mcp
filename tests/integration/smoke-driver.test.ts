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
 */
function runSmoke(args: string[] = [], timeoutMs = 120_000): Promise<SpawnResult> {
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
  it(
    'runs all five presets in skipInstall mode and exits 0',
    async () => {
      const result = await runSmoke([], 180_000);
      // Easier to debug failures by attaching the output to the assertion
      // message — vitest's diff on multi-line strings is not always helpful.
      const ctx = `\nexit=${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
      expect(result.exitCode, ctx).toBe(0);
      expect(result.stdout, ctx).toContain('PASS full-everything-on');
      expect(result.stdout, ctx).toContain('PASS variant-a-full-npm');
      expect(result.stdout, ctx).toContain('PASS variant-b-full-bun-sqlite-drizzle');
      expect(result.stdout, ctx).toContain('PASS variant-c-minimal-pnpm');
      expect(result.stdout, ctx).toContain('PASS variant-d-flat-regression');
    },
    240_000
  );

  it('exits 2 with a clear message when given an unknown preset name', async () => {
    const result = await runSmoke(['not-a-real-preset'], 30_000);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown preset: not-a-real-preset');
    // The error lists the available preset names so an operator can recover
    // without having to dig through tools/smoke.ts.
    expect(result.stderr).toContain('full-everything-on');
  }, 60_000);
});
