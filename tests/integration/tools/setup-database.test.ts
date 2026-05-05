import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import {
  cleanupTempDir,
  createMockConfig,
  createTempDir,
  dirExists,
  fileExists,
} from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('setup_database tool', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should handle no database configuration', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'none',
        orm: 'none',
      },
    });

    const result = await client.callTool('setup_database', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toMatch(/No database|Skipping database/i);
  });

  it('should attempt Prisma setup', async () => {
    const projectName = `prisma-setup-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'postgres',
        orm: 'prisma',
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('setup_database', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Database setup completed successfully');
    expect(text).toContain('ORM: prisma');
  });

  it('should attempt Drizzle setup', async () => {
    const projectName = `drizzle-setup-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'mysql',
        orm: 'drizzle',
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('setup_database', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Database setup completed successfully');
    expect(text).toContain('ORM: drizzle');
  });

  it('should attempt Mongoose setup', async () => {
    const projectName = `mongoose-setup-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'mongodb',
        orm: 'mongoose',
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('setup_database', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Database setup completed successfully');
    expect(text).toContain('ORM: mongoose');
  });

  it('should handle SQLite', async () => {
    const projectName = `sqlite-setup-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        database: 'sqlite',
        orm: 'prisma',
      },
    });

    await client.callTool('scaffold_project', { config, targetPath: tempDir });

    const result = await client.callTool('setup_database', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Database setup completed successfully');
    expect(text).toContain('ORM: prisma');
  });
});

describe('setup_database tool — monorepo:minimal', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('routes prisma sources into apps/web in minimal mode', async () => {
    const projectName = 'minimal-db-prisma';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    // Schema and source files land in apps/web (minimal mode), NOT projectPath.
    expect(await fileExists(path.join(appPath, 'prisma', 'schema.prisma'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'client.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'index.ts'))).toBe(true);

    // Confirm we did NOT pollute projectPath with a top-level prisma/ folder.
    expect(await dirExists(path.join(projectPath, 'prisma'))).toBe(false);
  }, 120000);
});

describe('setup_database tool — monorepo:full', () => {
  let client: MCPTestClient;
  let tempDir: string;
  const serverPath = path.join(__dirname, '../../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('routes prisma sources into packages/db in full mode and wires apps/web dep', async () => {
    const projectName = 'full-db-prisma-route';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const dbPkgDir = path.join(projectPath, 'packages', 'db');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    // Schema lands in packages/db
    expect(await fileExists(path.join(dbPkgDir, 'prisma', 'schema.prisma'))).toBe(true);
    // Source files land in packages/db/src
    expect(await fileExists(path.join(dbPkgDir, 'src', 'client.ts'))).toBe(true);
    expect(await fileExists(path.join(dbPkgDir, 'src', 'index.ts'))).toBe(true);
    // Did NOT write client into apps/web/src/lib/db
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'client.ts'))).toBe(false);

    // apps/web/package.json contains the workspace dep
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.dependencies?.[`@${projectName}/db`]).toBe('workspace:*');
  }, 120000);

  it('routes drizzle schema/config/migrations into packages/db in full mode', async () => {
    const projectName = 'full-db-drizzle-route';
    const projectPath = path.join(tempDir, projectName);
    const dbPkgDir = path.join(projectPath, 'packages', 'db');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'mysql',
        orm: 'drizzle',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    expect(await fileExists(path.join(dbPkgDir, 'drizzle.config.ts'))).toBe(true);
    expect(await fileExists(path.join(dbPkgDir, 'src', 'schema.ts'))).toBe(true);
    expect(await fileExists(path.join(dbPkgDir, 'src', 'client.ts'))).toBe(true);
    expect(await fileExists(path.join(dbPkgDir, 'src', 'index.ts'))).toBe(true);
    expect(await dirExists(path.join(dbPkgDir, 'drizzle', 'migrations'))).toBe(true);
  }, 120000);

  it('routes mongoose connection/models into packages/db in full mode', async () => {
    const projectName = 'full-db-mongoose-route';
    const projectPath = path.join(tempDir, projectName);
    const dbPkgDir = path.join(projectPath, 'packages', 'db');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'mongodb',
        orm: 'mongoose',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    expect(await fileExists(path.join(dbPkgDir, 'src', 'connection.ts'))).toBe(true);
    expect(await fileExists(path.join(dbPkgDir, 'src', 'index.ts'))).toBe(true);
    expect(await dirExists(path.join(dbPkgDir, 'src', 'models'))).toBe(true);
  }, 120000);

  it('falls back to apps/web for direct driver (orm:none) since packages/db is not emitted', async () => {
    const projectName = 'full-db-direct-route';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const dbPkgDir = path.join(projectPath, 'packages', 'db');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'none',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    // Direct driver lives in apps/web/src/lib/db/index.ts
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'index.ts'))).toBe(true);
    // packages/db should NOT have been created (Group D gates on orm !== 'none')
    expect(await dirExists(dbPkgDir)).toBe(false);
  }, 120000);

  it('rewrites pre-existing apps/web @/lib/db imports to @<projectName>/db', async () => {
    const projectName = 'full-db-import-rewrite';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    // Pre-create a file in apps/web/src that imports from @/lib/db
    const targetFile = path.join(appPath, 'src', 'example-db-consumer.ts');
    await fs.writeFile(
      targetFile,
      [
        "import { db } from '@/lib/db';",
        "import type { User } from '@/lib/db/types';",
        '',
        'export const ref = db;',
        'export type Ref = User;',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    const rewritten = await fs.readFile(targetFile, 'utf-8');
    expect(rewritten).toContain(`from '@${projectName}/db'`);
    expect(rewritten).toContain(`from '@${projectName}/db/types'`);
    expect(rewritten).not.toContain("from '@/lib/db'");
  }, 120000);

  it('import-rewrite is a no-op when apps/web has no @/lib/db imports', async () => {
    const projectName = 'full-db-noop-rewrite';
    const projectPath = path.join(tempDir, projectName);
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'full',
        database: 'postgres',
        orm: 'prisma',
        auth: 'none',
        uiLibrary: 'none',
        testing: 'none',
        skipInstall: true,
      },
    });

    const scaffold = await client.callTool('scaffold_project', { config, targetPath: tempDir });
    expect(client.isSuccess(scaffold)).toBe(true);

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);
  }, 120000);
});
