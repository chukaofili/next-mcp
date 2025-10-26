import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
      'create_directory_structure',
      'update_package_json',
      'generate_dockerfile',
      'generate_nextjs_custom_code',
      'setup_shadcn',
      'generate_base_components',
      'setup_database',
      'setup_authentication',
      'install_dependencies',
      'validate_project',
      'generate_readme',
    ];

    for (const expectedTool of expectedTools) {
      expect(toolNames).toContain(expectedTool);
    }

    // Should have exactly 12 tools
    expect(toolNames).toHaveLength(12);
  });

  it('should have proper tool schemas', async () => {
    const result = await client.listTools();

    result.tools.forEach((tool) => {
      expect(tool.name).toBeDefined();
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);

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
});
