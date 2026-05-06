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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
  'dotenv-cli': '^9',
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

/**
 * Source of truth for the ORM and database literal sets. Declared as `as const`
 * tuples so a single declaration drives THREE views without duplication:
 *   1. The literal-union TypeScript types ({@link OrmName}, {@link DatabaseName}).
 *   2. The `z.enum(...)` schema enums on {@link ProjectConfigSchema}.
 *   3. The keys/values of {@link ORM_DATABASE_COMPATIBILITY}.
 *
 * Adding a new orm/db = touch one tuple, and the type, schema, and compat table
 * all stay in sync (the compat table will fail to type-check until every key is
 * present, and any new db must be slotted into each orm's value array).
 */
export const ORM_NAMES = ['none', 'prisma', 'drizzle', 'mongoose'] as const;
export const DATABASE_NAMES = ['none', 'postgres', 'mysql', 'mongodb', 'sqlite'] as const;
export type OrmName = (typeof ORM_NAMES)[number];
export type DatabaseName = (typeof DATABASE_NAMES)[number];

/**
 * Source of truth for which databases each ORM supports. Used in BOTH the
 * schema-parse refine on {@link ProjectConfigSchema} (rejects illegal combos
 * at the MCP boundary) AND the runtime gate in `setupDatabase` (defense-in-
 * depth for any internal caller that bypasses parse). Keep them sharing this
 * one constant so the two views can't drift.
 *
 * The implicit `database: 'none'` rule falls out of this table: `'none'` is
 * not in any non-`none` ORM's compat list, so `prisma + none`, `drizzle +
 * none`, and `mongoose + none` all reject. `orm: 'none'` accepts every db
 * value (including `'none'`), so direct-driver setups are unconstrained.
 */
export const ORM_DATABASE_COMPATIBILITY: Record<OrmName, ReadonlyArray<DatabaseName>> = {
  prisma: ['postgres', 'mysql', 'sqlite', 'mongodb'],
  drizzle: ['postgres', 'mysql', 'sqlite'],
  mongoose: ['mongodb'],
  none: ['none', 'postgres', 'mysql', 'sqlite', 'mongodb'],
};

/**
 * Comma-separated list of every supported database except `'none'`, derived
 * from {@link ORM_DATABASE_COMPATIBILITY}.none (which lists every db plus
 * `'none'`). Interpolated into the better-auth refine message so adding a new
 * db to the compat table also surfaces it in the user-facing error — no
 * second hand-maintained list to keep in sync.
 */
const NON_NONE_DBS = ORM_DATABASE_COMPATIBILITY.none.filter((d) => d !== 'none').join(', ');

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
 * Package-emission gate helpers.
 *
 * The four functions below are the single source of truth for "does this
 * config emit `packages/db`, `packages/auth`, `packages/ui`, or
 * `packages/orpc` on disk?" They mirror the gates inside
 * {@link generateFullModePackages} and are also called from
 * {@link generateReadme} and {@link generateAgentsMd} so the documentation
 * package list can't silently drift from disk reality.
 *
 * Any change to a gate (e.g. a future `database: 'planetscale'` that doesn't
 * get its own packages/db) must be made here once — every call site picks it
 * up automatically.
 *
 * `hasAuthPackageEmitted` composes on `hasDbPackageEmitted` to capture the
 * load-bearing constraint that the auth package template hard-codes
 * `@<projectName>/db: workspace:*`, so `packages/auth` requires `packages/db`
 * to also exist (see {@link shouldRouteToAuthPackage}).
 *
 * On a schema-validated config `hasDbPackageEmitted` is equivalent to
 * {@link shouldRouteToDbPackage} — both are kept because the names answer
 * different questions (where do db sources land vs. is `packages/db` on
 * disk). The redundant `database !== 'none'` clause is defense-in-depth
 * against an unvalidated caller; it also makes the gate readable on its
 * own.
 */
export function hasDbPackageEmitted(config: ProjectConfig): boolean {
  return (
    config.architecture.monorepo === 'full' &&
    config.architecture.database !== 'none' &&
    config.architecture.orm !== 'none'
  );
}

export function hasAuthPackageEmitted(config: ProjectConfig): boolean {
  return hasDbPackageEmitted(config) && config.architecture.auth === 'better-auth';
}

export function hasUiPackageEmitted(config: ProjectConfig): boolean {
  return config.architecture.monorepo === 'full' && config.architecture.uiLibrary === 'shadcn';
}

export function hasOrpcPackageEmitted(config: ProjectConfig): boolean {
  return config.architecture.monorepo === 'full' && config.architecture.rpc === 'orpc';
}

/**
 * Single source of truth for the db-layer runtime/dev deps that the generated
 * Prisma/Drizzle client + config files actually import.
 *
 * Two callers consume this:
 *   1. {@link NextMCPServer#updatePackageJson} — adds these to `apps/web/package.json`
 *      in flat/minimal mode (and skips them in `full + orm` mode where they
 *      belong on the workspace package instead).
 *   2. {@link NextMCPServer#patchDbWorkspacePackageJson} — merges them into
 *      `packages/db/package.json` in `full + orm` mode so the workspace can
 *      resolve `@prisma/adapter-pg`, `pg`, `mysql2`, `dotenv`, etc.
 *
 * Returns empty objects for `orm: 'none'` and `orm: 'mongoose'` (mongoose's
 * single dep is already declared in the mongoose package template; direct-driver
 * deps are handled inline below for the flat layout).
 */
export function getDbDeps(config: ProjectConfig): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};
  const { orm, database } = config.architecture;

  if (orm === 'prisma') {
    // client.ts.template imports @prisma/adapter-pg + @prisma/client; pg is the
    // adapter's transitive driver and must be declared explicitly.
    // prisma.config.ts (post-init) imports dotenv. prisma CLI is a devDep.
    deps.pg = PACKAGE_VERSIONS.pg;
    deps['@prisma/adapter-pg'] = PACKAGE_VERSIONS['@prisma/adapter-pg'];
    deps['@prisma/client'] = PACKAGE_VERSIONS['@prisma/client'];
    deps.dotenv = PACKAGE_VERSIONS.dotenv;
    devDeps.prisma = PACKAGE_VERSIONS.prisma;
  } else if (orm === 'drizzle') {
    deps['drizzle-orm'] = PACKAGE_VERSIONS['drizzle-orm'];
    devDeps['drizzle-kit'] = PACKAGE_VERSIONS['drizzle-kit'];

    if (database === 'postgres') {
      deps.pg = PACKAGE_VERSIONS.pg;
      deps.dotenv = PACKAGE_VERSIONS.dotenv;
    } else if (database === 'mysql') {
      deps.mysql2 = PACKAGE_VERSIONS.mysql2;
    } else if (database === 'sqlite') {
      deps['better-sqlite3'] = PACKAGE_VERSIONS['better-sqlite3'];
      devDeps['@types/better-sqlite3'] = PACKAGE_VERSIONS['@types/better-sqlite3'];
    }
  }

  return { dependencies: deps, devDependencies: devDeps };
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
  // Build a relative POSIX path. The base dir is anchored so the returned
  // string is stable on Windows hosts (Docker reads forward-slash paths
  // regardless of the host OS).
  const dbBaseDir = shouldRouteToDbPackage(config)
    ? 'packages/db'
    : config.architecture.monorepo === 'none'
      ? '.'
      : 'apps/web';
  const dbSrcDir = shouldRouteToDbPackage(config)
    ? path.posix.join(dbBaseDir, 'src')
    : path.posix.join(dbBaseDir, 'src/lib/db');
  return path.posix.join(dbSrcDir, '.prisma');
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
 * Build the `globalPassThroughEnv` array emitted into the scaffolded
 * `turbo.json`. Gating these on the resolved config avoids leaking unused
 * pass-through entries into projects that won't ever read them (e.g.
 * shipping `BETTER_AUTH_SECRET` to a project with `auth: 'none'`).
 *
 * Order is fixed and stable so snapshot/array-equality tests don't churn:
 *   1. `NODE_ENV` — always present.
 *   2. `DATABASE_URL` — only when a database is configured.
 *   3. `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` —
 *      only when `auth === 'better-auth'`.
 */
export function buildGlobalPassThroughEnv(config: ProjectConfig): string[] {
  const env: string[] = ['NODE_ENV'];
  if (config.architecture.database !== 'none') {
    env.push('DATABASE_URL');
  }
  if (config.architecture.auth === 'better-auth') {
    env.push('BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_BETTER_AUTH_URL');
  }
  return env;
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

/**
 * Project-root-relative path to the better-auth config file. This is the
 * `--config` argument passed to `auth@latest generate`. Run from the project
 * root, so the path is the same shape across all monorepo modes (and matches
 * the `auth:generate` script wired into the root package.json).
 */
export function getAuthConfigRelPath(config: ProjectConfig): string {
  if (shouldRouteToAuthPackage(config)) {
    return 'packages/auth/src/server.ts';
  }
  if (config.architecture.monorepo === 'none') {
    return 'src/lib/auth.ts';
  }
  return 'apps/web/src/lib/auth.ts';
}

/**
 * Project-root-relative path to the better-auth-generated schema file. Only
 * meaningful for `orm: 'drizzle'` — the auth CLI rewrites this file from the
 * auth config. Returns `null` for other ORMs (Prisma works in-place via its
 * own schema; Mongoose is schemaless).
 */
export function getAuthSchemaOutputRelPath(config: ProjectConfig): string | null {
  if (config.architecture.orm !== 'drizzle') return null;
  if (shouldRouteToDbPackage(config)) {
    return 'packages/db/src/schema/auth.ts';
  }
  if (config.architecture.monorepo === 'none') {
    return 'src/lib/db/schema/auth.ts';
  }
  return 'apps/web/src/lib/db/schema/auth.ts';
}

/**
 * The full `auth:generate` script string for the project root package.json,
 * or `null` when the config doesn't warrant one (no auth, or non-drizzle ORM
 * — Prisma users rely on `setup_authentication`'s migrate flow which mutates
 * `schema.prisma` in-place).
 *
 * Always runs from the project root via `dotenv -e .env --` so the `.env`
 * (which lives at the workspace root in monorepo modes and at the project
 * root in flat mode — same place for both) is loaded before the CLI reads
 * `process.env.DATABASE_URL`.
 */
export function getAuthGenerateScript(config: ProjectConfig): string | null {
  if (config.architecture.auth !== 'better-auth') return null;
  const outputRel = getAuthSchemaOutputRelPath(config);
  if (!outputRel) return null;
  const dlx = packageRunnerDlx(config.architecture.packageManager);
  const configRel = getAuthConfigRelPath(config);
  return `dotenv -e .env -- ${dlx} auth@latest generate -y --config ${configRel} --output ${outputRel}`;
}

/**
 * Top-level export of the package-runner-dlx command for a given package
 * manager. Mirrors {@link NextMCPServer#getPackageRunnerDlx} (instance
 * method) so non-class call sites (helpers like {@link getAuthGenerateScript})
 * can derive the same string without instantiating the server.
 */
export function packageRunnerDlx(pm: PackageManager): string {
  switch (pm) {
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

/**
 * Returns the project-relative POSIX directory containing `schema.prisma` for
 * the migrate Dockerfile. Mirrors the host layout inside the container — the
 * same path is used as both the COPY destination and the `--schema=` arg in
 * the CMD, so a single placeholder (`__SCHEMA_HOST_PATH__`) is sufficient.
 *
 * - `full + orm`:                    `packages/db/prisma`
 * - `minimal` / `full + orm:none`:   `apps/web/prisma`
 * - `none`:                          `prisma`
 */
export function getMigrateSchemaHostPath(config: ProjectConfig): string {
  if (shouldRouteToDbPackage(config)) return 'packages/db/prisma';
  if (config.architecture.monorepo === 'none') return 'prisma';
  return 'apps/web/prisma';
}

/**
 * Returns the project-relative POSIX path to `drizzle.config.ts` for the
 * migrate Dockerfile. Mirrors {@link getMigrateSchemaHostPath} for prisma:
 * the path is interpreted in-container at WORKDIR `/app` and passed verbatim
 * to `drizzle-kit migrate --config=`.
 *
 * - `full + orm:drizzle`:             `packages/db/drizzle.config.ts`
 * - `minimal + orm:drizzle`:          `apps/web/drizzle.config.ts`
 * - `none + orm:drizzle`:             `drizzle.config.ts`
 */
export function getMigrateDrizzleConfigPath(config: ProjectConfig): string {
  if (shouldRouteToDbPackage(config)) return 'packages/db/drizzle.config.ts';
  if (config.architecture.monorepo === 'none') return 'drizzle.config.ts';
  return 'apps/web/drizzle.config.ts';
}

/**
 * Returns the project-relative POSIX directory containing the drizzle source
 * files (schema.ts + client.ts) for the migrate Dockerfile's flat-mode COPY.
 * Mirrors the layout {@link setupDrizzle} writes.
 *
 * - `full + orm:drizzle`: `packages/db/src` (drizzle.config.ts's `schema:`
 *   resolves to `./src/schema.ts` from `packages/db/`)
 * - `minimal + orm:drizzle`: `apps/web/src/lib/db`
 * - `none + orm:drizzle`: `src/lib/db`
 *
 * Only used by flat mode's targeted COPY — monorepo modes do `COPY . .` and
 * pick this up implicitly.
 */
function getMigrateDrizzleSchemaDir(config: ProjectConfig): string {
  if (shouldRouteToDbPackage(config)) return 'packages/db/src';
  if (config.architecture.monorepo === 'none') return 'src/lib/db';
  return 'apps/web/src/lib/db';
}

/**
 * Returns the project-relative POSIX directory where drizzle-kit writes
 * generated migration SQL files (the `out:` field in `drizzle.config.ts`).
 *
 * - `full + orm:drizzle`: `packages/db/drizzle/migrations`
 * - `minimal + orm:drizzle`: `apps/web/drizzle/migrations`
 * - `none + orm:drizzle`: `drizzle/migrations`
 *
 * The migrate image's flat-mode COPY uses this directory; monorepo modes
 * pick it up via `COPY . .`.
 */
function getMigrateDrizzleOutDir(config: ProjectConfig): string {
  if (shouldRouteToDbPackage(config)) return 'packages/db/drizzle';
  if (config.architecture.monorepo === 'none') return 'drizzle';
  return 'apps/web/drizzle';
}

/**
 * Maps the configured database to the drizzle runtime driver package needed
 * for `drizzle-kit migrate` to talk to it. `mongodb` is intentionally absent
 * — drizzle does not support mongo, and the migrate Dockerfile gate also
 * excludes mongoose, so this map only needs the SQL flavours.
 */
function getDrizzleDriverPackage(database: string): string {
  switch (database) {
    case 'postgres':
      return 'pg';
    case 'mysql':
      return 'mysql2';
    case 'sqlite':
      return 'better-sqlite3';
    default:
      return 'pg';
  }
}

/**
 * Per-PM ad-hoc add command used by the migrate Dockerfile in flat mode. The
 * migrate image only needs prisma + the runtime client + dotenv — there's no
 * benefit to a full workspace install when there's no workspace.
 */
const MIGRATE_DEPS_ADD: Record<PackageManager, string> = {
  pnpm: 'pnpm add prisma @prisma/client dotenv',
  npm: 'npm install prisma @prisma/client dotenv',
  yarn: 'yarn add prisma @prisma/client dotenv',
  bun: 'bun add prisma @prisma/client dotenv',
};

/**
 * Per-PM `add` verb (used to build drizzle's flat-mode deps install, where
 * the package list depends on the configured database driver).
 */
const PM_ADD_COMMAND: Record<PackageManager, string> = {
  pnpm: 'pnpm add',
  npm: 'npm install',
  yarn: 'yarn add',
  bun: 'bun add',
};

/**
 * Builds the drizzle flat-mode `<pm> add` command — drizzle-kit + drizzle-orm
 * + the database driver + dotenv. The driver depends on the configured
 * database (see {@link getDrizzleDriverPackage}).
 */
function buildDrizzleMigrateDepsAdd(pm: PackageManager, database: string): string {
  const driver = getDrizzleDriverPackage(database);
  return `${PM_ADD_COMMAND[pm]} drizzle-kit drizzle-orm ${driver} dotenv`;
}

/**
 * Substitutes placeholders in the Dockerfile.migrate template. Resolves both
 * the shared PM placeholders (via {@link substituteDockerfilePlaceholders})
 * and the migrate-specific ones:
 *
 * - `__SCHEMA_HOST_PATH__`        — (prisma only) directory containing
 *                                   `schema.prisma`, relative to project
 *                                   root and mirrored as the in-container
 *                                   path. Unused for drizzle.
 * - `__MIGRATE_COPY__`            — COPY block. Flat mode preserves the
 *                                   targeted legacy copy (root manifests +
 *                                   schema sources + optional config files).
 *                                   Monorepo modes do `COPY . .` so the
 *                                   workspace structure is intact for
 *                                   `__PM_INSTALL__` to resolve workspace
 *                                   `db` deps.
 * - `__MIGRATE_DEPS_INSTALL__`    — flat mode: PM-specific ORM-aware add.
 *                                   Monorepo modes: full
 *                                   `__PM_INSTALL__` (lockfile-driven).
 * - `__MIGRATE_CMD__`             — ORM-specific CMD body. Prisma:
 *                                   `<dlx> prisma migrate deploy --schema=...`.
 *                                   Drizzle:
 *                                   `<dlx> drizzle-kit migrate --config=...`.
 *
 * Mongoose is not supported here — the gate at the call site excludes it
 * (mongo is schemaless; there are no SQL migrations to apply).
 *
 * All paths use POSIX separators so the result is stable on Windows hosts.
 */
export function substituteMigrateDockerfilePlaceholders(
  template: string,
  config: ProjectConfig
): string {
  const pm = config.architecture.packageManager;
  const isMonorepo = config.architecture.monorepo !== 'none';
  const orm = config.architecture.orm;
  const lockfile = DOCKERFILE_PM_VALUES[pm].__LOCKFILE__;
  const dlx = DOCKERFILE_PM_VALUES[pm].__PM_DLX__;

  // Prisma is the only ORM that uses __SCHEMA_HOST_PATH__ — we still resolve
  // it for prisma below, but the placeholder is a no-op for drizzle (unused).
  const schemaHostPath = orm === 'prisma' ? getMigrateSchemaHostPath(config) : '';

  let migrateCopy: string;
  let migrateDepsInstall: string;
  let migrateCmd: string;

  if (orm === 'drizzle') {
    const configPath = getMigrateDrizzleConfigPath(config);
    migrateCmd = `${dlx} drizzle-kit migrate --config=./${configPath}`;

    if (isMonorepo) {
      // Same shape as prisma: COPY . . + lockfile-driven install. The
      // workspace's packages/db/package.json declares drizzle-kit as a
      // devDep so the install resolves it.
      migrateCopy = 'COPY . .';
      migrateDepsInstall = DOCKERFILE_PM_VALUES[pm].__PM_INSTALL__;
    } else {
      // Flat mode: targeted COPY of the drizzle config + schema source dir
      // + the generated migrations output dir.
      //
      // The migrations output dir (`drizzle/`) only exists after
      // `drizzle-kit generate` has been run. The README's drizzle setup
      // section instructs users to run that before `docker compose run --rm
      // migrate`, so the COPY is a hard requirement and a missing directory
      // is a configuration error worth surfacing as a build failure (rather
      // than silently swallowing it).
      const schemaDir = getMigrateDrizzleSchemaDir(config);
      const outDir = getMigrateDrizzleOutDir(config);
      migrateCopy = [
        `COPY package.json ${lockfile}* pnpm-workspace.yaml* ./`,
        `COPY ${configPath} ./${configPath}`,
        `COPY ${schemaDir} ./${schemaDir}`,
        `COPY ${outDir} ./${outDir}`,
      ].join('\n');
      migrateDepsInstall = buildDrizzleMigrateDepsAdd(pm, config.architecture.database);
    }
  } else {
    // Prisma branch — preserves the existing layout.
    migrateCmd = `${dlx} prisma migrate deploy --schema=./${schemaHostPath}/schema.prisma`;

    if (isMonorepo) {
      // The migrate image needs the full workspace tree so the lockfile-driven
      // install can resolve workspace `db` deps. `COPY . .` plus `.dockerignore`
      // keeps the build context lean enough; the migrate is a one-shot, not a
      // hot-path runtime image.
      migrateCopy = 'COPY . .';
      migrateDepsInstall = DOCKERFILE_PM_VALUES[pm].__PM_INSTALL__;
    } else {
      // Flat mode: keep the legacy targeted COPY pattern. `prisma.config.ts*`
      // glob handles the case where the file doesn't exist.
      //
      // Note: `pnpm-workspace.yaml*` is a no-op glob in flat mode (the file is
      // never emitted there) and remains for any PM. We keep the line — rather
      // than gate it on `pm === 'pnpm'` — so the COPY shape stays uniform
      // across PMs; the `*` makes it a safe match-zero on disk.
      migrateCopy = [
        `COPY package.json ${lockfile}* pnpm-workspace.yaml* ./`,
        `COPY ${schemaHostPath} ./${schemaHostPath}`,
        'COPY prisma.config.ts* ./',
      ].join('\n');
      migrateDepsInstall = MIGRATE_DEPS_ADD[pm];
    }
  }

  let out = template;
  out = out.replaceAll('__SCHEMA_HOST_PATH__', schemaHostPath);
  out = out.replaceAll('__MIGRATE_COPY__', migrateCopy);
  out = out.replaceAll('__MIGRATE_DEPS_INSTALL__', migrateDepsInstall);
  out = out.replaceAll('__MIGRATE_CMD__', migrateCmd);
  return substituteDockerfilePlaceholders(out, pm, config.name!);
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
          .enum(DATABASE_NAMES)
          .default('postgres')
          .describe('Database system. Configures the appropriate database driver and connection.'),
        orm: z
          .enum(ORM_NAMES)
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
  )
  .refine(
    (cfg) => !(cfg.architecture.auth === 'better-auth' && cfg.architecture.database === 'none'),
    {
      message: `Better Auth requires a database. Set architecture.database to one of: ${NON_NONE_DBS}.`,
    }
  )
  .superRefine((cfg, ctx) => {
    const { orm, database } = cfg.architecture;
    if (orm === 'none') return;
    if (ORM_DATABASE_COMPATIBILITY[orm].includes(database)) return;
    const validDbs = ORM_DATABASE_COMPATIBILITY[orm].filter((db) => db !== 'none').join(', ');
    ctx.addIssue({
      code: 'custom',
      message:
        `Invalid combination: orm "${orm}" does not support database "${database}". ` +
        `Valid databases for ${orm}: ${validDbs}`,
      path: ['architecture'],
    });
  });

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
export type ImportRewriteMapping = {
  alias: string;
  replacement: string;
  preserveSubpath: boolean;
};

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
 * alone.
 *
 * Skipped directories: `node_modules`, `.next`, `.prisma`, `.turbo`,
 * `dist`, `public`.
 *
 * Exported standalone (in addition to being used internally) so it can be
 * unit-tested directly without spinning up the full MCP server.
 */
export async function rewriteImportsInTree(
  root: string,
  mappings: ImportRewriteMapping[]
): Promise<void> {
  // Sort longest-prefix-first so a shorter alias can never partially
  // consume a longer one. Callers may pass mappings in any order.
  const sortedMappings = [...mappings].sort((a, b) => b.alias.length - a.alias.length);
  const skipDirs = new Set(['node_modules', '.next', '.prisma', '.turbo', 'dist', 'public']);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      await rewriteImportsInTree(fullPath, mappings);
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

/**
 * Wire `apps/web/package.json` to consume a sibling workspace package under
 * `packages/<packageDir>/`.
 *
 * Resolves the canonical package name from `packages/<packageDir>/package.json`
 * (rather than recomputing one from the project name) and appends
 * `<resolvedName>: 'workspace:*'` to `apps/web/package.json`'s `dependencies`
 * if the entry is missing or stale. Returns the resolved name so callers can
 * include it in user-facing instructions or in subsequent import-rewrite
 * steps.
 *
 * Contract — "no silent fallback" (Group G fix-loop): a missing
 * `packages/<packageDir>/package.json`, an unparsable file, or a missing /
 * empty `name` field is treated as an invariant violation and surfaced as a
 * thrown error rather than papered over with a guessed name. The thrown
 * message always includes the helper name, the offending package directory,
 * and the caller-supplied `hint` so the user knows which precondition was
 * violated.
 *
 * If `apps/web/package.json` itself is missing the helper is a no-op on the
 * write side (both existing callers historically skipped that branch
 * silently when `apps/web` had not been scaffolded yet) — but the resolved
 * name is still returned so callers can proceed.
 *
 * Import-rewriting (e.g. `@/lib/db` → `<pkgName>` or `@/lib/auth` →
 * `<pkgName>/server`) is the caller's responsibility; this helper only
 * handles the workspace-dep wiring half.
 *
 * Callers:
 *   - `NextMCPServer#wireAppsWebToDbPackage` (Group F)
 *   - `NextMCPServer#wireAppsWebToAuthPackage` (Group F1)
 *
 * Exported (module-scope) — matches the precedent of `getAppPath`,
 * `shouldRouteToDbPackage`, etc. The helper has no instance-state dependency
 * (only `projectPath`, `packageDir`, `hint`) so lifting it out makes it
 * directly unit-testable without instantiating the server.
 */
export async function wireAppsWebToWorkspacePackage(
  projectPath: string,
  packageDir: string,
  hint: string
): Promise<string> {
  const appPath = path.join(projectPath, 'apps/web');
  const pkgJsonPath = path.join(projectPath, 'packages', packageDir, 'package.json');

  // 1. Resolve the workspace package name from the on-disk package.json.
  //    A missing file is an invariant violation — the caller is gated on a
  //    precondition (e.g. `shouldRouteToDbPackage(config)`) which means the
  //    upstream emitter MUST have produced this file. Throwing surfaces a
  //    real bug rather than silently picking a guessed name.
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      `wireAppsWebToWorkspacePackage: expected packages/${packageDir}/package.json to exist ` +
        `(upstream emitter should have produced it). ${hint}`
    );
  }

  // Parse the package.json. Read+parse failures are a single error class
  // (corrupt-or-unreadable). The "missing name field" check is intentionally
  // hoisted out of the try/catch so its error message stands alone — the
  // file *was* read fine, it just had no usable `name`. Wrapping that case
  // in a "failed to read" lead clause was misleading.
  let pkg: { name?: unknown };
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `wireAppsWebToWorkspacePackage: failed to read packages/${packageDir}/package.json ` +
        `(upstream emitter should have produced it). ${hint} Underlying error: ${reason}`
    );
  }
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
    throw new Error(
      `wireAppsWebToWorkspacePackage: packages/${packageDir}/package.json has no usable "name" field. ${hint}`
    );
  }
  const resolvedName: string = pkg.name;

  // 2. Append the workspace dep to apps/web/package.json. If apps/web has
  //    not been scaffolded yet (the file is missing) this is a silent
  //    skip — both pre-extraction callers behaved this way and integration
  //    tests rely on that ordering tolerance.
  const appPkgPath = path.join(appPath, 'package.json');
  if (existsSync(appPkgPath)) {
    const appPkg = JSON.parse(await fs.readFile(appPkgPath, 'utf-8'));
    appPkg.dependencies = appPkg.dependencies || {};
    if (appPkg.dependencies[resolvedName] !== 'workspace:*') {
      appPkg.dependencies[resolvedName] = 'workspace:*';
      await fs.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
      logger.info(`Added ${resolvedName}: workspace:* to apps/web/package.json`);
    }
  }

  return resolvedName;
}

const ORM_PACKAGE_SUBDIR: Partial<Record<NonNullable<ProjectConfig['architecture']['orm']>, string>> = {
  prisma: 'db/prisma',
  drizzle: 'db/drizzle',
  mongoose: 'db/mongoose',
};

// Shared raw shapes for tool inputs. McpServer.registerTool accepts a
// ZodRawShapeCompat (Record<string, AnySchema>) and serializes it to JSON
// Schema for tools/list internally — no manual z.toJSONSchema() needed.
const commonInputShape = {
  config: ProjectConfigSchema,
  projectPath: z.string().describe('Path to the project directory'),
} as const;

const scaffoldInputShape = {
  config: ProjectConfigSchema,
  targetPath: z.string().describe('Target directory path, usually the current working directory'),
} as const;

class NextMCPServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: details.name,
      version: details.version,
    });

    this.setupToolHandlers();
  }

  /**
   * Wraps a per-tool implementation in shared `validateAndApplyDefaults` +
   * uniform error handling so each `registerTool` call site stays
   * declarative. The caller-visible response shape (text-content with `❌`
   * / `Error executing` markers on failure) is preserved bit-for-bit so
   * the test client's `isFailure` heuristic and the smoke driver's parser
   * keep working without modification.
   */
  private withValidation<TPathKey extends 'projectPath' | 'targetPath'>(
    name: string,
    pathKey: TPathKey,
    impl: (config: ProjectConfig, projectPath: string) => Promise<{ content: Array<{ type: string; text: string }> }>
  ): (args: { config: ProjectConfig } & Record<TPathKey, string>) => Promise<CallToolResult> {
    return async (args) => {
      try {
        const validatedConfig = this.validateAndApplyDefaults(args.config);
        if (!validatedConfig) {
          throw new Error('Config validation failed');
        }
        // The per-tool methods predate the McpServer migration and were
        // typed before strict CallToolResult inference. Their content arrays
        // use string-literal `type: 'text'` at every call site, so the
        // runtime values are correct — we widen via cast rather than
        // annotating eight helper-method signatures.
        return (await impl(validatedConfig, args[pathKey])) as CallToolResult;
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
    };
  }

  private setupToolHandlers() {
    this.server.registerTool(
      'scaffold_project',
      {
        description: 'Create a new Next.js project with specified configuration',
        inputSchema: scaffoldInputShape,
      },
      this.withValidation('scaffold_project', 'targetPath', (config, targetPath) =>
        this.scaffoldProject(config, targetPath)
      )
    );

    this.server.registerTool(
      'generate_dockerfile',
      {
        description: 'Generate Dockerfile and docker-compose.yml',
        inputSchema: commonInputShape,
      },
      this.withValidation('generate_dockerfile', 'projectPath', (config, projectPath) =>
        this.generateDockerfile(config, projectPath)
      )
    );

    this.server.registerTool(
      'setup_shadcn',
      {
        description: 'Initialize shadcn/ui with defaults and install all components',
        inputSchema: commonInputShape,
      },
      this.withValidation('setup_shadcn', 'projectPath', (config, projectPath) =>
        this.setupShadcn(config, projectPath)
      )
    );

    this.server.registerTool(
      'generate_base_components',
      {
        description: 'Generate base React components and layouts',
        inputSchema: commonInputShape,
      },
      this.withValidation('generate_base_components', 'projectPath', (config, projectPath) =>
        this.generateBaseComponents(config, projectPath)
      )
    );

    this.server.registerTool(
      'setup_database',
      {
        description: 'Generate database configuration and migrations',
        inputSchema: commonInputShape,
      },
      this.withValidation('setup_database', 'projectPath', (config, projectPath) =>
        this.setupDatabase(config, projectPath)
      )
    );

    this.server.registerTool(
      'setup_authentication',
      {
        description: 'Configure authentication system',
        inputSchema: commonInputShape,
      },
      this.withValidation('setup_authentication', 'projectPath', (config, projectPath) =>
        this.setupAuthentication(config, projectPath)
      )
    );

    this.server.registerTool(
      'validate_project',
      {
        description: 'Run validation checks on the generated project',
        inputSchema: commonInputShape,
      },
      this.withValidation('validate_project', 'projectPath', (config, projectPath) =>
        this.validateProject(config, projectPath)
      )
    );

    this.server.registerTool(
      'generate_readme',
      {
        description: 'Generate comprehensive README.md',
        inputSchema: commonInputShape,
      },
      this.withValidation('generate_readme', 'projectPath', (config, projectPath) =>
        this.generateReadme(config, projectPath)
      )
    );
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

    const parsed = JSON.parse(rootPkgRaw);
    if (pm !== 'pnpm') {
      parsed.workspaces = ['apps/*', 'packages/*'];
    } else {
      // The `packageManager` field requires a fully pinned semver — Corepack
      // rejects shorthand like `pnpm@10` ("Invalid package manager
      // specification ... expected a semver version"). Pin to a known-good
      // minor; pnpm 10.0.0 has a workspace regression that breaks `pnpm dlx`
      // from inside a child workspace package, so we steer clear of the first
      // 10.x release.
      parsed.packageManager = 'pnpm@10.18.0';
      parsed.engines = { ...(parsed.engines || { node: '>=24' }), pnpm: '>=10' };
    }

    // Wire the root-level `auth:generate` script when applicable
    // (better-auth + drizzle). Always run from project root with
    // `dotenv -e .env --` so the new auth CLI reads DATABASE_URL.
    const authGenerateScript = getAuthGenerateScript(config);
    if (authGenerateScript) {
      parsed.scripts = { ...(parsed.scripts ?? {}), 'auth:generate': authGenerateScript };
      parsed.devDependencies = {
        ...(parsed.devDependencies ?? {}),
        'dotenv-cli': PACKAGE_VERSIONS['dotenv-cli'],
      };
    }

    rootPkgRaw = JSON.stringify(parsed, null, 2) + '\n';

    await fs.writeFile(path.join(projectPath, 'package.json'), rootPkgRaw);

    // 2. tsconfig.json
    const tsTpl = await fs.readFile(path.join(templatesDir, 'tsconfig.json.template'), 'utf-8');
    await fs.writeFile(path.join(projectPath, 'tsconfig.json'), tsTpl);

    // 3. turbo.json — globalPassThroughEnv is added programmatically (config-gated),
    // not in the template. See `buildGlobalPassThroughEnv`.
    const turboTpl = await fs.readFile(path.join(templatesDir, 'turbo.json.template'), 'utf-8');
    const turbo = JSON.parse(turboTpl);
    turbo.globalPassThroughEnv = buildGlobalPassThroughEnv(config);
    await fs.writeFile(path.join(projectPath, 'turbo.json'), JSON.stringify(turbo, null, 2) + '\n');

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
   * Merge the runtime/dev deps the generated db client + config files actually
   * import (driver, adapter, dotenv, etc.) into `packages/db/package.json`.
   *
   * The ORM-specific package.json templates only declare the ORM core
   * (`@prisma/client` + `prisma`, or `drizzle-orm` + `drizzle-kit`); the per-
   * config deps live in {@link getDbDeps}. This patcher reconciles both so
   * `packages/db` can resolve its own imports under strict pnpm without the
   * template having to enumerate every db × orm combination.
   *
   * Symmetric with the skip in {@link NextMCPServer#updatePackageJson}: the
   * same dep set is added here and removed from `apps/web/package.json` when
   * `shouldRouteToDbPackage(config)` is true.
   */
  private async patchDbWorkspacePackageJson(
    config: ProjectConfig,
    projectPath: string
  ): Promise<void> {
    const { dependencies, devDependencies } = getDbDeps(config);
    if (Object.keys(dependencies).length === 0 && Object.keys(devDependencies).length === 0) {
      return;
    }

    const pkgPath = path.join(projectPath, 'packages/db/package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    pkg.dependencies = { ...(pkg.dependencies ?? {}), ...dependencies };
    pkg.devDependencies = { ...(pkg.devDependencies ?? {}), ...devDependencies };
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
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

    const { orm } = config.architecture;

    // db (D3)
    if (hasDbPackageEmitted(config)) {
      const subdir = ORM_PACKAGE_SUBDIR[orm];
      if (!subdir) throw new Error(`No packages/db template subdir for orm: ${orm}`);
      await this.copyPackageTemplate(config, projectPath, 'db', subdir);
      await this.patchDbWorkspacePackageJson(config, projectPath);
    }

    // auth (D4)
    // Gate must match `shouldRouteToAuthPackage`: the auth template hard-codes
    // `@<projectName>/db: workspace:*` so we only emit `packages/auth` when
    // `packages/db` will also be emitted (i.e. `orm !== 'none'`). For
    // `full + ba + db + orm:none` the auth files stay in `apps/web/src/lib`.
    if (hasAuthPackageEmitted(config)) {
      await this.copyPackageTemplate(config, projectPath, 'auth');
    }

    // ui (D5)
    if (hasUiPackageEmitted(config)) {
      await this.copyPackageTemplate(config, projectPath, 'ui');
    }

    // orpc (D6)
    if (hasOrpcPackageEmitted(config)) {
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

      // Wire `auth:generate` (better-auth + drizzle only). In flat mode the
      // project root and the app share one `package.json`, so this is the
      // matching call site to `scaffoldMonorepoRoot`'s root-level injection.
      // In monorepo modes `updatePackageJson` writes `apps/web/package.json`,
      // not the workspace root, so the script does not belong here.
      if (config.architecture.monorepo === 'none') {
        const authGenerateScript = getAuthGenerateScript(config);
        if (authGenerateScript) {
          additionalScripts['auth:generate'] = authGenerateScript;
        }
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
      // In `full + orm` (shouldRouteToDbPackage), runtime db deps belong on
      // the `packages/db` workspace package — `apps/web` consumes the db
      // surface via the `@<project>/db: workspace:*` dep that
      // wireAppsWebToDbPackage adds. Adding pg/@prisma/adapter-pg/dotenv/
      // drivers here would put them in the wrong workspace and leave
      // packages/db unable to resolve its own imports under strict pnpm.
      // {@link patchDbWorkspacePackageJson} merges these onto packages/db
      // for the routed path; mongoose's single dep is already declared in
      // the mongoose package template.
      if (!shouldRouteToDbPackage(config)) {
        const dbDeps = getDbDeps(config);
        Object.assign(additionalDeps, dbDeps.dependencies);
        Object.assign(additionalDevDeps, dbDeps.devDependencies);

        if (config.architecture.orm === 'mongoose') {
          additionalDeps.mongoose = PACKAGE_VERSIONS.mongoose;
        }
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
      // In `full + better-auth + db + orm` (shouldRouteToAuthPackage),
      // `apps/web` reaches better-auth helpers through
      // `@<project>/auth/exports` (curated re-exports in
      // packages/auth/src/re-exports.ts) so the only better-auth dep needed
      // there is the workspace dep wired by wireAppsWebToAuthPackage.
      // The `packages/auth` template declares `better-auth: catalog:`.
      if (
        config.architecture.auth === 'better-auth' &&
        !shouldRouteToAuthPackage(config)
      ) {
        additionalDeps['better-auth'] = PACKAGE_VERSIONS['better-auth'];
      }

      // `auth:generate` script (flat mode only — monorepo handles this in
      // scaffoldMonorepoRoot) shells `dotenv-cli`. Add it as a devDep so the
      // `dotenv` binary is available in node_modules/.bin.
      if (
        config.architecture.monorepo === 'none' &&
        getAuthGenerateScript(config) !== null
      ) {
        additionalDevDeps['dotenv-cli'] = PACKAGE_VERSIONS['dotenv-cli'];
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

        // Generate migrate service for any ORM that produces SQL migrations
        // (prisma, drizzle). Mongoose stays excluded — mongo is schemaless,
        // there are no SQL migrations to apply.
        if (config.architecture.orm === 'prisma' || config.architecture.orm === 'drizzle') {
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
        .replaceAll('__DATABASE_DEPENDS_ON__', databaseDependsOn)
        .replaceAll('__DATABASE_SERVICE__', databaseService)
        .replaceAll('__MIGRATE_SERVICE__', migrateService)
        .replaceAll('__VOLUMES_SECTION__', volumesSection)
        .replaceAll('__DATABASE_ENV__', databaseEnv)
        .replaceAll('__PRISMA_COMMAND__', prismaCommand)
        .replaceAll('__PRISMA_VOLUMES__', prismaVolumes);

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

      // Generate Dockerfile.migrate for any ORM that produces SQL migrations
      // (prisma, drizzle). Mongoose stays excluded — mongo is schemaless.
      // The template is fully placeholder-driven so it adapts to all four
      // package managers, all three monorepo modes, and both supported ORMs
      // — see {@link substituteMigrateDockerfilePlaceholders}.
      let migrateDockerfileMessage = '';
      const ormUsesMigrateImage =
        config.architecture.orm === 'prisma' || config.architecture.orm === 'drizzle';
      if (ormUsesMigrateImage && config.architecture.database !== 'none') {
        const dockerfileMigrateTemplate = await fs.readFile(
          path.join(__dirname, 'templates', 'docker', 'Dockerfile.migrate'),
          'utf-8'
        );
        const migrateDockerfile = substituteMigrateDockerfilePlaceholders(dockerfileMigrateTemplate, config);
        await fs.writeFile(path.join(projectPath, 'Dockerfile.migrate'), migrateDockerfile);
        const ormLabel = config.architecture.orm === 'prisma' ? 'Prisma' : 'Drizzle';
        migrateDockerfileMessage = `\n- Dockerfile.migrate for running ${ormLabel} migrations`;
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

      const appPath = getAppPath(config, projectPath);
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

      // Write the files (route through getAppPath so monorepo modes write
      // into apps/web/src/... instead of a stray top-level src/ tree).
      await fs.mkdir(path.join(appPath, 'src/app/api/health'), { recursive: true });
      await fs.writeFile(path.join(appPath, 'src/app/page.tsx'), pageTsx);
      await fs.writeFile(path.join(appPath, 'src/app/api/health/route.ts'), healthApiRoute);

      // Only create custom button component if not using shadcn
      if (!useShadcn) {
        await fs.writeFile(path.join(appPath, 'src/components/ui/button.tsx'), buttonComponent);
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

    return template.replaceAll('__DRIVER_IMPORT__', driverImport).replaceAll('__CONNECTION_CODE__', connectionCode);
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

    // Defense-in-depth: ProjectConfigSchema's refines already reject this combo
    // at the MCP boundary (see ORM_DATABASE_COMPATIBILITY usage in
    // ProjectConfigSchema). We re-check here using the same shared constant in
    // case an internal caller bypasses validation.
    if (orm !== 'none' && !ORM_DATABASE_COMPATIBILITY[orm].includes(database)) {
      const validDbs = ORM_DATABASE_COMPATIBILITY[orm].filter((db) => db !== 'none').join(', ');
      return {
        content: [
          {
            type: 'text',
            text:
              `Invalid combination: ${orm} does not support ${database}. ` +
              `Valid databases for ${orm}: ${validDbs}`,
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
    // routing, the config sits at `packages/db/drizzle.config.ts` and the
    // schema barrel at `packages/db/src/schema/index.ts`. In other modes, both
    // live under `<app>/src/lib/db/`. Compute the right path so drizzle-kit
    // can find the schema barrel at runtime.
    const drizzleSchemaPath = shouldRouteToDbPackage(config)
      ? './src/schema/index.ts'
      : './src/lib/db/schema/index.ts';

    configTemplate = configTemplate
      .replace(/__DIALECT__/g, this.getDrizzleDialect(database))
      .replace(/__DB_CREDENTIALS__/g, this.getDrizzleCredentials(database))
      .replace(/__SCHEMA_PATH__/g, drizzleSchemaPath);

    const configPath = path.join(dbBaseDir, 'drizzle.config.ts');
    await fs.writeFile(configPath, configTemplate);

    // Schema is a directory: `schema/index.ts` is a barrel that re-exports
    // every schema module, and `schema/auth.ts` is the better-auth-generated
    // file (populated by `pnpm auth:generate`; empty placeholder until then).
    // Users can drop more table modules alongside `auth.ts` and re-export
    // them from the barrel.
    const schemaDir = path.join(dbSrcDir, 'schema');
    await fs.mkdir(schemaDir, { recursive: true });

    const schemaIndexTemplate = await fs.readFile(
      path.join(__dirname, 'templates/database/drizzle/schema/index.ts.template'),
      'utf-8'
    );
    await fs.writeFile(path.join(schemaDir, 'index.ts'), schemaIndexTemplate);

    const schemaAuthTemplate = await fs.readFile(
      path.join(__dirname, 'templates/database/drizzle/schema/auth.ts.template'),
      'utf-8'
    );
    await fs.writeFile(path.join(schemaDir, 'auth.ts'), schemaAuthTemplate);

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
   *  1. Workspace-dep wiring (resolve canonical name from
   *     `packages/db/package.json` and append `<dbPkgName>: 'workspace:*'` to
   *     `apps/web/package.json`'s `dependencies`) is delegated to the shared
   *     {@link wireAppsWebToWorkspacePackage} helper. The helper enforces
   *     the Group G "no silent fallback" contract — a missing or unparsable
   *     `packages/db/package.json` throws with the caller-supplied hint
   *     rather than guessing a name.
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
    const dbPkgName = await wireAppsWebToWorkspacePackage(
      projectPath,
      'db',
      'Did setup_database run before scaffold_project?'
    );

    // Rewrite `@/lib/db` imports inside apps/web sources.
    const appPath = path.join(projectPath, 'apps/web');
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
   * better-auth core sources have been written into `packages/auth/src/`
   * (Group F1):
   *
   *   - Workspace-dep wiring (resolve canonical name from
   *     `packages/auth/package.json` and append `<authPkgName>: 'workspace:*'`
   *     to `apps/web/package.json`'s `dependencies`) is delegated to the
   *     shared {@link wireAppsWebToWorkspacePackage} helper. The helper
   *     enforces the Group G "no silent fallback" contract — a missing or
   *     unparsable `packages/auth/package.json` throws with the
   *     caller-supplied hint rather than guessing a name.
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
    const authPkgName = await wireAppsWebToWorkspacePackage(
      projectPath,
      'auth',
      "Did scaffold_project run with auth: 'better-auth' and a database configured?"
    );

    const appPath = path.join(projectPath, 'apps/web');

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
   * Thin wrapper that delegates to the exported {@link rewriteImportsInTree}.
   * Kept as an instance method so the existing call sites
   * (`this.rewriteImportsInTree(...)`) keep working without churn. The
   * implementation moved to the top-level export so it can be unit-tested
   * directly without instantiating the server.
   */
  private async rewriteImportsInTree(root: string, mappings: ImportRewriteMapping[]): Promise<void> {
    await rewriteImportsInTree(root, mappings);
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
   * Schema-gen command for the new better-auth CLI (`auth@latest`). Always
   * runs from the project root (see {@link getAuthSchemaCwd}) so paths are
   * project-relative — the same shape works for flat, minimal, and full
   * modes, and matches the persistent `auth:generate` script wired into the
   * project root `package.json` (see {@link getAuthGenerateScript}).
   *
   * For drizzle, `--output` points at the dedicated `schema/auth.ts` file
   * (the auth tables are isolated from user-defined tables; the drizzle
   * schema barrel re-exports both). For prisma, the auth CLI rewrites
   * `schema.prisma` in-place via the prisma datasource it finds in the
   * config, so no `--output` is passed.
   */
  private getAuthSchemaCommand(config: ProjectConfig): string {
    const dlx = this.getPackageRunnerDlx(config.architecture.packageManager);
    const configRelPath = getAuthConfigRelPath(config);
    const outputRel = getAuthSchemaOutputRelPath(config);
    const outputArg = outputRel ? ` --output ${outputRel}` : '';
    return `dotenv -e .env -- ${dlx} auth@latest generate -y --config ${configRelPath}${outputArg}`;
  }

  private getAuthMigrationCommand(config: ProjectConfig): string {
    const { orm, packageManager } = config.architecture;
    const packageRunner = this.getPackageRunner(packageManager);
    const dlx = this.getPackageRunnerDlx(packageManager);

    if (orm === 'prisma') {
      return `${packageRunner} prisma migrate dev -n setup_authentication`;
    }

    if (orm === 'drizzle') {
      return `${packageRunner} drizzle-kit generate && ${packageRunner} drizzle-kit migrate`;
    }

    const configRelPath = getAuthConfigRelPath(config);
    return `dotenv -e .env -- ${dlx} auth@latest migrate -y --config ${configRelPath}`;
  }

  /**
   * cwd for better-auth schema-gen. With `auth@latest`, paths are
   * project-root-relative across all monorepo modes, so cwd is always the
   * project root (matching the persistent `auth:generate` script). Migration
   * cwd still varies — see {@link getAuthMigrationCwd}.
   */
  private getAuthSchemaCwd(_config: ProjectConfig, projectPath: string): string {
    return projectPath;
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
      // Defense-in-depth: ProjectConfigSchema's refine already rejects
      // better-auth + database:'none' at the MCP boundary. We re-check here
      // in case an internal caller bypasses validation.
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
        .replaceAll('__ADAPTER_IMPORT__', adapterImport)
        .replaceAll('__DATABASE_CONFIG__', databaseConfig);
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
        const authIndexTemplate = await fs.readFile(
          path.join(__dirname, 'templates/auth/index.ts.template'),
          'utf-8'
        );
        await fs.writeFile(authPaths.indexPath, authIndexTemplate);
      }

      // Resolve the import specifier the templated app-level files should
      // use to reach the headless `auth` and `authClient` exports. In routed
      // mode this is the workspace package's subpath exports
      // (`<pkg>/server` and `<pkg>/client`); in legacy mode it stays as the
      // local `@/lib/auth` / `@/lib/auth-client` aliases.
      const authPkgName = routedToAuthPkg ? `@${config.name}/auth` : null;
      const authServerImport = authPkgName ? `${authPkgName}/server` : '@/lib/auth';
      const authClientImport = authPkgName ? `${authPkgName}/client` : '@/lib/auth-client';

      // Resolve where `route.ts` and `proxy.ts` should reach for the
      // better-auth helpers. In routed mode they resolve through
      // `@<project>/auth/exports` (curated re-exports of
      // `better-auth/cookies`, `better-auth/next-js`, `better-auth/node`)
      // so `apps/web` doesn't need a direct `better-auth` dep. In legacy
      // mode `packages/auth` doesn't exist, so we keep the upstream
      // subpaths.
      const betterAuthCookiesImport = authPkgName ? `${authPkgName}/exports` : 'better-auth/cookies';
      const betterAuthNextJsImport = authPkgName ? `${authPkgName}/exports` : 'better-auth/next-js';

      // Step 4: Generate API route. Substitutes the auth-server import so
      // `route.ts` reaches the workspace package in routed mode.
      const routeTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth-route.ts.template'), 'utf-8');
      const routeContent = routeTemplate
        .replaceAll('__AUTH_SERVER_IMPORT__', authServerImport)
        .replaceAll('__BETTER_AUTH_NEXTJS_IMPORT__', betterAuthNextJsImport);
      await fs.writeFile(path.join(appPath, 'src/app/api/auth/[...all]/route.ts'), routeContent);

      // Step 5: Generate AuthUIProvider. Substitutes the auth-client import.
      const authProviderTemplate = await fs.readFile(
        path.join(__dirname, 'templates/auth/auth-ui-provider.tsx.template'),
        'utf-8'
      );
      const authProviderContent = authProviderTemplate.replaceAll('__AUTH_CLIENT_IMPORT__', authClientImport);
      await fs.writeFile(path.join(appPath, 'src/providers/auth-ui-provider.tsx'), authProviderContent);

      // Step 6: Generate dynamic auth pages & layout
      // Step 7: Generate dynamic account pages
      // Step 8: Generate UserButton component
      // Step 8.5: Generate proxy.ts (uses better-auth/cookies, routed via
      // `@<project>/auth/exports` in routed mode).
      const proxyTemplate = await fs.readFile(
        path.join(__dirname, 'templates/auth/proxy.ts.template'),
        'utf-8'
      );
      const proxyContent = proxyTemplate.replaceAll(
        '__BETTER_AUTH_COOKIES_IMPORT__',
        betterAuthCookiesImport
      );
      await fs.writeFile(path.join(appPath, 'src/proxy.ts'), proxyContent);

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

        if (authRegistryResult.success && settingsAndButtonResult.success) {
          registryInstallSummary = 'Installed better-auth-ui shadcn-registry components in apps/web';
        } else {
          const failed: string[] = [];
          if (!authRegistryResult.success) failed.push('better-auth-ui auth registry');
          if (!settingsAndButtonResult.success) failed.push('better-auth-ui settings/user-button registry');
          registryInstallSummary = `Failed to install: ${failed.join(', ')} — see logs for details`;
        }
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

      // Step 13: Generate success message with instructions
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
      // package.json and tsconfig.json live at the workspace root in every
      // mode (Group C emits a workspace tsconfig in monorepo modes too), so
      // these checks stay anchored at projectPath.
      await fs.access(path.join(projectPath, 'package.json'));
      validationResults.push('✅ package.json exists');

      // next.config.ts is owned by the Next.js app — flat at projectPath in
      // `monorepo: 'none'`, but at apps/web in monorepo modes. Use
      // getAppPath so the existence check resolves to the right location.
      const appPath = getAppPath(config, projectPath);
      const nextConfigPath = path.join(appPath, 'next.config.ts');
      await fs.access(nextConfigPath);
      const nextConfigDisplay = path.relative(projectPath, nextConfigPath) || 'next.config.ts';
      validationResults.push(`✅ next.config.ts exists (${nextConfigDisplay})`);

      // Workspace TypeScript config (the workspace base in monorepo modes).
      await fs.access(path.join(projectPath, 'tsconfig.json'));
      validationResults.push('✅ tsconfig.json exists');

      // Attempt to build (and best-effort lint/typecheck) unless skipped.
      // We always invoke the package manager from projectPath: in monorepo
      // modes the workspace root scripts (`build`, `lint`, `typecheck`) are
      // themselves Turbo runners, so this fans out across workspaces
      // without us having to know about `pnpm -r`/`-F` flags. In flat mode
      // these are plain Next.js scripts.
      if (!config.architecture.skipInstall) {
        const pm = config.architecture.packageManager;
        const buildResult = this.execCommand(`${pm} run build`, projectPath, 'validate build');
        if (!buildResult.success) {
          throw new Error('[validate build failed]: Check logs for details');
        }
        validationResults.push('✅ Project builds successfully');

        // Best-effort: run lint/typecheck if a corresponding root script
        // exists. We don't require these — older flat-mode projects might
        // not define `typecheck` (the flat scaffold uses `type-check`),
        // and we shouldn't make validation fail when a script is simply
        // absent. Read package.json once and probe.
        try {
          const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
          const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
          const scripts = pkg.scripts ?? {};

          const optionalScripts: Array<{ key: string; label: string }> = [
            { key: 'lint', label: 'lint' },
            // Prefer `typecheck` (monorepo root convention, matches turbo
            // pipeline). Fall back to `type-check` (flat-mode convention).
            { key: scripts.typecheck ? 'typecheck' : 'type-check', label: 'typecheck' },
          ];

          for (const { key, label } of optionalScripts) {
            if (!scripts[key]) {
              validationResults.push(`⚠️ Skipped ${label} validation (no \`${key}\` script in package.json)`);
              continue;
            }
            const result = this.execCommand(`${pm} run ${key}`, projectPath, `validate ${label}`);
            if (!result.success) {
              throw new Error(`[validate ${label} failed]: Check logs for details`);
            }
            validationResults.push(`✅ ${label} passes`);
          }
        } catch (error) {
          // If the package.json read or parse fails, we can't probe
          // scripts — surface the issue and bail to the outer catch.
          if (error instanceof Error && error.message.startsWith('[validate ')) throw error;
          throw error;
        }
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
      const hasDbPackage = hasDbPackageEmitted(config);
      const hasAuthPackage = hasAuthPackageEmitted(config);
      const hasUiPackage = hasUiPackageEmitted(config);
      const hasOrpcPackage = hasOrpcPackageEmitted(config);
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

   Or, in the dockerized environment, generate the SQL locally and apply it via the migrate service:
   \`\`\`bash
   ${drizzleCdPrefix}${prismaExec} drizzle-kit generate
   docker compose run --rm migrate
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

      // Generate Docker monorepo migrate note. In monorepo mode the web
      // service no longer auto-applies migrations on boot (Group H made the
      // inline `prisma migrate deploy` skip web for monorepo), so users must
      // invoke the dedicated migrate service. `Dockerfile.migrate` now
      // templatizes per monorepo mode AND per ORM (prisma + drizzle) — see
      // {@link substituteMigrateDockerfilePlaceholders}.
      let monorepoDockerNotes = '';
      const ormUsesMigrateImage =
        architecture.orm === 'prisma' || architecture.orm === 'drizzle';
      if (isMonorepo && ormUsesMigrateImage && architecture.database !== 'none') {
        const ormLabel = architecture.orm === 'prisma' ? 'Prisma' : 'Drizzle';
        monorepoDockerNotes = `

### Applying database migrations (monorepo)

The web service no longer runs ${ormLabel} migrations on startup in monorepo mode. After bringing the stack up, apply pending migrations explicitly:

\`\`\`bash
docker compose run --rm migrate
\`\`\`
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

      // Emit agent-facing docs alongside the README. Both files always live at
      // the workspace root (not under apps/web), regardless of monorepo mode —
      // they're project-level documentation. CLAUDE.md is a fixed pointer; the
      // real content lives in AGENTS.md so we don't drift two copies.
      await this.generateAgentsMd(config, projectPath);
      await this.generateClaudeMd(projectPath);

      return {
        content: [
          {
            type: 'text',
            text: [
              '✅ Generated comprehensive project documentation',
              '',
              'Files generated:',
              '- README.md',
              '- AGENTS.md',
              '- CLAUDE.md',
            ].join('\n'),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to generate project documentation: ${errorMessage}`,
          },
        ],
      };
    }
  }

  /**
   * Emit `<projectPath>/AGENTS.md` — agent-facing documentation that mirrors
   * the actual scaffold for this config. Branches on the same gates the
   * scaffold uses so the doc never claims a `packages/*` exists when it
   * doesn't, and import strings line up with what F1/G1 wire up
   * (`@<n>/db`, `@<n>/auth/server`, `@<n>/auth/client` in routed mode;
   * `@/lib/db`, `@/lib/auth`, `@/lib/auth-client` otherwise).
   */
  private async generateAgentsMd(config: ProjectConfig, projectPath: string): Promise<void> {
    const { architecture } = config;
    const pm = architecture.packageManager;
    const isMonorepo = architecture.monorepo !== 'none';
    const isFullMonorepo = architecture.monorepo === 'full';

    const hasDbPackage = hasDbPackageEmitted(config);
    const hasAuthPackage = hasAuthPackageEmitted(config);
    const hasUiPackage = hasUiPackageEmitted(config);
    const hasOrpcPackage = hasOrpcPackageEmitted(config);

    // Compute import strings once. These have to track F1/G1's wiring exactly:
    // - `shouldRouteToDbPackage` -> `@<projectName>/db` (workspace dep), else `@/lib/db`
    // - `shouldRouteToAuthPackage` -> `@<projectName>/auth/{server,client}`,
    //   else `@/lib/auth` and `@/lib/auth-client`.
    const routedToDbPkg = shouldRouteToDbPackage(config);
    const routedToAuthPkg = shouldRouteToAuthPackage(config);
    const dbImportSpec = routedToDbPkg ? `@${config.name}/db` : '@/lib/db';
    const authServerImportSpec = routedToAuthPkg
      ? `@${config.name}/auth/server`
      : '@/lib/auth';
    const authClientImportSpec = routedToAuthPkg
      ? `@${config.name}/auth/client`
      : '@/lib/auth-client';

    // Stack summary (one paragraph)
    const stackBits: string[] = [`Next.js 16 (App Router)`];
    stackBits.push(architecture.typescript ? 'TypeScript' : 'JavaScript');
    stackBits.push(`package manager: ${pm}`);
    stackBits.push(`monorepo: ${architecture.monorepo}`);
    if (architecture.database !== 'none') {
      stackBits.push(
        `${architecture.database}${architecture.orm !== 'none' ? ` + ${architecture.orm}` : ''}`
      );
    }
    if (architecture.auth !== 'none') stackBits.push(`${architecture.auth}`);
    if (architecture.uiLibrary === 'shadcn') stackBits.push('shadcn/ui');
    if (architecture.rpc === 'orpc') stackBits.push('oRPC');
    if (architecture.testing !== 'none') stackBits.push(`${architecture.testing} (testing)`);

    // Workspace layout block — only meaningful in monorepo modes.
    let workspaceLayout = '';
    if (isMonorepo) {
      const layoutLines: string[] = [];
      layoutLines.push('- `apps/web/` — the Next.js application (routes, components, hooks).');
      if (hasDbPackage) {
        layoutLines.push(
          `- \`packages/db/\` — database client + ${architecture.orm === 'prisma' ? 'Prisma schema' : architecture.orm === 'drizzle' ? 'Drizzle schema' : 'schema'} (workspace package \`@${config.name}/db\`).`
        );
      }
      if (hasAuthPackage) {
        layoutLines.push(
          `- \`packages/auth/\` — Better Auth core (workspace package \`@${config.name}/auth\`, with \`/server\` and \`/client\` subpath exports).`
        );
      }
      if (hasUiPackage) {
        layoutLines.push(
          `- \`packages/ui/\` — shared shadcn/ui components (workspace package \`@${config.name}/ui\`).`
        );
      }
      if (hasOrpcPackage) {
        layoutLines.push(
          `- \`packages/orpc/\` — oRPC contracts/handlers (workspace package \`@${config.name}/orpc\`).`
        );
      }
      if (isFullMonorepo) {
        layoutLines.push('- `packages/eslint-config/` — shared ESLint config.');
        layoutLines.push('- `packages/typescript-config/` — shared TypeScript config (`base.json`).');
      }

      workspaceLayout = `
## Workspace layout

${layoutLines.join('\n')}

The workspace is wired through \`pnpm-workspace.yaml\` (or the equivalent \`workspaces\` field) and \`turbo.json\` — \`build\`, \`lint\`, and \`typecheck\` at the root fan out to every workspace.
`;
    }

    // Commands block — root-level scripts, plus per-workspace filter examples.
    let commandsBlock = '';
    if (isMonorepo) {
      const filterFlag = pm === 'pnpm' ? '--filter' : '--filter';
      commandsBlock = `
## Commands

Run from the workspace root — these delegate to Turborepo, which fans out across all workspaces:

\`\`\`bash
${pm} install                        # Install dependencies for all workspaces
${pm} dev                            # Run dev for every workspace
${pm} build                          # Build every workspace
${pm} lint                           # Lint every workspace
${pm} run typecheck                  # Type-check every workspace
${architecture.testing !== 'none' ? `${pm} test                           # Run tests across workspaces\n` : ''}${pm} run pipeline                   # Run \`build\`, \`lint\`, and \`test\` together (Turbo)
\`\`\`

To target a single workspace, use ${pm}'s ${filterFlag} flag:

\`\`\`bash
${pm} ${filterFlag} @${config.name}/web dev       # Dev for apps/web only
${pm} ${filterFlag} @${config.name}/web build     # Build apps/web only
\`\`\`
`;
    } else {
      commandsBlock = `
## Commands

\`\`\`bash
${pm} install            # Install dependencies
${pm} dev                # Start the dev server (Turbopack)
${pm} build              # Build for production
${pm} start              # Start the production server
${pm} lint               # Run ESLint
${pm} run type-check     # Run TypeScript type checking
${architecture.testing !== 'none' ? `${pm} test               # Run tests\n` : ''}\`\`\`
`;
    }

    // Where-to-find pointer block. Only emit a row when the config produces it.
    const findRows: string[] = [];
    findRows.push(
      `- **App routes**: \`${isMonorepo ? 'apps/web/src/app/' : 'src/app/'}\``
    );
    if (architecture.uiLibrary === 'shadcn') {
      findRows.push(
        `- **UI components**: \`${hasUiPackage ? 'packages/ui/' : isMonorepo ? 'apps/web/src/components/' : 'src/components/'}\``
      );
    } else {
      findRows.push(
        `- **Components**: \`${isMonorepo ? 'apps/web/src/components/' : 'src/components/'}\``
      );
    }
    if (architecture.database !== 'none' && architecture.orm !== 'none') {
      findRows.push(
        `- **Database client**: \`${routedToDbPkg ? 'packages/db/' : isMonorepo ? 'apps/web/src/lib/db/' : 'src/lib/db/'}\``
      );
    }
    if (architecture.auth === 'better-auth') {
      findRows.push(
        `- **Auth core**: \`${routedToAuthPkg ? 'packages/auth/' : isMonorepo ? 'apps/web/src/lib/auth.ts' : 'src/lib/auth.ts'}\``
      );
      findRows.push(
        `- **Auth UI**: \`${isMonorepo ? 'apps/web/src/components/auth/' : 'src/components/auth/'}\``
      );
    }
    if (hasOrpcPackage) {
      findRows.push(`- **oRPC routes/router**: \`packages/orpc/\``);
    }

    // Conventions section — import strings + workspace dep notation.
    const conventionLines: string[] = [];
    if (architecture.database !== 'none' && architecture.orm !== 'none') {
      conventionLines.push(
        `- **Database imports**: import the client from \`${dbImportSpec}\`${routedToDbPkg ? ' (workspace package).' : '.'}`
      );
    }
    if (architecture.auth === 'better-auth') {
      conventionLines.push(
        `- **Auth imports**: server-side from \`${authServerImportSpec}\`, client-side from \`${authClientImportSpec}\`.`
      );
    }
    if (isFullMonorepo) {
      conventionLines.push(
        `- **Workspace deps**: cross-package references use \`workspace:*\` in \`package.json\` and resolve to the local sources at install time.`
      );
      if (pm === 'pnpm') {
        conventionLines.push(
          `- **Catalog versions** (pnpm): shared dependency versions are declared once under the \`catalog:\` block in \`pnpm-workspace.yaml\` — referenced as \`"catalog:"\` from package.json files.`
        );
      }
      conventionLines.push(
        `- **Shared config**: ESLint and TypeScript configs are sourced from \`packages/eslint-config\` and \`packages/typescript-config\` — extend those rather than redeclaring per-package.`
      );
    }

    // Pitfalls / gotchas — only the ones that apply to this config.
    // Hoist shared derivations used across the ORM-specific schema-change
    // pitfalls so we don't recompute them per-branch.
    const dbPackageCd = hasDbPackage ? 'cd packages/db && ' : '';
    const pmExec = pm === 'npm' ? 'npx' : `${pm} exec`;
    const pitfallLines: string[] = [];
    if (
      isMonorepo &&
      (architecture.orm === 'prisma' || architecture.orm === 'drizzle') &&
      architecture.database !== 'none'
    ) {
      pitfallLines.push(
        `- **Migrations don't run on web boot in monorepo mode.** After \`docker compose up\`, apply pending migrations with \`docker compose run --rm migrate\`.`
      );
    }
    if (isFullMonorepo) {
      pitfallLines.push(
        `- **Adding a new package.** Drop it under \`packages/\` and ${pm === 'pnpm' ? "ensure the path matches the glob in `pnpm-workspace.yaml`" : 'ensure it matches the `workspaces` glob in the root `package.json`'} — Turborepo picks it up automatically once it exists in the workspace.`
      );
    }
    if (architecture.orm === 'prisma' && architecture.database !== 'none') {
      pitfallLines.push(
        `- **Schema changes.** After editing the Prisma schema, regenerate the client: \`${dbPackageCd}${pmExec} prisma generate\`.`
      );
    }
    if (architecture.orm === 'drizzle' && architecture.database !== 'none') {
      pitfallLines.push(
        `- **Schema changes.** After editing the Drizzle schema, regenerate migrations: \`${dbPackageCd}${pmExec} drizzle-kit generate\`.`
      );
    }

    // Testing pointer.
    let testingBlock = '';
    if (architecture.testing !== 'none') {
      const testsLocation = isMonorepo ? 'apps/web/' : 'the project root';
      testingBlock = `
## Testing

Tests run with \`${pm} test\`${architecture.testing === 'vitest' ? ' (Vitest)' : architecture.testing === 'jest' ? ' (Jest)' : architecture.testing === 'playwright' ? ' (Playwright)' : ''}. Test files live alongside the code they cover (see ${testsLocation}).
`;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Assemble the document.
    const sections: string[] = [];
    sections.push(`# AGENTS.md`);
    sections.push('');
    sections.push(
      `Working notes for AI agents (Claude Code, Cursor, etc.) on the **${config.name}** codebase.`
    );
    sections.push('');
    sections.push(`## Project overview`);
    sections.push('');
    // Append trailing punctuation to the user-supplied description if it's
    // missing one, so the overview doesn't read as a run-on into the Stack
    // sentence (e.g. "Foo bar Stack: ...").
    const descriptionRaw = config.description || `${config.name} is a Next.js application.`;
    const description = /[.!?]$/.test(descriptionRaw) ? descriptionRaw : `${descriptionRaw}.`;
    sections.push(`${description} Stack: ${stackBits.join(', ')}.`);

    if (workspaceLayout) sections.push(workspaceLayout);
    sections.push(commandsBlock);

    sections.push(`## Where to find things`);
    sections.push('');
    sections.push(findRows.join('\n'));
    sections.push('');

    if (conventionLines.length > 0) {
      sections.push(`## Conventions`);
      sections.push('');
      sections.push(conventionLines.join('\n'));
      sections.push('');
    }

    if (pitfallLines.length > 0) {
      sections.push(`## Pitfalls and gotchas`);
      sections.push('');
      sections.push(pitfallLines.join('\n'));
      sections.push('');
    }

    if (testingBlock) sections.push(testingBlock);

    sections.push('---');
    sections.push('');
    sections.push(
      `Generated by next-mcp on ${today}. This is a maintenance note, not a contract — keep it in sync with the code by hand if structure shifts.`
    );
    sections.push('');

    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), sections.join('\n'));
  }

  /**
   * Emit `<projectPath>/CLAUDE.md` — a fixed pointer at AGENTS.md. Same
   * content for every project; no config-aware branching. Existing files are
   * overwritten unconditionally (matches README behavior).
   */
  private async generateClaudeMd(projectPath: string): Promise<void> {
    const claudeMd = `# CLAUDE.md

This project's agent guidance lives in [AGENTS.md](./AGENTS.md) — the single source of truth for AI agents working on this codebase.
`;
    await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), claudeMd);
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
