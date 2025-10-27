import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir } from '../../helpers/test-utils.js';

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
    await client.callTool('create_directory_structure', { config, projectPath });

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
    await client.callTool('create_directory_structure', { config, projectPath });

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
    await client.callTool('create_directory_structure', { config, projectPath });

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
    await client.callTool('create_directory_structure', { config, projectPath });

    const result = await client.callTool('setup_database', { config, projectPath });

    expect(client.isSuccess(result)).toBe(true);

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toContain('Database setup completed successfully');
    expect(text).toContain('ORM: prisma');
  });
});
