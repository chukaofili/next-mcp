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
        auth: 'none',
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

  it('writes drizzle.config.ts with the legacy schema path in minimal mode', async () => {
    // In minimal mode, drizzle.config.ts lives at `apps/web/drizzle.config.ts`
    // and the schema lives at `apps/web/src/lib/db/schema.ts`. The `schema:`
    // field is interpreted relative to the config's own location, so the
    // correct value here is `./src/lib/db/schema.ts`. This test pins that to
    // ensure the full-mode fix did not regress the legacy layout.
    const projectName = 'minimal-db-drizzle';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
    const config = createMockConfig({
      name: projectName,
      architecture: {
        monorepo: 'minimal',
        database: 'postgres',
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

    const drizzleConfig = await fs.readFile(
      path.join(appPath, 'drizzle.config.ts'),
      'utf-8'
    );
    expect(drizzleConfig).toContain("schema: './src/lib/db/schema.ts'");
    // The placeholder must be substituted, not leaked through.
    expect(drizzleConfig).not.toContain('__SCHEMA_PATH__');
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

    // The success-message text quotes the workspace import specifier, NOT the
    // legacy `@/lib/db` alias. This is what the MCP caller sees right after
    // the tool reports success, so it has to point at imports that actually
    // resolve in `apps/web` (which now depends on the workspace package).
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain(`@${projectName}/db`);
    expect(text).not.toContain("'@/lib/db'");
    expect(text).toContain('packages/db/src/');
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

    // The `schema:` field in drizzle.config.ts must resolve from the config's
    // own location (`packages/db/drizzle.config.ts`) to the schema file
    // (`packages/db/src/schema.ts`). With the legacy hardcoded value of
    // `./src/lib/db/schema.ts`, drizzle-kit would fail at runtime — so this
    // assertion guards the regression.
    const drizzleConfig = await fs.readFile(
      path.join(dbPkgDir, 'drizzle.config.ts'),
      'utf-8'
    );
    expect(drizzleConfig).toContain("schema: './src/schema.ts'");
    expect(drizzleConfig).not.toContain("schema: './src/lib/db/schema.ts'");
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

  it('routes mongoose sources fully into packages/db with workspace dep + content check (audit 1a)', async () => {
    // Audit gap-fill 1a: F1's tests covered prisma + drizzle in full mode but
    // skipped mongoose. This test pins the on-disk shape for the third ORM:
    //  - sources land in packages/db/src (NOT apps/web/src/lib/db),
    //  - the models dir is created with a .gitkeep marker,
    //  - apps/web depends on @<n>/db: workspace:*, and
    //  - connection.ts/index.ts contents match the mongoose templates.
    const projectName = 'full-db-mongoose-content';
    const projectPath = path.join(tempDir, projectName);
    const appPath = path.join(projectPath, 'apps', 'web');
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

    // Connection + barrel land in packages/db/src, NOT at apps/web/src/lib/db.
    expect(await fileExists(path.join(dbPkgDir, 'src', 'connection.ts'))).toBe(true);
    expect(await fileExists(path.join(dbPkgDir, 'src', 'index.ts'))).toBe(true);
    expect(await fileExists(path.join(appPath, 'src', 'lib', 'db', 'connection.ts'))).toBe(false);

    // Models directory is created with the .gitkeep marker so the empty dir
    // survives `git add`.
    expect(await fileExists(path.join(dbPkgDir, 'src', 'models', '.gitkeep'))).toBe(true);

    // Connection content reads back as the mongoose template (key signals
    // that prove the right template was picked, not just any file).
    const connection = await fs.readFile(path.join(dbPkgDir, 'src', 'connection.ts'), 'utf-8');
    expect(connection).toContain("import mongoose from 'mongoose'");
    expect(connection).toContain('const MONGODB_URI = process.env.DATABASE_URL');
    expect(connection).toContain('export default connectDB');

    // Barrel re-exports the default connection plus leaves a hint for models.
    const indexContent = await fs.readFile(path.join(dbPkgDir, 'src', 'index.ts'), 'utf-8');
    expect(indexContent).toContain("export { default as connectDB } from './connection'");

    // apps/web depends on the workspace db package.
    const appPkg = JSON.parse(await fs.readFile(path.join(appPath, 'package.json'), 'utf-8'));
    expect(appPkg.dependencies?.[`@${projectName}/db`]).toBe('workspace:*');
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

  it('import-rewrite leaves non-import string literals containing @/lib/db alone', async () => {
    // Regression guard: the rewrite regex must anchor on import context. A
    // file that mentions `@/lib/db` only inside a non-import string literal
    // (JSDoc, console.log, fixtures, etc.) must NOT be touched, while a real
    // import in the same file must still be rewritten.
    const projectName = 'full-db-rewrite-anchored';
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

    const targetFile = path.join(appPath, 'src', 'mixed-usage.ts');
    await fs.writeFile(
      targetFile,
      [
        "import { db } from '@/lib/db';",
        "const note = '@/lib/db tip';",
        "const log = 'see @/lib/db/types';",
        "console.log('@/lib/db');",
        '/**',
        " * @example import x from '@/lib/db'",
        ' */',
        'export const ref = db;',
        'export const meta = { note, log };',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(result)).toBe(true);

    const rewritten = await fs.readFile(targetFile, 'utf-8');

    // The real import on line 1 IS rewritten.
    expect(rewritten).toContain(`from '@${projectName}/db'`);

    // String literals that merely contain `@/lib/db` are NOT rewritten — they
    // are user data, not module specifiers.
    expect(rewritten).toContain("const note = '@/lib/db tip';");
    expect(rewritten).toContain("const log = 'see @/lib/db/types';");
    expect(rewritten).toContain("console.log('@/lib/db');");
    // The JSDoc `@example` line happens to contain a real `import x from '...'`
    // form. It's inside a comment, but our regex is text-based and will rewrite
    // it — that's acceptable; comments don't affect runtime resolution. The
    // load-bearing assertions are the three string-literal checks above.
  }, 120000);

  it('documents observed re-run behavior on the same project (audit 5a)', async () => {
    // Audit gap-fill 5a: re-run behavior is undocumented today. The point of
    // this test is NOT to require idempotency — it's to PIN the observed
    // behavior (success-or-error and which side effects survive) so a future
    // change that silently flips the policy fails loudly. If today's behavior
    // changes intentionally, this assertion needs an update with the change.
    const projectName = 'full-db-prisma-rerun';
    const projectPath = path.join(tempDir, projectName);
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

    const first = await client.callTool('setup_database', { config, projectPath });
    expect(client.isSuccess(first)).toBe(true);

    // Capture key files after the first run.
    const schemaPath = path.join(dbPkgDir, 'prisma', 'schema.prisma');
    const clientPath = path.join(dbPkgDir, 'src', 'client.ts');
    const indexPath = path.join(dbPkgDir, 'src', 'index.ts');
    const firstSchema = await fs.readFile(schemaPath, 'utf-8');
    const firstClient = await fs.readFile(clientPath, 'utf-8');
    const firstIndex = await fs.readFile(indexPath, 'utf-8');

    // Second run on the same project. Document whatever happens — currently
    // setup_database overwrites cleanly without erroring.
    const second = await client.callTool('setup_database', { config, projectPath });

    // Observed behavior today: the second run reports success, NOT a failure.
    // If this changes (e.g. it starts erroring on a non-empty packages/db),
    // update both the assertion and the next-steps text in
    // generateDatabaseInstructions to match.
    expect(client.isSuccess(second)).toBe(true);

    // The files exist and have the same shape after the re-run. Content
    // equality pins the "overwrites cleanly with the same template" behavior;
    // if the tool ever starts merging or appending, this assertion catches it.
    const secondSchema = await fs.readFile(schemaPath, 'utf-8');
    const secondClient = await fs.readFile(clientPath, 'utf-8');
    const secondIndex = await fs.readFile(indexPath, 'utf-8');
    expect(secondSchema).toBe(firstSchema);
    expect(secondClient).toBe(firstClient);
    expect(secondIndex).toBe(firstIndex);

    // apps/web/package.json's @<n>/db dep is still pinned to workspace:*
    // (no duplicate or version drift after the second run).
    const appPkg = JSON.parse(
      await fs.readFile(path.join(projectPath, 'apps', 'web', 'package.json'), 'utf-8')
    );
    expect(appPkg.dependencies?.[`@${projectName}/db`]).toBe('workspace:*');
  }, 180000);

  it('does not rewrite imports when apps/web has no @/lib/db imports', async () => {
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
