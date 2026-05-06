#!/usr/bin/env node

/** TODO:
 * - Add dark mode toggle
 * - Add side bar or horizontal bar for navigation
 * - Add user profile management
 * - Add organisations support
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, promises as fs, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { adjectives, colors, Config, names, uniqueNamesGenerator } from 'unique-names-generator';
import winston from 'winston';
import { z } from 'zod';

import details from '../package.json' with { type: 'json' };

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup log directory in user's HOME directory
const LOG_DIR = path.join(os.homedir(), '.next-mcp');
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

let logLevel = 'info';
let logFilename = 'next-mcp.log';
if (process.env.NODE_ENV === 'test') {
  logLevel = 'debug';
  logFilename = 'next-mcp-test.log';
}

const logTransportFilename = path.join(LOG_DIR, logFilename);

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

// Prisma configuration constants. The schema-relative `--output` arg is
// computed per-config via {@link getPrismaOutputArg}, and the `.dockerignore`
// path for the generated client is computed per-config via
// {@link getPrismaGeneratedIgnorePath}. No top-level constants are needed.

// Package version constants - centralized version management
const CREATE_NEXT_APP_VERSION = 'create-next-app@^16';
const PACKAGE_VERSIONS = {
  // State Management
  zustand: '^5',
  '@reduxjs/toolkit': '^2',
  'react-redux': '^9',

  // ORM & Database
  '@prisma/client': '^7',
  prisma: '^7',
  'drizzle-orm': '^0.45',
  'drizzle-kit': '^0.31',
  mongoose: '^9',

  // Database Drivers
  pg: '^8',
  '@prisma/adapter-pg': '^7',
  mysql2: '^3',
  mongodb: '^7',
  'better-sqlite3': '^12',
  '@types/better-sqlite3': '^7',

  // UI Libraries
  '@tanstack/react-table': '^8',

  // Authentication
  'better-auth': '^1',

  // Testing - Vitest
  vitest: '^4',
  '@vitejs/plugin-react': '^6',
  '@testing-library/react': '^16',
  '@testing-library/jest-dom': '^6',
  jsdom: '^29',

  // Testing - Jest
  jest: '^30',
  'jest-environment-jsdom': '^30',

  // Testing - Playwright
  '@playwright/test': '^1',

  // Utilities
  dotenv: '^17',
  '@types/node': '^25',
} as const;

export const CATALOG_VERSIONS: Record<string, string> = {
  '@types/node': '^25',
  typescript: '^6',
  eslint: '^10',
  vitest: '^4',
  dotenv: '^17',
  'better-auth': '^1',
  '@better-auth/api-key': '^1',
};

export function getAppPath(config: ProjectConfig, projectPath: string): string {
  return config.architecture.monorepo === 'none'
    ? projectPath
    : path.join(projectPath, 'apps/web');
}

/**
 * Returns true when database sources should be routed into `packages/db`.
 * This mirrors the gate in {@link generateFullModePackages}: only `monorepo: 'full'`
 * with a real ORM emits `packages/db`. For `orm: 'none'` (direct driver), even in
 * full mode, sources fall back to the app directory.
 */
export function shouldRouteToDbPackage(config: ProjectConfig): boolean {
  return config.architecture.monorepo === 'full' && config.architecture.orm !== 'none';
}

/**
 * Resolves the base directory for database sources.
 * - `full + orm`:           `<projectPath>/packages/db`
 * - `minimal` / `none` / `full + orm:none`: app directory (via {@link getAppPath})
 */
export function getDbBaseDir(config: ProjectConfig, projectPath: string): string {
  return shouldRouteToDbPackage(config)
    ? path.join(projectPath, 'packages/db')
    : getAppPath(config, projectPath);
}

/**
 * Resolves the directory where db client/index/schema source files should land.
 * - When routed to `packages/db`: `<base>/src` (the package's own source root)
 * - Otherwise:                    `<base>/src/lib/db`
 */
export function getDbSrcDir(config: ProjectConfig, projectPath: string): string {
  const base = getDbBaseDir(config, projectPath);
  return shouldRouteToDbPackage(config) ? path.join(base, 'src') : path.join(base, 'src/lib/db');
}

/**
 * Returns the value to pass to `prisma init --output`. The path is interpreted
 * by Prisma as **relative to the schema file** (`<dbBase>/prisma/schema.prisma`),
 * so the result must be a sibling of the `prisma/` directory.
 *
 * The endpoints (`<dbBase>/prisma`, `<dbBase>/<dbSrc>/.prisma`) are derived from
 * the same logical shape that {@link getDbSrcDir} uses, so the two helpers can
 * not silently drift if the src-dir layout ever changes. We always use
 * `path.posix` for the final `relative()` so the returned string is stable on
 * Windows hosts (Prisma config and our generated artifacts are POSIX-flavored).
 *
 * - `full + orm`:           `../src/.prisma`        (sits next to packages/db/prisma)
 * - other modes:            `../src/lib/db/.prisma` (preserves legacy layout)
 */
export function getPrismaOutputArg(config: ProjectConfig): string {
  // Anchor both endpoints at a synthetic dbBase so the math is the same shape
  // as the real absolute paths but free of OS-dependent separators. Whatever
  // `getDbSrcDir` decides is the src root, the prisma output sits at
  // `<src>/.prisma`, and the schema lives at `<dbBase>/prisma/`.
  const dbBaseDir = '.';
  const dbSrcDir = shouldRouteToDbPackage(config)
    ? path.posix.join(dbBaseDir, 'src')
    : path.posix.join(dbBaseDir, 'src/lib/db');
  return path.posix.relative(
    path.posix.join(dbBaseDir, 'prisma'),
    path.posix.join(dbSrcDir, '.prisma')
  );
}

/**
 * Returns the project-relative path to the Prisma generated client directory,
 * suitable for appending to a `.dockerignore` file. Always uses POSIX
 * separators so the result is stable on Windows hosts (Docker reads
 * forward-slash paths regardless of the host OS).
 *
 * - `full + orm`:    `packages/db/src/.prisma`
 * - `minimal`:       `apps/web/src/lib/db/.prisma`
 * - `none`:          `src/lib/db/.prisma`
 * - `full + orm:none`: falls back to the app path (no `packages/db` exists)
 */
export function getPrismaGeneratedIgnorePath(config: ProjectConfig): string {
  // Use a synthetic root anchor so we get a relative POSIX path regardless of
  // the caller's actual `projectPath` separators or location.
  const projectRoot = '.';
  const dbBaseDir = shouldRouteToDbPackage(config)
    ? path.posix.join(projectRoot, 'packages/db')
    : config.architecture.monorepo === 'none'
      ? projectRoot
      : path.posix.join(projectRoot, 'apps/web');
  const dbSrcDir = shouldRouteToDbPackage(config)
    ? path.posix.join(dbBaseDir, 'src')
    : path.posix.join(dbBaseDir, 'src/lib/db');
  return path.posix.relative(projectRoot, path.posix.join(dbSrcDir, '.prisma'));
}

/**
 * Returns true when better-auth core sources should be routed into
 * `packages/auth`. This mirrors the gate in {@link generateFullModePackages}
 * (D4): the auth package is only emitted when `monorepo: 'full'`,
 * `auth: 'better-auth'`, a database is configured, AND a real ORM is in use.
 *
 * The `orm !== 'none'` clause is load-bearing: the auth package template
 * hard-codes `@<projectName>/db` as a workspace dep, but `packages/db` is
 * only emitted when an ORM is configured (see Group D's gate). Routing into
 * `packages/auth` without `packages/db` would produce an unresolvable
 * workspace dep and break `pnpm install`. It would also break the
 * better-auth CLI's `--config src/server.ts` path resolution from
 * `apps/web` cwd. For all other shapes (including `full + ba + db +
 * orm:none`), auth files fall back to the app's `src/lib/`.
 */
export function shouldRouteToAuthPackage(config: ProjectConfig): boolean {
  return (
    config.architecture.monorepo === 'full' &&
    config.architecture.auth === 'better-auth' &&
    config.architecture.database !== 'none' &&
    config.architecture.orm !== 'none'
  );
}

/**
 * File paths for the better-auth core sources (`server.ts`, `client.ts`, and
 * the `index.ts` barrel). In `packages/auth` routing, the three files live
 * inside the package's own `src/`. In all other modes, only `serverPath` and
 * `clientPath` are used and they collapse onto the legacy filenames
 * (`<app>/src/lib/auth.ts`, `<app>/src/lib/auth-client.ts`); `indexPath` is
 * `null` because the legacy layout has no barrel.
 *
 * Returning a struct (rather than separate getters) keeps the per-mode
 * branching in one place — callers don't have to know whether they're in
 * routed mode to pick the right filename.
 */
export function getAuthFilePaths(
  config: ProjectConfig,
  projectPath: string
): { serverPath: string; clientPath: string; indexPath: string | null } {
  if (shouldRouteToAuthPackage(config)) {
    const base = path.join(projectPath, 'packages/auth/src');
    return {
      serverPath: path.join(base, 'server.ts'),
      clientPath: path.join(base, 'client.ts'),
      indexPath: path.join(base, 'index.ts'),
    };
  }
  const appPath = getAppPath(config, projectPath);
  return {
    serverPath: path.join(appPath, 'src/lib/auth.ts'),
    clientPath: path.join(appPath, 'src/lib/auth-client.ts'),
    indexPath: null,
  };
}

export function getShadcnRunner(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm dlx';
    case 'yarn':
      return 'yarn dlx';
    case 'bun':
      return 'bunx --bun';
    case 'npm':
    default:
      return 'npx';
  }
}

export function buildShadcnInitCommand(
  packageManager: PackageManager,
  monorepoMode: 'none' | 'minimal' | 'full'
): string {
  const runner = getShadcnRunner(packageManager);
  const monorepoFlag = monorepoMode !== 'none' ? ' --monorepo' : '';
  return `${runner} shadcn@latest init --preset b0 --template next${monorepoFlag} --pointer`;
}

export function substituteProjectName(content: string, projectName: string): string {
  return content.replaceAll('<projectName>', projectName).replaceAll('__PROJECT_NAME__', projectName);
}

type DockerfilePlaceholderValues = {
  __BASE_IMAGE__: string;
  __COREPACK_SETUP__: string;
  __PM_PATH_SETUP__: string;
  __PM__: string;
  __PM_DLX__: string;
  __PM_INSTALL__: string;
  __PM_RUN__: string;
  __LOCKFILE__: string;
  __CACHE_MOUNT__: string;
};

const DOCKERFILE_PM_VALUES: Record<PackageManager, DockerfilePlaceholderValues> = {
  pnpm: {
    __BASE_IMAGE__: 'node:24-alpine',
    __COREPACK_SETUP__: 'corepack enable && corepack prepare pnpm@latest --activate',
    __PM_PATH_SETUP__: 'ENV PNPM_HOME="/pnpm"\nENV PATH="$PNPM_HOME:$PATH"',
    __PM__: 'pnpm',
    __PM_DLX__: 'pnpm dlx',
    __PM_INSTALL__: 'pnpm install --frozen-lockfile',
    __PM_RUN__: 'pnpm',
    __LOCKFILE__: 'pnpm-lock.yaml',
    __CACHE_MOUNT__: '--mount=type=cache,id=pnpm,target=/pnpm/store',
  },
  npm: {
    __BASE_IMAGE__: 'node:24-alpine',
    __COREPACK_SETUP__: 'corepack enable && corepack prepare npm@latest --activate',
    __PM_PATH_SETUP__: '# no extra PATH setup',
    __PM__: 'npm',
    __PM_DLX__: 'npx',
    __PM_INSTALL__: 'npm ci',
    __PM_RUN__: 'npm run',
    __LOCKFILE__: 'package-lock.json',
    __CACHE_MOUNT__: '--mount=type=cache,id=npm,target=/root/.npm',
  },
  yarn: {
    __BASE_IMAGE__: 'node:24-alpine',
    __COREPACK_SETUP__: 'corepack enable && corepack prepare yarn@stable --activate',
    __PM_PATH_SETUP__: '# no extra PATH setup',
    __PM__: 'yarn',
    __PM_DLX__: 'yarn dlx',
    __PM_INSTALL__: 'yarn install --immutable',
    __PM_RUN__: 'yarn',
    __LOCKFILE__: 'yarn.lock',
    __CACHE_MOUNT__: '--mount=type=cache,id=yarn,target=/usr/local/share/.cache/yarn',
  },
  bun: {
    __BASE_IMAGE__: 'oven/bun:1-alpine',
    __COREPACK_SETUP__: 'true',
    __PM_PATH_SETUP__: '# no extra PATH setup',
    __PM__: 'bun',
    __PM_DLX__: 'bunx',
    __PM_INSTALL__: 'bun install --frozen-lockfile',
    __PM_RUN__: 'bun run',
    __LOCKFILE__: 'bun.lockb',
    __CACHE_MOUNT__: '--mount=type=cache,id=bun,target=/root/.bun/install/cache',
  },
};

export function substituteDockerfilePlaceholders(
  template: string,
  packageManager: PackageManager,
  projectName: string
): string {
  const values = DOCKERFILE_PM_VALUES[packageManager];
  // Sort by key length descending so longer placeholders (e.g. __PM_DLX__) are
  // replaced before any shorter prefix (e.g. __PM__) that would otherwise corrupt them.
  const entries = Object.entries(values).sort(([a], [b]) => b.length - a.length);
  let out = template;
  for (const [key, value] of entries) {
    out = out.replaceAll(key, value);
  }
  return substituteProjectName(out, projectName);
}

function assertNoResidualCatalog(value: unknown, pathParts: string[] = []): void {
  if (typeof value === 'string' && value === 'catalog:') {
    throw new Error(
      `Residual "catalog:" reference at ${pathParts.join('.') || '<root>'} not handled by substituteCatalog. Add this section to the substitution loop.`
    );
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      assertNoResidualCatalog(v, [...pathParts, k]);
    }
  }
}

export function substituteCatalog(
  packageJsonContent: string,
  packageManager: PackageManager,
  catalog: Record<string, string>
): string {
  if (packageManager === 'pnpm') return packageJsonContent;

  const pkg = JSON.parse(packageJsonContent);
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (version === 'catalog:') {
        if (!(name in catalog)) {
          throw new Error(`No CATALOG_VERSIONS entry for "${name}" (in ${section})`);
        }
        deps[name] = catalog[name];
      }
    }
  }
  assertNoResidualCatalog(pkg);
  return JSON.stringify(pkg, null, 2) + '\n';
}

// Zod schema for ProjectConfig with validation and defaults
export const ProjectConfigSchema = z
  .object({
    name: z.string().optional().describe('Project name. If not provided, a unique name will be generated automatically.'),
    description: z.string().optional().describe('Project description. Used in package.json and documentation.'),
    architecture: z
      .object({
        typescript: z
          .boolean()
          .default(true)
          .describe('Enable TypeScript. Configures the project with TypeScript support.'),
        reactCompiler: z
          .boolean()
          .default(false)
          .describe('Enable React Compiler. Experimental React compiler for automatic optimization.'),
        skipInstall: z
          .boolean()
          .optional()
          .default(false)
          .describe('Skip npm/pnpm install during setup. Useful for CI/CD or manual dependency management.'),
        packageManager: z
          .enum(['npm', 'pnpm', 'yarn', 'bun'])
          .default('pnpm')
          .describe('Package manager to use. Determines which commands are used for installing dependencies.'),
        database: z
          .enum(['none', 'postgres', 'mysql', 'mongodb', 'sqlite'])
          .default('postgres')
          .describe('Database system. Configures the appropriate database driver and connection.'),
        orm: z
          .enum(['none', 'prisma', 'drizzle', 'mongoose'])
          .default('prisma')
          .describe('ORM/database toolkit. Sets up the chosen ORM with appropriate configurations.'),
        auth: z
          .enum(['none', 'better-auth'])
          .default('better-auth')
          .describe('Authentication system. Configures authentication with the selected provider.'),
        uiLibrary: z
          .enum(['none', 'shadcn'])
          .default('shadcn')
          .describe('UI component library. Installs and configures the selected UI library.'),
        stateManagement: z
          .enum(['none', 'zustand', 'redux'])
          .default('none')
          .describe('State management solution. Sets up global state management with the chosen library.'),
        testing: z
          .enum(['none', 'jest', 'vitest', 'playwright'])
          .default('none')
          .describe('Testing framework. Configures unit/integration testing or E2E testing setup.'),
        monorepo: z
          .enum(['none', 'minimal', 'full'])
          .default('none')
          .describe('Monorepo layout. `none` = flat project. `minimal` = workspaces + Turborepo with apps/web. `full` = minimal plus opinionated shared packages.'),
        rpc: z
          .enum(['none', 'orpc'])
          .default('none')
          .describe('RPC layer. `orpc` requires `monorepo === \'full\'` (emits packages/orpc).'),
      })
      .describe('Project architecture configuration. Defines the technology stack and features.'),
  })
  .refine(
    (cfg) => !(cfg.architecture.rpc === 'orpc' && cfg.architecture.monorepo !== 'full'),
    { message: 'rpc: "orpc" requires monorepo: "full"' }
  );

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export type PackageManager = NonNullable<ProjectConfig['architecture']['packageManager']>;

/**
 * Describes a single alias-to-package import rewrite for the codebase walker.
 * `preserveSubpath: true` keeps any `<alias>/<sub>` suffix intact (used for
 * the db case, where `@/lib/db/<sub>` maps to `<pkg>/<sub>`).
 * `preserveSubpath: false` matches the alias exactly with no trailing path
 * (used for `@/lib/auth` and `@/lib/auth-client`, which are single-file
 * aliases — any `/<sub>` form would already be invalid in the legacy layout).
 */
type ImportRewriteMapping = {
  alias: string;
  replacement: string;
  preserveSubpath: boolean;
};

const ORM_PACKAGE_SUBDIR: Partial<Record<NonNullable<ProjectConfig['architecture']['orm']>, string>> = {
  prisma: 'db/prisma',
  drizzle: 'db/drizzle',
  mongoose: 'db/mongoose',
};

const inputSchemaJson = z.toJSONSchema(
  z.object({
    config: ProjectConfigSchema,
    projectPath: z.string().describe('Path to the project directory'),
  })
);

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
          inputSchema: z.toJSONSchema(
            z.object({
              config: ProjectConfigSchema,
              targetPath: z.string().describe('Target directory path, usually the current working directory'),
            })
          ),
        },
        {
          name: 'generate_dockerfile',
          description: 'Generate Dockerfile and docker-compose.yml',
          inputSchema: inputSchemaJson,
        },
        {
          name: 'setup_shadcn',
          description: 'Initialize shadcn/ui with defaults and install all components',
          inputSchema: inputSchemaJson,
        },
        {
          name: 'generate_base_components',
          description: 'Generate base React components and layouts',
          inputSchema: inputSchemaJson,
        },
        {
          name: 'setup_database',
          description: 'Generate database configuration and migrations',
          inputSchema: inputSchemaJson,
        },
        {
          name: 'setup_authentication',
          description: 'Configure authentication system',
          inputSchema: inputSchemaJson,
        },
        {
          name: 'validate_project',
          description: 'Run validation checks on the generated project',
          inputSchema: inputSchemaJson,
        },
        {
          name: 'generate_readme',
          description: 'Generate comprehensive README.md',
          inputSchema: inputSchemaJson,
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
        const validatedConfig = this.validateAndApplyDefaults(args.config);
        if (!validatedConfig) {
          throw new Error('Config validation failed');
        }

        switch (name) {
          case 'scaffold_project':
            return await this.scaffoldProject(validatedConfig, args.targetPath as string);
          case 'generate_base_components':
            return await this.generateBaseComponents(validatedConfig, args.projectPath as string);
          case 'generate_dockerfile':
            return await this.generateDockerfile(validatedConfig, args.projectPath as string);
          case 'setup_shadcn':
            return await this.setupShadcn(validatedConfig, args.projectPath as string);
          case 'setup_database':
            return await this.setupDatabase(validatedConfig, args.projectPath as string);
          case 'setup_authentication':
            return await this.setupAuthentication(validatedConfig, args.projectPath as string);
          case 'validate_project':
            return await this.validateProject(validatedConfig, args.projectPath as string);
          case 'generate_readme':
            return await this.generateReadme(validatedConfig, args.projectPath as string);
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

  /**
   * Validates and applies defaults to the project config using Zod schema
   */
  private validateAndApplyDefaults(config: unknown): ProjectConfig {
    // Parse and validate the config, applying defaults from the schema
    const validated = ProjectConfigSchema.parse(config);

    // Apply name default if not provided (using unique name generator)
    return {
      ...validated,
      name: validated.name ?? `${uniqueNamesGenerator(uniqueNamesGeneratorConfig)}-app`,
      description: validated.description ?? 'A Next.js application scaffolded with an AI Agent MCP',
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

    // Test-only short-circuit: when NEXT_MCP_RECORD_COMMANDS points at a
    // file, append a JSON record per call instead of spawning a real shell.
    // This lets integration tests assert what *would* have been executed
    // (e.g. shadcn-registry add URLs and cwd) without waiting on network or
    // package-manager I/O. Production code paths never set this var.
    const recordPath = process.env.NEXT_MCP_RECORD_COMMANDS;
    if (recordPath) {
      try {
        // Synchronous append keeps ordering stable across the pipeline.
        const record = JSON.stringify({ command, cwd: projectPath, label: commandLabel }) + '\n';
        appendFileSync(recordPath, record);
      } catch (err) {
        logger.warn(`Failed to record command to ${recordPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { success: true, output: '' };
    }

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
    try {
      const projectPath = path.join(targetPath, config.name!);
      const isMonorepo = config.architecture.monorepo !== 'none';
      const appPath = getAppPath(config, projectPath);

      // Build create-next-app command based on configuration
      // For monorepo, create-next-app produces <projectPath>/apps/web; for flat,
      // it produces <projectPath>/<projectName>.
      const createCommand = isMonorepo
        ? this.buildCreateNextAppCommand(config, './web')
        : this.buildCreateNextAppCommand(config);

      // For monorepo, ensure apps/ exists before running create-next-app there.
      const createCwd = isMonorepo ? path.join(projectPath, 'apps') : targetPath;
      if (isMonorepo) {
        await fs.mkdir(createCwd, { recursive: true });
      }

      // Run create-next-app
      const result = this.execCommand(createCommand, createCwd, 'create-next-app');
      if (!result.success) {
        throw new Error('[create-next-app failed]: Check logs for details');
      }

      const stdout = result.output || '';
      logger.info(`create-next-app completed successfully: ${stdout}`);

      // Verify the app directory was created
      await fs.access(appPath);

      if (isMonorepo) {
        await this.renameAppPackage(appPath, config.name!);
        // Note: apps/web/next.config.ts is generated by generateNextJSCustomCode
        // (below) from next.config.template, which already contains
        // output: 'standalone'. No need for a separate inject step.
        await this.ensureEnvExample(appPath);
        await this.scaffoldMonorepoRoot(config, projectPath);
        await this.generateFullModePackages(config, projectPath);
      }

      // Post-process .gitignore to exclude .env.ci from being ignored (per-app)
      await this.updateGitignore(appPath);

      // Per-app file ops always operate on the app directory.
      await this.createDirectoryStructure(config, appPath);
      await this.updatePackageJson(config, appPath);
      await this.generateNextJSCustomCode(appPath);

      if (!config.architecture.skipInstall) {
        logger.info('Install not skipped: Installing dependencies as part of project scaffolding');
        await this.installDependencies(config, projectPath);
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully created Next.js project at ${projectPath}\n\n[Configuration]:\n${JSON.stringify(config, null, 2)}\n\n[Command executed]: ${createCommand}\n\n[Output]:\n${stdout}`,
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

  private async updateGitignore(projectPath: string) {
    const gitignorePath = path.join(projectPath, '.gitignore');
    try {
      let content = await fs.readFile(gitignorePath, 'utf-8');

      // Check if .env.ci exclusion already exists
      if (!content.includes('!.env.ci')) {
        // Add exclusion for .env.ci after .env* pattern
        content = content.replace(/^(\.env\*)$/m, '$1\n!.env.ci');
        await fs.writeFile(gitignorePath, content);
        logger.info('Updated .gitignore to exclude .env.ci from being ignored');
      }
    } catch (error) {
      logger.warn(`Could not update .gitignore: ${error}`);
    }
  }

  private async renameAppPackage(appPath: string, projectName: string): Promise<void> {
    const pkgPath = path.join(appPath, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    pkg.name = `@${projectName}/web`;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  private async ensureEnvExample(appPath: string): Promise<void> {
    const p = path.join(appPath, '.env.example');
    try {
      await fs.access(p);
      return; // already exists
    } catch {
      await fs.writeFile(p, '# Example environment variables — copy to .env.local and fill in.\n');
    }
  }

  private async scaffoldMonorepoRoot(config: ProjectConfig, projectPath: string): Promise<void> {
    const projectName = config.name!;
    const description = config.description || '';
    const pm = config.architecture.packageManager;

    const templatesDir = path.join(__dirname, 'templates');

    // 1. Root package.json
    const pkgTpl = await fs.readFile(path.join(templatesDir, 'package.json.template'), 'utf-8');
    let rootPkgRaw = pkgTpl
      .replaceAll('<projectName>', projectName)
      .replaceAll('<description>', description);

    // For non-pnpm, substitute catalog: references (pnpm uses pnpm-workspace.yaml catalog).
    rootPkgRaw = substituteCatalog(rootPkgRaw, pm, CATALOG_VERSIONS);

    if (pm !== 'pnpm') {
      const parsed = JSON.parse(rootPkgRaw);
      parsed.workspaces = ['apps/*', 'packages/*'];
      rootPkgRaw = JSON.stringify(parsed, null, 2) + '\n';
    } else {
      const parsed = JSON.parse(rootPkgRaw);
      // The `packageManager` field requires a fully pinned semver — Corepack
      // rejects shorthand like `pnpm@10` ("Invalid package manager
      // specification ... expected a semver version"). Pin to a known-good
      // minor; pnpm 10.0.0 has a workspace regression that breaks `pnpm dlx`
      // from inside a child workspace package, so we steer clear of the first
      // 10.x release.
      parsed.packageManager = 'pnpm@10.18.0';
      parsed.engines = { ...(parsed.engines || { node: '>=24' }), pnpm: '>=10' };
      rootPkgRaw = JSON.stringify(parsed, null, 2) + '\n';
    }

    await fs.writeFile(path.join(projectPath, 'package.json'), rootPkgRaw);

    // 2. tsconfig.json
    const tsTpl = await fs.readFile(path.join(templatesDir, 'tsconfig.json.template'), 'utf-8');
    await fs.writeFile(path.join(projectPath, 'tsconfig.json'), tsTpl);

    // 3. turbo.json
    const turboTpl = await fs.readFile(path.join(templatesDir, 'turbo.json.template'), 'utf-8');
    await fs.writeFile(path.join(projectPath, 'turbo.json'), turboTpl);

    // 4. .gitignore at workspace root
    const giTpl = await fs.readFile(path.join(templatesDir, '.gitignore.template'), 'utf-8');
    await fs.writeFile(path.join(projectPath, '.gitignore'), giTpl);

    // 5. pnpm-workspace.yaml — only for pnpm
    if (pm === 'pnpm') {
      const workspaceTpl = await fs.readFile(
        path.join(templatesDir, 'pnpm-workspace.yaml.template'),
        'utf-8'
      );
      await fs.writeFile(path.join(projectPath, 'pnpm-workspace.yaml'), workspaceTpl);
    }
  }

  /**
   * Recursively copy a directory of templates into a destination, applying:
   *   - substituteProjectName to file contents that came from .template files
   *   - substituteCatalog to package.json files (when not pnpm)
   *   - .template suffix removal on output filenames
   * Files without a .template suffix (e.g. base.json, next.js) are copied verbatim.
   */
  private async copyTemplateTree(
    srcDir: string,
    destDir: string,
    projectName: string,
    packageManager: PackageManager
  ): Promise<void> {
    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destName = entry.name.replace(/\.template$/, '');
      const destPath = path.join(destDir, destName);

      if (entry.isDirectory()) {
        await this.copyTemplateTree(srcPath, destPath, projectName, packageManager);
        continue;
      }

      let content = await fs.readFile(srcPath, 'utf-8');
      content = substituteProjectName(content, projectName);

      // Catalog substitution applies only to actual package.json files.
      if (destName === 'package.json') {
        content = substituteCatalog(content, packageManager, CATALOG_VERSIONS);
      }

      await fs.writeFile(destPath, content);
    }
  }

  /**
   * Copy one always-on or conditional package from templates/packages/<srcSubdir>
   * into <projectPath>/packages/<pkgName>.
   *
   * For db ORM variants (`db/prisma`, `db/drizzle`, `db/mongoose`), also copies
   * the shared `db/tsconfig.json.template` and `db/eslint.config.mjs.template`
   * sibling files into the destination.
   */
  private async copyPackageTemplate(
    config: ProjectConfig,
    projectPath: string,
    pkgName: string,
    srcSubdir = pkgName
  ): Promise<void> {
    const templatesRoot = path.join(__dirname, 'templates/packages');
    const srcDir = path.join(templatesRoot, srcSubdir);
    const destDir = path.join(projectPath, 'packages', pkgName);
    const projectName = config.name!;
    const pm = config.architecture.packageManager;

    await this.copyTemplateTree(srcDir, destDir, projectName, pm);

    // Special handling for db ORM variants: also copy shared sibling files
    // from packages/db/ that aren't inside the ORM-specific subdir.
    if (srcSubdir.startsWith('db/')) {
      const sharedFiles = ['tsconfig.json.template', 'eslint.config.mjs.template'];
      for (const f of sharedFiles) {
        const src = path.join(templatesRoot, 'db', f);
        const dest = path.join(destDir, f.replace(/\.template$/, ''));
        let content = await fs.readFile(src, 'utf-8');
        content = substituteProjectName(content, projectName);
        await fs.writeFile(dest, content);
      }
    }
  }

  /**
   * Generate all packages/* for monorepo:'full' mode.
   * Always emits eslint-config + typescript-config.
   * Conditionally emits db/auth/ui/orpc based on other config fields.
   */
  private async generateFullModePackages(
    config: ProjectConfig,
    projectPath: string
  ): Promise<void> {
    if (config.architecture.monorepo !== 'full') return;

    // Always-on
    await this.copyPackageTemplate(config, projectPath, 'eslint-config');
    await this.copyPackageTemplate(config, projectPath, 'typescript-config');

    const { database, orm, auth, uiLibrary, rpc } = config.architecture;

    // db (D3)
    if (database !== 'none' && orm !== 'none') {
      const subdir = ORM_PACKAGE_SUBDIR[orm];
      if (!subdir) throw new Error(`No packages/db template subdir for orm: ${orm}`);
      await this.copyPackageTemplate(config, projectPath, 'db', subdir);
    }

    // auth (D4)
    // Gate must match `shouldRouteToAuthPackage`: the auth template hard-codes
    // `@<projectName>/db: workspace:*` so we only emit `packages/auth` when
    // `packages/db` will also be emitted (i.e. `orm !== 'none'`). For
    // `full + ba + db + orm:none` the auth files stay in `apps/web/src/lib`.
    if (auth === 'better-auth' && database !== 'none' && orm !== 'none') {
      await this.copyPackageTemplate(config, projectPath, 'auth');
    }

    // ui (D5)
    if (uiLibrary === 'shadcn') {
      await this.copyPackageTemplate(config, projectPath, 'ui');
    }

    // orpc (D6)
    if (rpc === 'orpc') {
      await this.copyPackageTemplate(config, projectPath, 'orpc');
    }
  }

  private buildCreateNextAppCommand(config: ProjectConfig, appDirName = `./${config.name}`): string {
    const packageRunner = this.getPackageRunnerDlx(config.architecture.packageManager);
    const flags = [`${packageRunner} ${CREATE_NEXT_APP_VERSION}`, appDirName];
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

  private async createDirectoryStructure(config: ProjectConfig, appPath: string) {
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
        await fs.mkdir(path.join(appPath, dir), { recursive: true });
      } catch (error) {
        // Directory might already exist, continue
        logger.error(`Note: Directory ${dir} might already exist`, error);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Created ${additionalDirectories.length} additional directories and structure`,
        },
      ],
    };
  }

  private async updatePackageJson(config: ProjectConfig, appPath: string) {
    try {
      // Read the existing package.json created by create-next-app
      const packageJsonPath = path.join(appPath, 'package.json');
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
      }

      // Database + ORM
      if (config.architecture.orm === 'prisma') {
        additionalDeps.pg = PACKAGE_VERSIONS.pg;
        additionalDeps['@prisma/adapter-pg'] = PACKAGE_VERSIONS['@prisma/adapter-pg'];
        additionalDeps['@prisma/client'] = PACKAGE_VERSIONS['@prisma/client'];
        additionalDeps.dotenv = PACKAGE_VERSIONS.dotenv;
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
      await fs.writeFile(packageJsonPath, JSON.stringify(existingPackageJson, null, 2) + '\n');

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
      // Pick template based on monorepo flag. The monorepo template uses the
      // `turbo prune` workflow and is templated for all four package managers
      // via {@link substituteDockerfilePlaceholders}; the flat template is
      // hardcoded for the legacy single-package layout.
      const isMonorepo = config.architecture.monorepo !== 'none';
      const templateName = isMonorepo ? 'Dockerfile.monorepo' : 'Dockerfile';
      let dockerfileTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'docker', templateName),
        'utf-8'
      );
      if (isMonorepo) {
        dockerfileTemplate = substituteDockerfilePlaceholders(
          dockerfileTemplate,
          config.architecture.packageManager,
          config.name!
        );
      }
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
      let databaseUrl = '';
      let prismaCommand = '';
      let prismaVolumes = '';
      let migrateService = '';

      // Add Prisma migration command if using Prisma. In monorepo mode the
      // standalone runtime image is self-contained (Prisma client + engines
      // are bundled by `turbo build`) and the schema lives at
      // `packages/db/prisma/` (or `apps/web/.../prisma/` for minimal) — neither
      // matches the legacy `./prisma:/app/prisma` host paths or the bare
      // `prisma migrate deploy` cwd assumption. We defer migrations to the
      // explicit `migrate` service in those modes; the web service runs
      // `node server.js` directly via the image's CMD.
      if (config.architecture.orm === 'prisma' && !isMonorepo) {
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
            databaseUrl = `postgresql://postgres:postgres@db:5432/${config.name}`;
            databaseEnv = `- DATABASE_URL=${databaseUrl}`;
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
            databaseUrl = `mysql://mysql:mysql@db:3306/${config.name}`;
            databaseEnv = `- DATABASE_URL=${databaseUrl}`;
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
            databaseUrl = `mongodb://db:27017/${config.name}`;
            databaseEnv = `- DATABASE_URL=${databaseUrl}`;
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
            databaseUrl = `file:/app/data/${config.name}.db`;
            databaseEnv = `- DATABASE_URL=${databaseUrl}`;
            volumesSection = `volumes:
  sqlite_data:`;
            break;
        }

        // Generate migrate service if using Prisma with a database
        if (config.architecture.orm === 'prisma') {
          migrateService = `  migrate:
    build:
      context: .
      dockerfile: Dockerfile.migrate
    environment:
      - DATABASE_URL=${databaseUrl}
    depends_on:
      db:
        condition: service_healthy`;
        }
      }

      // Replace template placeholders
      const dockerCompose = dockerComposeTemplate
        .replace('__DATABASE_DEPENDS_ON__', databaseDependsOn)
        .replace('__DATABASE_SERVICE__', databaseService)
        .replace('__MIGRATE_SERVICE__', migrateService)
        .replace('__VOLUMES_SECTION__', volumesSection)
        .replace('__DATABASE_ENV__', databaseEnv)
        .replace('__PRISMA_COMMAND__', prismaCommand)
        .replace('__PRISMA_VOLUMES__', prismaVolumes);

      await fs.writeFile(path.join(projectPath, 'Dockerfile'), dockerfileTemplate);

      // Add Prisma generated folder to .dockerignore if ORM is Prisma. The
      // exact path varies by monorepo mode — see {@link getPrismaGeneratedIgnorePath}.
      let finalDockerignore = dockerignoreTemplate;
      if (config.architecture.orm === 'prisma') {
        const prismaGeneratedDir = getPrismaGeneratedIgnorePath(config);
        if (!finalDockerignore.includes(prismaGeneratedDir)) {
          finalDockerignore += `\n# Prisma generated client\n${prismaGeneratedDir}\n`;
          logger.info('Added Prisma generated folder to .dockerignore', { prismaGeneratedDir });
        }
      }
      await fs.writeFile(path.join(projectPath, '.dockerignore'), finalDockerignore);
      await fs.writeFile(path.join(projectPath, 'docker-compose.yml'), dockerCompose);

      // Copy Dockerfile.migrate if using Prisma with a database
      let migrateDockerfileMessage = '';
      if (config.architecture.orm === 'prisma' && config.architecture.database !== 'none') {
        const dockerfileMigrateTemplate = await fs.readFile(
          path.join(__dirname, 'templates', 'docker', 'Dockerfile.migrate'),
          'utf-8'
        );
        await fs.writeFile(path.join(projectPath, 'Dockerfile.migrate'), dockerfileMigrateTemplate);
        migrateDockerfileMessage = '\n- Dockerfile.migrate for running Prisma migrations';
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Generated Docker configuration:\n- Dockerfile (from template)\n- docker-compose.yml with ${config.architecture.database} database setup${migrateDockerfileMessage}`,
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

  private async generateNextJSCustomCode(appPath: string) {
    try {
      const customDirs = ['src/app/privacy', 'src/app/terms'];

      for (const dir of customDirs) {
        await fs.mkdir(path.join(appPath, dir), { recursive: true });
      }

      // Read template files
      // Define template-to-destination mappings
      const templateMappings = [
        { template: '.env.ci.template', destination: '.env.ci' },
        { template: 'next.config.template', destination: 'next.config.ts' },
        { template: 'privacy-page.tsx.template', destination: path.join('src', 'app', 'privacy', 'page.tsx') },
        { template: 'terms-page.tsx.template', destination: path.join('src', 'app', 'terms', 'page.tsx') },
      ];

      // Read and write all template files in parallel
      await Promise.all(
        templateMappings.map(async ({ template, destination }) => {
          const content = await fs.readFile(path.join(__dirname, 'templates', template), 'utf-8');
          await fs.writeFile(path.join(appPath, destination), content);
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
      const monorepoMode = config.architecture.monorepo;
      const shadcnInitCommand = buildShadcnInitCommand(packageManager, monorepoMode);
      const shadcnRunner = getShadcnRunner(packageManager);
      const shadcnAddAllCommand = `${shadcnRunner} shadcn@latest add --all -y -o`;
      const appPath = getAppPath(config, projectPath);
      const results: string[] = [];
      logger.info(`Initializing shadcn/ui with ${packageManager}...`);

      if (config.architecture.skipInstall) {
        results.push(`⚠️  Skipped installation of shadcn/ui components due to skipInstall flag`);
        return {
          content: [
            {
              type: 'text',
              text: results.join('\n'),
            },
          ],
        };
      }

      // Step 1: Initialize shadcn/ui with default configuration
      try {
        const result = this.execCommand(shadcnInitCommand, appPath, 'shadcn init (apps/web)');

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
        const result = this.execCommand(shadcnAddAllCommand, appPath, 'shadcn add all (apps/web)');

        if (!result.success) {
          throw new Error('[shadcn init failed]: Check logs for details');
        }

        results.push(`✅ Successfully installed all shadcn/ui components`);
        logger.info(`shadcn/ui add all components executed successfully`);

        // Step 3: When full + shadcn, also run init+add against packages/ui
        if (config.architecture.monorepo === 'full' && config.architecture.uiLibrary === 'shadcn') {
          const uiCwd = path.join(projectPath, 'packages/ui');
          const uiInitResult = this.execCommand(shadcnInitCommand, uiCwd, 'shadcn init (packages/ui)');
          if (!uiInitResult.success) {
            throw new Error('[shadcn init (packages/ui) failed]: Check logs for details');
          }
          const uiAddResult = this.execCommand(shadcnAddAllCommand, uiCwd, 'shadcn add all (packages/ui)');
          if (!uiAddResult.success) {
            throw new Error('[shadcn add all (packages/ui) failed]: Check logs for details');
          }
          results.push(`✅ Successfully installed shadcn/ui components in packages/ui`);
        }

        const globalsCssPath = path.join(appPath, 'src/app/globals.css');
        let globalsCss = await fs.readFile(globalsCssPath, 'utf-8');

        if (!globalsCss.includes('--chart-1: oklch(0.646 0.222 41.116)')) {
          globalsCss = `${globalsCss}\n@layer base {\n  :root {\n    --chart-1: oklch(0.646 0.222 41.116);\n    --chart-2: oklch(0.6 0.118 184.704);\n    --chart-3: oklch(0.398 0.07 227.392);\n    --chart-4: oklch(0.828 0.189 84.429);\n    --chart-5: oklch(0.769 0.188 70.08);\n  }\n\n  .dark {\n    --chart-1: oklch(0.488 0.243 264.376);\n    --chart-2: oklch(0.696 0.17 162.48);\n    --chart-3: oklch(0.769 0.188 70.08);\n    --chart-4: oklch(0.627 0.265 303.9);\n    --chart-5: oklch(0.645 0.246 16.439);\n  }\n}`;
        }

        if (!globalsCss.includes('--sidebar: oklch(0.985 0 0);')) {
          globalsCss = `${globalsCss}\n@layer base {\n  :root {\n    --sidebar: oklch(0.985 0 0);\n    --sidebar-foreground: oklch(0.145 0 0);\n    --sidebar-primary: oklch(0.205 0 0);\n    --sidebar-primary-foreground: oklch(0.985 0 0);\n    --sidebar-accent: oklch(0.97 0 0);\n    --sidebar-accent-foreground: oklch(0.205 0 0);\n    --sidebar-border: oklch(0.922 0 0);\n    --sidebar-ring: oklch(0.708 0 0);\n  }\n\n  .dark {\n    --sidebar: oklch(0.205 0 0);\n    --sidebar-foreground: oklch(0.985 0 0);\n    --sidebar-primary: oklch(0.488 0.243 264.376);\n    --sidebar-primary-foreground: oklch(0.985 0 0);\n    --sidebar-accent: oklch(0.269 0 0);\n    --sidebar-accent-foreground: oklch(0.985 0 0);\n    --sidebar-border: oklch(1 0 0 / 10%);\n    --sidebar-ring: oklch(0.439 0 0);\n  }\n}`;
        }

        await fs.writeFile(globalsCssPath, globalsCss);

        const layoutPath = path.join(appPath, 'src/app/layout.tsx');
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
import * as schema from './schema';`;
        connectionCode = `const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });`;
        break;

      case 'mysql':
        driverImport = `import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';`;
        connectionCode = `const poolConnection = mysql.createPool({ uri: connectionString });

export const db = drizzle(poolConnection, { schema, mode: 'default' });`;
        break;

      case 'sqlite':
        driverImport = `import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';`;
        connectionCode = `const sqlite = new Database('dev.db');

export const db = drizzle(sqlite, { schema });`;
        break;

      default:
        driverImport = `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';`;
        connectionCode = `const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });`;
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
      // Resolve where db assets should land based on monorepo mode + orm.
      const dbBaseDir = getDbBaseDir(config, projectPath);
      const dbSrcDir = getDbSrcDir(config, projectPath);

      const dbDirs: string[] = [dbSrcDir];
      if (orm === 'drizzle') {
        dbDirs.push(path.join(dbBaseDir, 'drizzle/migrations'));
      } else if (orm === 'mongoose') {
        dbDirs.push(path.join(dbSrcDir, 'models'));
      }

      for (const dir of dbDirs) {
        await fs.mkdir(dir, { recursive: true });
      }

      const databaseUrl = this.getDatabaseUrl(config);
      const envEntry = `DATABASE_URL="${databaseUrl}"`;

      // .env* files always live at the workspace root (projectPath) — that is the
      // project root in `none` mode and the monorepo root in `minimal`/`full` modes.
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
        await this.setupPrisma(config, dbBaseDir, dbSrcDir);
      } else if (orm === 'drizzle') {
        await this.setupDrizzle(config, dbBaseDir, dbSrcDir);
      } else if (orm === 'mongoose') {
        await this.setupMongoose(dbSrcDir);
      } else {
        await this.setupDirectDriver(config, dbSrcDir);
      }

      // In `full` mode with packages/db routing, wire apps/web to depend on it
      // and rewrite any pre-existing `@/lib/db` imports in apps/web sources.
      // We capture the resolved package name so the user-facing instructions
      // can quote the exact import specifier that was wired.
      let dbPkgName: string | undefined;
      if (shouldRouteToDbPackage(config)) {
        dbPkgName = await this.wireAppsWebToDbPackage(config, projectPath);
      }

      // Generate success message with instructions
      const instructions = this.generateDatabaseInstructions(config, dbPkgName);
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

  private async setupPrisma(
    config: ProjectConfig,
    dbBaseDir: string,
    dbSrcDir: string
  ): Promise<void> {
    const database = config.architecture.database;
    const packageRunner = config.architecture.skipInstall
      ? this.getPackageRunnerDlx(config.architecture.packageManager)
      : this.getPackageRunner(config.architecture.packageManager);
    const provider = this.getPrismaProvider(database);
    const prismaOutputArg = getPrismaOutputArg(config);

    // `prisma init` writes `prisma/schema.prisma` relative to its cwd. To land
    // schema files in the right place per monorepo mode, run it inside dbBaseDir.
    if (!existsSync(path.join(dbBaseDir, 'prisma', 'schema.prisma'))) {
      const prismaInitCmd = `${packageRunner} prisma init --datasource-provider ${provider} --generator-provider prisma-client --output ${prismaOutputArg}`;
      const result = this.execCommand(prismaInitCmd, dbBaseDir, 'prisma init');

      if (!result.success) {
        throw new Error('[prisma init failed]: Check logs for details');
      }
    } else {
      logger.info('[prisma init skipped]: Prisma schema already exists, skipping prisma init');
    }

    // Modify prisma.config.ts if it exists (located alongside schema in dbBaseDir)
    const prismaConfigPath = path.join(dbBaseDir, 'prisma.config.ts');
    if (existsSync(prismaConfigPath)) {
      const prismaConfigContent = await fs.readFile(prismaConfigPath, 'utf-8');
      const dotenvImport = `import dotenv from 'dotenv';\ndotenv.config();\n\n`;

      // Add dotenv import at the top if it doesn't already exist
      if (!prismaConfigContent.includes('dotenv')) {
        await fs.writeFile(prismaConfigPath, dotenvImport + prismaConfigContent);
        logger.info('[prisma.config.ts modified]: Added dotenv configuration');
      }
    }

    // Copy client template
    const clientTemplatePath = path.join(__dirname, 'templates/database/prisma/client.ts.template');
    const clientTemplate = await fs.readFile(clientTemplatePath, 'utf-8');
    const clientPath = path.join(dbSrcDir, 'client.ts');
    await fs.writeFile(clientPath, clientTemplate);

    // Copy index template
    const indexTemplatePath = path.join(__dirname, 'templates/database/prisma/index.ts.template');
    const indexTemplate = await fs.readFile(indexTemplatePath, 'utf-8');
    const indexPath = path.join(dbSrcDir, 'index.ts');
    await fs.writeFile(indexPath, indexTemplate);

    // Run prisma generate to create the Prisma client if not skipped
    if (!config.architecture.skipInstall) {
      const prismaGenerateCmd = `${packageRunner} prisma generate`;
      const result = this.execCommand(prismaGenerateCmd, dbBaseDir, 'prisma generate');

      if (!result.success) {
        throw new Error('[prisma generate failed]: Check logs for details');
      }
    }
  }

  private async setupDrizzle(
    config: ProjectConfig,
    dbBaseDir: string,
    dbSrcDir: string
  ): Promise<void> {
    const database = config.architecture.database;

    // Read and process drizzle config template
    const configTemplatePath = path.join(__dirname, 'templates/database/drizzle/drizzle.config.ts.template');
    let configTemplate = await fs.readFile(configTemplatePath, 'utf-8');

    // Schema path is interpreted relative to drizzle.config.ts. In `full + orm`
    // routing, the config sits at `packages/db/drizzle.config.ts` and the schema
    // at `packages/db/src/schema.ts`. In other modes, both live under
    // `<app>/src/lib/db/`. Compute the right path so drizzle-kit can find the
    // schema at runtime.
    const drizzleSchemaPath = shouldRouteToDbPackage(config)
      ? './src/schema.ts'
      : './src/lib/db/schema.ts';

    configTemplate = configTemplate
      .replace(/__DIALECT__/g, this.getDrizzleDialect(database))
      .replace(/__DB_CREDENTIALS__/g, this.getDrizzleCredentials(database))
      .replace(/__SCHEMA_PATH__/g, drizzleSchemaPath);

    const configPath = path.join(dbBaseDir, 'drizzle.config.ts');
    await fs.writeFile(configPath, configTemplate);

    // Read and process schema template
    const schemaTemplatePath = path.join(__dirname, 'templates/database/drizzle/schema.ts.template');
    let schemaTemplate = await fs.readFile(schemaTemplatePath, 'utf-8');

    schemaTemplate = this.generateDrizzleSchemaImports(database, schemaTemplate);

    const schemaPath = path.join(dbSrcDir, 'schema.ts');
    await fs.writeFile(schemaPath, schemaTemplate);

    // Read and process client template
    const clientTemplatePath = path.join(__dirname, 'templates/database/drizzle/client.ts.template');
    let clientTemplate = await fs.readFile(clientTemplatePath, 'utf-8');

    clientTemplate = this.generateDrizzleClient(database, clientTemplate);

    const clientPath = path.join(dbSrcDir, 'client.ts');
    await fs.writeFile(clientPath, clientTemplate);

    // Copy index template
    const indexTemplatePath = path.join(__dirname, 'templates/database/drizzle/index.ts.template');
    const indexTemplate = await fs.readFile(indexTemplatePath, 'utf-8');

    const indexPath = path.join(dbSrcDir, 'index.ts');
    await fs.writeFile(indexPath, indexTemplate);
  }

  private async setupMongoose(dbSrcDir: string): Promise<void> {
    // Copy connection template
    const connectionTemplatePath = path.join(__dirname, 'templates/database/mongoose/connection.ts.template');
    const connectionTemplate = await fs.readFile(connectionTemplatePath, 'utf-8');

    const connectionPath = path.join(dbSrcDir, 'connection.ts');
    await fs.writeFile(connectionPath, connectionTemplate);

    // Create models directory with .gitkeep
    const modelsDir = path.join(dbSrcDir, 'models');
    await fs.mkdir(modelsDir, { recursive: true });
    await fs.writeFile(path.join(modelsDir, '.gitkeep'), '');

    // Copy index template
    const indexTemplatePath = path.join(__dirname, 'templates/database/mongoose/index.ts.template');
    const indexTemplate = await fs.readFile(indexTemplatePath, 'utf-8');

    const indexPath = path.join(dbSrcDir, 'index.ts');
    await fs.writeFile(indexPath, indexTemplate);
  }

  private async setupDirectDriver(config: ProjectConfig, dbSrcDir: string): Promise<void> {
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

    const dbPath = path.join(dbSrcDir, 'index.ts');
    await fs.writeFile(dbPath, template);
  }

  /**
   * Wire `apps/web` to consume the `packages/db` workspace package after the
   * db sources have been routed there. Two effects:
   *
   *  1. Ensure `apps/web/package.json` lists `@<projectName>/db: workspace:*` under
   *     `dependencies`. We pull the package name straight from the scaffolded
   *     `packages/db/package.json` rather than recomputing — that guards against
   *     drift if a future template changes the convention.
   *  2. Rewrite any `apps/web` source file that imports from `@/lib/db` (or a
   *     subpath like `@/lib/db/types`) to import from `@<projectName>/db` instead.
   *     Today, no callers of `setup_database` will have produced such imports
   *     yet — but `setup_authentication` and user code may, and this contract
   *     keeps the rewrite idempotent for those paths.
   *
   * Walk is scoped to `apps/web/src` and `apps/web/app` (if present). We do not
   * descend into `node_modules`, `.next`, `.prisma`, or `public`.
   */
  private async wireAppsWebToDbPackage(_config: ProjectConfig, projectPath: string): Promise<string> {
    const appPath = path.join(projectPath, 'apps/web');
    const dbPkgJsonPath = path.join(projectPath, 'packages/db/package.json');

    // 1. Resolve db package name from the on-disk package.json. This function is
    //    only called when `shouldRouteToDbPackage(config)` is true, which means
    //    Group D MUST have already emitted `packages/db/package.json`. A missing
    //    or unparsable file here is an invariant violation, not a soft fault —
    //    we surface it loudly rather than guessing a name.
    if (!existsSync(dbPkgJsonPath)) {
      throw new Error(
        'wireAppsWebToDbPackage: expected packages/db/package.json to exist ' +
          '(Group D should have emitted it). Did setup_database run before scaffold_project?'
      );
    }
    let dbPkgName: string;
    try {
      const dbPkg = JSON.parse(await fs.readFile(dbPkgJsonPath, 'utf-8'));
      if (typeof dbPkg.name !== 'string' || dbPkg.name.length === 0) {
        throw new Error('packages/db/package.json has no usable "name" field');
      }
      dbPkgName = dbPkg.name;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `wireAppsWebToDbPackage: failed to read packages/db/package.json (Group D ` +
          `should have emitted it). Did setup_database run before scaffold_project? ` +
          `Underlying error: ${reason}`
      );
    }

    // 2. Add workspace dep to apps/web/package.json
    const appPkgPath = path.join(appPath, 'package.json');
    if (existsSync(appPkgPath)) {
      const appPkg = JSON.parse(await fs.readFile(appPkgPath, 'utf-8'));
      appPkg.dependencies = appPkg.dependencies || {};
      if (appPkg.dependencies[dbPkgName] !== 'workspace:*') {
        appPkg.dependencies[dbPkgName] = 'workspace:*';
        await fs.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
        logger.info(`Added ${dbPkgName}: workspace:* to apps/web/package.json`);
      }
    }

    // 3. Rewrite `@/lib/db` imports inside apps/web sources.
    for (const sub of ['src', 'app']) {
      const root = path.join(appPath, sub);
      if (existsSync(root)) {
        await this.rewriteImportsInTree(root, [
          { alias: '@/lib/db', replacement: dbPkgName, preserveSubpath: true },
        ]);
      }
    }

    return dbPkgName;
  }

  /**
   * Wire `apps/web` to consume the `packages/auth` workspace package after the
   * better-auth core sources have been written into `packages/auth/src/`.
   *
   * Mirrors {@link wireAppsWebToDbPackage} (Group F1):
   *   - The auth package name is read from `packages/auth/package.json` (Group D
   *     emits this in the same `monorepo: 'full' + auth: 'better-auth' +
   *     database !== 'none'` shape this helper is gated on). A missing or
   *     unreadable file is an invariant violation that we surface loudly
   *     rather than guessing a name.
   *   - `apps/web/package.json` is updated in place to add
   *     `<authPkgName>: 'workspace:*'` under `dependencies`.
   *   - Pre-existing `@/lib/auth` / `@/lib/auth-client` imports inside
   *     `apps/web/src` and `apps/web/app` are rewritten to the workspace
   *     package's subpath exports (`<authPkgName>/server` and
   *     `<authPkgName>/client` respectively). The subpath exports are
   *     declared in `packages/auth/package.json` (D4 emits this).
   *
   * Returns the resolved `authPkgName` so callers can include it in
   * user-facing instructions.
   */
  private async wireAppsWebToAuthPackage(
    _config: ProjectConfig,
    projectPath: string
  ): Promise<string> {
    const appPath = path.join(projectPath, 'apps/web');
    const authPkgJsonPath = path.join(projectPath, 'packages/auth/package.json');

    if (!existsSync(authPkgJsonPath)) {
      throw new Error(
        'wireAppsWebToAuthPackage: expected packages/auth/package.json to exist ' +
          '(Group D should have emitted it). Did scaffold_project run with auth: ' +
          "'better-auth' and a database configured?"
      );
    }

    let authPkgName: string;
    try {
      const authPkg = JSON.parse(await fs.readFile(authPkgJsonPath, 'utf-8'));
      if (typeof authPkg.name !== 'string' || authPkg.name.length === 0) {
        throw new Error('packages/auth/package.json has no usable "name" field');
      }
      authPkgName = authPkg.name;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `wireAppsWebToAuthPackage: failed to read packages/auth/package.json (Group D ` +
          `should have emitted it). Underlying error: ${reason}`
      );
    }

    const appPkgPath = path.join(appPath, 'package.json');
    if (existsSync(appPkgPath)) {
      const appPkg = JSON.parse(await fs.readFile(appPkgPath, 'utf-8'));
      appPkg.dependencies = appPkg.dependencies || {};
      if (appPkg.dependencies[authPkgName] !== 'workspace:*') {
        appPkg.dependencies[authPkgName] = 'workspace:*';
        await fs.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
        logger.info(`Added ${authPkgName}: workspace:* to apps/web/package.json`);
      }
    }

    // Rewrite `@/lib/auth` and `@/lib/auth-client` imports. The walker sorts
    // mappings longest-prefix-first internally, so the deliberately
    // shorter-prefix-first order below is safe AND doubles as a regression
    // guard: if `rewriteImportsInTree` ever stops sorting, this callsite
    // would corrupt `@/lib/auth-client` imports into `<pkg>/server-client`
    // and the dedicated test in setup-authentication.test.ts ("rewrites
    // pre-existing apps/web @/lib/auth(-client) imports to workspace
    // subpaths") would fail. The walker also preserves regex-anchor context
    // so string literals containing `@/lib/auth` (JSDoc, log strings,
    // fixtures) are left alone.
    //
    // We also intentionally do NOT preserve a subpath on the auth aliases:
    // `@/lib/auth` is a single-file alias (not a directory), so any
    // `@/lib/auth/<sub>` form is invalid in the legacy layout and rewriting
    // it would just propagate broken code into the new package shape.
    for (const sub of ['src', 'app']) {
      const root = path.join(appPath, sub);
      if (existsSync(root)) {
        await this.rewriteImportsInTree(root, [
          { alias: '@/lib/auth', replacement: `${authPkgName}/server`, preserveSubpath: false },
          { alias: '@/lib/auth-client', replacement: `${authPkgName}/client`, preserveSubpath: false },
        ]);
      }
    }

    return authPkgName;
  }

  /**
   * Recursively visit `.ts` / `.tsx` files under `root` and rewrite import
   * specifiers per the supplied {@link ImportRewriteMapping}s. All matches
   * across all mappings are applied in a single pass per file.
   *
   * Mappings are sorted internally by descending alias length so when two
   * aliases share a prefix (e.g. `@/lib/auth-client` and `@/lib/auth`) the
   * longer one is matched first — callers do not need to pre-order them.
   *
   * Each mapping anchors its regex on import context (`from`, `import`,
   * `require`) so string literals that merely contain the alias are left
   * alone — see Group F1's `rewrite-anchored` regression test for the
   * load-bearing assertion.
   */
  private async rewriteImportsInTree(root: string, mappings: ImportRewriteMapping[]): Promise<void> {
    // Sort longest-prefix-first so a shorter alias can never partially
    // consume a longer one. Callers may pass mappings in any order.
    const sortedMappings = [...mappings].sort((a, b) => b.alias.length - a.alias.length);
    const skipDirs = new Set(['node_modules', '.next', '.prisma', '.turbo', 'dist', 'public']);
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await this.rewriteImportsInTree(fullPath, mappings);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;

      const original = await fs.readFile(fullPath, 'utf-8');
      let updated = original;

      for (const mapping of sortedMappings) {
        // Anchor on import context so we don't accidentally rewrite string
        // literals in JSDoc, console logs, fixtures, etc. We cover four forms:
        //   - static `from '...'` (default/named/side-effect / export-from)
        //   - bare side-effect `import '...'`
        //   - dynamic `import('...')` (the `(` is captured as part of the prefix)
        //   - CJS `require('...')`
        // The alias is escaped for regex, and `preserveSubpath` controls
        // whether `<alias>/<sub>` is preserved (db case) or treated as the
        // exact alias only (auth case, where the alias maps to a single file).
        const escapedAlias = mapping.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = mapping.preserveSubpath
          ? new RegExp(
              `((?:from|import|require)\\s*\\(?\\s*)(['"])${escapedAlias}(\\/[^'"]*)?\\2`,
              'g'
            )
          : new RegExp(`((?:from|import|require)\\s*\\(?\\s*)(['"])${escapedAlias}\\2`, 'g');

        updated = updated.replace(pattern, (_match, prefix: string, quote: string, sub?: string) => {
          const tail = mapping.preserveSubpath ? (sub ?? '') : '';
          return `${prefix}${quote}${mapping.replacement}${tail}${quote}`;
        });
      }

      if (updated !== original) {
        await fs.writeFile(fullPath, updated);
        logger.info(`Rewrote imports in ${path.relative(root, fullPath)}`);
      }
    }
  }

  private generateDatabaseInstructions(config: ProjectConfig, dbPkgName?: string): string {
    const orm = config.architecture.orm || 'none';
    const database = config.architecture.database;
    const packageRunner = this.getPackageRunner(config.architecture.packageManager);

    // Surface the actual on-disk routing in the success message. In `full + orm`,
    // sources land in `packages/db/src` and consumers import them via the
    // workspace package whose name was resolved from
    // `packages/db/package.json` (passed in via `dbPkgName`); in all other modes
    // the legacy `src/lib/db/` layout applies and the path-alias `@/lib/db`
    // resolves to it.
    const routedToDbPkg = shouldRouteToDbPackage(config);
    const importSpecifier = routedToDbPkg ? (dbPkgName ?? `@${config.name}/db`) : '@/lib/db';
    const filesCreatedIn = routedToDbPkg ? 'packages/db/src/' : 'src/lib/db/';
    const schemaLocationDrizzle = routedToDbPkg ? 'packages/db/src/schema.ts' : 'src/lib/db/schema.ts';
    const modelsLocationMongoose = routedToDbPkg ? 'packages/db/src/models/' : 'src/lib/db/models/';

    let instructions = `Database setup completed successfully!\n\n`;
    instructions += `Configuration:\n`;
    instructions += `- Database: ${database}\n`;
    instructions += `- ORM: ${orm}\n`;
    instructions += `- Files created in: ${filesCreatedIn}\n\n`;

    instructions += `Next steps:\n`;

    if (orm === 'prisma') {
      instructions += `1. Prisma client has been generated and is ready to use!\n`;
      instructions += `2. Update your schema in prisma/schema.prisma (optional)\n`;
      instructions += `3. Run: ${packageRunner} prisma db push (or prisma migrate dev)\n`;
      instructions += `4. After schema changes, run: ${packageRunner} prisma generate\n`;
      instructions += `5. Import and use: import { db } from '${importSpecifier}'\n`;
    } else if (orm === 'drizzle') {
      instructions += `1. Define your schema in ${schemaLocationDrizzle}\n`;
      instructions += `2. Run: ${packageRunner} drizzle-kit generate\n`;
      instructions += `3. Run: ${packageRunner} drizzle-kit push (or migrate)\n`;
      instructions += `4. Import and use: import { db } from '${importSpecifier}'\n`;
    } else if (orm === 'mongoose') {
      instructions += `1. Create your models in ${modelsLocationMongoose}\n`;
      instructions += `2. Import connection: import { connectDB } from '${importSpecifier}'\n`;
      instructions += `3. Call connectDB() before using models\n`;
      instructions += `4. Export and use your models from the models directory\n`;
    } else {
      instructions += `1. Import the database client: import { db } from '${importSpecifier}'\n`;
      instructions += `2. Use the provided query helpers or pool directly\n`;
      instructions += `3. Refer to the ${database} documentation for query syntax\n`;
    }

    instructions += `\nEnvironment variable added to .env`;

    return instructions;
  }

  // Authentication Helper Functions
  private getAdapterConfig(config: ProjectConfig): { adapterImport: string; databaseConfig: string } {
    const { database, orm } = config.architecture;

    // In `monorepo: 'full' + auth + db` routing, the auth source lives at
    // `packages/auth/src/server.ts` and there is no `@/...` resolution from
    // there to `@/lib/db`. The auth package's `package.json` already declares
    // `@<projectName>/db: workspace:*` as a dep (Group D's auth template), so
    // the headless `betterAuth({...})` config imports the same workspace
    // package that the rest of the monorepo uses. In all other modes, the
    // legacy `@/lib/db` alias resolves to the app's local `src/lib/db`.
    const dbImportSpecifier = shouldRouteToDbPackage(config)
      ? `@${config.name}/db`
      : '@/lib/db';

    if (orm === 'prisma') {
      return {
        adapterImport: `import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "${dbImportSpecifier}";`,
        databaseConfig: `prismaAdapter(db, {
    provider: "${this.getPrismaProvider(database)}",
  })`,
      };
    }

    if (orm === 'drizzle') {
      return {
        adapterImport: `import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "${dbImportSpecifier}";`,
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

  /**
   * `--config <path>` is interpreted relative to the better-auth CLI's cwd.
   * In `packages/auth` routing, the auth file is `src/server.ts` (relative to
   * `packages/auth`); in legacy mode it is `src/lib/auth.ts` (relative to the
   * app — flat or `apps/web`). Schema commands run with the cwd returned by
   * {@link getAuthSchemaCwd} and migration commands with {@link
   * getAuthMigrationCwd} so the relative paths match.
   */
  private getAuthSchemaCommand(config: ProjectConfig): string {
    const configRelPath = shouldRouteToAuthPackage(config) ? 'src/server.ts' : 'src/lib/auth.ts';
    return `npx @better-auth/cli@latest generate -y --config ${configRelPath}`;
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

    const configRelPath = shouldRouteToAuthPackage(config) ? 'src/server.ts' : 'src/lib/auth.ts';
    return `npx @better-auth/cli@latest migrate -y --config ${configRelPath}`;
  }

  /**
   * cwd for the better-auth schema/migration commands. The auth CLI's
   * `--config <path>` is relative to this cwd, and the ORM CLIs (prisma,
   * drizzle-kit) need to be invoked wherever their own artifacts live:
   *   - `full + orm`: `packages/db` so `prisma migrate` finds the schema
   *     emitted by Group F1 at `packages/db/prisma/schema.prisma`. The
   *     auth schema generation runs from the same cwd; `--config
   *     ../auth/src/server.ts` is unwieldy, so we run schema-gen from
   *     `packages/auth` (which has its own `--config src/server.ts`) and
   *     run migrations from `packages/db`.
   *   - other modes: cwd = appPath (which is projectPath in `none` mode
   *     and `apps/web` in `minimal` mode). Same shape for both auth-cli
   *     and ORM CLIs because everything lives in the app dir.
   */
  private getAuthSchemaCwd(config: ProjectConfig, projectPath: string): string {
    if (shouldRouteToAuthPackage(config)) {
      return path.join(projectPath, 'packages/auth');
    }
    return getAppPath(config, projectPath);
  }

  private getAuthMigrationCwd(config: ProjectConfig, projectPath: string): string {
    // Migrations are owned by the ORM, so they need to run wherever the ORM
    // artifacts live. In `full + orm`, that's `packages/db`. In other modes
    // (or `full + orm:none`, which doesn't get here because better-auth
    // requires a database), it's the app dir.
    if (shouldRouteToDbPackage(config)) {
      return getDbBaseDir(config, projectPath);
    }
    return getAppPath(config, projectPath);
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

    try {
      // Verify database is configured
      if (config.architecture.database === 'none') {
        throw new Error('Better Auth requires a database. Please select a database option.');
      }

      // Resolve mode-aware locations once. `appPath` is where all the
      // route/component-level files live (apps/web in monorepo modes, the
      // workspace root in `none` mode). In `full + better-auth + db`, the
      // headless `betterAuth({...})` server config and the typed client are
      // additionally routed into `packages/auth/src/` via Group D's
      // pre-emitted package. `.env*` files always sit at projectPath
      // regardless of mode (workspace root === single-app root in flat mode).
      const appPath = getAppPath(config, projectPath);
      const authPaths = getAuthFilePaths(config, projectPath);
      const routedToAuthPkg = shouldRouteToAuthPackage(config);

      // Step 1: Create directory structure
      // App-level dirs (route-coupled / component-coupled — these live in
      // apps/web regardless of monorepo mode because their imports use
      // Next.js's `@/...` alias which resolves inside the app).
      const appLevelDirs = [
        'src/lib',
        'src/providers',
        'src/app/api/auth/[...all]',
        'src/app/auth/[path]',
        'src/app/account/[path]',
        'src/components/auth',
      ];

      for (const dir of appLevelDirs) {
        await fs.mkdir(path.join(appPath, dir), { recursive: true });
      }

      // Auth-package src dir (only in `full + better-auth + db` routing)
      if (routedToAuthPkg) {
        await fs.mkdir(path.dirname(authPaths.serverPath), { recursive: true });
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

      // Step 3: Generate auth configuration files (server + client)
      const { adapterImport, databaseConfig } = this.getAdapterConfig(config);

      // Read and process auth.ts template -> server.ts (routed) or
      // src/lib/auth.ts (legacy).
      const authTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth.ts.template'), 'utf-8');
      const authContent = authTemplate
        .replace('__ADAPTER_IMPORT__', adapterImport)
        .replace('__DATABASE_CONFIG__', databaseConfig);
      await fs.writeFile(authPaths.serverPath, authContent);

      // Copy auth-client.ts -> client.ts (routed) or src/lib/auth-client.ts
      // (legacy).
      const authClientTemplate = await fs.readFile(
        path.join(__dirname, 'templates/auth/auth-client.ts.template'),
        'utf-8'
      );
      await fs.writeFile(authPaths.clientPath, authClientTemplate);

      // In routed mode, also write the barrel `index.ts` that re-exports the
      // subpath modules. apps/web consumers should still prefer the explicit
      // subpaths (`<pkg>/server`, `<pkg>/client`) — the barrel exists for
      // ergonomic import in the package's own internal code.
      if (routedToAuthPkg && authPaths.indexPath) {
        await fs.writeFile(
          authPaths.indexPath,
          `export * from './server';\nexport * from './client';\n`
        );
      }

      // Resolve the import specifier the templated app-level files should
      // use to reach the headless `auth` and `authClient` exports. In routed
      // mode this is the workspace package's subpath exports
      // (`<pkg>/server` and `<pkg>/client`); in legacy mode it stays as the
      // local `@/lib/auth` / `@/lib/auth-client` aliases.
      const authPkgName = routedToAuthPkg ? `@${config.name}/auth` : null;
      const authServerImport = authPkgName ? `${authPkgName}/server` : '@/lib/auth';
      const authClientImport = authPkgName ? `${authPkgName}/client` : '@/lib/auth-client';

      // Step 4: Generate API route. Substitutes the auth-server import so
      // `route.ts` reaches the workspace package in routed mode.
      const routeTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth-route.ts.template'), 'utf-8');
      const routeContent = routeTemplate.replace('__AUTH_SERVER_IMPORT__', authServerImport);
      await fs.writeFile(path.join(appPath, 'src/app/api/auth/[...all]/route.ts'), routeContent);

      // Step 5: Generate AuthUIProvider. Substitutes the auth-client import.
      const authProviderTemplate = await fs.readFile(
        path.join(__dirname, 'templates/auth/auth-ui-provider.tsx.template'),
        'utf-8'
      );
      const authProviderContent = authProviderTemplate.replace('__AUTH_CLIENT_IMPORT__', authClientImport);
      await fs.writeFile(path.join(appPath, 'src/providers/auth-ui-provider.tsx'), authProviderContent);

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
          await fs.writeFile(path.join(appPath, destination), content);
        })
      );

      // Step 9: Update root layout to include AuthProvider
      const layoutPath = path.join(appPath, 'src/app/layout.tsx');
      let layoutContent = await fs.readFile(layoutPath, 'utf-8');

      if (!layoutContent.includes('AuthProvider')) {
        // Add import at the top
        const importStatement = `import { AuthProvider } from "@/providers/auth-ui-provider";\n`;
        layoutContent = layoutContent.replace(/^(import.*\n)*/, (match) => match + importStatement);

        // Wrap {children} with <AuthProvider>{children}</AuthProvider>
        layoutContent = layoutContent.replace(/\{children\}/, '<AuthProvider>{children}</AuthProvider>');
        await fs.writeFile(layoutPath, layoutContent);
      }

      // Step 10: Wire `apps/web` to the `packages/auth` workspace package and
      // rewrite any pre-existing `@/lib/auth(-client)` imports. The dep is
      // added to `apps/web/package.json`; pre-existing imports inside
      // `apps/web/src` and `apps/web/app` are rewritten to `<pkg>/server`
      // and `<pkg>/client`. The walker is a safety net — the templated
      // files emitted above already use the routed specifiers when
      // `routedToAuthPkg` is true.
      let resolvedAuthPkgName: string | undefined;
      if (routedToAuthPkg) {
        resolvedAuthPkgName = await this.wireAppsWebToAuthPackage(config, projectPath);
      }

      // Step 11: Install better-auth-ui shadcn registry pieces. These live
      // in apps/web (route-coupled compositions, not reusable primitives) so
      // we always run with cwd = appPath, even when `monorepo === 'full' +
      // uiLibrary === 'shadcn'` (where setup_shadcn additionally inits
      // packages/ui).
      let registryInstallSummary = '';
      if (!config.architecture.skipInstall) {
        const runner = getShadcnRunner(config.architecture.packageManager);
        const authRegistryUrl = 'https://better-auth-ui.com/r/auth.json';
        const settingsRegistryUrl = 'https://better-auth-ui.com/r/settings.json';
        const userButtonRegistryUrl = 'https://better-auth-ui.com/r/user-button.json';

        const authRegistryResult = this.execCommand(
          `${runner} shadcn@latest add ${authRegistryUrl} -y`,
          appPath,
          'better-auth-ui auth registry'
        );
        const settingsAndButtonResult = this.execCommand(
          `${runner} shadcn@latest add ${settingsRegistryUrl} ${userButtonRegistryUrl} -y`,
          appPath,
          'better-auth-ui settings/user-button registry'
        );

        registryInstallSummary =
          authRegistryResult.success && settingsAndButtonResult.success
            ? 'Installed better-auth-ui shadcn-registry components in apps/web'
            : 'Failed to install one or more better-auth-ui shadcn-registry components — see logs';
        logger.info(registryInstallSummary);
      } else {
        registryInstallSummary =
          'Skipped better-auth-ui shadcn-registry installation due to skipInstall flag';
        logger.info(registryInstallSummary);
      }

      // Step 12: Run schema generation and migration
      const { database } = config.architecture;
      let schemaGenerated = false;
      let migrationRan = false;

      // MongoDB doesn't need migrations (schema-less)
      const shouldRunMigrations = database !== 'mongodb';

      if (shouldRunMigrations && !config.architecture.skipInstall) {
        // Generate auth schema (cwd is mode-aware — see getAuthSchemaCwd).
        const schemaCmd = this.getAuthSchemaCommand(config);
        const schemaCwd = this.getAuthSchemaCwd(config, projectPath);
        const schemaResult = this.execCommand(schemaCmd, schemaCwd, 'auth schema generation');
        schemaGenerated = schemaResult.success;

        // Run migrations if schema was generated successfully (cwd
        // follows the ORM artifacts — see getAuthMigrationCwd).
        if (schemaGenerated) {
          const migrationCmd = this.getAuthMigrationCommand(config);
          const migrationCwd = this.getAuthMigrationCwd(config, projectPath);
          const migrationResult = this.execCommand(migrationCmd, migrationCwd, 'auth migration');
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
          nextSteps = `⚠️  Manual setup required. Please run these commands:

📋 Next Steps:

1. Generate the database schema:
   ${this.getAuthSchemaCommand(config)}

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

      // Reflect routed file locations in the user-facing output. In routed
      // mode, the headless server config and typed client live inside the
      // workspace package; otherwise the legacy `src/lib/...` layout
      // applies. The route/component-level files always live in the app.
      const serverFileLine = routedToAuthPkg
        ? `- packages/auth/src/server.ts (server config) — exposed via ${resolvedAuthPkgName}/server`
        : '- src/lib/auth.ts (server config)';
      const clientFileLine = routedToAuthPkg
        ? `- packages/auth/src/client.ts (client) — exposed via ${resolvedAuthPkgName}/client`
        : '- src/lib/auth-client.ts (client)';
      const indexFileLine = routedToAuthPkg
        ? '\n- packages/auth/src/index.ts (workspace barrel re-exporting server + client)'
        : '';
      const appPrefix = routedToAuthPkg || config.architecture.monorepo !== 'none' ? 'apps/web/' : '';

      const instructions = `✅ Better Auth + Better Auth UI has been configured successfully!

${nextSteps}

${registryInstallSummary}

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
- /account/settings - Account settings

🔐 Features Enabled:
- Email & Password Authentication with beautiful UI
- Session Management
- Account Settings Pages
- User Profile Management
- Pre-styled shadcn/ui components
- Ready-to-use UserButton component

📁 Generated Files:
${serverFileLine}
${clientFileLine}${indexFileLine}
- ${appPrefix}src/providers/auth-ui-provider.tsx (UI provider)
- ${appPrefix}src/app/api/auth/[...all]/route.ts (API handler)
- ${appPrefix}src/app/auth/[path]/page.tsx (dynamic auth pages)
- ${appPrefix}src/app/account/[path]/page.tsx (account settings)
- ${appPrefix}src/components/auth/user-button.tsx (UserButton wrapper)
- Updated ${appPrefix}src/app/layout.tsx (AuthProvider wrapper)

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
        validationResults.push(`⚠️ Build validation skipped (skipInstall is true)`);
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
      const isMonorepo = architecture.monorepo !== 'none';
      const isFullMonorepo = architecture.monorepo === 'full';
      // Mirror generateFullModePackages emission gates so the README only
      // documents packages that actually land on disk for this config.
      const hasDbPackage = isFullMonorepo && architecture.database !== 'none' && architecture.orm !== 'none';
      const hasAuthPackage =
        isFullMonorepo &&
        architecture.auth === 'better-auth' &&
        architecture.database !== 'none' &&
        architecture.orm !== 'none';
      const hasUiPackage = isFullMonorepo && architecture.uiLibrary === 'shadcn';
      const hasOrpcPackage = isFullMonorepo && architecture.rpc === 'orpc';
      // In monorepo:full + prisma, the schema lives at packages/db/prisma —
      // prisma commands need to run from that directory (or be passed --schema).
      const prismaInDbPackage = hasDbPackage && architecture.orm === 'prisma';
      const prismaExec = pm === 'npm' ? 'npx' : `${pm} exec`;

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
          // In monorepo:full + prisma, prisma CLI must run inside packages/db so
          // it picks up packages/db/prisma/schema.prisma without --schema flags.
          const prismaCdPrefix = prismaInDbPackage ? `cd packages/db && ` : '';
          databaseSetup = `

### Database Setup (Prisma)

1. Start the database using Docker:
   \`\`\`bash
   ${pm} run docker:dev:up
   \`\`\`

2. Run database migrations:
   \`\`\`bash
   ${prismaCdPrefix}${prismaExec} prisma migrate dev
   \`\`\`

3. (Optional) Open Prisma Studio to manage your data:
   \`\`\`bash
   ${prismaCdPrefix}${prismaExec} prisma studio
   \`\`\`
`;
        } else if (architecture.orm === 'drizzle') {
          // In monorepo:full + drizzle, drizzle-kit reads its config from
          // packages/db/drizzle.config.ts; run from there so paths resolve.
          const drizzleCdPrefix = hasDbPackage ? `cd packages/db && ` : '';
          databaseSetup = `

### Database Setup (Drizzle)

1. Start the database using Docker:
   \`\`\`bash
   ${pm} run docker:dev:up
   \`\`\`

2. Generate and run migrations:
   \`\`\`bash
   ${drizzleCdPrefix}${prismaExec} drizzle-kit generate
   ${drizzleCdPrefix}${prismaExec} drizzle-kit migrate
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

      // Generate Docker monorepo+prisma migrate caveat. In monorepo mode the
      // web service no longer auto-applies migrations on boot (Group H made
      // the inline `prisma migrate deploy` skip web for monorepo), so users
      // must invoke the dedicated migrate service. In monorepo:full the
      // schema also lives at packages/db/prisma — Dockerfile.migrate's
      // default `prisma/schema.prisma` path won't resolve, so we surface a
      // note about adding `--schema=./packages/db/prisma/schema.prisma`.
      let monorepoDockerNotes = '';
      if (isMonorepo && architecture.orm === 'prisma' && architecture.database !== 'none') {
        monorepoDockerNotes = `

### Applying database migrations (monorepo)

The web service no longer runs Prisma migrations on startup in monorepo mode. After bringing the stack up, apply pending migrations explicitly:

\`\`\`bash
docker compose run --rm migrate
\`\`\`
${
  isFullMonorepo
    ? `
> **Note**: \`Dockerfile.migrate\` ships with a default schema path of \`prisma/schema.prisma\`. In \`monorepo: full\` the schema lives at \`packages/db/prisma/schema.prisma\`, so you may need to update the migrate service to pass \`--schema=./packages/db/prisma/schema.prisma\` (either by editing the Dockerfile's \`CMD\` or by overriding it in \`docker-compose.yml\`).
`
    : ''
}`;
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
${monorepoDockerNotes}${testingInstructions}
## Project Structure

\`\`\`
${
  isMonorepo
    ? `${config.name}/
├── apps/
│   └── web/                       # Next.js application (apps/web)
│       ├── src/
│       │   ├── app/               # Next.js app directory
│       │   │   ├── api/           # API routes
${
  architecture.auth === 'better-auth'
    ? `│       │   │   │   └── auth/      # Authentication API
│       │   │   ├── auth/          # Auth pages (sign-in, sign-up)
│       │   │   ├── account/       # Account management pages
`
    : ''
}│       │   │   ├── layout.tsx     # Root layout
│       │   │   └── page.tsx       # Home page
│       │   ├── components/        # React components
│       │   │   ├── ui/            # UI components${architecture.uiLibrary === 'shadcn' ? ' (shadcn/ui)' : ''}
${
  architecture.auth === 'better-auth'
    ? `│       │   │   └── auth/         # Auth components
`
    : ''
}│       │   ├── lib/               # Utility functions${
        architecture.database !== 'none' && !hasDbPackage
          ? `
│       │   │   └── db/            # Database client and schema`
          : ''
      }
${
  architecture.auth === 'better-auth'
    ? `│       │   ├── providers/         # React providers
`
    : ''
}│       │   └── hooks/             # Custom React hooks
│       ├── next.config.ts         # Next.js configuration (apps/web)
│       └── tsconfig.json          # apps/web TypeScript config
${
  isFullMonorepo
    ? `├── packages/
${hasDbPackage ? `│   ├── packages/db/               # Database client + ${architecture.orm === 'prisma' ? 'Prisma schema' : 'Drizzle schema'} (workspace package)
` : ''}${hasAuthPackage ? `│   ├── packages/auth/             # Better Auth core (workspace package)
` : ''}${hasUiPackage ? `│   ├── packages/ui/               # Shared shadcn/ui components (workspace package)
` : ''}${hasOrpcPackage ? `│   ├── packages/orpc/             # oRPC contracts/handlers (workspace package)
` : ''}│   ├── packages/eslint-config/    # Shared ESLint config
│   └── packages/typescript-config/ # Shared TypeScript config
`
    : ''
}├── pnpm-workspace.yaml            # Workspace definition
├── turbo.json                     # Turborepo task pipeline
├── docker-compose.yml             # Docker Compose configuration
├── Dockerfile                     # Docker configuration
├── package.json                   # Workspace root scripts (Turbo runners)
└── tsconfig.json                  # Workspace TypeScript config (base)`
    : `${config.name}/
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
└── tsconfig.json           # TypeScript configuration`
}
\`\`\`

## Available Scripts
${
  isMonorepo
    ? `
Run from the workspace root — these delegate to Turborepo, which fans out to every workspace:

- \`${pm} dev\` - Start the dev server for every workspace (Turbo \`dev\`)
- \`${pm} build\` - Build every workspace (Turbo \`build\`)
- \`${pm} lint\` - Run ESLint across all workspaces
- \`${pm} run typecheck\` - Run TypeScript type checking across all workspaces
${architecture.testing !== 'none' ? `- \`${pm} test\` - Run tests across all workspaces\n` : ''}- \`${pm} run pipeline\` - Run \`build\`, \`lint\`, and \`test\` together (Turbo)

To target a single workspace, use ${pm === 'pnpm' ? `pnpm's \`--filter\`` : 'a workspace filter'} flag, for example:

- \`${pm} --filter @${config.name}/web dev\` - Start dev for apps/web only
- \`${pm} --filter @${config.name}/web build\` - Build apps/web only
${
  architecture.database !== 'none'
    ? `- \`${pm} run docker:dev:up\` - Start database with Docker Compose (workspace root)
- \`${pm} run docker:dev:down\` - Stop database
`
    : ''
}- \`${pm} run docker:build\` - Build Docker image
- \`${pm} run docker:run\` - Run Docker container`
    : `
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
- \`${pm} run docker:run\` - Run Docker container`
}

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
