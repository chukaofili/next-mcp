import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectConfig } from '../../src/index.ts';

/**
 * Test ProjectConfig type with optional architecture attributes
 * The MCP server will apply defaults for any missing attributes
 */
export type TestProjectConfig = {
  name?: string;
  description?: string;
  architecture?: Partial<ProjectConfig['architecture']>;
};

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(prefix = 'next-mcp-test-'): Promise<string> {
  const tempPath = path.join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).substring(7)}`);
  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to cleanup temp directory ${dirPath}:`, error);
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file content as string
 */
export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Check if a directory exists
 */
export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Execute a command and return output
 */
export function execCommand(command: string, cwd?: string): string {
  return execSync(command, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Create a mock ProjectConfig for testing
 */
export function createMockConfig(overrides?: TestProjectConfig): ProjectConfig {
  return {
    name: overrides?.name,
    description: overrides?.description,
    architecture: {
      typescript: true,
      reactCompiler: false,
      packageManager: 'pnpm',
      database: 'postgres',
      orm: 'prisma',
      auth: 'better-auth',
      uiLibrary: 'shadcn',
      stateManagement: 'none',
      testing: 'vitest',
      skipInstall: true,
      ...(overrides?.architecture || {}),
    },
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a basic package.json for testing
 */
export async function createPackageJson(dirPath: string, config?: { name?: string }): Promise<void> {
  const packageJson = {
    name: config?.name || 'test-project',
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'next lint',
    },
    dependencies: {},
    devDependencies: {},
  };

  await fs.writeFile(path.join(dirPath, 'package.json'), JSON.stringify(packageJson, null, 2));
}

/**
 * Verify basic Next.js project structure
 */
export async function verifyNextJsStructure(projectPath: string): Promise<{
  hasPackageJson: boolean;
  hasSrcDir: boolean;
  hasAppDir: boolean;
  hasNextConfig: boolean;
  hasTsConfig: boolean;
}> {
  return {
    hasPackageJson: await fileExists(path.join(projectPath, 'package.json')),
    hasSrcDir: await dirExists(path.join(projectPath, 'src')),
    hasAppDir: await dirExists(path.join(projectPath, 'src/app')),
    hasNextConfig: await fileExists(path.join(projectPath, 'next.config.ts')),
    hasTsConfig: await fileExists(path.join(projectPath, 'tsconfig.json')),
  };
}
