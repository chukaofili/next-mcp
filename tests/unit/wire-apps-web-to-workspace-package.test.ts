import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { wireAppsWebToWorkspacePackage } from '../../src/index.js';
import { cleanupTempDir, createTempDir, fileExists, readFile } from '../helpers/test-utils.js';

/**
 * Direct unit tests for the shared `wireAppsWebToWorkspacePackage` helper
 * (Tier 4b extraction from `wireAppsWebToDbPackage` /
 * `wireAppsWebToAuthPackage`).
 *
 * The helper has a tightly bounded contract — file paths in, package name
 * out, throw on the well-defined error paths — so testing it directly via
 * the module-level export gives us coverage that's resilient against
 * future per-caller changes (db's import-rewrite block, auth's subpath
 * mappings) and locks in the Group G "no silent fallback" guarantee.
 */
describe('wireAppsWebToWorkspacePackage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('wire-helper-');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Convenience: synthesise the minimal `packages/<dir>/package.json` and
   * (optionally) `apps/web/package.json` shape the helper expects.
   */
  async function seed(opts: {
    packageDir: string;
    pkgJson?: string | object | null; // string => raw write, object => JSON.stringify, null => skip
    appPkgJson?: string | object | null;
  }): Promise<void> {
    const pkgDir = path.join(tempDir, 'packages', opts.packageDir);
    await fs.mkdir(pkgDir, { recursive: true });
    if (opts.pkgJson !== null && opts.pkgJson !== undefined) {
      const body = typeof opts.pkgJson === 'string' ? opts.pkgJson : JSON.stringify(opts.pkgJson, null, 2);
      await fs.writeFile(path.join(pkgDir, 'package.json'), body);
    }

    if (opts.appPkgJson !== null && opts.appPkgJson !== undefined) {
      const appDir = path.join(tempDir, 'apps/web');
      await fs.mkdir(appDir, { recursive: true });
      const body =
        typeof opts.appPkgJson === 'string' ? opts.appPkgJson : JSON.stringify(opts.appPkgJson, null, 2);
      await fs.writeFile(path.join(appDir, 'package.json'), body);
    }
  }

  it('happy path: writes <name>: workspace:* to apps/web/package.json and returns the resolved name', async () => {
    await seed({
      packageDir: 'db',
      pkgJson: { name: '@acme/db', version: '0.0.0' },
      appPkgJson: { name: '@acme/web', version: '0.0.0', dependencies: { next: '^15.0.0' } },
    });

    const resolved = await wireAppsWebToWorkspacePackage(
      tempDir,
      'db',
      'Did setup_database run before scaffold_project?'
    );

    expect(resolved).toBe('@acme/db');
    const appPkg = JSON.parse(await readFile(path.join(tempDir, 'apps/web/package.json')));
    expect(appPkg.dependencies['@acme/db']).toBe('workspace:*');
    // Unrelated existing deps are preserved.
    expect(appPkg.dependencies.next).toBe('^15.0.0');
  });

  it('idempotency: a second call is a no-op (file mtime unchanged after first wire)', async () => {
    await seed({
      packageDir: 'db',
      pkgJson: { name: '@acme/db', version: '0.0.0' },
      appPkgJson: { name: '@acme/web', dependencies: {} },
    });

    await wireAppsWebToWorkspacePackage(tempDir, 'db', 'hint');
    const firstStat = await fs.stat(path.join(tempDir, 'apps/web/package.json'));
    // The contents are now correct; a follow-up call should detect that
    // and skip the write entirely. We check both content equality (always)
    // and mtime equality (a stronger guarantee — proves we did not even
    // re-serialize identical JSON).
    await wireAppsWebToWorkspacePackage(tempDir, 'db', 'hint');
    const secondStat = await fs.stat(path.join(tempDir, 'apps/web/package.json'));
    const appPkg = JSON.parse(await readFile(path.join(tempDir, 'apps/web/package.json')));

    expect(appPkg.dependencies['@acme/db']).toBe('workspace:*');
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it('throws when packages/<dir>/package.json is missing, with helper name + dir + hint', async () => {
    // Don't create packages/db/package.json at all.
    const hint = 'Did setup_database run before scaffold_project?';
    await expect(wireAppsWebToWorkspacePackage(tempDir, 'db', hint)).rejects.toThrow(
      /wireAppsWebToWorkspacePackage[\s\S]*packages\/db\/package\.json[\s\S]*Did setup_database run before scaffold_project\?/
    );
  });

  it('throws when packages/<dir>/package.json has no "name" field, including the hint in the message', async () => {
    await seed({ packageDir: 'db', pkgJson: {} /* no name */ });

    const hint = 'Did setup_database run before scaffold_project?';
    await expect(wireAppsWebToWorkspacePackage(tempDir, 'db', hint)).rejects.toThrow(
      /no usable "name" field[\s\S]*Did setup_database run before scaffold_project\?|Did setup_database run before scaffold_project\?[\s\S]*no usable "name" field/
    );
  });

  it('throws on unparsable JSON in packages/<dir>/package.json, with the hint surfaced', async () => {
    await seed({ packageDir: 'db', pkgJson: 'not valid json {{{' });

    const hint = 'Did setup_database run before scaffold_project?';
    await expect(wireAppsWebToWorkspacePackage(tempDir, 'db', hint)).rejects.toThrow(
      /wireAppsWebToWorkspacePackage[\s\S]*Did setup_database run before scaffold_project\?/
    );
  });

  it('preserves the silent-skip behavior when apps/web/package.json is missing — does not throw, returns the name, writes nothing', async () => {
    await seed({
      packageDir: 'auth',
      pkgJson: { name: '@acme/auth' },
      // appPkgJson intentionally omitted.
    });

    const resolved = await wireAppsWebToWorkspacePackage(
      tempDir,
      'auth',
      "Did scaffold_project run with auth: 'better-auth' and a database configured?"
    );

    expect(resolved).toBe('@acme/auth');
    // No apps/web/package.json was created as a side effect.
    expect(await fileExists(path.join(tempDir, 'apps/web/package.json'))).toBe(false);
  });
});
