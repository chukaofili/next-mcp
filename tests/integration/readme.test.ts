import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists, readFile } from '../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('README Generation', () => {
  let client: MCPTestClient;
  let tempDir: string;
  // Always test the built distribution files (dist/index.js)
  // This ensures we test exactly what will be deployed/published
  const serverPath = path.join(__dirname, '../../dist/index.js');

  beforeEach(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000);

  afterEach(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should create README.md file', async () => {
    const config = createMockConfig();

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const exists = await fileExists(readmePath);

    expect(exists).toBe(true);
  });

  it('should include project name and description', async () => {
    const config = createMockConfig({
      name: 'my-awesome-app',
      description: 'An awesome Next.js application',
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('my-awesome-app');
    expect(content).toContain('An awesome Next.js application');
  });

  it('should include tech stack information', async () => {
    const config = createMockConfig({
      architecture: {
        typescript: true,
        database: 'postgres',
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Next.js');
    expect(content).toContain('TypeScript');
    expect(content).toContain('postgres');
    expect(content).toContain('prisma');
    expect(content).toContain('better-auth');
    expect(content).toContain('shadcn');
  });

  it('should include package manager specific commands', async () => {
    // pnpm/yarn accept the bare script name (`pnpm dev`); npm/bun
    // require the explicit `run` keyword (`npm run dev`, `bun run dev`).
    // Asserting `${pm.name} dev` for npm/bun would lock in invalid
    // copy-paste commands that error out for users on those managers.
    const packageManagers = [
      { name: 'pnpm', devCommand: 'pnpm dev' },
      { name: 'npm', devCommand: 'npm run dev' },
      { name: 'yarn', devCommand: 'yarn dev' },
      { name: 'bun', devCommand: 'bun run dev' },
    ] as const;

    for (const pm of packageManagers) {
      const config = createMockConfig({
        architecture: { packageManager: pm.name },
      });

      const result = await client.callTool('generate_readme', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
      const readmePath = path.join(tempDir, 'README.md');
      const content = await readFile(readmePath);

      expect(content).toContain(pm.devCommand);
    }
  });

  it('should include database setup instructions for Prisma', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
        packageManager: 'pnpm',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Database Setup');
    expect(content).toContain('Prisma');
    expect(content).toContain('prisma migrate');
    expect(content).toContain('docker:dev:up');
  });

  it('should include database setup instructions for Drizzle', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'mysql',
        orm: 'drizzle',
        packageManager: 'npm',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Drizzle');
    expect(content).toContain('drizzle-kit');
  });

  it('should include authentication documentation', async () => {
    const config = createMockConfig({
      architecture: {
        auth: 'better-auth',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Authentication');
    expect(content).toContain('Better Auth');
    expect(content).toContain('/auth/sign-in');
    expect(content).toContain('/auth/sign-up');
    expect(content).toContain('UserButton');
  });

  it('should include testing instructions when testing is configured', async () => {
    const testingFrameworks = ['vitest', 'jest', 'playwright'] as const;

    for (const framework of testingFrameworks) {
      const config = createMockConfig({
        architecture: { testing: framework },
      });

      const result = await client.callTool('generate_readme', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
      const readmePath = path.join(tempDir, 'README.md');
      const content = await readFile(readmePath);

      expect(content).toContain('Testing');
      expect(content).toContain('test');
    }
  });

  it('should not include database sections when database is none', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'none',
        orm: 'none',
        auth: 'none',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    // Should not contain database-specific setup
    expect(content).not.toContain('Database Setup (Prisma)');
    expect(content).not.toContain('Database Setup (Drizzle)');
  });

  it('should not include auth sections when auth is none', async () => {
    const config = createMockConfig({
      architecture: {
        auth: 'none',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).not.toContain('Better Auth');
    expect(content).not.toContain('/auth/sign-in');
  });

  it('should include Docker instructions', async () => {
    const config = createMockConfig();

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Docker');
    expect(content).toContain('docker:build');
    expect(content).toContain('docker-compose');
  });

  it('should include deployment section', async () => {
    const config = createMockConfig();

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Deployment');
    expect(content).toContain('Vercel');
  });

  it('should include project structure diagram', async () => {
    const config = createMockConfig({
      architecture: {
        orm: 'prisma',
        auth: 'better-auth',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Project Structure');
    expect(content).toContain('src/');
    expect(content).toContain('prisma/');
    expect(content).toContain('components/');
  });

  it('should include links to documentation', async () => {
    const config = createMockConfig({
      architecture: {
        orm: 'prisma',
        auth: 'better-auth',
        uiLibrary: 'shadcn',
      },
    });

    const result = await client.callTool('generate_readme', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const readmePath = path.join(tempDir, 'README.md');
    const content = await readFile(readmePath);

    expect(content).toContain('Learn More');
    expect(content).toContain('nextjs.org/docs');
    expect(content).toContain('tailwindcss.com');
    expect(content).toContain('prisma.io');
    expect(content).toContain('better-auth.com');
    expect(content).toContain('ui.shadcn.com');
  });

  it('uses per-pm workspace filter shape and omits pnpm-workspace.yaml for non-pnpm monorepos', async () => {
    // Codex flagged that the README was emitting `npm --filter <pkg>`
    // (invalid — npm uses `--workspace=`) and listing `pnpm-workspace.yaml`
    // even for npm/yarn/bun workspaces (where the file isn't generated).
    // This test pins both fixes for npm; the per-pm helper unit tests
    // cover the other managers' shapes.
    const config = createMockConfig({
      name: 'npm-monorepo-readme',
      architecture: {
        monorepo: 'full',
        packageManager: 'npm',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
      },
    });

    const result = await client.callTool('generate_readme', { config, projectPath: tempDir });
    expect(client.isSuccess(result)).toBe(true);

    const content = await readFile(path.join(tempDir, 'README.md'));

    // npm filter shape: `npm run <script> --workspace=<pkg>` — NOT
    // `npm --filter <pkg>`.
    expect(content).toContain('npm run dev --workspace=@npm-monorepo-readme/web');
    expect(content).not.toContain('npm --filter');

    // pnpm-workspace.yaml is only emitted for pnpm projects, so the
    // README's project-structure block must not list it for npm.
    expect(content).not.toContain('pnpm-workspace.yaml');
  });
});
