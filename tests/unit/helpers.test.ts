import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempDir,
  cleanupTempDir,
  fileExists,
  dirExists,
  readFile,
  createPackageJson,
  verifyNextJsStructure,
} from '../helpers/test-utils.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

    it('should detect existing structure', async () => {
      // Create basic Next.js structure
      await createPackageJson(tempDir);
      await fs.mkdir(path.join(tempDir, 'src/app'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'next.config.ts'), 'export default {}');
      await fs.writeFile(path.join(tempDir, 'tsconfig.json'), '{}');

      const result = await verifyNextJsStructure(tempDir);

      expect(result.hasPackageJson).toBe(true);
      expect(result.hasSrcDir).toBe(true);
      expect(result.hasAppDir).toBe(true);
      expect(result.hasNextConfig).toBe(true);
      expect(result.hasTsConfig).toBe(true);
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
