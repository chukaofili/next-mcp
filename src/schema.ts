import * as z from 'zod';

/**
 * Side-effect-free schema module. Exports the project config schema, its
 * literal-set sources, and the orm/database compatibility table — everything
 * an external consumer (e.g. the smoke driver in `tools/smoke.ts`) needs to
 * validate a config without booting the MCP server.
 *
 * `src/index.ts` is the executable server entrypoint and runs
 * `new NextMCPServer().run()` at module load. Importing the schema from there
 * starts a stdio server in the importing process, which is wrong for any
 * non-server caller. Read schema/types from THIS module instead.
 */

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
  // Prisma supports all 4 dialects because the generator now scaffolds a
  // dialect-agnostic client (bare `new PrismaClient()` — no driver
  // adapter) and `getDbDeps` only declares `@prisma/client` + `prisma` +
  // `dotenv` (no per-dialect driver). The bundled Prisma engine handles
  // the dialect from the schema.prisma datasource, which `prisma init
  // --datasource-provider <dialect>` writes during scaffolding.
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

export const ProjectConfigSchema = z
  .object({
    name: z
      .string()
      .optional()
      .describe('Project name. If not provided, a unique name will be generated automatically.'),
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
          .describe(
            'Monorepo layout. `none` = flat project. `minimal` = workspaces + Turborepo with apps/web. `full` = minimal plus opinionated shared packages.'
          ),
        rpc: z
          .enum(['none', 'orpc'])
          .default('none')
          .describe("RPC layer. `orpc` requires `monorepo === 'full'` (emits packages/orpc)."),
      })
      .describe('Project architecture configuration. Defines the technology stack and features.'),
  })
  .refine((cfg) => !(cfg.architecture.rpc === 'orpc' && cfg.architecture.monorepo !== 'full'), {
    message: 'rpc: "orpc" requires monorepo: "full"',
  })
  .refine((cfg) => !(cfg.architecture.auth === 'better-auth' && cfg.architecture.database === 'none'), {
    message: `Better Auth requires a database. Set architecture.database to one of: ${NON_NONE_DBS}.`,
  })
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
