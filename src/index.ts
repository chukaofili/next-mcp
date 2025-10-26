#!/usr/bin/env node

/** TODO:
 * - Add dark mode toggle
 * - Add side bar or horizontal bar for navigation
 * - Add user profile management
 * - User button from better-auth-ui
 * - Add organisations support
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { adjectives, colors, Config, names, uniqueNamesGenerator } from 'unique-names-generator';
import winston from 'winston';

import details from '../package.json' with { type: 'json' };

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let logLevel = 'info';
let logTransportFilename = 'next-mcp.log';
if (process.env.NODE_ENV !== 'test') {
  logLevel = 'debug';
  logTransportFilename = 'next-mcp-test.log';
}

// Configure logger
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: logTransportFilename })],
});

const uniqueNamesGeneratorConfig: Config = {
  dictionaries: [adjectives, colors, names],
  length: 2,
  separator: '-',
  style: 'lowerCase',
};

// Prisma configuration constants
const PRISMA_OUTPUT_PATH = '../src/lib/db/generated/prisma';
const PRISMA_GENERATED_DIR = 'src/lib/db/generated';

// Package version constants - centralized version management
const CREATE_NEXT_APP_VERSION = 'create-next-app@^16';
const PACKAGE_VERSIONS = {
  // State Management
  zustand: '^5',
  '@reduxjs/toolkit': '^2',
  'react-redux': '^9',
  '@types/react-redux': '^7',

  // ORM & Database
  '@prisma/client': '^6',
  prisma: '^6',
  'drizzle-orm': '^0.44.6',
  'drizzle-kit': '^0.31.5',
  mongoose: '^8',

  // Database Drivers
  pg: '^8',
  mysql2: '^3',
  mongodb: '^6',
  'better-sqlite3': '^12',
  '@types/better-sqlite3': '^7',

  // UI Libraries
  '@tanstack/react-table': '^8',

  // Authentication
  'better-auth': '^1',
  '@daveyplate/better-auth-ui': '^3',

  // Testing - Vitest
  vitest: '^1',
  '@vitejs/plugin-react': '^4',
  '@testing-library/react': '^14',
  '@testing-library/jest-dom': '^6',
  jsdom: '^23.0.1',

  // Testing - Jest
  jest: '^29',
  'jest-environment-jsdom': '^29',

  // Testing - Playwright
  '@playwright/test': '^1',

  // Utilities
  dotenv: '^17',
  '@types/node': '^24',
} as const;

export interface ProjectConfig {
  name?: string;
  description?: string;
  architecture: {
    typescript: boolean;
    reactCompiler: boolean;
    skipInstall?: boolean;
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
    database: 'none' | 'postgres' | 'mysql' | 'mongodb' | 'sqlite';
    orm: 'none' | 'prisma' | 'drizzle' | 'mongoose';
    auth: 'none' | 'better-auth';
    uiLibrary: 'none' | 'shadcn';
    stateManagement: 'none' | 'zustand' | 'redux';
    testing: 'none' | 'jest' | 'vitest' | 'playwright';
  };
}

class NextMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: details.name,
        version: details.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'scaffold_project',
          description: 'Create a new Next.js project with specified configuration',
          inputSchema: {
            type: 'object',
            properties: {
              config: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  architecture: { type: 'object' },
                },
                required: ['architecture'],
              },
              targetPath: {
                type: 'string',
                description: 'Target directory path',
              },
            },
            required: ['config', 'targetPath'],
          },
        },
        {
          name: 'create_directory_structure',
          description: 'Create the base directory structure for the project',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'update_package_json',
          description: 'Update package.json with appropriate dependencies',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'generate_dockerfile',
          description: 'Generate Dockerfile and docker-compose.yml',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'generate_nextjs_custom_code',
          description: 'Generate Next.js configuration files, and add custom paths and code snippets',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'setup_shadcn',
          description: 'Initialize shadcn/ui with defaults and install all components',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'generate_base_components',
          description: 'Generate base React components and layouts',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'setup_database',
          description: 'Generate database configuration and migrations',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'setup_authentication',
          description: 'Configure authentication system',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'install_dependencies',
          description: 'Install npm/pnpm dependencies',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
        {
          name: 'validate_project',
          description: 'Run validation checks on the generated project',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'generate_readme',
          description: 'Generate comprehensive README.md',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'object' },
              projectPath: { type: 'string' },
            },
            required: ['config', 'projectPath'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        return {
          content: [
            {
              type: 'text',
              text: `No arguments provided for tool: ${name}`,
            },
          ],
        };
      }

      try {
        switch (name) {
          case 'scaffold_project':
            return await this.scaffoldProject(args.config as ProjectConfig, args.targetPath as string);
          case 'create_directory_structure':
            return await this.createDirectoryStructure(args.config as ProjectConfig, args.projectPath as string);
          case 'update_package_json':
            return await this.updatePackageJson(args.config as ProjectConfig, args.projectPath as string);
          case 'generate_dockerfile':
            return await this.generateDockerfile(args.config as ProjectConfig, args.projectPath as string);
          case 'generate_nextjs_custom_code':
            return await this.generateNextJSCustomCode(args.projectPath as string);
          case 'generate_base_components':
            return await this.generateBaseComponents(args.config as ProjectConfig, args.projectPath as string);
          case 'setup_shadcn':
            return await this.setupShadcn(args.config as ProjectConfig, args.projectPath as string);
          case 'setup_database':
            return await this.setupDatabase(args.config as ProjectConfig, args.projectPath as string);
          case 'setup_authentication':
            return await this.setupAuthentication(args.config as ProjectConfig, args.projectPath as string);
          case 'install_dependencies':
            return await this.installDependencies(args.config as ProjectConfig, args.projectPath as string);
          case 'validate_project':
            return await this.validateProject(args.config as ProjectConfig, args.projectPath as string);
          case 'generate_readme':
            return await this.generateReadme(args.config as ProjectConfig, args.projectPath as string);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private applyConfigDefaults(config: ProjectConfig) {
    return {
      name: config.name ?? `${uniqueNamesGenerator(uniqueNamesGeneratorConfig)}-app`,
      description: config.description ?? 'A Next.js application scaffolded with and AI Agent MCP',
      architecture: {
        typescript: config.architecture.typescript ?? true,
        reactCompiler: config.architecture.reactCompiler ?? false,
        packageManager: config.architecture.packageManager ?? 'pnpm',
        database: config.architecture.database ?? 'postgres',
        orm: config.architecture.orm ?? 'prisma',
        auth: config.architecture.auth ?? 'better-auth',
        uiLibrary: config.architecture.uiLibrary ?? 'shadcn',
        stateManagement: config.architecture.stateManagement ?? 'none',
        testing: config.architecture.testing ?? 'none',
        skipInstall: config.architecture.skipInstall ?? false,
      },
    };
  }

  private getPackageRunner(packageManager: string): string {
    switch (packageManager) {
      case 'pnpm':
        return 'pnpm exec';
      case 'yarn':
        return 'yarn';
      case 'bun':
        return 'bunx';
      case 'npm':
      default:
        return 'npx';
    }
  }

  private getPackageRunnerDlx(packageManager: string): string {
    switch (packageManager) {
      case 'pnpm':
        return 'pnpm dlx';
      case 'yarn':
        return 'yarn dlx';
      case 'bun':
        return 'bunx';
      case 'npm':
      default:
        return 'npx';
    }
  }

  /**
   * Execute a shell command with comprehensive error logging
   * @param command The command to execute
   * @param projectPath The working directory for the command
   * @param commandLabel A human-readable label for logging (e.g., "prisma init", "auth schema generation")
   * @returns Object with success flag and optional output
   */
  private execCommand(
    command: string,
    projectPath: string,
    commandLabel: string
  ): { success: boolean; output?: string } {
    logger.info(`Running ${commandLabel}: ${command}`);

    try {
      const output = execSync(command, {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const outputStr = output.toString();
      logger.info(`${commandLabel} output: ${outputStr}`);
      return { success: true, output: outputStr };
    } catch (error) {
      const execError = error as { status?: number; stderr?: Buffer; stdout?: Buffer; message: string };
      logger.error(`[${commandLabel} failed]:`, {
        command,
        status: execError.status,
        stderr: execError.stderr?.toString(),
        stdout: execError.stdout?.toString(),
        message: execError.message,
      });
      logger.warn(`${commandLabel} failed - user will need to run manually`);
      return { success: false };
    }
  }

  private getDatabaseUrl(config: ProjectConfig): string {
    const { database } = config.architecture;
    const projectName = config.name;

    switch (database) {
      case 'postgres':
        return `postgresql://postgres:postgres@localhost:5432/${projectName}?schema=public`;
      case 'mysql':
        return `mysql://root:password@localhost:3306/${projectName}`;
      case 'sqlite':
        return 'file:./dev.db';
      case 'mongodb':
        return `mongodb://localhost:27017/${projectName}`;
      default:
        return '';
    }
  }

  private getPrismaProvider(database: string): string {
    const providerMap: Record<string, string> = {
      postgres: 'postgresql',
      mysql: 'mysql',
      sqlite: 'sqlite',
      mongodb: 'mongodb',
    };
    return providerMap[database] || 'postgresql';
  }

  private getDrizzleProvider(database: string): string {
    switch (database) {
      case 'postgres':
        return 'pg';
      case 'mysql':
        return 'mysql';
      case 'sqlite':
        return 'sqlite';
      default:
        return 'pg';
    }
  }

  private async scaffoldProject(config: ProjectConfig, targetPath: string) {
    // Apply defaults to the configuration
    try {
      const fullConfig = this.applyConfigDefaults(config);
      const projectPath = path.join(targetPath, fullConfig.name);
      logger.debug(fullConfig);
      logger.debug(projectPath);

      // Build create-next-app command based on configuration
      const createCommand = this.buildCreateNextAppCommand(fullConfig);
      logger.info(`Executing: ${createCommand}`);

      // Run create-next-app
      const result = this.execCommand(createCommand, targetPath, 'create-next-app');

      if (!result.success) {
        throw new Error('[create-next-app failed]: Check logs for details');
      }

      const stdout = result.output || '';
      logger.info(`create-next-app completed successfully: ${stdout}`);

      // Verify the project was created
      await fs.access(projectPath);

      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully created Next.js project at ${projectPath}\n\n[Configuration]:\n${JSON.stringify(fullConfig, null, 2)}\n\n[Command executed]: ${createCommand}\n\n[Output]:\n${stdout}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to create Next.js project: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private buildCreateNextAppCommand(config: ProjectConfig): string {
    const packageRunner = this.getPackageRunnerDlx(config.architecture.packageManager);
    const flags = [`${packageRunner} ${CREATE_NEXT_APP_VERSION}`, `./${config.name}`];
    logger.info(`Building create-next-app command for config: ${JSON.stringify(config)}`);

    if (config.architecture.typescript) {
      flags.push('--ts');
    } else {
      flags.push('--js');
    }

    if (config.architecture.reactCompiler) {
      flags.push('--react-compiler');
    }

    if (config.architecture.packageManager === 'pnpm') {
      flags.push('--use-pnpm');
    } else if (config.architecture.packageManager === 'yarn') {
      flags.push('--use-yarn');
    } else if (config.architecture.packageManager === 'bun') {
      flags.push('--use-bun');
    } else {
      flags.push('--use-npm');
    }

    // Skip dependency installation if specified [Used for tests]
    if (config.architecture.skipInstall) {
      flags.push('--skip-install');
    }

    // Use src directory for better organization
    flags.push('--src-dir');

    // Auto accept all prompts with defaults which are not configured
    flags.push('--yes');

    return flags.join(' ');
  }

  private async createDirectoryStructure(config: ProjectConfig, projectPath: string) {
    // Additional directories that create-next-app doesn't create
    const additionalDirectories = ['src/components/ui', 'src/components/forms', 'src/lib', 'src/hooks'];

    // Add stores directory if using external state management
    if (config.architecture.stateManagement !== 'none') {
      additionalDirectories.push('src/stores');
    }

    // Add database-related directories
    if (config.architecture.database !== 'none') {
      additionalDirectories.push('src/lib/db');
    }

    // Add auth-related directories
    if (config.architecture.auth !== 'none') {
      additionalDirectories.push('src/components/auth');
    }

    // Add testing-related directories
    if (config.architecture.testing !== 'none') {
      additionalDirectories.push('src/tests');
    }

    // Create the additional directories
    for (const dir of additionalDirectories) {
      try {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      } catch (error) {
        // Directory might already exist, continue
        logger.error(`Note: Directory ${dir} might already exist`, error);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Created ${additionalDirectories.length} additional directories and initialized git repository`,
        },
      ],
    };
  }

  private async updatePackageJson(config: ProjectConfig, projectPath: string) {
    try {
      // Read the existing package.json created by create-next-app
      const packageJsonPath = path.join(projectPath, 'package.json');
      const existingPackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      // Add additional scripts
      const additionalScripts: Record<string, string> = {
        'type-check': 'tsc --noEmit',
        'docker:build': `docker build -t ${config.name} .`,
        'docker:run': `docker run -p 3000:3000 ${config.name}`,
        'docker:dev:up': 'docker-compose -f docker-compose.yml up',
        'docker:dev:down': 'docker-compose -f docker-compose.yml down',
        test: 'echo "No test command specified"',
        'test:watch': 'echo "No test watch command specified"',
        'test:ui': 'echo "No test UI command specified"',
        'test:e2e': 'echo "No e2e test command specified"',
        'test:e2e:ui': 'echo "No e2e test UI command specified"',
      };

      if (config.architecture.testing === 'vitest') {
        additionalScripts.test = 'vitest';
        additionalScripts['test:watch'] = 'vitest --watch';
        additionalScripts['test:ui'] = 'vitest --ui';
      } else if (config.architecture.testing === 'jest') {
        additionalScripts.test = 'jest';
        additionalScripts['test:watch'] = 'jest --watch';
      } else if (config.architecture.testing === 'playwright') {
        additionalScripts['test:e2e'] = 'playwright test';
        additionalScripts['test:e2e:ui'] = 'playwright test --ui';
      }

      // Add prebuild script for Prisma generate
      if (config.architecture.orm === 'prisma') {
        additionalScripts.prebuild = 'prisma generate';
      }

      existingPackageJson.scripts = {
        ...existingPackageJson.scripts,
        ...additionalScripts,
      };

      // Add additional dependencies based on architecture choices
      const additionalDeps: Record<string, string> = {};
      const additionalDevDeps: Record<string, string> = {};

      // State Management
      if (config.architecture.stateManagement === 'zustand') {
        additionalDeps.zustand = PACKAGE_VERSIONS.zustand;
      } else if (config.architecture.stateManagement === 'redux') {
        additionalDeps['@reduxjs/toolkit'] = PACKAGE_VERSIONS['@reduxjs/toolkit'];
        additionalDeps['react-redux'] = PACKAGE_VERSIONS['react-redux'];
        additionalDevDeps['@types/react-redux'] = PACKAGE_VERSIONS['@types/react-redux'];
      }

      // Database + ORM
      if (config.architecture.orm === 'prisma') {
        additionalDeps['@prisma/client'] = PACKAGE_VERSIONS['@prisma/client'];
        additionalDevDeps.prisma = PACKAGE_VERSIONS.prisma;
      } else if (config.architecture.orm === 'drizzle') {
        additionalDeps['drizzle-orm'] = PACKAGE_VERSIONS['drizzle-orm'];
        additionalDevDeps['drizzle-kit'] = PACKAGE_VERSIONS['drizzle-kit'];

        if (config.architecture.database === 'postgres') {
          additionalDeps.pg = PACKAGE_VERSIONS.pg;
          additionalDeps.dotenv = PACKAGE_VERSIONS.dotenv;
        }

        if (config.architecture.database === 'mysql') {
          additionalDeps.mysql2 = PACKAGE_VERSIONS.mysql2;
        }

        if (config.architecture.database === 'sqlite') {
          additionalDeps['better-sqlite3'] = PACKAGE_VERSIONS['better-sqlite3'];
          additionalDevDeps['@types/better-sqlite3'] = PACKAGE_VERSIONS['@types/better-sqlite3'];
        }
      } else if (config.architecture.orm === 'mongoose') {
        additionalDeps.mongoose = PACKAGE_VERSIONS.mongoose;
      }

      if (config.architecture.orm === 'none') {
        if (config.architecture.database === 'postgres') {
          additionalDeps.pg = PACKAGE_VERSIONS.pg;
        } else if (config.architecture.database === 'mysql') {
          additionalDeps.mysql2 = PACKAGE_VERSIONS.mysql2;
        } else if (config.architecture.database === 'mongodb') {
          additionalDeps.mongodb = PACKAGE_VERSIONS.mongodb;
        } else if (config.architecture.database === 'sqlite') {
          additionalDeps['better-sqlite3'] = PACKAGE_VERSIONS['better-sqlite3'];
          additionalDevDeps['@types/better-sqlite3'] = PACKAGE_VERSIONS['@types/better-sqlite3'];
        }
      }

      if (config.architecture.uiLibrary === 'shadcn') {
        additionalDeps['@tanstack/react-table'] = PACKAGE_VERSIONS['@tanstack/react-table'];
      }

      // Authentication
      if (config.architecture.auth === 'better-auth') {
        additionalDeps['better-auth'] = PACKAGE_VERSIONS['better-auth'];
        additionalDeps['@daveyplate/better-auth-ui'] = PACKAGE_VERSIONS['@daveyplate/better-auth-ui'];
      }

      // Testing
      if (config.architecture.testing === 'vitest') {
        additionalDevDeps.vitest = PACKAGE_VERSIONS.vitest;
        additionalDevDeps['@vitejs/plugin-react'] = PACKAGE_VERSIONS['@vitejs/plugin-react'];
        additionalDevDeps['@testing-library/react'] = PACKAGE_VERSIONS['@testing-library/react'];
        additionalDevDeps['@testing-library/jest-dom'] = PACKAGE_VERSIONS['@testing-library/jest-dom'];
        additionalDevDeps.jsdom = PACKAGE_VERSIONS.jsdom;
      } else if (config.architecture.testing === 'jest') {
        additionalDevDeps.jest = PACKAGE_VERSIONS.jest;
        additionalDevDeps['jest-environment-jsdom'] = PACKAGE_VERSIONS['jest-environment-jsdom'];
        additionalDevDeps['@testing-library/react'] = PACKAGE_VERSIONS['@testing-library/react'];
        additionalDevDeps['@testing-library/jest-dom'] = PACKAGE_VERSIONS['@testing-library/jest-dom'];
      } else if (config.architecture.testing === 'playwright') {
        additionalDevDeps['@playwright/test'] = PACKAGE_VERSIONS['@playwright/test'];
      }

      // Merge dependencies
      existingPackageJson.dependencies = {
        ...existingPackageJson.dependencies,
        ...additionalDeps,
      };

      existingPackageJson.devDependencies = {
        ...existingPackageJson.devDependencies,
        ...additionalDevDeps,
      };

      // Update package.json description
      if (config.description) {
        existingPackageJson.description = config.description;
      }

      // Write the updated package.json
      await fs.writeFile(packageJsonPath, JSON.stringify(existingPackageJson, null, 2));

      const addedDepsCount = Object.keys(additionalDeps).length;
      const addedDevDepsCount = Object.keys(additionalDevDeps).length;
      const addedScriptsCount = Object.keys(additionalScripts).length;

      return {
        content: [
          {
            type: 'text',
            text: `✅ Updated package.json with:\n- ${addedDepsCount} additional dependencies\n- ${addedDevDepsCount} additional dev dependencies\n- ${addedScriptsCount} additional scripts`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to update package.json: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async generateDockerfile(config: ProjectConfig, projectPath: string) {
    try {
      // Read Dockerfile template
      const dockerfileTemplate = await fs.readFile(path.join(__dirname, 'templates', 'docker', 'Dockerfile'), 'utf-8');
      const dockerignoreTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'docker', '.dockerignore'),
        'utf-8'
      );

      // Read docker-compose template
      const dockerComposeTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'docker', 'docker-compose.yml'),
        'utf-8'
      );

      // Generate database-specific sections
      let databaseDependsOn = '';
      let databaseService = '';
      let volumesSection = '';
      let databaseEnv = '';
      let prismaCommand = '';
      let prismaVolumes = '';

      // Add Prisma migration command if using Prisma
      if (config.architecture.orm === 'prisma') {
        prismaCommand = `    command: sh -c "npx prisma migrate deploy && node server.js"`;
        prismaVolumes = `    volumes:
      - ./prisma:/app/prisma
      - ./node_modules/.prisma:/app/node_modules/.prisma`;
      }

      if (config.architecture.database !== 'none') {
        switch (config.architecture.database) {
          case 'postgres':
            databaseDependsOn = `    depends_on:
      db:
        condition: service_healthy`;
            databaseEnv = `- DATABASE_URL=postgresql://postgres:postgres@db:5432/${config.name}`;
            databaseService = `  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${config.name}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "6432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ${config.name}"]
      interval: 5s
      timeout: 5s
      retries: 5`;
            volumesSection = `volumes:
  postgres_data:`;
            break;

          case 'mysql':
            databaseDependsOn = `    depends_on:
      db:
        condition: service_healthy`;
            databaseEnv = `- DATABASE_URL=mysql://mysql:mysql@db:3306/${config.name}`;
            databaseService = `  db:
    image: mysql:9
    environment:
      MYSQL_ROOT_PASSWORD: mysql
      MYSQL_DATABASE: ${config.name}
      MYSQL_USER: mysql
      MYSQL_PASSWORD: mysql
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-pmysql"]
      interval: 5s
      timeout: 5s
      retries: 5`;
            volumesSection = `volumes:
  mysql_data:`;
            break;

          case 'mongodb':
            databaseDependsOn = `    depends_on:
      db:
        condition: service_healthy`;
            databaseEnv = `- DATABASE_URL=mongodb://db:27017/${config.name}`;
            databaseService = `  db:
    image: mongo:8-noble
    environment:
      MONGO_INITDB_DATABASE: ${config.name}
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 5`;
            volumesSection = `volumes:
  mongodb_data:`;
            break;

          case 'sqlite':
            // SQLite doesn't need a separate database service
            // But we need to ensure the database file persists
            databaseDependsOn = `    volumes:
      - sqlite_data:/app/data`;
            databaseEnv = `- DATABASE_URL=file:/app/data/${config.name}.db`;
            volumesSection = `volumes:
  sqlite_data:`;
            break;
        }
      }

      // Replace template placeholders
      const dockerCompose = dockerComposeTemplate
        .replace('__DATABASE_DEPENDS_ON__', databaseDependsOn)
        .replace('__DATABASE_SERVICE__', databaseService)
        .replace('__VOLUMES_SECTION__', volumesSection)
        .replace('__DATABASE_ENV__', databaseEnv)
        .replace('__PRISMA_COMMAND__', prismaCommand)
        .replace('__PRISMA_VOLUMES__', prismaVolumes);

      await fs.writeFile(path.join(projectPath, 'Dockerfile'), dockerfileTemplate);

      // Add Prisma generated folder to .dockerignore if ORM is Prisma
      let finalDockerignore = dockerignoreTemplate;
      if (config.architecture.orm === 'prisma') {
        if (!finalDockerignore.includes(PRISMA_GENERATED_DIR)) {
          finalDockerignore += `\n# Prisma generated client\n${PRISMA_GENERATED_DIR}\n`;
          logger.info('Added Prisma generated folder to .dockerignore');
        }
      }
      await fs.writeFile(path.join(projectPath, '.dockerignore'), finalDockerignore);
      await fs.writeFile(path.join(projectPath, 'docker-compose.yml'), dockerCompose);

      return {
        content: [
          {
            type: 'text',
            text: `✅ Generated Docker configuration:\n- Dockerfile (from template)\n- docker-compose.yml with ${config.architecture.database} database setup`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to generate Docker configuration: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async generateNextJSCustomCode(projectPath: string) {
    try {
      const customDirs = ['src/app/privacy', 'src/app/terms'];

      for (const dir of customDirs) {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      }

      // Read template files
      // Define template-to-destination mappings
      const templateMappings = [
        { template: 'next.config.template', destination: 'next.config.ts' },
        { template: 'privacy-page.tsx.template', destination: path.join('src', 'app', 'privacy', 'page.tsx') },
        { template: 'terms-page.tsx.template', destination: path.join('src', 'app', 'terms', 'page.tsx') },
      ];

      // Read and write all template files in parallel
      await Promise.all(
        templateMappings.map(async ({ template, destination }) => {
          const content = await fs.readFile(path.join(__dirname, 'templates', template), 'utf-8');
          await fs.writeFile(path.join(projectPath, destination), content);
        })
      );

      const filesCreated = templateMappings.map(({ destination }) => destination);

      return {
        content: [
          {
            type: 'text',
            text: `✅ Generated Next.js configuration files (from templates):\n${filesCreated.map((f) => `- ${f}`).join('\n')}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Unexpected error during generateNextJSCustomCode:', errorMessage);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to generate Next.js configuration: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async setupShadcn(config: ProjectConfig, projectPath: string) {
    if (config.architecture.uiLibrary !== 'shadcn') {
      return {
        content: [
          {
            type: 'text',
            text: 'Shadcn/ui setup skipped - uiLibrary is not set to "shadcn"',
          },
        ],
      };
    }

    try {
      const packageManager = config.architecture.packageManager;
      const packageRunner = this.getPackageRunnerDlx(packageManager);
      const results: string[] = [];

      // Step 1: Initialize shadcn/ui with default configuration
      logger.info(`Initializing shadcn/ui with ${packageManager}...`);
      try {
        const shadcnInitCommand = `${packageRunner} shadcn@latest init -y -d`;
        const result = this.execCommand(shadcnInitCommand, projectPath, 'shadcn init');

        if (!result.success) {
          throw new Error('[shadcn init failed]: Check logs for details');
        }

        results.push(`✅ Initialized shadcn/ui with default configuration using ${packageManager}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to initialize shadcn/ui:', errorMessage);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to initialize shadcn/ui: ${errorMessage}`,
            },
          ],
        };
      }

      // Step 2: Install all shadcn/ui components using the --all flag
      logger.info(`Installing all shadcn/ui components with ${packageManager}...`);
      try {
        const shadcnAddAllCommand = `${packageRunner} shadcn@latest add --all -y -o`;
        const result = this.execCommand(shadcnAddAllCommand, projectPath, 'shadcn add all');

        if (!result.success) {
          throw new Error('[shadcn init failed]: Check logs for details');
        }

        results.push(`✅ Successfully installed all shadcn/ui components`);
        logger.info(`shadcn/ui add all components executed successfully`);

        const globalsCssPath = path.join(projectPath, 'src/app/globals.css');
        let globalsCss = await fs.readFile(globalsCssPath, 'utf-8');

        if (!globalsCss.includes('--chart-1: oklch(0.646 0.222 41.116)')) {
          globalsCss = `${globalsCss}\n@layer base {\n  :root {\n    --chart-1: oklch(0.646 0.222 41.116);\n    --chart-2: oklch(0.6 0.118 184.704);\n    --chart-3: oklch(0.398 0.07 227.392);\n    --chart-4: oklch(0.828 0.189 84.429);\n    --chart-5: oklch(0.769 0.188 70.08);\n  }\n\n  .dark {\n    --chart-1: oklch(0.488 0.243 264.376);\n    --chart-2: oklch(0.696 0.17 162.48);\n    --chart-3: oklch(0.769 0.188 70.08);\n    --chart-4: oklch(0.627 0.265 303.9);\n    --chart-5: oklch(0.645 0.246 16.439);\n  }\n}`;
        }

        if (!globalsCss.includes('--sidebar: oklch(0.985 0 0);')) {
          globalsCss = `${globalsCss}\n@layer base {\n  :root {\n    --sidebar: oklch(0.985 0 0);\n    --sidebar-foreground: oklch(0.145 0 0);\n    --sidebar-primary: oklch(0.205 0 0);\n    --sidebar-primary-foreground: oklch(0.985 0 0);\n    --sidebar-accent: oklch(0.97 0 0);\n    --sidebar-accent-foreground: oklch(0.205 0 0);\n    --sidebar-border: oklch(0.922 0 0);\n    --sidebar-ring: oklch(0.708 0 0);\n  }\n\n  .dark {\n    --sidebar: oklch(0.205 0 0);\n    --sidebar-foreground: oklch(0.985 0 0);\n    --sidebar-primary: oklch(0.488 0.243 264.376);\n    --sidebar-primary-foreground: oklch(0.985 0 0);\n    --sidebar-accent: oklch(0.269 0 0);\n    --sidebar-accent-foreground: oklch(0.985 0 0);\n    --sidebar-border: oklch(1 0 0 / 10%);\n    --sidebar-ring: oklch(0.439 0 0);\n  }\n}`;
        }

        await fs.writeFile(globalsCssPath, globalsCss);

        const layoutPath = path.join(projectPath, 'src/app/layout.tsx');
        let layoutContent = await fs.readFile(layoutPath, 'utf-8');
        if (!layoutContent.includes('Toaster')) {
          // Add import at the top
          const importStatement = `import { Toaster } from "@/components/ui/sonner";\n`;
          layoutContent = layoutContent.replace(/^(import.*\n)*/, (match) => match + importStatement);

          // Add Toaster component after children
          layoutContent = layoutContent.replace(/<body[^>]*>([\s\S]*?)<\/body>/, (match, content) =>
            match.replace(content, `${content}  <Toaster position="top-center" />\n      `)
          );

          await fs.writeFile(layoutPath, layoutContent);
        }
        logger.info('Updated globals.css and layout.tsx for shadcn/ui');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to install shadcn/ui components:', errorMessage);
        results.push(`⚠️  Failed to install all components: ${errorMessage}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: results.join('\n'),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Unexpected error during shadcn/ui setup:', errorMessage);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to set up shadcn/ui: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async generateBaseComponents(config: ProjectConfig, projectPath: string) {
    try {
      // Note: If uiLibrary is 'shadcn', call the 'setup_shadcn' tool separately
      // to initialize shadcn/ui and install all components

      const useShadcn = config.architecture.uiLibrary === 'shadcn';

      // Update the existing page.tsx with our custom content using Tailwind CSS
      const pageTsx = `${useShadcn ? "import { Button } from '@/components/ui/button';\n\n" : ''}export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Welcome to ${config.name}
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          ${config.description || 'Your Next.js application is ready! Built with modern tools and best practices.'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
          <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🚀 Next.js 15</h3>
            <p className="text-gray-600">
              Built with the latest Next.js features including App Router and Turbopack.
            </p>
          </div>

          <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🎨 Tailwind CSS</h3>
            <p className="text-gray-600">
              Utility-first CSS framework for rapid UI development.
            </p>
          </div>
          ${
            config.architecture.typescript
              ? `
          <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">📘 TypeScript</h3>
            <p className="text-gray-600">
              Type-safe development with excellent IDE support.
            </p>
          </div>`
              : ''
          }
          ${
            config.architecture.database !== 'none'
              ? `
          <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🗄️ ${config.architecture.database.charAt(0).toUpperCase() + config.architecture.database.slice(1)}</h3>
            <p className="text-gray-600">
              Database integration ready for your data needs.
            </p>
          </div>`
              : ''
          }
          ${
            config.architecture.auth !== 'none'
              ? `
          <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🔐 Authentication</h3>
            <p className="text-gray-600">
              Secure authentication with ${config.architecture.auth}.
            </p>
          </div>`
              : ''
          }

          <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🐳 Docker Ready</h3>
            <p className="text-gray-600">
              Containerized for easy deployment to any cloud platform.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          ${
            useShadcn
              ? `<Button asChild>
            <a href="/api/health">Test API Route</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="https://nextjs.org/docs" target="_blank" rel="noopener noreferrer">
              Read the Docs
            </a>
          </Button>`
              : `<a
            href="/api/health"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Test API Route
          </a>
          <a
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Read the Docs
          </a>`
          }
        </div>
      </div>
    </main>
  );
}
`;

      // Create a simple health check API route
      const healthApiRoute = `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    project: '${config.name}',
    features: {
      database: '${config.architecture.database}',
      auth: '${config.architecture.auth}',
      styling: 'tailwind',
      stateManagement: '${config.architecture.stateManagement}',
      testing: '${config.architecture.testing}',
    },
  });
}
`;

      // Create reusable Button component with Tailwind CSS
      const buttonComponent = `import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        className={clsx(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-blue-600 text-white hover:bg-blue-700': variant === 'primary',
            'bg-gray-100 text-gray-900 hover:bg-gray-200': variant === 'secondary',
            'border border-gray-300 bg-transparent hover:bg-gray-50': variant === 'outline',
          },
          {
            'h-8 px-3 text-sm': size === 'sm',
            'h-10 px-4': size === 'md',
            'h-12 px-6 text-lg': size === 'lg',
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { Button };
`;

      // Write the files
      await fs.mkdir(path.join(projectPath, 'src/app/api/health'), { recursive: true });
      await fs.writeFile(path.join(projectPath, 'src/app/page.tsx'), pageTsx);
      await fs.writeFile(path.join(projectPath, 'src/app/api/health/route.ts'), healthApiRoute);

      // Only create custom button component if not using shadcn
      if (!useShadcn) {
        await fs.writeFile(path.join(projectPath, 'src/components/ui/button.tsx'), buttonComponent);
      }

      const components = ['- Enhanced home page with feature showcase', '- Added health check API route'];

      if (useShadcn) {
        components.push('- Using shadcn/ui Button component (call setup_shadcn tool to install)');
      } else {
        components.push('- Created reusable Button component with Tailwind CSS');
      }

      if (config.architecture.auth !== 'none') {
        components.push('- Created authentication-related components (to be implemented based on chosen auth method)');
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Generated base components:\n${components.join('\n')}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to generate base components: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private generateDrizzleSchemaImports(database: string, template: string): string {
    const importMap: Record<string, { dialectCore: string; imports: string }> = {
      postgres: {
        dialectCore: 'pg-core',
        imports: 'pgTable, uuid, text, timestamp',
      },
      mysql: {
        dialectCore: 'mysql-core',
        imports: 'mysqlTable, varchar, text, timestamp',
      },
      sqlite: {
        dialectCore: 'sqlite-core',
        imports: 'sqliteTable, text, integer',
      },
    };

    const config = importMap[database] || importMap.postgres;

    return template.replace('__IMPORTS__', config.imports).replace('__DIALECT_CORE__', config.dialectCore);
  }

  private generateDrizzleClient(database: string, template: string): string {
    let driverImport = '';
    let connectionCode = '';

    switch (database) {
      case 'postgres':
        driverImport = `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString,
});`;
        connectionCode = `export const db = drizzle(pool, { schema });`;
        break;

      case 'mysql':
        driverImport = `import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

const poolConnection = mysql.createPool({
  uri: connectionString,
});`;
        connectionCode = `export const db = drizzle(poolConnection, { schema, mode: 'default' });`;
        break;

      case 'sqlite':
        driverImport = `import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const sqlite = new Database('dev.db');`;
        connectionCode = `export const db = drizzle(sqlite, { schema });`;
        break;

      default:
        driverImport = `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString,
});`;
        connectionCode = `export const db = drizzle(pool, { schema });`;
    }

    return template.replace('__DRIVER_IMPORT__', driverImport).replace('__CONNECTION_CODE__', connectionCode);
  }

  private getDrizzleDialect(database: string): string {
    const dialectMap: Record<string, string> = {
      postgres: 'postgresql',
      mysql: 'mysql',
      sqlite: 'sqlite',
    };
    return dialectMap[database] || 'postgresql';
  }

  private getDrizzleCredentials(database: string): string {
    switch (database) {
      case 'postgres':
        return `{
    url: process.env.DATABASE_URL!,
  }`;
      case 'mysql':
        return `{
    url: process.env.DATABASE_URL!,
  }`;
      case 'sqlite':
        return `{
    url: './dev.db',
  }`;
      default:
        return `{
    url: process.env.DATABASE_URL!,
  }`;
    }
  }

  private async setupDatabase(config: ProjectConfig, projectPath: string) {
    if (config.architecture.database === 'none') {
      return {
        content: [
          {
            type: 'text',
            text: 'No database configuration needed',
          },
        ],
      };
    }

    const { orm, database } = config.architecture;

    // Validate ORM/Database compatibility
    const validCombinations: Record<string, string[]> = {
      prisma: ['postgres', 'mysql', 'sqlite', 'mongodb'],
      drizzle: ['postgres', 'mysql', 'sqlite'],
      mongoose: ['mongodb'],
      none: ['postgres', 'mysql', 'sqlite', 'mongodb'],
    };

    if (orm !== 'none' && !validCombinations[orm]?.includes(database)) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Invalid combination: ${orm} does not support ${database}. ` +
              `Valid databases for ${orm}: ${validCombinations[orm].join(', ')}`,
          },
        ],
      };
    }

    try {
      const dbDirs = ['src/lib/db'];

      if (orm === 'drizzle') {
        dbDirs.push('drizzle/migrations');
      } else if (orm === 'mongoose') {
        dbDirs.push('src/lib/db/models');
      }

      for (const dir of dbDirs) {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      }

      const databaseUrl = this.getDatabaseUrl(config);
      const envEntry = `DATABASE_URL="${databaseUrl}"`;

      // Update or add DATABASE_URL to both .env files
      const envFiles = ['.env', '.env.example', '.env.local'];
      for (const envFile of envFiles) {
        const envPath = path.join(projectPath, envFile);
        let envContent = await fs.readFile(envPath, 'utf-8').catch(() => '');

        if (envContent.includes('DATABASE_URL=')) {
          envContent = envContent.replace(/DATABASE_URL=.*/g, envEntry);
        } else {
          envContent += `\n# Database Configuration\n${envEntry}\n`;
        }
        await fs.writeFile(envPath, envContent);
      }

      if (orm === 'prisma') {
        await this.setupPrisma(config, projectPath);
      } else if (orm === 'drizzle') {
        await this.setupDrizzle(config, projectPath);
      } else if (orm === 'mongoose') {
        await this.setupMongoose(config, projectPath);
      } else {
        await this.setupDirectDriver(config, projectPath);
      }

      // Generate success message with instructions
      const instructions = this.generateDatabaseInstructions(config);
      logger.info('Database setup completed successfully');
      logger.info(instructions);

      return {
        content: [
          {
            type: 'text',
            text: instructions,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Database setup failed: ${errorMessage}`);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to set up database: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async setupPrisma(config: ProjectConfig, projectPath: string) {
    const database = config.architecture.database;
    const packageRunner = this.getPackageRunner(config.architecture.packageManager);
    const provider = this.getPrismaProvider(database);

    if (!existsSync(path.join(projectPath, 'prisma', 'schema.prisma'))) {
      const prismaInitCmd = `${packageRunner} prisma init --datasource-provider ${provider} --generator-provider prisma-client --output ${PRISMA_OUTPUT_PATH}`;
      const result = this.execCommand(prismaInitCmd, projectPath, 'prisma init');

      if (!result.success) {
        throw new Error('[prisma init failed]: Check logs for details');
      }
    } else {
      logger.info('[prisma init skipped]: Prisma schema already exists, skipping prisma init');
    }

    // Copy client template
    const clientTemplatePath = path.join(__dirname, 'templates/database/prisma/client.ts.template');
    const clientTemplate = await fs.readFile(clientTemplatePath, 'utf-8');
    const clientPath = path.join(projectPath, 'src/lib/db/client.ts');
    await fs.writeFile(clientPath, clientTemplate);

    // Copy index template
    const indexTemplatePath = path.join(__dirname, 'templates/database/prisma/index.ts.template');
    const indexTemplate = await fs.readFile(indexTemplatePath, 'utf-8');
    const indexPath = path.join(projectPath, 'src/lib/db/index.ts');
    await fs.writeFile(indexPath, indexTemplate);

    // Run prisma generate to create the Prisma client
    const prismaGenerateCmd = `${packageRunner} prisma generate`;
    const result = this.execCommand(prismaGenerateCmd, projectPath, 'prisma generate');

    if (!result.success) {
      throw new Error('[prisma generate failed]: Check logs for details');
    }
  }

  private async setupDrizzle(config: ProjectConfig, projectPath: string) {
    const database = config.architecture.database;

    // Read and process drizzle config template
    const configTemplatePath = path.join(__dirname, 'templates/database/drizzle/drizzle.config.ts.template');
    let configTemplate = await fs.readFile(configTemplatePath, 'utf-8');

    configTemplate = configTemplate
      .replace(/\{\{DIALECT\}\}/g, this.getDrizzleDialect(database))
      .replace(/__DB_CREDENTIALS__/g, this.getDrizzleCredentials(database));

    const configPath = path.join(projectPath, 'drizzle.config.ts');
    await fs.writeFile(configPath, configTemplate);

    // Read and process schema template
    const schemaTemplatePath = path.join(__dirname, 'templates/database/drizzle/schema.ts.template');
    let schemaTemplate = await fs.readFile(schemaTemplatePath, 'utf-8');

    schemaTemplate = this.generateDrizzleSchemaImports(database, schemaTemplate);

    const schemaPath = path.join(projectPath, 'src/lib/db/schema.ts');
    await fs.writeFile(schemaPath, schemaTemplate);

    // Read and process client template
    const clientTemplatePath = path.join(__dirname, 'templates/database/drizzle/client.ts.template');
    let clientTemplate = await fs.readFile(clientTemplatePath, 'utf-8');

    clientTemplate = this.generateDrizzleClient(database, clientTemplate);

    const clientPath = path.join(projectPath, 'src/lib/db/client.ts');
    await fs.writeFile(clientPath, clientTemplate);

    // Copy index template
    const indexTemplatePath = path.join(__dirname, 'templates/database/drizzle/index.ts.template');
    const indexTemplate = await fs.readFile(indexTemplatePath, 'utf-8');

    const indexPath = path.join(projectPath, 'src/lib/db/index.ts');
    await fs.writeFile(indexPath, indexTemplate);
  }

  private async setupMongoose(_config: ProjectConfig, projectPath: string) {
    // Copy connection template
    const connectionTemplatePath = path.join(__dirname, 'templates/database/mongoose/connection.ts.template');
    const connectionTemplate = await fs.readFile(connectionTemplatePath, 'utf-8');

    const connectionPath = path.join(projectPath, 'src/lib/db/connection.ts');
    await fs.writeFile(connectionPath, connectionTemplate);

    // Create models directory with .gitkeep
    const modelsDir = path.join(projectPath, 'src/lib/db/models');
    await fs.mkdir(modelsDir, { recursive: true });
    await fs.writeFile(path.join(modelsDir, '.gitkeep'), '');

    // Copy index template
    const indexTemplatePath = path.join(__dirname, 'templates/database/mongoose/index.ts.template');
    const indexTemplate = await fs.readFile(indexTemplatePath, 'utf-8');

    const indexPath = path.join(projectPath, 'src/lib/db/index.ts');
    await fs.writeFile(indexPath, indexTemplate);
  }

  private async setupDirectDriver(config: ProjectConfig, projectPath: string) {
    const database = config.architecture.database;

    // Determine which template to use
    let templateName: string;
    if (database === 'postgres') {
      templateName = 'postgres.ts.template';
    } else if (database === 'mysql') {
      templateName = 'mysql.ts.template';
    } else if (database === 'sqlite') {
      templateName = 'sqlite.ts.template';
    } else if (database === 'mongodb') {
      templateName = 'mongodb.ts.template';
    } else {
      throw new Error(`Unsupported database: ${database}`);
    }

    // Copy template
    const templatePath = path.join(__dirname, `templates/database/direct/${templateName}`);
    const template = await fs.readFile(templatePath, 'utf-8');

    const dbPath = path.join(projectPath, 'src/lib/db/index.ts');
    await fs.writeFile(dbPath, template);
  }

  private generateDatabaseInstructions(config: ProjectConfig): string {
    const orm = config.architecture.orm || 'none';
    const database = config.architecture.database;
    const packageRunner = this.getPackageRunner(config.architecture.packageManager);

    let instructions = `Database setup completed successfully!\n\n`;
    instructions += `Configuration:\n`;
    instructions += `- Database: ${database}\n`;
    instructions += `- ORM: ${orm}\n`;
    instructions += `- Files created in: src/lib/db/\n\n`;

    instructions += `Next steps:\n`;

    if (orm === 'prisma') {
      instructions += `1. Prisma client has been generated and is ready to use!\n`;
      instructions += `2. Update your schema in prisma/schema.prisma (optional)\n`;
      instructions += `3. Run: ${packageRunner} prisma db push (or prisma migrate dev)\n`;
      instructions += `4. After schema changes, run: ${packageRunner} prisma generate\n`;
      instructions += `5. Import and use: import { db } from '@/lib/db'\n`;
    } else if (orm === 'drizzle') {
      instructions += `1. Define your schema in src/lib/db/schema.ts\n`;
      instructions += `2. Run: ${packageRunner} drizzle-kit generate\n`;
      instructions += `3. Run: ${packageRunner} drizzle-kit push (or migrate)\n`;
      instructions += `4. Import and use: import { db } from '@/lib/db'\n`;
    } else if (orm === 'mongoose') {
      instructions += `1. Create your models in src/lib/db/models/\n`;
      instructions += `2. Import connection: import { connectDB } from '@/lib/db'\n`;
      instructions += `3. Call connectDB() before using models\n`;
      instructions += `4. Export and use your models from the models directory\n`;
    } else {
      instructions += `1. Import the database client: import { db } from '@/lib/db'\n`;
      instructions += `2. Use the provided query helpers or pool directly\n`;
      instructions += `3. Refer to the ${database} documentation for query syntax\n`;
    }

    instructions += `\nEnvironment variable added to .env`;

    return instructions;
  }

  // Authentication Helper Functions
  private getAdapterConfig(config: ProjectConfig): { adapterImport: string; databaseConfig: string } {
    const { database, orm } = config.architecture;

    if (orm === 'prisma') {
      return {
        adapterImport: `import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";`,
        databaseConfig: `prismaAdapter(db, {
    provider: "${this.getPrismaProvider(database)}",
  })`,
      };
    }

    if (orm === 'drizzle') {
      return {
        adapterImport: `import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";`,
        databaseConfig: `drizzleAdapter(db, {
    provider: "${this.getDrizzleProvider(database)}",
  })`,
      };
    }

    // Direct database connection
    if (database === 'postgres') {
      return {
        adapterImport: `import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});`,
        databaseConfig: `pool`,
      };
    }

    if (database === 'mysql') {
      return {
        adapterImport: `import mysql from "mysql2/promise";

const pool = mysql.createPool(process.env.DATABASE_URL);`,
        databaseConfig: `pool`,
      };
    }

    if (database === 'sqlite') {
      return {
        adapterImport: `import Database from "better-sqlite3";

const db = new Database("./dev.db");`,
        databaseConfig: `db`,
      };
    }

    // Fallback for mongodb or other
    return {
      adapterImport: `// Direct database connection`,
      databaseConfig: `process.env.DATABASE_URL`,
    };
  }

  private getAuthSchemaCommand(): string {
    return 'npx @better-auth/cli@latest generate -y --config src/lib/auth.ts';
  }

  private getAuthMigrationCommand(config: ProjectConfig): string {
    const { orm, packageManager } = config.architecture;
    const packageRunner = this.getPackageRunner(packageManager);

    if (orm === 'prisma') {
      return `${packageRunner} prisma migrate dev -n setup_authentication`;
    }

    if (orm === 'drizzle') {
      return `${packageRunner} drizzle-kit generate && ${packageRunner} drizzle-kit migrate`;
    }

    return 'npx @better-auth/cli@latest migrate -y --config src/lib/auth.ts';
  }

  private async setupAuthentication(config: ProjectConfig, projectPath: string) {
    if (config.architecture.auth === 'none') {
      return {
        content: [
          {
            type: 'text',
            text: 'No authentication configuration needed',
          },
        ],
      };
    }

    // Verify database is configured
    if (config.architecture.database === 'none') {
      throw new Error('Better Auth requires a database. Please select a database option.');
    }

    try {
      // Step 1: Create directory structure
      const authDirs = [
        'src/lib',
        'src/providers',
        'src/app/api/auth/[...all]',
        'src/app/auth/[path]',
        'src/app/account/[path]',
        'src/components/auth',
      ];

      for (const dir of authDirs) {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      }

      // Update .env files (smart merge with existing DATABASE_URL)
      const envFiles = ['.env', '.env.example', '.env.local'];
      // Step 2: Generate environment variables
      for (const envFile of envFiles) {
        const secret = randomBytes(32).toString('base64');
        const authEnvVars = `
# Better Auth Configuration
BETTER_AUTH_SECRET="${secret}"
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# OAuth Providers (optional)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
`;
        const envPath = path.join(projectPath, envFile);
        let envContent = await fs.readFile(envPath, 'utf-8').catch(() => '');

        // Add auth vars if not present
        if (!envContent.includes('BETTER_AUTH_SECRET')) {
          envContent += authEnvVars;
          await fs.writeFile(envPath, envContent);
        }
      }

      // Step 3: Generate auth configuration files
      const { adapterImport, databaseConfig } = this.getAdapterConfig(config);

      // Read and process auth.ts template
      const authTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth.ts.template'), 'utf-8');
      const authContent = authTemplate
        .replace('__ADAPTER_IMPORT__', adapterImport)
        .replace('__DATABASE_CONFIG__', databaseConfig);

      await fs.writeFile(path.join(projectPath, 'src/lib/auth.ts'), authContent);

      // Copy auth-client.ts
      const authClientTemplate = await fs.readFile(
        path.join(__dirname, 'templates/auth/auth-client.ts.template'),
        'utf-8'
      );
      await fs.writeFile(path.join(projectPath, 'src/lib/auth-client.ts'), authClientTemplate);

      // Step 4: Generate API route
      const routeTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth-route.ts.template'), 'utf-8');
      await fs.writeFile(path.join(projectPath, 'src/app/api/auth/[...all]/route.ts'), routeTemplate);

      // Step 5: Generate AuthUIProvider
      const authProviderTemplate = await fs.readFile(
        path.join(__dirname, 'templates/auth/auth-ui-provider.tsx.template'),
        'utf-8'
      );
      await fs.writeFile(path.join(projectPath, 'src/providers/auth-ui-provider.tsx'), authProviderTemplate);

      // Step 6: Generate dynamic auth pages & layout
      // Step 7: Generate dynamic account pages
      // Step 8: Generate UserButton component
      const templateMappings = [
        {
          template: path.join('auth', 'auth-page.tsx.template'),
          destination: path.join('src', 'app', 'auth', '[path]', 'page.tsx'),
        },
        {
          template: path.join('auth', 'account-page.tsx.template'),
          destination: path.join('src', 'app', 'account', '[path]', 'page.tsx'),
        },
        {
          template: path.join('auth', 'user-button.tsx.template'),
          destination: path.join('src', 'components', 'auth', 'user-button.tsx'),
        },
        {
          template: path.join('auth', 'proxy.ts.template'),
          destination: path.join('src', 'proxy.ts'),
        },
      ];

      await Promise.all(
        templateMappings.map(async ({ template, destination }) => {
          const content = await fs.readFile(path.join(__dirname, 'templates', template), 'utf-8');
          await fs.writeFile(path.join(projectPath, destination), content);
        })
      );

      // Step 9: Update root layout to include AuthProvider
      const layoutPath = path.join(projectPath, 'src/app/layout.tsx');
      let layoutContent = await fs.readFile(layoutPath, 'utf-8');

      if (!layoutContent.includes('AuthProvider')) {
        // Add import at the top
        const importStatement = `import { AuthProvider } from "@/providers/auth-ui-provider";\n`;
        layoutContent = layoutContent.replace(/^(import.*\n)*/, (match) => match + importStatement);

        // Wrap {children} with <AuthProvider>{children}</AuthProvider>
        layoutContent = layoutContent.replace(/\{children\}/, '<AuthProvider>{children}</AuthProvider>');
        await fs.writeFile(layoutPath, layoutContent);
      }

      // Step 10: Update globals.css with better-auth-ui import
      const globalsCssPath = path.join(projectPath, 'src/app/globals.css');
      let globalsCss = await fs.readFile(globalsCssPath, 'utf-8');

      if (!globalsCss.includes('@daveyplate/better-auth-ui/css')) {
        globalsCss = `@import "@daveyplate/better-auth-ui/css";\n\n${globalsCss}`;
        await fs.writeFile(globalsCssPath, globalsCss);
      }

      // Step 11: Run schema generation and migration
      const { database } = config.architecture;
      let schemaGenerated = false;
      let migrationRan = false;

      // MongoDB doesn't need migrations (schema-less)
      const shouldRunMigrations = database !== 'mongodb';

      if (shouldRunMigrations) {
        // Generate auth schema
        const schemaCmd = this.getAuthSchemaCommand();
        const schemaResult = this.execCommand(schemaCmd, projectPath, 'auth schema generation');
        schemaGenerated = schemaResult.success;

        // Run migrations if schema was generated successfully
        if (schemaGenerated) {
          const migrationCmd = this.getAuthMigrationCommand(config);
          const migrationResult = this.execCommand(migrationCmd, projectPath, 'auth migration');
          migrationRan = migrationResult.success;
        }
      }

      // Step 12: Generate success message with instructions
      let nextSteps = '';

      if (database === 'mongodb') {
        // MongoDB doesn't need migrations
        nextSteps = `✅ MongoDB adapter configured - no migrations needed!

📋 Next Steps:

1. Start your development server:
   ${config.architecture.packageManager} dev

2. Visit http://localhost:3000/auth/sign-up to create your first user

ℹ️  Note: MongoDB is schema-less, so no migration commands are required.`;
      } else if (shouldRunMigrations) {
        // For all databases that ran auto-migrations
        if (schemaGenerated && migrationRan) {
          nextSteps = `✅ Database schema and migrations have been generated and applied automatically!

📋 Next Steps:

1. Start your development server:
   ${config.architecture.packageManager} dev

2. Visit http://localhost:3000/auth/sign-up to create your first user`;
        } else if (schemaGenerated && !migrationRan) {
          nextSteps = `⚠️  Schema generated but migration failed. Please run manually:

📋 Next Steps:

1. Run database migrations:
   ${this.getAuthMigrationCommand(config)}

2. Start your development server:
   ${config.architecture.packageManager} dev

3. Visit http://localhost:3000/auth/sign-up to create your first user`;
        } else {
          nextSteps = `⚠️  Auto-setup failed. Please run these commands manually:

📋 Next Steps:

1. Generate the database schema:
   ${this.getAuthSchemaCommand()}

2. Run database migrations:
   ${this.getAuthMigrationCommand(config)}

3. Start your development server:
   ${config.architecture.packageManager} dev

4. Visit http://localhost:3000/auth/sign-up to create your first user`;
        }
      } else {
        // Fallback (should not reach here due to MongoDB check above)
        nextSteps = `📋 Next Steps:

1. Start your development server:
   ${config.architecture.packageManager} dev

2. Visit http://localhost:3000/auth/sign-up to create your first user`;
      }

      const instructions = `✅ Better Auth + Better Auth UI has been configured successfully!

${nextSteps}

📚 Documentation:
- Better Auth: https://www.better-auth.com/docs
- Better Auth UI: https://better-auth-ui.com
- Email & Password Auth: https://www.better-auth.com/docs/authentication/email-password

🎨 Available Auth Routes:
- /auth/sign-in - Sign in page
- /auth/sign-up - Sign up page
- /auth/forgot-password - Password reset
- /auth/two-factor - 2FA setup
- /account/profile - User profile settings
- /account/security - Security settings
- /account/sessions - Active sessions

🔐 Features Enabled:
- Email & Password Authentication with beautiful UI
- Session Management
- Account Settings Pages
- User Profile Management
- Pre-styled shadcn/ui components
- Ready-to-use UserButton component

📁 Generated Files:
- src/lib/auth.ts (server config)
- src/lib/auth-client.ts (client)
- src/providers/auth-ui-provider.tsx (UI provider)
- src/app/api/auth/[...all]/route.ts (API handler)
- src/app/auth/[path]/page.tsx (dynamic auth pages)
- src/app/account/[path]/page.tsx (account settings)
- src/components/auth/user-button.tsx (UserButton wrapper)
- Updated src/app/layout.tsx (AuthProvider wrapper)
- Updated src/app/globals.css (better-auth-ui styles)

💡 Quick Start:
Add the UserButton to your layout/navbar:

import { UserButton } from "@/components/auth/user-button";

export default function Header() {
  return (
    <header>
      <nav>
        {/* Your navigation */}
        <UserButton />
      </nav>
    </header>
  );
}
`;

      logger.info('Authentication setup completed successfully');
      logger.info(instructions);

      return {
        content: [
          {
            type: 'text',
            text: instructions,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Authentication setup failed: ${errorMessage}`);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to set up authentication: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async installDependencies(config: ProjectConfig, projectPath: string) {
    try {
      const installCommand = `${config.architecture.packageManager} install`;
      const result = this.execCommand(installCommand, projectPath, 'install dependencies');

      if (!result.success) {
        throw new Error('[dependency installation failed]: Check logs for details');
      }

      const output = result.output || '';
      logger.info(`Dependencies installed using ${config.architecture.packageManager}: ${output}`);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully installed dependencies using ${config.architecture.packageManager}\n\n[Output]:\n${output}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Unexpected error during dependency installation:', errorMessage);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to install dependencies: ${errorMessage}`,
          },
        ],
      };
    }
  }

  private async validateProject(config: ProjectConfig, projectPath: string) {
    const validationResults = [];

    try {
      // Check if package.json exists
      await fs.access(path.join(projectPath, 'package.json'));
      validationResults.push('✅ package.json exists');

      // Check if Next.js config exists
      await fs.access(path.join(projectPath, 'next.config.ts'));
      validationResults.push('✅ next.config.ts exists');

      // Check if TypeScript config exists
      await fs.access(path.join(projectPath, 'tsconfig.json'));
      validationResults.push('✅ tsconfig.json exists');

      // Attempt to build the project unless skipped
      if (!config.architecture.skipInstall) {
        const runBuildCommand = `${config.architecture.packageManager} run build`;
        const result = this.execCommand(runBuildCommand, projectPath, 'validate build');

        if (!result.success) {
          throw new Error('[validate build failed]: Check logs for details');
        }

        validationResults.push('✅ Project builds successfully');
      } else {
        validationResults.push('⚠️ Build validation skipped (skipInstall is true)');
      }

      validationResults.push('✅ Project validation completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      validationResults.push(`❌ Validation failed: ${errorMessage}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: validationResults.join('\n'),
        },
      ],
    };
  }

  private async generateReadme(config: ProjectConfig, projectPath: string) {
    try {
      const { architecture } = config;
      const pm = architecture.packageManager;

      // Generate features list based on configuration
      const features = [];
      features.push('App Router for modern routing and layouts');
      if (architecture.typescript) features.push('TypeScript for type-safe development');
      if (architecture.uiLibrary === 'shadcn') features.push('shadcn/ui components library');
      if (architecture.database !== 'none') features.push(`${architecture.database} database integration`);
      if (architecture.orm !== 'none') features.push(`${architecture.orm} ORM for database operations`);
      if (architecture.auth !== 'none') features.push('Better Auth authentication with pre-built UI');
      if (architecture.stateManagement !== 'none') features.push(`${architecture.stateManagement} state management`);
      if (architecture.testing !== 'none') features.push(`${architecture.testing} testing framework`);
      features.push('Docker and docker-compose configuration');
      features.push('Tailwind CSS for styling');
      features.push('ESLint for code quality');

      // Generate database-specific setup instructions
      let databaseSetup = '';
      if (architecture.database !== 'none') {
        if (architecture.orm === 'prisma') {
          databaseSetup = `

### Database Setup (Prisma)

1. Start the database using Docker:
   \`\`\`bash
   ${pm} run docker:dev:up
   \`\`\`

2. Run database migrations:
   \`\`\`bash
   ${pm === 'npm' ? 'npx' : `${pm} exec`} prisma migrate dev
   \`\`\`

3. (Optional) Open Prisma Studio to manage your data:
   \`\`\`bash
   ${pm === 'npm' ? 'npx' : `${pm} exec`} prisma studio
   \`\`\`
`;
        } else if (architecture.orm === 'drizzle') {
          databaseSetup = `

### Database Setup (Drizzle)

1. Start the database using Docker:
   \`\`\`bash
   ${pm} run docker:dev:up
   \`\`\`

2. Generate and run migrations:
   \`\`\`bash
   ${pm === 'npm' ? 'npx' : `${pm} exec`} drizzle-kit generate
   ${pm === 'npm' ? 'npx' : `${pm} exec`} drizzle-kit migrate
   \`\`\`
`;
        } else if (architecture.orm === 'mongoose') {
          databaseSetup = `

### Database Setup (MongoDB + Mongoose)

1. Start MongoDB using Docker:
   \`\`\`bash
   ${pm} run docker:dev:up
   \`\`\`

2. The database connection will be established automatically when the app starts.
`;
        } else {
          databaseSetup = `

### Database Setup

1. Start the database using Docker:
   \`\`\`bash
   ${pm} run docker:dev:up
   \`\`\`

2. Update your \`.env.local\` file with the appropriate DATABASE_URL.
`;
        }
      }

      // Generate authentication setup instructions
      let authSetup = '';
      if (architecture.auth === 'better-auth') {
        authSetup = `

### Authentication

This project uses Better Auth with Better Auth UI for authentication.

Available auth routes:
- \`/auth/sign-in\` - Sign in page
- \`/auth/sign-up\` - Sign up page
- \`/auth/forgot-password\` - Password reset
- \`/account/profile\` - User profile settings
- \`/account/security\` - Security settings

The UserButton component is available for easy integration:
\`\`\`tsx
import { UserButton } from "@/components/auth/user-button";
\`\`\`

For more information, visit [Better Auth Documentation](https://www.better-auth.com/docs).
`;
      }

      // Generate testing instructions
      let testingInstructions = '';
      if (architecture.testing !== 'none') {
        testingInstructions = `

## Testing

Run tests with:
\`\`\`bash
${pm} test
\`\`\`
${
  architecture.testing === 'vitest'
    ? `
Run tests in watch mode:
\`\`\`bash
${pm} run test:watch
\`\`\`

Open Vitest UI:
\`\`\`bash
${pm} run test:ui
\`\`\`
`
    : ''
}${
          architecture.testing === 'playwright'
            ? `
Run E2E tests:
\`\`\`bash
${pm} run test:e2e
\`\`\`

Open Playwright UI:
\`\`\`bash
${pm} run test:e2e:ui
\`\`\`
`
            : ''
        }`;
      }

      const readme = `# ${config.name}

${config.description || 'A Next.js application scaffolded with Next.js MCP Server'}

## Features

${features.map((feature) => `- ${feature}`).join('\n')}

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: ${architecture.typescript ? 'TypeScript' : 'JavaScript'}
- **Package Manager**: ${pm}
- **UI Library**: ${architecture.uiLibrary === 'shadcn' ? 'shadcn/ui' : 'Tailwind CSS'}
- **Styling**: Tailwind CSS
- **Database**: ${architecture.database}${architecture.orm !== 'none' ? ` (${architecture.orm})` : ''}
- **Authentication**: ${architecture.auth}${architecture.auth === 'better-auth' ? ' + Better Auth UI' : ''}
- **State Management**: ${architecture.stateManagement}
- **Testing**: ${architecture.testing}

## Getting Started

### Prerequisites

- Node.js 20 or later
- ${pm} package manager
${architecture.database !== 'none' && architecture.database !== 'sqlite' ? '- Docker and Docker Compose (for local database)' : ''}

### Installation

1. Clone the repository (or navigate to the project directory)

2. Install dependencies:
   \`\`\`bash
   ${pm} install
   \`\`\`

3. Copy environment variables:
   \`\`\`bash
   cp .env.example .env.local
   \`\`\`

4. Update \`.env.local\` with your configuration
${databaseSetup}
5. Run the development server:
   \`\`\`bash
   ${pm} dev
   \`\`\`

6. Open [http://localhost:3000](http://localhost:3000) to see your application
${authSetup}
## Docker

### Development with Docker Compose

Start all services (app + database):
\`\`\`bash
${pm} run docker:dev:up
\`\`\`

Stop all services:
\`\`\`bash
${pm} run docker:dev:down
\`\`\`

### Production Build

Build the Docker image:
\`\`\`bash
${pm} run docker:build
\`\`\`

Run the container:
\`\`\`bash
${pm} run docker:run
\`\`\`

Or use docker-compose:
\`\`\`bash
docker-compose up
\`\`\`
${testingInstructions}
## Project Structure

\`\`\`
${config.name}/
├── src/
│   ├── app/                    # Next.js app directory
│   │   ├── api/               # API routes
${
  architecture.auth === 'better-auth'
    ? `│   │   │   └── auth/          # Authentication API
│   │   ├── auth/              # Auth pages (sign-in, sign-up)
│   │   ├── account/           # Account management pages
`
    : ''
}│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Home page
│   ├── components/            # React components
│   │   ├── ui/               # UI components${architecture.uiLibrary === 'shadcn' ? ' (shadcn/ui)' : ''}
${
  architecture.auth === 'better-auth'
    ? `│   │   └── auth/             # Auth components
`
    : ''
}│   ├── lib/                  # Utility functions
${
  architecture.database !== 'none'
    ? `│   │   └── db/               # Database client and schema
`
    : ''
}${
        architecture.auth === 'better-auth'
          ? `│   ├── providers/            # React providers
`
          : ''
      }│   └── hooks/                # Custom React hooks
${architecture.orm === 'prisma' ? '├── prisma/                 # Prisma schema and migrations\n' : ''}${architecture.orm === 'drizzle' ? '├── drizzle/                # Drizzle schema and migrations\n' : ''}├── docker-compose.yml       # Docker Compose configuration
├── Dockerfile               # Docker configuration
├── next.config.ts          # Next.js configuration
├── tailwind.config.ts      # Tailwind CSS configuration
└── tsconfig.json           # TypeScript configuration
\`\`\`

## Available Scripts

- \`${pm} dev\` - Start development server (with Turbopack)
- \`${pm} build\` - Build for production
- \`${pm} start\` - Start production server
- \`${pm} lint\` - Run ESLint
- \`${pm} run type-check\` - Run TypeScript type checking
${architecture.testing !== 'none' ? `- \`${pm} test\` - Run tests\n` : ''}${
        architecture.database !== 'none'
          ? `- \`${pm} run docker:dev:up\` - Start database with Docker Compose
- \`${pm} run docker:dev:down\` - Stop database
`
          : ''
      }- \`${pm} run docker:build\` - Build Docker image
- \`${pm} run docker:run\` - Run Docker container

## Environment Variables

See \`.env.example\` for all available environment variables.

Key variables:
${architecture.database !== 'none' ? '- `DATABASE_URL` - Database connection string\n' : ''}${
        architecture.auth === 'better-auth'
          ? `- \`BETTER_AUTH_SECRET\` - Secret for Better Auth
- \`BETTER_AUTH_URL\` - Your app URL
- \`NEXT_PUBLIC_BETTER_AUTH_URL\` - Public app URL
`
          : ''
      }
## Deployment

This project can be deployed to various platforms:

### Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Push your code to GitHub
2. Import your repository to Vercel
3. Configure environment variables
4. Deploy!

### Docker

Deploy using the included Dockerfile to any platform that supports Docker:
- AWS ECS/Fargate
- Google Cloud Run
- Azure Container Instances
- DigitalOcean App Platform
- Fly.io
- Railway

## Learn More

### Next.js
- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
- [Next.js GitHub](https://github.com/vercel/next.js)

### Styling
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
${architecture.uiLibrary === 'shadcn' ? '- [shadcn/ui Documentation](https://ui.shadcn.com)\n' : ''}
### Database
${architecture.orm === 'prisma' ? '- [Prisma Documentation](https://www.prisma.io/docs)\n' : ''}${architecture.orm === 'drizzle' ? '- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)\n' : ''}${architecture.orm === 'mongoose' ? '- [Mongoose Documentation](https://mongoosejs.com/docs/)\n' : ''}
### Authentication
${
  architecture.auth === 'better-auth'
    ? `- [Better Auth Documentation](https://www.better-auth.com/docs)
- [Better Auth UI Documentation](https://better-auth-ui.com)
`
    : ''
}
## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the [MIT License](LICENSE).

---

Generated with [Next.js MCP Server](https://github.com/anthropics/next-mcp)
`;

      await fs.writeFile(path.join(projectPath, 'README.md'), readme);

      return {
        content: [
          {
            type: 'text',
            text: '✅ Generated comprehensive README.md with project documentation',
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to generate README.md: ${errorMessage}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Next.js Scaffolding MCP server running on stdio');
  }
}

process.on('SIGINT', async () => {
  process.exit(0);
});

process.on('SIGTERM', async () => {
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

const server = new NextMCPServer();
server.run().catch(logger.error);
