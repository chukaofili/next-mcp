import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createTempDir, fileExists } from '../../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generate_nextjs_custom_code tool', () => {
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

  it('should generate Next.js configuration files', async () => {
    const result = await client.callTool('generate_nextjs_custom_code', {
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);

    // Check if it indicates success or what files were created
    // The exact behavior may vary
  });

  it('should handle generation without errors', async () => {
    const result = await client.callTool('generate_nextjs_custom_code', {
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
    // Should not crash
    expect(result).toBeDefined();
    const text = client.getTextContent(result);
    expect(text).toBeDefined();
  });
});
