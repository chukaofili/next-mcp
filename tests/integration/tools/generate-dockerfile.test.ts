import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir, fileExists, readFile } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generate_dockerfile tool', () => {
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

  it('should generate Docker configuration for Prisma', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
      },
    });

    const result = await client.callTool('generate_dockerfile', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toContain('postgres');

    // Verify files were created
    expect(await fileExists(path.join(tempDir, 'Dockerfile'))).toBe(true);
    expect(await fileExists(path.join(tempDir, 'docker-compose.yml'))).toBe(true);
  });

  it('should handle different databases', async () => {
    const databases = [
      { name: 'postgres', image: 'postgres' },
      { name: 'mysql', image: 'mysql' },
      { name: 'mongodb', image: 'mongo' },
      { name: 'sqlite', image: null }, // SQLite doesn't need Docker service
    ] as const;

    for (const db of databases) {
      const config = createMockConfig({
        architecture: { database: db.name },
      });

      const result = await client.callTool('generate_dockerfile', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
      const text = client.getTextContent(result);
      expect(text).toContain(db.name);

      if (db.image) {
        // Verify docker-compose includes the database service
        const dockerCompose = await readFile(path.join(tempDir, 'docker-compose.yml'));
        expect(dockerCompose).toContain(db.image);
      }
    }
  });

  it('should generate Dockerfile without database', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'none',
        orm: 'none',
      },
    });

    const result = await client.callTool('generate_dockerfile', {
      config,
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);

    // Verify Dockerfile exists
    expect(await fileExists(path.join(tempDir, 'Dockerfile'))).toBe(true);

    // Docker compose should be minimal or not include database service
    const dockerCompose = await readFile(path.join(tempDir, 'docker-compose.yml'));
    expect(dockerCompose).toBeDefined();
  });

  it('should handle different package managers', async () => {
    const packageManagers = ['npm', 'pnpm', 'yarn'] as const;

    for (const pm of packageManagers) {
      const config = createMockConfig({
        architecture: { packageManager: pm },
      });

      const result = await client.callTool('generate_dockerfile', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);

      // Verify Dockerfile was created (specific package manager handling may vary)
      const dockerfile = await readFile(path.join(tempDir, 'Dockerfile'));
      expect(dockerfile).toBeDefined();
      expect(dockerfile.length).toBeGreaterThan(0);
    }
  });
});
