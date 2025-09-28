#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

interface ProjectConfig {
  name: string;
  description: string;
  features: string[];
  deployment: {
    platform: 'vercel' | 'aws' | 'gcp' | 'azure';
    containerRegistry?: string;
    domain?: string;
  };
  architecture: {
    appRouter: boolean;
    typescript: boolean;
    database: 'none' | 'postgres' | 'mysql' | 'mongodb';
    auth: 'none' | 'better-auth' | 'clerk' | 'supabase';
    uiLibrary: 'none' | 'shadcn';
    stateManagement: 'zustand' | 'redux' | 'context';
    testing: 'jest' | 'vitest' | 'playwright';
  };
}

class NextMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'nextjs-scaffolding-server',
        version: '1.0.0',
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
                  features: { type: 'array', items: { type: 'string' } },
                  deployment: { type: 'object' },
                  architecture: { type: 'object' }
                },
                required: ['name', 'architecture']
              },
              targetPath: { type: 'string', description: 'Target directory path' }
            },
            required: ['config', 'targetPath']
          }
        },
        {
          name: 'create_directory_structure',
          description: 'Create the base directory structure for the project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'generate_package_json',
          description: 'Generate package.json with appropriate dependencies',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'generate_dockerfile',
          description: 'Generate Dockerfile and docker-compose.yml',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'generate_nextjs_config',
          description: 'Generate Next.js configuration files',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'generate_base_components',
          description: 'Generate base React components and layouts',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'setup_database',
          description: 'Generate database configuration and migrations',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'setup_authentication',
          description: 'Configure authentication system',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'generate_ci_cd',
          description: 'Generate CI/CD pipeline configuration',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        },
        {
          name: 'install_dependencies',
          description: 'Install npm/pnpm dependencies',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              packageManager: { type: 'string', enum: ['npm', 'pnpm', 'yarn'] }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'validate_project',
          description: 'Run validation checks on the generated project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'generate_readme',
          description: 'Generate comprehensive README.md',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
              config: { type: 'object' }
            },
            required: ['projectPath', 'config']
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'scaffold_project':
            return await this.scaffoldProject(args.config, args.targetPath);
          case 'create_directory_structure':
            return await this.createDirectoryStructure(args.projectPath, args.config);
          case 'generate_package_json':
            return await this.generatePackageJson(args.projectPath, args.config);
          case 'generate_dockerfile':
            return await this.generateDockerfile(args.projectPath, args.config);
          case 'generate_nextjs_config':
            return await this.generateNextJSConfig(args.projectPath, args.config);
          case 'generate_base_components':
            return await this.generateBaseComponents(args.projectPath, args.config);
          case 'setup_database':
            return await this.setupDatabase(args.projectPath, args.config);
          case 'setup_authentication':
            return await this.setupAuthentication(args.projectPath, args.config);
          case 'generate_ci_cd':
            return await this.generateCICD(args.projectPath, args.config);
          case 'install_dependencies':
            return await this.installDependencies(args.projectPath, args.packageManager);
          case 'validate_project':
            return await this.validateProject(args.projectPath);
          case 'generate_readme':
            return await this.generateReadme(args.projectPath, args.config);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  private async scaffoldProject(config: ProjectConfig, targetPath: string) {
    const projectPath = path.join(targetPath, config.name);
    
    try {
      // Build create-next-app command based on configuration
      const createCommand = this.buildCreateNextAppCommand(config, targetPath);
      
      console.error(`Executing: ${createCommand}`);
      
      // Run create-next-app
      execSync(createCommand, { 
        stdio: 'inherit',
        cwd: targetPath
      });
      
      // Verify the project was created
      await fs.access(projectPath);
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully created Next.js project at ${projectPath}\nCommand executed: ${createCommand}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to create Next.js project: ${error.message}`,
          },
        ],
      };
    }
  }

  private buildCreateNextAppCommand(config: ProjectConfig, targetPath: string): string {
    const flags = [
      'npx create-next-app@latest',
      `./${config.name}`,
    ];

    // Always include these flags based on our architecture
    if (config.architecture.typescript) {
      flags.push('--ts');
    } else {
      flags.push('--js');
    }

    // Styling framework
    if (config.architecture.styling === 'tailwind') {
      flags.push('--tailwind');
    } else {
      flags.push('--no-tailwind');
    }

    // Always use ESLint
    flags.push('--eslint');

    // Always use App Router (it's the future)
    if (config.architecture.appRouter) {
      flags.push('--app');
    } else {
      flags.push('--no-app');
    }

    // Use src directory for better organization
    flags.push('--src-dir');

    // Use Turbopack for faster development
    flags.push('--turbopack');

    // Set import alias
    flags.push('--import-alias "@/*"');

    // Use pnpm as package manager
    flags.push('--use-pnpm');

    // Skip git init since we'll handle it separately
    flags.push('--skip-git');

    return flags.join(' ');
  }

  private async createDirectoryStructure(projectPath: string, config: ProjectConfig) {
    // Additional directories that create-next-app doesn't create
    const additionalDirectories = [
      'src/components/ui',
      'src/components/forms',
      'src/hooks',
      'tests',
      'docker',
      '.github/workflows'
    ];

    // Add stores directory if using external state management
    if (config.architecture.stateManagement !== 'context') {
      additionalDirectories.push('src/stores');
    }

    // Add database-related directories
    if (config.architecture.database !== 'none') {
      additionalDirectories.push('src/lib/db');
      additionalDirectories.push('migrations');
    }

    // Add auth-related directories
    if (config.architecture.auth !== 'none') {
      additionalDirectories.push('src/lib/auth');
      additionalDirectories.push('src/components/auth');
    }

    // Create the additional directories
    for (const dir of additionalDirectories) {
      try {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
      } catch (error) {
        // Directory might already exist, continue
        console.error(`Note: Directory ${dir} might already exist`);
      }
    }

    // Initialize git repository (since we skipped it in create-next-app)
    try {
      execSync('git init', { cwd: projectPath, stdio: 'pipe' });
      execSync('git add .', { cwd: projectPath, stdio: 'pipe' });
      execSync('git commit -m "Initial commit from scaffolding"', { 
        cwd: projectPath, 
        stdio: 'pipe' 
      });
    } catch (error) {
      console.error('Git initialization failed, continuing without git');
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

  private async generatePackageJson(projectPath: string, config: ProjectConfig) {
    try {
      // Read the existing package.json created by create-next-app
      const packageJsonPath = path.join(projectPath, 'package.json');
      const existingPackageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf-8')
      );

      // Add additional scripts
      const additionalScripts = {
        'type-check': 'tsc --noEmit',
        'lint:fix': 'next lint --fix',
        'docker:build': `docker build -t ${config.name} .`,
        'docker:run': `docker run -p 3000:3000 ${config.name}`,
        'docker:dev': 'docker-compose -f docker/docker-compose.yml up',
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

      // Merge scripts
      existingPackageJson.scripts = {
        ...existingPackageJson.scripts,
        ...additionalScripts,
      };

      // Add additional dependencies based on architecture choices
      const additionalDeps: Record<string, string> = {};
      const additionalDevDeps: Record<string, string> = {};

      // State Management
      if (config.architecture.stateManagement === 'zustand') {
        additionalDeps.zustand = '^4.4.7';
      } else if (config.architecture.stateManagement === 'redux') {
        additionalDeps['@reduxjs/toolkit'] = '^2.0.1';
        additionalDeps['react-redux'] = '^9.0.4';
        additionalDevDeps['@types/react-redux'] = '^7.1.33';
      }

      // Database
      if (config.architecture.database === 'postgres') {
        additionalDeps.pg = '^8.11.3';
        additionalDeps['drizzle-orm'] = '^0.29.1';
        additionalDevDeps['@types/pg'] = '^8.10.9';
        additionalDevDeps['drizzle-kit'] = '^0.20.7';
      } else if (config.architecture.database === 'mysql') {
        additionalDeps.mysql2 = '^3.6.5';
        additionalDeps['drizzle-orm'] = '^0.29.1';
        additionalDevDeps['drizzle-kit'] = '^0.20.7';
      } else if (config.architecture.database === 'mongodb') {
        additionalDeps.mongodb = '^6.3.0';
        additionalDeps.mongoose = '^8.0.3';
        additionalDevDeps['@types/mongodb'] = '^4.0.7';
      }

      // Authentication
      if (config.architecture.auth === 'nextauth') {
        additionalDeps['next-auth'] = '^4.24.5';
      } else if (config.architecture.auth === 'clerk') {
        additionalDeps['@clerk/nextjs'] = '^4.29.1';
      } else if (config.architecture.auth === 'supabase') {
        additionalDeps['@supabase/supabase-js'] = '^2.38.5';
        additionalDeps['@supabase/ssr'] = '^0.0.10';
      }

      // Styling (if not Tailwind, since that's handled by create-next-app)
      if (config.architecture.styling === 'styled-components') {
        additionalDeps['styled-components'] = '^6.1.6';
        additionalDevDeps['@types/styled-components'] = '^5.1.34';
      } else if (config.architecture.styling === 'emotion') {
        additionalDeps['@emotion/react'] = '^11.11.1';
        additionalDeps['@emotion/styled'] = '^11.11.0';
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

      // Additional utility packages
      additionalDeps.clsx = '^2.0.0';
      additionalDeps['class-variance-authority'] = '^0.7.0';
      additionalDeps.lucide-react = '^0.300.0';

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
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(existingPackageJson, null, 2)
      );

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
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to update package.json: ${error.message}`,
          },
        ],
      };
    }
  }

  private async generateDockerfile(projectPath: string, config: ProjectConfig) {
    const dockerfile = `# Use the official Node.js 20 image
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \\
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \\
  elif [ -f package-lock.json ]; then npm ci; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \\
  else echo "Lockfile not found." && exit 1; \\
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN \\
  if [ -f yarn.lock ]; then yarn build; \\
  elif [ -f package-lock.json ]; then npm run build; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm build; \\
  else echo "Lockfile not found." && exit 1; \\
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
`;

    const dockerCompose = `version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    ${config.architecture.database !== 'none' ? `depends_on:
      - db` : ''}

${config.architecture.database === 'postgres' ? `  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${config.name}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:` : ''}
`;

    await fs.writeFile(path.join(projectPath, 'docker/Dockerfile'), dockerfile);
    await fs.writeFile(path.join(projectPath, 'docker/docker-compose.yml'), dockerCompose);

    return {
      content: [
        {
          type: 'text',
          text: 'Generated Dockerfile and docker-compose.yml',
        },
      ],
    };
  }

  private async generateNextJSConfig(projectPath: string, config: ProjectConfig) {
    const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  output: 'standalone',
  images: {
    domains: ['localhost'],
  },
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
}

module.exports = nextConfig
`;

    let tailwindConfig = '';
    let postcssConfig = '';

    if (config.architecture.styling === 'tailwind') {
      tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
  plugins: [],
}
`;

      postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;
    }

    const tsConfig = `{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "es6"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

    await fs.writeFile(path.join(projectPath, 'next.config.js'), nextConfig);
    await fs.writeFile(path.join(projectPath, 'tsconfig.json'), tsConfig);
    
    if (config.architecture.styling === 'tailwind') {
      await fs.writeFile(path.join(projectPath, 'tailwind.config.js'), tailwindConfig);
      await fs.writeFile(path.join(projectPath, 'postcss.config.js'), postcssConfig);
    }

    return {
      content: [
        {
          type: 'text',
          text: 'Generated Next.js configuration files',
        },
      ],
    };
  }

  private async generateBaseComponents(projectPath: string, config: ProjectConfig) {
    try {
      // Update the existing page.tsx with our custom content
      const pageTsx = `export default function Home() {
  return (
    <main${config.architecture.styling === 'tailwind' ? ' className="min-h-screen flex flex-col items-center justify-center p-8"' : ''}>
      <div${config.architecture.styling === 'tailwind' ? ' className="max-w-4xl mx-auto text-center"' : ''}>
        <h1${config.architecture.styling === 'tailwind' ? ' className="text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"' : ''}>
          Welcome to ${config.name}
        </h1>
        <p${config.architecture.styling === 'tailwind' ? ' className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto"' : ''}>
          ${config.description || 'Your Next.js application is ready! Built with modern tools and best practices.'}
        </p>
        
        <div${config.architecture.styling === 'tailwind' ? ' className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12"' : ''}>
          <div${config.architecture.styling === 'tailwind' ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ''}>
            <h3${config.architecture.styling === 'tailwind' ? ' className="text-lg font-semibold mb-2"' : ''}>🚀 Next.js 15</h3>
            <p${config.architecture.styling === 'tailwind' ? ' className="text-gray-600"' : ''}>
              Built with the latest Next.js features including App Router and Turbopack.
            </p>
          </div>
          
          ${config.architecture.styling === 'tailwind' ? `<div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold mb-2">🎨 Tailwind CSS</h3>
            <p className="text-gray-600">
              Utility-first CSS framework for rapid UI development.
            </p>
          </div>` : ''}
          
          ${config.architecture.typescript ? `<div${config.architecture.styling === 'tailwind' ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ''}>
            <h3${config.architecture.styling === 'tailwind' ? ' className="text-lg font-semibold mb-2"' : ''}>📘 TypeScript</h3>
            <p${config.architecture.styling === 'tailwind' ? ' className="text-gray-600"' : ''}>
              Type-safe development with excellent IDE support.
            </p>
          </div>` : ''}
          
          ${config.architecture.database !== 'none' ? `<div${config.architecture.styling === 'tailwind' ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ''}>
            <h3${config.architecture.styling === 'tailwind' ? ' className="text-lg font-semibold mb-2"' : ''}>🗄️ ${config.architecture.database.charAt(0).toUpperCase() + config.architecture.database.slice(1)}</h3>
            <p${config.architecture.styling === 'tailwind' ? ' className="text-gray-600"' : ''}>
              Database integration ready for your data needs.
            </p>
          </div>` : ''}
          
          ${config.architecture.auth !== 'none' ? `<div${config.architecture.styling === 'tailwind' ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ''}>
            <h3${config.architecture.styling === 'tailwind' ? ' className="text-lg font-semibold mb-2"' : ''}>🔐 Authentication</h3>
            <p${config.architecture.styling === 'tailwind' ? ' className="text-gray-600"' : ''}>
              Secure authentication with ${config.architecture.auth}.
            </p>
          </div>` : ''}
          
          <div${config.architecture.styling === 'tailwind' ? ' className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"' : ''}>
            <h3${config.architecture.styling === 'tailwind' ? ' className="text-lg font-semibold mb-2"' : ''}>🐳 Docker Ready</h3>
            <p${config.architecture.styling === 'tailwind' ? ' className="text-gray-600"' : ''}>
              Containerized for easy deployment to any cloud platform.
            </p>
          </div>
        </div>
        
        <div${config.architecture.styling === 'tailwind' ? ' className="mt-12 flex flex-col sm:flex-row gap-4 justify-center"' : ''}>
          <a 
            href="/api/health"${config.architecture.styling === 'tailwind' ? ' className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"' : ''}
          >
            Test API Route
          </a>
          <a 
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noopener noreferrer"${config.architecture.styling === 'tailwind' ? ' className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"' : ''}
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
      let buttonComponent = '';
      if (config.architecture.styling === 'tailwind') {
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
      await fs.writeFile(path.join(projectPath, 'src/app/page.tsx'), pageTsx);
      await fs.writeFile(path.join(projectPath, 'src/app/api/health/route.ts'), healthApiRoute);
      
      if (buttonComponent) {
        await fs.writeFile(path.join(projectPath, 'src/components/ui/button.tsx'), buttonComponent);
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Updated base components:\n- Enhanced home page with feature showcase\n- Added health check API route\n${buttonComponent ? '- Created reusable Button component\n' : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to generate base components: ${error.message}`,
          },
        ],
      };
    }
  }

  private async setupDatabase(projectPath: string, config: ProjectConfig) {
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

    await fs.writeFile(path.join(projectPath, 'src/lib/db.ts'), dbConfig);

    return {
      content: [
        {
          type: 'text',
          text: `Generated ${config.architecture.database} database configuration`,
        },
      ],
    };
  }

  private async setupAuthentication(projectPath: string, config: ProjectConfig) {
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

    await fs.writeFile(path.join(projectPath, 'src/lib/auth.ts'), authConfig);

    return {
      content: [
        {
          type: 'text',
          text: `Generated ${config.architecture.auth} authentication configuration`,
        },
      ],
    };
  }

  private async generateCICD(projectPath: string, config: ProjectConfig) {
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
    
    ${config.architecture.testing !== 'jest' ? '- name: Run tests\n      run: pnpm test' : ''}
  
  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Deploy to ${config.deployment.platform}
      run: echo "Deploy to ${config.deployment.platform}"
`;

    await fs.writeFile(path.join(projectPath, '.github/workflows/ci.yml'), ciWorkflow);

    return {
      content: [
        {
          type: 'text',
          text: 'Generated CI/CD pipeline configuration',
        },
      ],
    };
  }

  private async installDependencies(projectPath: string, packageManager = 'pnpm') {
    try {
      execSync(`${packageManager} install`, { 
        cwd: projectPath,
        stdio: 'pipe'
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully installed dependencies using ${packageManager}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
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
      await fs.access(path.join(projectPath, 'package.json'));
      validationResults.push('✅ package.json exists');

      // Check if Next.js config exists
      await fs.access(path.join(projectPath, 'next.config.js'));
      validationResults.push('✅ next.config.js exists');

      // Check if TypeScript config exists
      await fs.access(path.join(projectPath, 'tsconfig.json'));
      validationResults.push('✅ tsconfig.json exists');

      // Try to build the project
      execSync('npm run build', { cwd: projectPath, stdio: 'pipe' });
      validationResults.push('✅ Project builds successfully');

    } catch (error) {
      validationResults.push(`❌ Validation failed: ${error.message}`);
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

  private async generateReadme(projectPath: string, config: ProjectConfig) {
    const readme = `# ${config.name}

${config.description || 'A Next.js application'}

## Features

${config.features.map(feature => `- ${feature}`).join('\n')}

## Tech Stack

- **Framework**: Next.js ${config.architecture.appRouter ? '(App Router)' : '(Pages Router)'}
- **Language**: ${config.architecture.typescript ? 'TypeScript' : 'JavaScript'}
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

${config.deployment.platform === 'vercel' ? 
  'The easiest way to deploy is to use the [Vercel Platform](https://vercel.com/new).' :
  `Deploy using your ${config.deployment.platform} workflow.`}

## Scripts

- \`pnpm dev\` - Start development server
- \`pnpm build\` - Build for production
- \`pnpm start\` - Start production server
- \`pnpm lint\` - Run ESLint
- \`pnpm type-check\` - Run TypeScript type checking
${config.architecture.testing !== 'jest' ? '- `pnpm test` - Run tests' : ''}

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
`;

    await fs.writeFile(path.join(projectPath, 'README.md'), readme);

    return {
      content: [
        {
          type: 'text',
          text: 'Generated comprehensive README.md',
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Next.js Scaffolding MCP server running on stdio');
  }
}

const server = new NextMCPServer();
server.run().catch(console.error);