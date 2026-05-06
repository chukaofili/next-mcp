import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildShadcnInitCommand, getAppPath, getAuthConfigRelPath, getAuthGenerateScript, getAuthSchemaOutputRelPath, getShadcnRunner, packageRunnerDlx, rewriteImportsInTree, substituteCatalog, substituteDockerfilePlaceholders, substituteProjectName } from '../../src/index.js';
import type { ProjectConfig } from '../../src/index.js';
import {
  cleanupTempDir,
  createMockConfig,
  createPackageJson,
  createTempDir,
  dirExists,
  fileExists,
  readFile,
  verifyNextJsStructure,
} from '../helpers/test-utils.js';

describe('Test Utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('createTempDir', () => {
    it('should create a temporary directory', async () => {
      const exists = await dirExists(tempDir);
      expect(exists).toBe(true);
    });

    it('should create unique directories', async () => {
      const dir1 = await createTempDir();
      const dir2 = await createTempDir();

      expect(dir1).not.toBe(dir2);

      await cleanupTempDir(dir1);
      await cleanupTempDir(dir2);
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const exists = await fileExists(testFile);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const exists = await fileExists(path.join(tempDir, 'nonexistent.txt'));
      expect(exists).toBe(false);
    });
  });

  describe('dirExists', () => {
    it('should return true for existing directory', async () => {
      const exists = await dirExists(tempDir);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing directory', async () => {
      const exists = await dirExists(path.join(tempDir, 'nonexistent'));
      expect(exists).toBe(false);
    });

    it('should return false for files', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test');

      const exists = await dirExists(testFile);
      expect(exists).toBe(false);
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';
      await fs.writeFile(testFile, content);

      const result = await readFile(testFile);
      expect(result).toBe(content);
    });
  });

  describe('createPackageJson', () => {
    it('should create a valid package.json', async () => {
      await createPackageJson(tempDir);

      const packageJsonPath = path.join(tempDir, 'package.json');
      const exists = await fileExists(packageJsonPath);
      expect(exists).toBe(true);

      const content = await readFile(packageJsonPath);
      const parsed = JSON.parse(content);

      expect(parsed.name).toBe('test-project');
      expect(parsed.version).toBe('0.1.0');
      expect(parsed.scripts).toBeDefined();
      expect(parsed.scripts.dev).toBe('next dev');
    });

    it('should accept custom config', async () => {
      await createPackageJson(tempDir, { name: 'custom-name' });

      const packageJsonPath = path.join(tempDir, 'package.json');
      const content = await readFile(packageJsonPath);
      const parsed = JSON.parse(content);

      expect(parsed.name).toBe('custom-name');
    });
  });

  describe('verifyNextJsStructure', () => {
    it('should detect missing structure', async () => {
      const result = await verifyNextJsStructure(tempDir);

      expect(result.hasPackageJson).toBe(false);
      expect(result.hasSrcDir).toBe(false);
      expect(result.hasAppDir).toBe(false);
      expect(result.hasNextConfig).toBe(false);
      expect(result.hasTsConfig).toBe(false);
    });
  });

  describe('cleanupTempDir', () => {
    it('should remove directory and contents', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test');

      await cleanupTempDir(tempDir);

      const exists = await dirExists(tempDir);
      expect(exists).toBe(false);
    });

    it('should not throw on non-existent directory', async () => {
      await expect(cleanupTempDir('/nonexistent/path')).resolves.not.toThrow();
    });
  });
});

describe('getAppPath', () => {
  it('returns projectPath when monorepo:none', () => {
    const cfg = { architecture: { monorepo: 'none' } } as ProjectConfig;
    expect(getAppPath(cfg, '/p')).toBe('/p');
  });
  it('returns apps/web when monorepo:minimal', () => {
    const cfg = { architecture: { monorepo: 'minimal' } } as ProjectConfig;
    expect(getAppPath(cfg, '/p')).toBe('/p/apps/web');
  });
  it('returns apps/web when monorepo:full', () => {
    const cfg = { architecture: { monorepo: 'full' } } as ProjectConfig;
    expect(getAppPath(cfg, '/p')).toBe('/p/apps/web');
  });
});

describe('getShadcnRunner', () => {
  it.each([
    ['pnpm', 'pnpm dlx'],
    ['npm', 'npx'],
    ['yarn', 'yarn dlx'],
    ['bun', 'bunx --bun'],
  ])('%s -> %s', (pm, expected) => {
    expect(getShadcnRunner(pm)).toBe(expected);
  });
});

describe('buildShadcnInitCommand', () => {
  it('flat (monorepo:none) — pnpm', () => {
    expect(buildShadcnInitCommand('pnpm', 'none')).toBe(
      'pnpm dlx shadcn@latest init --preset b0 --template next --pointer'
    );
  });
  it('monorepo:minimal — npm', () => {
    expect(buildShadcnInitCommand('npm', 'minimal')).toBe(
      'npx shadcn@latest init --preset b0 --template next --monorepo --pointer'
    );
  });
  it('monorepo:full — yarn', () => {
    expect(buildShadcnInitCommand('yarn', 'full')).toBe(
      'yarn dlx shadcn@latest init --preset b0 --template next --monorepo --pointer'
    );
  });
  it('monorepo:minimal — bun (uses --bun runner)', () => {
    expect(buildShadcnInitCommand('bun', 'minimal')).toBe(
      'bunx --bun shadcn@latest init --preset b0 --template next --monorepo --pointer'
    );
  });
  it('monorepo:none — bun', () => {
    expect(buildShadcnInitCommand('bun', 'none')).toBe(
      'bunx --bun shadcn@latest init --preset b0 --template next --pointer'
    );
  });
});

describe('substituteProjectName', () => {
  it('replaces <projectName> placeholder', () => {
    expect(substituteProjectName('@<projectName>/web', 'my-app')).toBe('@my-app/web');
  });
  it('replaces __PROJECT_NAME__ placeholder', () => {
    expect(substituteProjectName('@__PROJECT_NAME__/web', 'my-app')).toBe('@my-app/web');
  });
});

describe('substituteCatalog', () => {
  const catalog = { typescript: '^6', '@types/node': '^25' };

  it('passes through for pnpm', () => {
    const json = '{"devDependencies":{"typescript":"catalog:"}}';
    expect(substituteCatalog(json, 'pnpm', catalog)).toBe(json);
  });

  it('substitutes literal versions for npm', () => {
    const json = '{"devDependencies":{"typescript":"catalog:","@types/node":"catalog:"}}';
    const result = JSON.parse(substituteCatalog(json, 'npm', catalog));
    expect(result.devDependencies.typescript).toBe('^6');
    expect(result.devDependencies['@types/node']).toBe('^25');
  });

  it('substitutes for yarn and bun', () => {
    const json = '{"dependencies":{"typescript":"catalog:"}}';
    expect(JSON.parse(substituteCatalog(json, 'yarn', catalog)).dependencies.typescript).toBe('^6');
    expect(JSON.parse(substituteCatalog(json, 'bun', catalog)).dependencies.typescript).toBe('^6');
  });

  it('throws on unknown catalog entry for non-pnpm', () => {
    const json = '{"dependencies":{"unknown-dep":"catalog:"}}';
    expect(() => substituteCatalog(json, 'npm', catalog)).toThrow(/unknown-dep/);
  });

  it('leaves non-catalog versions untouched', () => {
    const json = '{"dependencies":{"react":"^19","typescript":"catalog:"}}';
    const out = JSON.parse(substituteCatalog(json, 'npm', catalog));
    expect(out.dependencies.react).toBe('^19');
    expect(out.dependencies.typescript).toBe('^6');
  });

  it('throws on residual catalog: in unhandled sections (e.g. optionalDependencies)', () => {
    const json = '{"optionalDependencies":{"fsevents":"catalog:"}}';
    expect(() => substituteCatalog(json, 'npm', { fsevents: '^2' }))
      .toThrow(/optionalDependencies\.fsevents/);
  });

  it('substitutes within peerDependencies', () => {
    const json = '{"peerDependencies":{"typescript":"catalog:"}}';
    const out = JSON.parse(substituteCatalog(json, 'yarn', { typescript: '^6' }));
    expect(out.peerDependencies.typescript).toBe('^6');
  });
});

describe('substituteDockerfilePlaceholders', () => {
  const tpl = `__COREPACK_SETUP__
FROM __BASE_IMAGE__
__PM_PATH_SETUP__
RUN __PM_INSTALL__
ARG PACKAGE="@__PROJECT_NAME__/web"
RUN __PM_DLX__ turbo prune
RUN __PM_RUN__ turbo build
RUN __CACHE_MOUNT__ install
COPY --from=deps /app/out/__LOCKFILE__ ./
`;

  it('substitutes for pnpm', () => {
    const out = substituteDockerfilePlaceholders(tpl, 'pnpm', 'my-app');
    expect(out).toContain('FROM node:24-alpine');
    expect(out).toContain('corepack enable && corepack prepare pnpm@latest --activate');
    expect(out).toContain('pnpm install --frozen-lockfile');
    expect(out).toContain('pnpm dlx turbo prune');
    expect(out).toContain('pnpm turbo build');
    expect(out).toContain('--mount=type=cache,id=pnpm,target=/pnpm/store');
    expect(out).toContain('pnpm-lock.yaml');
    expect(out).toContain('@my-app/web');
    expect(out).toContain('ENV PNPM_HOME="/pnpm"');
  });

  it('substitutes for npm', () => {
    const out = substituteDockerfilePlaceholders(tpl, 'npm', 'my-app');
    expect(out).toContain('FROM node:24-alpine');
    expect(out).toContain('corepack enable && corepack prepare npm@latest --activate');
    expect(out).toContain('npm ci');
    expect(out).toContain('npx turbo prune');
    expect(out).toContain('npm run turbo build');
    expect(out).toContain('--mount=type=cache,id=npm,target=/root/.npm');
    expect(out).toContain('package-lock.json');
    expect(out).not.toContain('PNPM_HOME');
  });

  it('substitutes for yarn', () => {
    const out = substituteDockerfilePlaceholders(tpl, 'yarn', 'my-app');
    expect(out).toContain('FROM node:24-alpine');
    expect(out).toContain('corepack enable && corepack prepare yarn@stable --activate');
    expect(out).toContain('yarn install --immutable');
    expect(out).toContain('yarn dlx turbo prune');
    expect(out).toContain('yarn turbo build');
    expect(out).toContain('--mount=type=cache,id=yarn,target=/usr/local/share/.cache/yarn');
    expect(out).toContain('yarn.lock');
    expect(out).not.toContain('PNPM_HOME');
  });

  it('substitutes for bun (different base image, no corepack)', () => {
    const out = substituteDockerfilePlaceholders(tpl, 'bun', 'my-app');
    expect(out).toContain('FROM oven/bun:1-alpine');
    expect(out).not.toContain('corepack');
    expect(out).toContain('bun install --frozen-lockfile');
    expect(out).toContain('bunx turbo prune');
    expect(out).toContain('bun run turbo build');
    expect(out).toContain('--mount=type=cache,id=bun,target=/root/.bun/install/cache');
    expect(out).toContain('bun.lockb');
    expect(out).not.toContain('PNPM_HOME');
  });
});

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const DOCKERFILE_MONOREPO_TEMPLATE = readFileSync(
  path.join(__dirname2, '../../src/templates/docker/Dockerfile.monorepo'),
  'utf-8'
);

describe('rewriteImportsInTree', () => {
  // Audit Priority 4: rewriteImportsInTree was only exercised through end-to-end
  // setup_database / setup_authentication tests. These unit tests cover the
  // walker mechanics directly: subdirectory traversal, file-extension filter,
  // skip-list, idempotency, and the longest-prefix-first sort with three
  // overlapping aliases (broader than the existing two-mapping regression).

  let root: string;

  beforeEach(async () => {
    root = await createTempDir('next-mcp-rewrite-walk-');
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /** Helper: write a file with the given relative path under the test root. */
  async function writeAt(rel: string, contents: string): Promise<string> {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf-8');
    return full;
  }

  it('walks multiple subdirectories and only rewrites .ts and .tsx files', async () => {
    // dir1/file1.ts and dir2/sub/file2.tsx — both must be rewritten.
    // dir1/sibling.js, dir2/notes.md — must NOT be rewritten.
    const ts = await writeAt('dir1/file1.ts', "import { db } from '@/lib/db';\nexport const x = db;\n");
    const tsx = await writeAt(
      'dir2/sub/file2.tsx',
      "import { db } from '@/lib/db';\nexport function C() { return null; }\n"
    );
    const js = await writeAt('dir1/sibling.js', "import { db } from '@/lib/db';\nexport const y = db;\n");
    const md = await writeAt('dir2/notes.md', 'see @/lib/db for details\n');

    await rewriteImportsInTree(root, [
      { alias: '@/lib/db', replacement: '@acme/db', preserveSubpath: true },
    ]);

    expect(await fs.readFile(ts, 'utf-8')).toContain("from '@acme/db'");
    expect(await fs.readFile(tsx, 'utf-8')).toContain("from '@acme/db'");
    // .js / .md files must be untouched — file-extension filter is `.ts|.tsx` only.
    expect(await fs.readFile(js, 'utf-8')).toContain("from '@/lib/db'");
    expect(await fs.readFile(md, 'utf-8')).toBe('see @/lib/db for details\n');
  });

  it('skips node_modules, .next, .prisma, .turbo, dist, public directories', async () => {
    // For each skip-listed dir, drop a real .ts file with a real import
    // statement — if the walker descends, the import WILL be rewritten and
    // the assertion fails. Note the file extension and import shape match
    // exactly what the rewriter targets, so the only thing keeping these
    // files untouched is the skip-list.
    const skipDirs = ['node_modules', '.next', '.prisma', '.turbo', 'dist', 'public'];
    const skippedFiles: string[] = [];
    for (const dir of skipDirs) {
      skippedFiles.push(
        await writeAt(
          `${dir}/leaf.ts`,
          "import { db } from '@/lib/db';\nexport const v = db;\n"
        )
      );
    }
    // Add a sibling file in a non-skipped directory so we know the walker
    // ran at all (positive control).
    const positive = await writeAt(
      'src/active.ts',
      "import { db } from '@/lib/db';\nexport const v = db;\n"
    );

    await rewriteImportsInTree(root, [
      { alias: '@/lib/db', replacement: '@acme/db', preserveSubpath: true },
    ]);

    // The positive control IS rewritten — proves the walker engaged.
    expect(await fs.readFile(positive, 'utf-8')).toContain("from '@acme/db'");

    // Each skip-listed dir's leaf is byte-for-byte unchanged.
    for (const file of skippedFiles) {
      expect(await fs.readFile(file, 'utf-8')).toBe(
        "import { db } from '@/lib/db';\nexport const v = db;\n"
      );
    }
  });

  it('is idempotent — running twice produces the same output as running once', async () => {
    const target = await writeAt(
      'src/idempotent.ts',
      [
        "import { db } from '@/lib/db';",
        "import type { User } from '@/lib/db/types';",
        "import { auth } from '@/lib/auth';",
        '',
        'export const refs = { db, User: null as User | null, auth };',
        '',
      ].join('\n')
    );

    const mappings: Parameters<typeof rewriteImportsInTree>[1] = [
      { alias: '@/lib/db', replacement: '@acme/db', preserveSubpath: true },
      { alias: '@/lib/auth', replacement: '@acme/auth/server', preserveSubpath: false },
    ];

    await rewriteImportsInTree(root, mappings);
    const afterOne = await fs.readFile(target, 'utf-8');

    await rewriteImportsInTree(root, mappings);
    const afterTwo = await fs.readFile(target, 'utf-8');

    expect(afterTwo).toBe(afterOne);
    // And the content matches expectations (sanity check).
    expect(afterOne).toContain("from '@acme/db'");
    expect(afterOne).toContain("from '@acme/db/types'");
    expect(afterOne).toContain("from '@acme/auth/server'");
    expect(afterOne).not.toContain("from '@/lib/db'");
    expect(afterOne).not.toContain("from '@/lib/auth'");
  });

  it('sorts mappings longest-prefix-first regardless of input order (3 overlapping aliases)', async () => {
    // Three aliases share a prefix. With an alphabetic / shortest-first sort,
    // `@/lib/auth` would partially consume `@/lib/auth-client` and the
    // resulting import would point at `@acme/auth/server-client` (broken).
    // The walker's internal sort guarantees the longest alias matches first
    // even when the caller passes them in any order.
    const target = await writeAt(
      'src/overlapping.ts',
      [
        // Source order matters here — the longest alias is FIRST in source,
        // so a naive scanner that already touched the bytes for it would be
        // re-touched by the shorter alias if the sort were broken.
        "import { authClientApi } from '@/lib/auth-client-api';",
        "import { authClient } from '@/lib/auth-client';",
        "import { auth } from '@/lib/auth';",
        '',
        'export const refs = { auth, authClient, authClientApi };',
        '',
      ].join('\n')
    );

    // Pass mappings in deliberately bad order (shortest first) so a
    // regression that drops the internal sort would surface immediately.
    await rewriteImportsInTree(root, [
      { alias: '@/lib/auth', replacement: '@acme/auth/server', preserveSubpath: false },
      { alias: '@/lib/auth-client', replacement: '@acme/auth/client', preserveSubpath: false },
      { alias: '@/lib/auth-client-api', replacement: '@acme/auth/client-api', preserveSubpath: false },
    ]);

    const rewritten = await fs.readFile(target, 'utf-8');
    expect(rewritten).toContain("from '@acme/auth/server'");
    expect(rewritten).toContain("from '@acme/auth/client'");
    expect(rewritten).toContain("from '@acme/auth/client-api'");
    // Fail-modes for a broken sort: the shorter alias consuming the longer
    // one's prefix and producing nonsense replacements.
    expect(rewritten).not.toContain('@acme/auth/server-client');
    expect(rewritten).not.toContain('@acme/auth/server-client-api');
    // And no legacy alias remains anywhere.
    expect(rewritten).not.toContain("from '@/lib/auth'");
    expect(rewritten).not.toContain("from '@/lib/auth-client'");
    expect(rewritten).not.toContain("from '@/lib/auth-client-api'");
  });

  it('handles empty roots and empty mapping lists without throwing', async () => {
    // Defensive: walker over an empty dir, and walker with no mappings —
    // both must be safe no-ops.
    await expect(rewriteImportsInTree(root, [])).resolves.toBeUndefined();

    const file = await writeAt('src/leaf.ts', "import { db } from '@/lib/db';\n");
    await rewriteImportsInTree(root, []);
    // No mappings -> file unchanged.
    expect(await fs.readFile(file, 'utf-8')).toBe("import { db } from '@/lib/db';\n");
  });
});

describe('Dockerfile.monorepo substitution end-to-end', () => {
  it.each(['pnpm', 'npm', 'yarn', 'bun'] as const)(
    '%s output has no unresolved placeholders',
    (pm) => {
      const out = substituteDockerfilePlaceholders(DOCKERFILE_MONOREPO_TEMPLATE, pm, 'sample');
      expect(out).not.toMatch(/__[A-Z_]+__/);
    }
  );

  it('pnpm output is functionally equivalent to the previous pnpm-specific Dockerfile', () => {
    const out = substituteDockerfilePlaceholders(DOCKERFILE_MONOREPO_TEMPLATE, 'pnpm', 'sample');
    expect(out).toContain('FROM node:24-alpine AS base');
    expect(out).toContain('corepack enable && corepack prepare pnpm@latest --activate');
    expect(out).toContain('pnpm dlx turbo@^2 prune $PACKAGE --docker');
    expect(out).toContain('COPY --from=deps /app/out/pnpm-lock.yaml ./pnpm-lock.yaml');
    expect(out).toContain('--mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile');
    expect(out).toContain('pnpm turbo build --filter=$PACKAGE...');
    expect(out).toContain('@sample/web');
  });

  it('bun output drops corepack and uses oven/bun base image', () => {
    const out = substituteDockerfilePlaceholders(DOCKERFILE_MONOREPO_TEMPLATE, 'bun', 'sample');
    expect(out).toContain('FROM oven/bun:1-alpine AS base');
    expect(out).not.toContain('corepack');
    expect(out).toContain('bun install --frozen-lockfile');
    expect(out).toContain('bun.lockb');
  });
});

describe('packageRunnerDlx', () => {
  it('returns the dlx command per package manager', () => {
    expect(packageRunnerDlx('pnpm')).toBe('pnpm dlx');
    expect(packageRunnerDlx('yarn')).toBe('yarn dlx');
    expect(packageRunnerDlx('bun')).toBe('bunx --bun');
    expect(packageRunnerDlx('npm')).toBe('npx');
  });
});

describe('getAuthConfigRelPath', () => {
  it('returns packages/auth path when auth is routed', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'full', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
    });
    expect(getAuthConfigRelPath(cfg)).toBe('packages/auth/src/server.ts');
  });

  it('returns apps/web path in minimal mode', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'minimal', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
    });
    expect(getAuthConfigRelPath(cfg)).toBe('apps/web/src/lib/auth.ts');
  });

  it('returns flat path in monorepo:none mode', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'none', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
    });
    expect(getAuthConfigRelPath(cfg)).toBe('src/lib/auth.ts');
  });

  it('returns apps/web path in full mode when auth is NOT routed (orm:none)', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'full', database: 'postgres', orm: 'none', auth: 'better-auth' },
    });
    expect(getAuthConfigRelPath(cfg)).toBe('apps/web/src/lib/auth.ts');
  });
});

describe('getAuthSchemaOutputRelPath', () => {
  it('returns packages/db schema path when db routed + drizzle', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'full', database: 'postgres', orm: 'drizzle', auth: 'better-auth' },
    });
    expect(getAuthSchemaOutputRelPath(cfg)).toBe('packages/db/src/schema/auth.ts');
  });

  it('returns apps/web schema path in minimal + drizzle', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'minimal', database: 'postgres', orm: 'drizzle', auth: 'better-auth' },
    });
    expect(getAuthSchemaOutputRelPath(cfg)).toBe('apps/web/src/lib/db/schema/auth.ts');
  });

  it('returns flat schema path in monorepo:none + drizzle', () => {
    const cfg = createMockConfig({
      architecture: { monorepo: 'none', database: 'postgres', orm: 'drizzle', auth: 'better-auth' },
    });
    expect(getAuthSchemaOutputRelPath(cfg)).toBe('src/lib/db/schema/auth.ts');
  });

  it('returns null for non-drizzle ORMs', () => {
    expect(
      getAuthSchemaOutputRelPath(
        createMockConfig({ architecture: { orm: 'prisma', auth: 'better-auth' } })
      )
    ).toBeNull();
    expect(
      getAuthSchemaOutputRelPath(
        createMockConfig({ architecture: { orm: 'mongoose', database: 'mongodb', auth: 'better-auth' } })
      )
    ).toBeNull();
    expect(
      getAuthSchemaOutputRelPath(
        createMockConfig({ architecture: { orm: 'none', auth: 'none' } })
      )
    ).toBeNull();
  });
});

describe('getAuthGenerateScript', () => {
  it('emits dotenv + auth@latest command for drizzle + better-auth (full mode)', () => {
    const cfg = createMockConfig({
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'better-auth',
        packageManager: 'pnpm',
      },
    });
    expect(getAuthGenerateScript(cfg)).toBe(
      'dotenv -e .env -- pnpm dlx auth@latest generate -y --config packages/auth/src/server.ts --output packages/db/src/schema/auth.ts'
    );
  });

  it('uses npx for npm-based projects', () => {
    const cfg = createMockConfig({
      architecture: {
        monorepo: 'none',
        database: 'postgres',
        orm: 'drizzle',
        auth: 'better-auth',
        packageManager: 'npm',
      },
    });
    expect(getAuthGenerateScript(cfg)).toBe(
      'dotenv -e .env -- npx auth@latest generate -y --config src/lib/auth.ts --output src/lib/db/schema/auth.ts'
    );
  });

  it('returns null for prisma (better-auth modifies schema.prisma in-place via setup_authentication)', () => {
    const cfg = createMockConfig({
      architecture: { orm: 'prisma', auth: 'better-auth' },
    });
    expect(getAuthGenerateScript(cfg)).toBeNull();
  });

  it('returns null for auth:none', () => {
    const cfg = createMockConfig({
      architecture: { orm: 'drizzle', auth: 'none', database: 'postgres' },
    });
    expect(getAuthGenerateScript(cfg)).toBeNull();
  });
});
