#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
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

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: 'next-mcp.log' })],
});

const uniqueNamesGeneratorConfig: Config = {
  dictionaries: [adjectives, colors, names],
  length: 2,
  separator: '-',
  style: 'lowerCase',
};

interface ProjectConfig {
  name: string;
  description: string;
  architecture: {
    appRouter: boolean;
    typescript: boolean;
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
                required: ['name', 'architecture'],
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
          name: 'generate_nextjs_config',
          description: 'Generate Next.js configuration files',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
            },
            required: ['projectPath'],
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
          name: 'generate_ci_cd',
          description: 'Generate CI/CD pipeline configuration',
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
              projectPath: { type: 'string' },
              packageManager: { type: 'string', enum: ['npm', 'pnpm', 'yarn', 'bun'] },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'validate_project',
          description: 'Run validation checks on the generated project',
          inputSchema: {
            type: 'object',
            properties: {
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
          case 'generate_nextjs_config':
            return await this.generateNextJSConfig(args.projectPath as string);
          // case "generate_base_components":
          //   return await this.generateBaseComponents(args.config as ProjectConfig, args.projectPath as string);
          // case "setup_database":
          //   return await this.setupDatabase(args.config as ProjectConfig, args.projectPath as string);
          // case "setup_authentication":
          //   return await this.setupAuthentication(args.config as ProjectConfig, args.projectPath as string);
          // case "generate_ci_cd":
          //   return await this.generateCICD(args.config as ProjectConfig, args.projectPath as string);
          // case "install_dependencies":
          //   return await this.installDependencies(
          //     args.projectPath as string,
          //     args.packageManager as string
          //   );
          // case "validate_project":
          //   return await this.validateProject(args.projectPath as string);
          // case "generate_readme":
          //   return await this.generateReadme(args.config as ProjectConfig, args.projectPath as string);
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

  private applyConfigDefaults(config: ProjectConfig): ProjectConfig {
    return {
      name: config.name || `${uniqueNamesGenerator(uniqueNamesGeneratorConfig)}-app`,
      description: config.description || 'A Next.js application scaffolded with and AI Agent MCP',
      architecture: {
        appRouter: config.architecture?.appRouter ?? true,
        typescript: config.architecture?.typescript ?? true,
        packageManager: config.architecture?.packageManager || 'pnpm',
        database: config.architecture?.database || 'postgres',
        orm: config.architecture?.orm || 'prisma',
        auth: config.architecture?.auth || 'better-auth',
        uiLibrary: config.architecture?.uiLibrary || 'shadcn',
        stateManagement: config.architecture?.stateManagement || 'none',
        testing: config.architecture?.testing || 'none',
      },
    };
  }

  private async scaffoldProject(config: ProjectConfig, targetPath: string) {
    // Apply defaults to the configuration
    const fullConfig = this.applyConfigDefaults(config);
    const projectPath = path.join(targetPath, fullConfig.name);

    try {
      // Build create-next-app command based on configuration
      const createCommand = this.buildCreateNextAppCommand(fullConfig);
      logger.info(`Executing: ${createCommand}`);

      // Run create-next-app
      const out = execSync(createCommand, {
        cwd: targetPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = out.toString();

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
    const flags = ['npx create-next-app@latest', `./${config.name}`];
    logger.info(`Building create-next-app command for config: ${JSON.stringify(config)}`);
    if (config.architecture.typescript) {
      flags.push('--ts');
    } else {
      flags.push('--js');
    }

    if (config.architecture.appRouter) {
      flags.push('--app');
    } else {
      flags.push('--no-app');
    }

    // Always use ESLint
    flags.push('--eslint');

    //Always use Tailwind CSS for styling
    flags.push('--tailwind');

    // Use src directory for better organization
    flags.push('--src-dir');

    // Use Turbopack for faster development
    flags.push('--turbopack');

    // Set import alias
    flags.push('--import-alias "@/*"');

    if (config.architecture.packageManager === 'pnpm') {
      flags.push('--use-pnpm');
    } else if (config.architecture.packageManager === 'yarn') {
      flags.push('--use-yarn');
    } else if (config.architecture.packageManager === 'bun') {
      flags.push('--use-bun');
    } else {
      flags.push('--use-npm');
    }

    return flags.join(' ');
  }

  private async createDirectoryStructure(config: ProjectConfig, projectPath: string) {
    // Additional directories that create-next-app doesn't create
    const additionalDirectories = [
      'src/components/ui',
      'src/components/forms',
      'src/lib',
      'src/hooks',
      '.github/workflows',
    ];

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
      additionalDirectories.push('src/lib/auth');
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
      const additionalScripts = {
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

      existingPackageJson.scripts = {
        ...existingPackageJson.scripts,
        ...additionalScripts,
      };

      // Add additional dependencies based on architecture choices
      const additionalDeps: Record<string, string> = {};
      const additionalDevDeps: Record<string, string> = {};

      // State Management
      if (config.architecture.stateManagement === 'zustand') {
        additionalDeps.zustand = '^5.0.8';
      } else if (config.architecture.stateManagement === 'redux') {
        additionalDeps['@reduxjs/toolkit'] = '^2.5.0';
        additionalDeps['react-redux'] = '^9.2.0';
        additionalDevDeps['@types/react-redux'] = '^7.1.34';
      }

      // Database + ORM
      if (config.architecture.orm === 'prisma') {
        additionalDeps['@prisma/client'] = '^6.17.1';
        additionalDevDeps.prisma = '^6.17.1';
      } else if (config.architecture.orm === 'drizzle') {
        additionalDeps['drizzle-orm'] = '^0.44.6';
        additionalDevDeps['drizzle-kit'] = '^0.31.5';

        if (config.architecture.database === 'postgres') {
          additionalDeps.pg = '^8.16.3';
          additionalDeps.dotenv = '^17.2.3';
        }

        if (config.architecture.database === 'mysql') {
          additionalDeps.mysql2 = '^3.15.2';
        }

        if (config.architecture.database === 'sqlite') {
          additionalDeps['better-sqlite3'] = '^12.4.1';
          additionalDevDeps['@types/better-sqlite3'] = '^7.6.13';
        }
      } else if (config.architecture.orm === 'mongoose') {
        additionalDeps.mongoose = '^8.19.1';
      }

      if (config.architecture.orm === 'none') {
        if (config.architecture.database === 'postgres') {
          additionalDeps.pg = '^8.16.3';
        } else if (config.architecture.database === 'mysql') {
          additionalDeps.mysql2 = '^3.15.2';
        } else if (config.architecture.database === 'mongodb') {
          additionalDeps.mongodb = '^6.20.0';
        } else if (config.architecture.database === 'sqlite') {
          additionalDeps['better-sqlite3'] = '^12.4.1';
          additionalDevDeps['@types/better-sqlite3'] = '^7.6.13';
        }
      }

      // Authentication
      if (config.architecture.auth === 'better-auth') {
        additionalDeps['better-auth'] = '^1.3.27';
      }

      // Testing
      if (config.architecture.testing === 'vitest') {
        additionalDevDeps.vitest = '^1.0.4';
        additionalDevDeps['@vitejs/plugin-react'] = '^4.2.1';
        additionalDevDeps['@testing-library/react'] = '^14.1.2';
        additionalDevDeps['@testing-library/jest-dom'] = '^6.1.6';
        additionalDevDeps.jsdom = '^23.0.1';
      } else if (config.architecture.testing === 'jest') {
        additionalDevDeps.jest = '^29.7.0';
        additionalDevDeps['jest-environment-jsdom'] = '^29.7.0';
        additionalDevDeps['@testing-library/react'] = '^14.1.2';
        additionalDevDeps['@testing-library/jest-dom'] = '^6.1.6';
      } else if (config.architecture.testing === 'playwright') {
        additionalDevDeps['@playwright/test'] = '^1.40.1';
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
      const dockerfileTemplate = await fs.readFile(path.join(__dirname, 'templates', 'Dockerfile'), 'utf-8');
      const dockerignoreTemplate = await fs.readFile(path.join(__dirname, 'templates', '.dockerignore'), 'utf-8');

      // Read docker-compose template
      const dockerComposeTemplate = await fs.readFile(path.join(__dirname, 'templates', 'docker-compose.yml'), 'utf-8');

      // Generate database-specific sections
      let databaseDependsOn = '';
      let databaseService = '';
      let volumesSection = '';

      if (config.architecture.database !== 'none') {
        databaseDependsOn = `    depends_on:
      - db`;

        switch (config.architecture.database) {
          case 'postgres':
            databaseService = `  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${config.name}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data`;
            volumesSection = `volumes:
  postgres_data:`;
            break;

          case 'mysql':
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
      - mysql_data:/var/lib/mysql`;
            volumesSection = `volumes:
  mysql_data:`;
            break;

          case 'mongodb':
            databaseService = `  db:
    image: mongo:6.0
    environment:
      MONGO_INITDB_DATABASE: ${config.name}
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db`;
            volumesSection = `volumes:
  mongodb_data:`;
            break;
        }
      }

      // Replace template placeholders
      const dockerCompose = dockerComposeTemplate
        .replace('__DATABASE_DEPENDS_ON__', databaseDependsOn)
        .replace('__DATABASE_SERVICE__', databaseService)
        .replace('__VOLUMES_SECTION__', volumesSection);

      await fs.writeFile(path.join(projectPath, 'Dockerfile'), dockerfileTemplate);
      await fs.writeFile(path.join(projectPath, '.dockerignore'), dockerignoreTemplate);
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

  private async generateNextJSConfig(projectPath: string) {
    try {
      // Read template files
      const nextConfigTemplate = await fs.readFile(path.join(__dirname, 'templates', 'next.config.template'), 'utf-8');

      // Write core configuration files
      await fs.writeFile(path.join(projectPath, 'next.config.ts'), nextConfigTemplate);
      const filesCreated = ['next.config.ts'];

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

  /**
  private async generateBaseComponents(
    projectPath: string,
    config: ProjectConfig
  ) {
    try {
      // Update the existing page.tsx with our custom content
      const pageTsx = `export default function Home() {
  return (
    <main${config.architecture.styling === "tailwind" ? ' className="min-h-screen flex flex-col items-center justify-center p-8"' : ""}>
      <div${config.architecture.styling === "tailwind" ? ' className="max-w-4xl mx-auto text-center"' : ""}>
        <h1${config.architecture.styling === "tailwind" ? ' className="text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"' : ""}>
          Welcome to ${config.name}
        </h1>
        <p${config.architecture.styling === "tailwind" ? ' className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto"' : ""}>
          ${config.description || "Your Next.js application is ready! Built with modern tools and best practices."}
        </p>
        
        <div${config.architecture.styling === "tailwind" ? ' className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12"' : ""}>
          <div${config.architecture.styling === "tailwind" ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ""}>
            <h3${config.architecture.styling === "tailwind" ? ' className="text-lg font-semibold mb-2"' : ""}>🚀 Next.js 15</h3>
            <p${config.architecture.styling === "tailwind" ? ' className="text-gray-600"' : ""}>
              Built with the latest Next.js features including App Router and Turbopack.
            </p>
          </div>
          
          ${
            config.architecture.styling === "tailwind"
              ? `<div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🎨 Tailwind CSS</h3>
            <p className="text-gray-600">
              Utility-first CSS framework for rapid UI development.
            </p>
          </div>`
              : ""
          }
          
          ${
            config.architecture.typescript
              ? `<div${config.architecture.styling === "tailwind" ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ""}>
            <h3${config.architecture.styling === "tailwind" ? ' className="text-lg font-semibold mb-2"' : ""}>📘 TypeScript</h3>
            <p${config.architecture.styling === "tailwind" ? ' className="text-gray-600"' : ""}>
              Type-safe development with excellent IDE support.
            </p>
          </div>`
              : ""
          }
          
          ${
            config.architecture.database !== "none"
              ? `<div${config.architecture.styling === "tailwind" ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ""}>
            <h3${config.architecture.styling === "tailwind" ? ' className="text-lg font-semibold mb-2"' : ""}>🗄️ ${config.architecture.database.charAt(0).toUpperCase() + config.architecture.database.slice(1)}</h3>
            <p${config.architecture.styling === "tailwind" ? ' className="text-gray-600"' : ""}>
              Database integration ready for your data needs.
            </p>
          </div>`
              : ""
          }
          
          ${
            config.architecture.auth !== "none"
              ? `<div${config.architecture.styling === "tailwind" ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ""}>
            <h3${config.architecture.styling === "tailwind" ? ' className="text-lg font-semibold mb-2"' : ""}>🔐 Authentication</h3>
            <p${config.architecture.styling === "tailwind" ? ' className="text-gray-600"' : ""}>
              Secure authentication with ${config.architecture.auth}.
            </p>
          </div>`
              : ""
          }
          
          <div${config.architecture.styling === "tailwind" ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ""}>
            <h3${config.architecture.styling === "tailwind" ? ' className="text-lg font-semibold mb-2"' : ""}>🐳 Docker Ready</h3>
            <p${config.architecture.styling === "tailwind" ? ' className="text-gray-600"' : ""}>
              Containerized for easy deployment to any cloud platform.
            </p>
          </div>
        </div>
        
        <div${config.architecture.styling === "tailwind" ? ' className="mt-12 flex flex-col sm:flex-row gap-4 justify-center"' : ""}>
          <a 
            href="/api/health"${config.architecture.styling === "tailwind" ? ' className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"' : ""}
          >
            Test API Route
          </a>
          <a 
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noopener noreferrer"${config.architecture.styling === "tailwind" ? ' className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"' : ""}
          >
            Read the Docs
          </a>
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
      styling: '${config.architecture.styling}',
      stateManagement: '${config.architecture.stateManagement}',
      testing: '${config.architecture.testing}',
    },
  });
}
`;

      // Create some basic UI components if using Tailwind
      let buttonComponent = "";
      if (config.architecture.styling === "tailwind") {
        buttonComponent = `import { type ButtonHTMLAttributes, forwardRef } from 'react';
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
      }

      // Write the files
      await fs.writeFile(path.join(projectPath, "src/app/page.tsx"), pageTsx);
      await fs.writeFile(
        path.join(projectPath, "src/app/api/health/route.ts"),
        healthApiRoute
      );

      if (buttonComponent) {
        await fs.writeFile(
          path.join(projectPath, "src/components/ui/button.tsx"),
          buttonComponent
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ Updated base components:\n- Enhanced home page with feature showcase\n- Added health check API route\n${buttonComponent ? "- Created reusable Button component\n" : ""}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to generate base components: ${error.message}`,
          },
        ],
      };
    }
  }

  private async setupDatabase(config: ProjectConfig, projectPath: string) {
    if (config.architecture.database === "none") {
      return {
        content: [
          {
            type: "text",
            text: "No database configuration needed",
          },
        ],
      };
    }

    // Generate database configuration based on selected database
    const dbConfig = `// Database configuration
export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || '${config.name}',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
}
`;

    await fs.writeFile(path.join(projectPath, "src/lib/db.ts"), dbConfig);

    return {
      content: [
        {
          type: "text",
          text: `Generated ${config.architecture.database} database configuration`,
        },
      ],
    };
  }

  private async setupAuthentication(
    projectPath: string,
    config: ProjectConfig
  ) {
    if (config.architecture.auth === "none") {
      return {
        content: [
          {
            type: "text",
            text: "No authentication configuration needed",
          },
        ],
      };
    }

    // Generate auth configuration
    const authConfig = `// Authentication configuration
export const authConfig = {
  providers: [],
  callbacks: {},
  pages: {
    signIn: '/auth/signin',
    signUp: '/auth/signup',
  },
}
`;

    await fs.writeFile(path.join(projectPath, "src/lib/auth.ts"), authConfig);

    return {
      content: [
        {
          type: "text",
          text: `Generated ${config.architecture.auth} authentication configuration`,
        },
      ],
    };
  }

  private async generateCICD(config: ProjectConfig, projectPath: string) {
    const ciWorkflow = `name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'pnpm'
    
    - name: Install dependencies
      run: pnpm install
    
    - name: Run linting
      run: pnpm lint
    
    - name: Run type checking
      run: pnpm type-check
    
    - name: Build application
      run: pnpm build
    
    ${config.architecture.testing !== "jest" ? "- name: Run tests\n      run: pnpm test" : ""}
  
  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Deploy to ${config.deployment.platform}
      run: echo "Deploy to ${config.deployment.platform}"
`;

    await fs.writeFile(
      path.join(projectPath, ".github/workflows/ci.yml"),
      ciWorkflow
    );

    return {
      content: [
        {
          type: "text",
          text: "Generated CI/CD pipeline configuration",
        },
      ],
    };
  }

  private async installDependencies(
    projectPath: string,
    packageManager = "pnpm"
  ) {
    try {
      execSync(`${packageManager} install`, {
        cwd: projectPath,
        stdio: "pipe",
      });

      return {
        content: [
          {
            type: "text",
            text: `Successfully installed dependencies using ${packageManager}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to install dependencies: ${error.message}`,
          },
        ],
      };
    }
  }

  private async validateProject(projectPath: string) {
    const validationResults = [];

    try {
      // Check if package.json exists
      await fs.access(path.join(projectPath, "package.json"));
      validationResults.push("✅ package.json exists");

      // Check if Next.js config exists
      await fs.access(path.join(projectPath, "next.config.js"));
      validationResults.push("✅ next.config.js exists");

      // Check if TypeScript config exists
      await fs.access(path.join(projectPath, "tsconfig.json"));
      validationResults.push("✅ tsconfig.json exists");

      // Try to build the project
      execSync("npm run build", { cwd: projectPath, stdio: "pipe" });
      validationResults.push("✅ Project builds successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      validationResults.push(`❌ Validation failed: ${errorMessage}`);
    }

    return {
      content: [
        {
          type: "text",
          text: validationResults.join("\n"),
        },
      ],
    };
  }

  private async generateReadme(config: ProjectConfig, projectPath: string) {
    const readme = `# ${config.name}

${config.description || "A Next.js application"}

## Features

${config.features.map((feature) => `- ${feature}`).join("\n")}

## Tech Stack

- **Framework**: Next.js ${config.architecture.appRouter ? "(App Router)" : "(Pages Router)"}
- **Language**: ${config.architecture.typescript ? "TypeScript" : "JavaScript"}
- **Styling**: ${config.architecture.styling}
- **Database**: ${config.architecture.database}
- **Authentication**: ${config.architecture.auth}
- **State Management**: ${config.architecture.stateManagement}
- **Testing**: ${config.architecture.testing}

## Getting Started

### Prerequisites

- Node.js 20 or later
- pnpm (recommended) or npm

### Installation

1. Clone the repository
2. Install dependencies:
   \`\`\`bash
   pnpm install
   \`\`\`

3. Copy environment variables:
   \`\`\`bash
   cp .env.example .env.local
   \`\`\`

4. Run the development server:
   \`\`\`bash
   pnpm dev
   \`\`\`

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Docker

Build and run with Docker:

\`\`\`bash
docker build -t ${config.name} .
docker run -p 3000:3000 ${config.name}
\`\`\`

Or use docker-compose:

\`\`\`bash
cd docker
docker-compose up
\`\`\`

## Deployment

This project is configured for deployment on ${config.deployment.platform}.

${
  config.deployment.platform === "vercel"
    ? "The easiest way to deploy is to use the [Vercel Platform](https://vercel.com/new)."
    : `Deploy using your ${config.deployment.platform} workflow.`
}

## Scripts

- \`pnpm dev\` - Start development server
- \`pnpm build\` - Build for production
- \`pnpm start\` - Start production server
- \`pnpm lint\` - Run ESLint
- \`pnpm type-check\` - Run TypeScript type checking
${config.architecture.testing !== "jest" ? "- `pnpm test` - Run tests" : ""}

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
`;

    await fs.writeFile(path.join(projectPath, "README.md"), readme);

    return {
      content: [
        {
          type: "text",
          text: "Generated comprehensive README.md",
        },
      ],
    };
  }
  */

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
