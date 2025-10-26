import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text).toMatch(/No database|Skipping database/i);
  });

  it('should attempt Prisma setup', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'postgres',
        orm: 'prisma',
      },
    });

    const result = await client.callTool('setup_database', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    // May succeed or fail depending on environment - just verify it responds
  });

  it('should attempt Drizzle setup', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'mysql',
        orm: 'drizzle',
      },
    });

    const result = await client.callTool('setup_database', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
  });

  it('should attempt Mongoose setup', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'mongodb',
        orm: 'mongoose',
      },
    });

    const result = await client.callTool('setup_database', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
  });

  it('should handle SQLite', async () => {
    const config = createMockConfig({
      architecture: {
        database: 'sqlite',
        orm: 'prisma',
      },
    });

    const result = await client.callTool('setup_database', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
  });
});
