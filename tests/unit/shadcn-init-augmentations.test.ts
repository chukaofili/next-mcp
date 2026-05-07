/**
 * Unit coverage for the augmentation primitives that wrap shadcn's
 * monorepo init. Each helper is tested in isolation against a temp
 * dir seeded with the relevant slice of shadcn's output. The full
 * pipeline (scaffoldViaShadcnMonorepo / scaffoldViaShadcnFlat) is
 * exercised separately via the integration suite + smoke driver.
 *
 * Refs: docs/plans/2026-05-07-r1-spike-results.md (the patch sketch
 * + §8.1/§8.3 corrections), design doc §6.2.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addDockerScripts,
  alignPins,
  appendCatalogBlock,
  CATALOG_VERSIONS,
  moveAppsWebFlatToSrc,
  patchNextConfigMjs,
  renameWorkspaceScope,
  swapTypescriptConfig,
} from '../../src/index.js';
import { cleanupTempDir, createTempDir, fileExists } from '../helpers/test-utils.js';

describe('renameWorkspaceScope', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('rewrites @workspace/ → @<name>/ across .json/.ts/.tsx/.js/.mjs/.md files', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'shadcn-template',
          devDependencies: {
            '@workspace/eslint-config': 'workspace:*',
            '@workspace/typescript-config': 'workspace:*',
            prettier: '^3',
          },
        },
        null,
        2
      ) + '\n'
    );
    await fs.writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ extends: '@workspace/typescript-config/base.json' }, null, 2) + '\n'
    );
    await fs.writeFile(path.join(tempDir, 'README.md'), `import { Button } from "@workspace/ui";\n`);
    await fs.mkdir(path.join(tempDir, 'apps', 'web'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps/web/postcss.config.mjs'),
      `export { default } from "@workspace/ui/postcss.config";\n`
    );
    await fs.mkdir(path.join(tempDir, 'apps/web/app'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps/web/app/page.tsx'),
      `import { Button } from "@workspace/ui/components/button";\nexport default () => <Button />;\n`
    );

    await renameWorkspaceScope(tempDir, 'my-app');

    const root = JSON.parse(await fs.readFile(path.join(tempDir, 'package.json'), 'utf-8'));
    expect(root.devDependencies['@my-app/eslint-config']).toBe('workspace:*');
    expect(root.devDependencies['@my-app/typescript-config']).toBe('workspace:*');
    expect(root.devDependencies['@workspace/eslint-config']).toBeUndefined();

    const tsc = JSON.parse(await fs.readFile(path.join(tempDir, 'tsconfig.json'), 'utf-8'));
    expect(tsc.extends).toBe('@my-app/typescript-config/base.json');

    const readme = await fs.readFile(path.join(tempDir, 'README.md'), 'utf-8');
    expect(readme).toContain('@my-app/ui');
    expect(readme).not.toContain('@workspace/');

    const post = await fs.readFile(path.join(tempDir, 'apps/web/postcss.config.mjs'), 'utf-8');
    expect(post).toContain('@my-app/ui/postcss.config');

    const page = await fs.readFile(path.join(tempDir, 'apps/web/app/page.tsx'), 'utf-8');
    expect(page).toContain('@my-app/ui/components/button');
  });

  it('renames apps/web/package.json.name from "web" to "@<name>/web" (B5/§8.1 addendum)', async () => {
    await fs.mkdir(path.join(tempDir, 'apps', 'web'), { recursive: true });
    // shadcn ships apps/web with name "web" (unscoped), so a literal
    // substring rewrite of @workspace/ skips it. The helper must
    // patch this explicitly.
    await fs.writeFile(
      path.join(tempDir, 'apps/web/package.json'),
      JSON.stringify({ name: 'web', dependencies: { '@workspace/ui': 'workspace:*' } }, null, 2) + '\n'
    );

    await renameWorkspaceScope(tempDir, 'shop');

    const pkg = JSON.parse(await fs.readFile(path.join(tempDir, 'apps/web/package.json'), 'utf-8'));
    expect(pkg.name).toBe('@shop/web');
    expect(pkg.dependencies['@shop/ui']).toBe('workspace:*');
  });

  it('is idempotent (re-running is a no-op)', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'foo', devDependencies: { '@workspace/ui': 'workspace:*' } }, null, 2) + '\n'
    );

    await renameWorkspaceScope(tempDir, 'foo');
    const after1 = await fs.readFile(path.join(tempDir, 'package.json'), 'utf-8');
    await renameWorkspaceScope(tempDir, 'foo');
    const after2 = await fs.readFile(path.join(tempDir, 'package.json'), 'utf-8');

    expect(after2).toBe(after1);
    expect(after2).toContain('@foo/ui');
    expect(after2).not.toContain('@workspace/');
  });

  it('skips node_modules and .git', async () => {
    await fs.mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'node_modules/pkg/package.json'),
      JSON.stringify({ name: '@workspace/should-be-skipped' }, null, 2) + '\n'
    );
    await fs.writeFile(
      path.join(tempDir, '.git/config'),
      `[remote "@workspace/origin"]\n`
    );
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'app' }, null, 2) + '\n'
    );

    await renameWorkspaceScope(tempDir, 'app');

    const nm = await fs.readFile(path.join(tempDir, 'node_modules/pkg/package.json'), 'utf-8');
    expect(nm).toContain('@workspace/should-be-skipped'); // untouched
    const git = await fs.readFile(path.join(tempDir, '.git/config'), 'utf-8');
    expect(git).toContain('@workspace/origin'); // untouched
  });
});

describe('appendCatalogBlock', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('appends a catalog: block under the existing packages: section', async () => {
    const initial = `packages:\n  - "apps/*"\n  - "packages/*"\n`;
    await fs.writeFile(path.join(tempDir, 'pnpm-workspace.yaml'), initial);

    await appendCatalogBlock(tempDir);

    const after = await fs.readFile(path.join(tempDir, 'pnpm-workspace.yaml'), 'utf-8');
    expect(after).toContain('packages:');
    expect(after).toContain('catalog:');
    for (const key of Object.keys(CATALOG_VERSIONS)) {
      expect(after).toContain(key);
    }
  });

  it('is idempotent (re-running does not duplicate entries)', async () => {
    const initial = `packages:\n  - "apps/*"\n  - "packages/*"\n`;
    await fs.writeFile(path.join(tempDir, 'pnpm-workspace.yaml'), initial);

    await appendCatalogBlock(tempDir);
    const first = await fs.readFile(path.join(tempDir, 'pnpm-workspace.yaml'), 'utf-8');
    await appendCatalogBlock(tempDir);
    const second = await fs.readFile(path.join(tempDir, 'pnpm-workspace.yaml'), 'utf-8');

    expect(second).toBe(first);
    // No duplicate "catalog:" headers.
    expect(second.match(/^catalog:/gm)?.length).toBe(1);
  });
});

describe('alignPins', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('bumps packageManager, engines, and root typescript devDep for pnpm', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'shadcn-template',
          devDependencies: { typescript: '5.9.3', turbo: '^2.8.17' },
          packageManager: 'pnpm@9.15.9',
          engines: { node: '>=20' },
        },
        null,
        2
      ) + '\n'
    );

    await alignPins(tempDir, 'pnpm');

    const pkg = JSON.parse(await fs.readFile(path.join(tempDir, 'package.json'), 'utf-8'));
    expect(pkg.packageManager).toBe('pnpm@10.18.0');
    expect(pkg.engines.node).toBe('>=24');
    expect(pkg.engines.pnpm).toBe('>=10');
    expect(pkg.devDependencies.typescript).toBe('^6');
    // Other deps should be untouched.
    expect(pkg.devDependencies.turbo).toBe('^2.8.17');
  });

  it('drops packageManager + engines.pnpm for non-pnpm', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'shadcn-template',
          devDependencies: { typescript: '5.9.3' },
          packageManager: 'pnpm@9.15.9',
          engines: { node: '>=20' },
        },
        null,
        2
      ) + '\n'
    );

    await alignPins(tempDir, 'npm');

    const pkg = JSON.parse(await fs.readFile(path.join(tempDir, 'package.json'), 'utf-8'));
    expect(pkg.packageManager).toBeUndefined();
    expect(pkg.engines.node).toBe('>=24');
    expect(pkg.engines.pnpm).toBeUndefined();
    expect(pkg.devDependencies.typescript).toBe('^6');
  });

  it('also bumps typescript devDep in apps/* and packages/* workspaces (shadcn pins TS in child workspaces)', async () => {
    // shadcn's monorepo init pins typescript ^5.9.3 in apps/web,
    // packages/ui, and packages/eslint-config — three sites in addition to
    // the root. Without bumping each, generated monorepos install/run
    // typescript 5.9.x in those workspaces and the intended ^6 catalog pin
    // doesn't take effect (Codex review P2).
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'shadcn-template',
          devDependencies: { typescript: '5.9.3', turbo: '^2.8.17' },
          packageManager: 'pnpm@9.15.9',
          engines: { node: '>=20' },
        },
        null,
        2
      ) + '\n'
    );
    await fs.mkdir(path.join(tempDir, 'apps/web'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'apps/web/package.json'),
      JSON.stringify(
        {
          name: '@workspace/web',
          devDependencies: { typescript: '^5.9.3', '@types/node': '^25' },
        },
        null,
        2
      ) + '\n'
    );
    await fs.mkdir(path.join(tempDir, 'packages/ui'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'packages/ui/package.json'),
      JSON.stringify(
        {
          name: '@workspace/ui',
          devDependencies: { typescript: '^5.9.3' },
        },
        null,
        2
      ) + '\n'
    );
    await fs.mkdir(path.join(tempDir, 'packages/eslint-config'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'packages/eslint-config/package.json'),
      JSON.stringify(
        {
          name: '@workspace/eslint-config',
          devDependencies: { typescript: '^5.9.3', eslint: '^10' },
        },
        null,
        2
      ) + '\n'
    );
    // No typescript devDep on this one — should be left untouched.
    await fs.mkdir(path.join(tempDir, 'packages/typescript-config'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'packages/typescript-config/package.json'),
      JSON.stringify({ name: '@workspace/typescript-config' }, null, 2) + '\n'
    );

    await alignPins(tempDir, 'pnpm');

    for (const rel of [
      'apps/web/package.json',
      'packages/ui/package.json',
      'packages/eslint-config/package.json',
    ]) {
      const child = JSON.parse(await fs.readFile(path.join(tempDir, rel), 'utf-8'));
      expect(child.devDependencies.typescript).toBe('^6');
    }
    // Other deps in child workspaces stay put.
    const web = JSON.parse(await fs.readFile(path.join(tempDir, 'apps/web/package.json'), 'utf-8'));
    expect(web.devDependencies['@types/node']).toBe('^25');
    const eslintCfg = JSON.parse(await fs.readFile(path.join(tempDir, 'packages/eslint-config/package.json'), 'utf-8'));
    expect(eslintCfg.devDependencies.eslint).toBe('^10');
    // Workspaces with no typescript pin are left as-is.
    const tsc = JSON.parse(await fs.readFile(path.join(tempDir, 'packages/typescript-config/package.json'), 'utf-8'));
    expect(tsc.devDependencies).toBeUndefined();
  });
});

describe('swapTypescriptConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('replaces shadcn base.json/nextjs.json/react-library.json with next-mcp templates', async () => {
    const tscDir = path.join(tempDir, 'packages/typescript-config');
    await fs.mkdir(tscDir, { recursive: true });
    // Plant shadcn's restrictive base.json (the one whose `lib` clamp
    // shadows node-globals discovery — see spike-results "B8 withdrawn" note).
    await fs.writeFile(
      path.join(tscDir, 'base.json'),
      JSON.stringify(
        { compilerOptions: { lib: ['es2022', 'DOM', 'DOM.Iterable'], strict: true } },
        null,
        2
      ) + '\n'
    );

    await swapTypescriptConfig(tempDir);

    // next-mcp's base.json is JSONC (carries a trailing comma that tsc
    // accepts but JSON.parse does not), so check the raw text instead of
    // strict-parsing.
    const after = await fs.readFile(path.join(tscDir, 'base.json'), 'utf-8');
    expect(after).not.toContain('"lib"'); // next-mcp's base does not clamp `lib`
    expect(after).toContain('"composite": true'); // next-mcp's base sets composite

    expect(await fileExists(path.join(tscDir, 'nextjs.json'))).toBe(true);
    expect(await fileExists(path.join(tscDir, 'react-library.json'))).toBe(true);
  });
});

describe('moveAppsWebFlatToSrc', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('moves apps/web/{app,components,hooks,lib} under apps/web/src/ and updates path mappings (monorepo case — cross-workspace tailwind.css unchanged)', async () => {
    const appPath = path.join(tempDir, 'apps/web');
    await fs.mkdir(path.join(appPath, 'app'), { recursive: true });
    await fs.mkdir(path.join(appPath, 'components'), { recursive: true });
    await fs.mkdir(path.join(appPath, 'hooks'), { recursive: true });
    await fs.mkdir(path.join(appPath, 'lib'), { recursive: true });
    await fs.writeFile(path.join(appPath, 'app/layout.tsx'), `export default () => null;\n`);
    await fs.writeFile(path.join(appPath, 'app/page.tsx'), `export default () => null;\n`);
    await fs.writeFile(path.join(appPath, 'components/.gitkeep'), '');
    await fs.writeFile(path.join(appPath, 'hooks/.gitkeep'), '');
    await fs.writeFile(path.join(appPath, 'lib/.gitkeep'), '');
    // shadcn-emitted apps/web/tsconfig.json (flat layout)
    await fs.writeFile(
      path.join(appPath, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: '@workspace/typescript-config/nextjs.json',
          compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'], '@workspace/ui/*': ['../../packages/ui/src/*'] } },
          include: ['next-env.d.ts', 'next.config.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
          exclude: ['node_modules'],
        },
        null,
        2
      ) + '\n'
    );
    // shadcn-emitted components.json — monorepo points tailwind.css at the
    // sibling packages/ui workspace (cross-workspace).
    await fs.writeFile(
      path.join(appPath, 'components.json'),
      JSON.stringify(
        {
          tailwind: { css: '../../packages/ui/src/styles/globals.css' },
          aliases: { components: '@/components', hooks: '@/hooks', lib: '@/lib' },
        },
        null,
        2
      ) + '\n'
    );

    await moveAppsWebFlatToSrc(appPath);

    expect(await fileExists(path.join(appPath, 'src/app/layout.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/app/page.tsx'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/components/.gitkeep'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/hooks/.gitkeep'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src/lib/.gitkeep'))).toBe(true);
    // Originals removed.
    expect(await fileExists(path.join(appPath, 'app/layout.tsx'))).toBe(false);
    expect(await fileExists(path.join(appPath, 'components/.gitkeep'))).toBe(false);

    // tsconfig path mapping updated (@/* now points at ./src/*).
    const tsc = JSON.parse(await fs.readFile(path.join(appPath, 'tsconfig.json'), 'utf-8'));
    expect(tsc.compilerOptions.paths['@/*']).toEqual(['./src/*']);

    // components.json tailwind.css path is UNCHANGED — components.json itself
    // doesn't move, packages/ui doesn't move, so the cross-workspace relative
    // path is the same before and after the apps/web/{app,...} → apps/web/src/{app,...}
    // shuffle. (Bug guard: prior implementation prepended an extra `../` and
    // broke `setup_shadcn`'s `shadcn add --all` resolution.)
    const cj = JSON.parse(await fs.readFile(path.join(appPath, 'components.json'), 'utf-8'));
    expect(cj.tailwind.css).toBe('../../packages/ui/src/styles/globals.css');
  });

  it('rewrites local tailwind.css from `app/globals.css` → `src/app/globals.css` for flat layout', async () => {
    // Flat dispatch: moveAppsWebFlatToSrc is called with `appPath = projectPath`
    // (the entire project IS the app). shadcn's flat init emits
    // `tailwind.css: "app/globals.css"` — this needs to track the move.
    const appPath = tempDir;
    await fs.mkdir(path.join(appPath, 'app'), { recursive: true });
    await fs.writeFile(
      path.join(appPath, 'app/globals.css'),
      `@import "tailwindcss";\n`
    );
    await fs.writeFile(path.join(appPath, 'app/layout.tsx'), `export default () => null;\n`);
    await fs.writeFile(
      path.join(appPath, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }, null, 2) + '\n'
    );
    await fs.writeFile(
      path.join(appPath, 'components.json'),
      JSON.stringify({ tailwind: { css: 'app/globals.css' } }, null, 2) + '\n'
    );

    await moveAppsWebFlatToSrc(appPath);

    expect(await fileExists(path.join(appPath, 'src/app/globals.css'))).toBe(true);
    const cj = JSON.parse(await fs.readFile(path.join(appPath, 'components.json'), 'utf-8'));
    expect(cj.tailwind.css).toBe('src/app/globals.css');
  });

  it('is idempotent: re-running on an already-src/ layout is a no-op', async () => {
    const appPath = path.join(tempDir, 'apps/web');
    await fs.mkdir(path.join(appPath, 'src/app'), { recursive: true });
    await fs.writeFile(path.join(appPath, 'src/app/page.tsx'), `export default () => null;\n`);
    await fs.writeFile(
      path.join(appPath, 'tsconfig.json'),
      JSON.stringify(
        { compilerOptions: { paths: { '@/*': ['./src/*'] } } },
        null,
        2
      ) + '\n'
    );
    // Cross-workspace path stays put — verifies the second call doesn't drift.
    await fs.writeFile(
      path.join(appPath, 'components.json'),
      JSON.stringify({ tailwind: { css: '../../packages/ui/src/styles/globals.css' } }, null, 2) + '\n'
    );

    await moveAppsWebFlatToSrc(appPath);
    await moveAppsWebFlatToSrc(appPath);

    expect(await fileExists(path.join(appPath, 'src/app/page.tsx'))).toBe(true);
    const tsc = JSON.parse(await fs.readFile(path.join(appPath, 'tsconfig.json'), 'utf-8'));
    expect(tsc.compilerOptions.paths['@/*']).toEqual(['./src/*']);
    const cj = JSON.parse(await fs.readFile(path.join(appPath, 'components.json'), 'utf-8'));
    expect(cj.tailwind.css).toBe('../../packages/ui/src/styles/globals.css');
  });
});

describe('addDockerScripts', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('adds docker:* scripts to root package.json without disturbing other scripts', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        { name: 'shop', scripts: { build: 'turbo build', dev: 'turbo dev' } },
        null,
        2
      ) + '\n'
    );

    await addDockerScripts(tempDir, 'shop');

    const pkg = JSON.parse(await fs.readFile(path.join(tempDir, 'package.json'), 'utf-8'));
    expect(pkg.scripts.build).toBe('turbo build');
    expect(pkg.scripts.dev).toBe('turbo dev');
    expect(pkg.scripts['docker:build']).toBe('docker build -t shop .');
    expect(pkg.scripts['docker:run']).toBe('docker run -p 3000:3000 shop');
    expect(pkg.scripts['docker:dev:up']).toBe('docker-compose -f docker-compose.yml up');
    expect(pkg.scripts['docker:dev:down']).toBe('docker-compose -f docker-compose.yml down');
  });
});

describe('patchNextConfigMjs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it('adds output: "standalone" when missing', async () => {
    const appPath = path.join(tempDir, 'apps/web');
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(
      path.join(appPath, 'next.config.mjs'),
      `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  transpilePackages: ["@shop/ui"],\n}\n\nexport default nextConfig\n`
    );

    await patchNextConfigMjs(appPath);

    const after = await fs.readFile(path.join(appPath, 'next.config.mjs'), 'utf-8');
    expect(after).toMatch(/output:\s*['"]standalone['"]/);
    expect(after).toContain('transpilePackages');
  });

  it('is idempotent: re-running on a config that already has standalone is a no-op', async () => {
    const appPath = path.join(tempDir, 'apps/web');
    await fs.mkdir(appPath, { recursive: true });
    await fs.writeFile(
      path.join(appPath, 'next.config.mjs'),
      `const nextConfig = { output: 'standalone', transpilePackages: ["@shop/ui"] };\nexport default nextConfig;\n`
    );

    const before = await fs.readFile(path.join(appPath, 'next.config.mjs'), 'utf-8');
    await patchNextConfigMjs(appPath);
    const after = await fs.readFile(path.join(appPath, 'next.config.mjs'), 'utf-8');
    expect(after).toBe(before);
  });
});
