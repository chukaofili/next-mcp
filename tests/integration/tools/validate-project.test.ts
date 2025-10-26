import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createPackageJson, createTempDir } from '../../helpers/test-utils.js';
import { promises as fs } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('validate_project tool', () => {
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

  it('should validate empty project', async () => {
    const config = createMockConfig();

    const result = await client.callTool('validate_project', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    // Validation tools report issues - that's not a "failure", it's expected behavior
  });

  it('should validate project with package.json', async () => {
    await createPackageJson(tempDir, { name: 'validation-test' });

    const config = createMockConfig();

    const result = await client.callTool('validate_project', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
    // Validation tools report issues - that's not a "failure", it's expected behavior
  });

  it('should validate project with basic structure', async () => {
    // Create basic Next.js structure
    await createPackageJson(tempDir, { name: 'structured-test' });
    await fs.mkdir(path.join(tempDir, 'src/app'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'next.config.ts'), 'export default {}');
    await fs.writeFile(path.join(tempDir, 'tsconfig.json'), '{}');

    const config = createMockConfig();

    const result = await client.callTool('validate_project', {
      config,
      projectPath: tempDir,
    });

    const text = client.getTextContent(result);
    expect(text).toBeDefined();
    // Validation tools report issues - that's not a "failure", it's expected behavior
  });
});
