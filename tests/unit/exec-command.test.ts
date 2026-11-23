import { describe, expect, it } from 'vitest';

import { NextMCPServer } from '../../src/index.js';

// `execCommand` is a private method on NextMCPServer. Bracket-notation access
// in test code is acceptable for unit-level coverage of internal helpers and
// keeps the production surface clean. Refs: smoke v1 finding B6, design doc
// §6.6 + Phase 2.

interface ExecResult {
  success: boolean;
  output?: string;
  stderr?: string;
  reason?: string;
}

type VerifyResult = boolean | { ok: true } | { ok: false; reason: string };
type VerifyFn = () => VerifyResult;

interface ExecCommand {
  (command: string, cwd: string, label: string, verify?: VerifyFn): ExecResult;
}

function getExec(): ExecCommand {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = new NextMCPServer() as any;
  return server.execCommand.bind(server) as ExecCommand;
}

describe('execCommand — exit code only (no verify)', () => {
  it('reports success on exit 0 and surfaces stdout', () => {
    const exec = getExec();
    const result = exec('echo hello', '/tmp', 'echo-success');
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('reports failure on non-zero exit and surfaces stderr (B6)', () => {
    const exec = getExec();
    const result = exec(
      `node -e "process.stderr.write('boom\\n'); process.exit(7)"`,
      '/tmp',
      'fail-with-stderr'
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('boom');
  });
});

describe('execCommand — verify callback (B6)', () => {
  it('keeps success: true when verify returns true on exit 0', () => {
    const exec = getExec();
    const result = exec('echo hello', '/tmp', 'verify-pass', () => true);
    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('downgrades to success: false when verify returns false on exit 0', () => {
    const exec = getExec();
    const result = exec('echo hello', '/tmp', 'verify-fail-bool', () => false);
    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
    // stdout should still be captured so callers can include it in messages.
    expect(result.output).toContain('hello');
  });

  it('uses the reason from verify { ok: false, reason } when verify fails', () => {
    const exec = getExec();
    const result = exec(
      'echo hello',
      '/tmp',
      'verify-fail-with-reason',
      () => ({ ok: false, reason: 'expected schema.prisma to contain model User' })
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('expected schema.prisma to contain model User');
  });

  it('does not invoke verify when the subprocess itself failed', () => {
    const exec = getExec();
    let called = false;
    const result = exec(
      `node -e "process.exit(1)"`,
      '/tmp',
      'no-verify-on-error',
      () => {
        called = true;
        return true;
      }
    );
    expect(result.success).toBe(false);
    expect(called).toBe(false);
  });
});
