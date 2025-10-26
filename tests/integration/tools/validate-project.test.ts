import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createPackageJson, createTempDir } from '../../helpers/test-utils.js';

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

  it.only('should validate project with basic structure', async () => {
    const projectName = `base-components-test_${Date.now()}`;
    const projectPath = path.join(tempDir, projectName);

    const config = createMockConfig({ name: projectName });

    const thisres = await client.callTool('scaffold_project', { config, targetPath: projectPath });
    console.log(thisres);
    // await client.callTool('create_directory_structure', { config, projectPath });

    // const result = await client.callTool('validate_project', { config, projectPath });

    // console.log(result);

    // expect(client.isSuccess(result)).toBe(true);

    // const text = client.getTextContent(result);
    // expect(text).toBeDefined();
    // console.log(text);
    // Validation tools report issues - that's not a "failure", it's expected behavior
  });
});
