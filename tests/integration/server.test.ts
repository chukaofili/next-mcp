import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../helpers/mcp-test-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MCP Server Initialization', () => {
  let client: MCPTestClient;
  const serverPath = path.join(__dirname, '../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
  });

  it('should connect to MCP server successfully', () => {
    // If we got here, connection was successful
    expect(client).toBeDefined();
  });

  it('should list all available tools', async () => {
    const result = await client.listTools();

    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);

    // Verify we have all expected tools
    const toolNames = result.tools.map((t) => t.name);
    const expectedTools = [
      'scaffold_project',
      'generate_dockerfile',
      'setup_shadcn',
      'generate_base_components',
      'setup_database',
      'setup_authentication',
      'validate_project',
      'generate_readme',
    ];

    for (const expectedTool of expectedTools) {
      expect(toolNames).toContain(expectedTool);
    }

    // Should have exactly 8 tools
    expect(toolNames).toHaveLength(8);
  });

  it('should have proper tool schemas', async () => {
    const result = await client.listTools();

    result.tools.forEach((tool) => {
      expect(tool.name).toBeDefined();
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool.description).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(0);

      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    });
  });

  it('should handle unknown tools gracefully', async () => {
    try {
      await client.callTool('nonexistent_tool_xyz', {});
      expect.fail('Should have thrown an error for unknown tool');
    } catch (error) {
      expect(error).toBeDefined();
      // Error should indicate tool not found
    }
  });

  it('should provide tool descriptions', async () => {
    const result = await client.listTools();

    const readmeTool = result.tools.find((t) => t.name === 'generate_readme');
    expect(readmeTool).toBeDefined();
    expect(readmeTool!.description).toContain('README');

    const dockerTool = result.tools.find((t) => t.name === 'generate_dockerfile');
    expect(dockerTool).toBeDefined();
    expect(dockerTool!.description).toContain('Docker');

    const scaffoldTool = result.tools.find((t) => t.name === 'scaffold_project');
    expect(scaffoldTool).toBeDefined();
    expect(scaffoldTool!.description).toBeDefined();
  });

  it('surfaces validation failures with isError:true so test/smoke clients detect them', async () => {
    // Codex flagged that any tool failure that fell through to
    // withValidation's catch returned a normal text result, so
    // MCPTestClient.isFailure() and the smoke driver would silently
    // treat a no-op as success. The fix added `isError: true` to that
    // arm; the SDK already set `isError: true` for input-shape rejections
    // like `MCP error -32602`. This test pins the cross-path contract:
    // EVERY tool-call failure must surface `isError: true` on the
    // response so the helper / smoke driver classify it as a failure.
    const result = (await client.callTool('scaffold_project', {
      // `auth: 'better-auth'` + `database: 'none'` is rejected by the
      // ProjectConfigSchema refine; the MCP SDK rejects input-shape
      // mismatches with `isError: true` before withValidation runs.
      config: {
        name: 'invalid-config',
        architecture: {
          database: 'none',
          orm: 'none',
          auth: 'better-auth',
        },
      },
      targetPath: '/tmp',
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(client.isFailure(result)).toBe(true);
    expect(client.isSuccess(result)).toBe(false);
  });
});
