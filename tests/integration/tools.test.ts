import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../helpers/mcp-test-client.js';
import { cleanupTempDir, createMockConfig, createTempDir } from '../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MCP Server Integration Tests', () => {
  let client: MCPTestClient;
  let tempDir: string;
  // Always test the built distribution files (dist/index.js)
  // This ensures we test exactly what will be deployed/published
  const serverPath = path.join(__dirname, '../../dist/index.js');

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000);

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  describe('Server Initialization', () => {
    it('should list all available tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      // Check for expected tools
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('scaffold_project');
      expect(toolNames).toContain('create_directory_structure');
      expect(toolNames).toContain('update_package_json');
      expect(toolNames).toContain('generate_dockerfile');
      expect(toolNames).toContain('generate_nextjs_custom_code');
      expect(toolNames).toContain('setup_shadcn');
      expect(toolNames).toContain('generate_base_components');
      expect(toolNames).toContain('setup_database');
      expect(toolNames).toContain('setup_authentication');
      expect(toolNames).toContain('install_dependencies');
      expect(toolNames).toContain('validate_project');
      expect(toolNames).toContain('generate_readme');
    });

    it('should have proper tool schemas', async () => {
      const result = await client.listTools();

      result.tools.forEach((tool) => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      });
    });
  });

  describe('generate_readme tool', () => {
    it('should generate README with minimal config', async () => {
      const config = createMockConfig({
        name: 'test-readme-app',
        architecture: {
          database: 'none',
          auth: 'none',
          testing: 'none',
        },
      });

      const result = await client.callTool('generate_readme', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);

      const text = client.getTextContent(result);
      expect(text).toContain('✅');
      expect(text).toContain('README.md');
    });

    it('should generate README with full config', async () => {
      const config = createMockConfig({
        name: 'full-stack-app',
        description: 'A comprehensive test application',
        architecture: {
          database: 'postgres',
          orm: 'prisma',
          auth: 'better-auth',
          uiLibrary: 'shadcn',
          testing: 'vitest',
        },
      });

      const result = await client.callTool('generate_readme', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
      const text = client.getTextContent(result);
      expect(text).toContain('✅');
      expect(text).toContain('README.md');
    });

    it('should handle different package managers', async () => {
      const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'];

      for (const pm of packageManagers) {
        const config = createMockConfig({
          architecture: { packageManager: pm },
        });

        const result = await client.callTool('generate_readme', {
          config,
          projectPath: tempDir,
        });

        expect(client.isSuccess(result)).toBe(true);
        const text = client.getTextContent(result);
        expect(text).toContain('✅');
        expect(text).toContain('README.md');
      }
    });
  });

  describe('create_directory_structure tool', () => {
    it('should create basic directory structure', async () => {
      const config = createMockConfig({
        architecture: {
          database: 'none',
          auth: 'none',
          stateManagement: 'none',
          testing: 'none',
        },
      });

      const result = await client.callTool('create_directory_structure', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
    });

    it('should create database directories when database is configured', async () => {
      const config = createMockConfig({
        architecture: {
          database: 'postgres',
          orm: 'prisma',
        },
      });

      const result = await client.callTool('create_directory_structure', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
    });

    it('should create auth directories when auth is configured', async () => {
      const config = createMockConfig({
        architecture: {
          auth: 'better-auth',
        },
      });

      const result = await client.callTool('create_directory_structure', {
        config,
        projectPath: tempDir,
      });

      expect(client.isSuccess(result)).toBe(true);
    });
  });

  describe('generate_dockerfile tool', () => {
    it('should generate Docker configuration', async () => {
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
    });

    it('should handle different databases', async () => {
      const databases = ['postgres', 'mysql', 'mongodb', 'sqlite'];

      for (const db of databases) {
        const config = createMockConfig({
          architecture: { database: db },
        });

        const result = await client.callTool('generate_dockerfile', {
          config,
          projectPath: tempDir,
        });

        expect(client.isSuccess(result)).toBe(true);
        const text = client.getTextContent(result);
        expect(text).toContain(db);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown tools gracefully', async () => {
      try {
        await client.callTool('nonexistent_tool', {});
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle missing required arguments', async () => {
      const result = await client.callTool('generate_readme', {});

      // Should return error message
      const text = client.getTextContent(result);
      expect(text).toBeDefined();
    });

    it('should handle invalid project path', async () => {
      const config = createMockConfig();

      const result = await client.callTool('generate_readme', {
        config,
        projectPath: '/nonexistent/path/that/does/not/exist',
      });

      // Should handle gracefully
      expect(result).toBeDefined();
    });
  });
});
