import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppPath, getShadcnRunner, substituteCatalog, substituteProjectName } from '../../src/index.js';
import type { ProjectConfig } from '../../src/index.js';
import {
  cleanupTempDir,
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
});
