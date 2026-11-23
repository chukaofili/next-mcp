# @chukaofili/next-mcp

Scaffold production-ready Next.js apps (flat or workspace) with Docker, auth, db, and shadcn/ui — driven via MCP.

[![npm version](https://badge.fury.io/js/%40chukaofili%2Fnext-mcp.svg)](https://www.npmjs.com/package/@chukaofili/next-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Automated Next.js Setup**: Generate complete Next.js projects with TypeScript, React Compiler, and modern tooling
- **Database Integration**: Support for PostgreSQL, MySQL, MongoDB, and SQLite with Prisma, Drizzle, or Mongoose
- **Authentication**: Pre-configured better-auth integration with user management
- **UI Components**: Automatic shadcn/ui setup with all components
- **State Management**: Optional Zustand or Redux integration
- **Testing**: Built-in support for Vitest, Jest, or Playwright
- **Docker Support**: Production-ready Dockerfile and docker-compose.yml generation
- **Monorepo modes**: Flat, `minimal` (apps/web + workspace root), or `full` (apps/web + `packages/{db,auth,ui,orpc,eslint-config,typescript-config}`)
- **RPC layer**: Optional oRPC integration (full-mode only) — emits `packages/orpc` with router, middleware, and procedure scaffolding
- **Migrate Dockerfile**: Templated `Dockerfile.migrate` covers both Prisma (`migrate deploy`) and Drizzle (`drizzle-kit migrate`) — run via `docker compose run --rm migrate`
- **Schema-validated configuration**: Illegal combinations (better-auth without a database, drizzle with mongodb, oRPC without full-mode, etc.) are rejected at config-parse time with actionable errors
- **Headless smoke driver**: `pnpm run smoke` runs 5 preset configs through the full tool sequence in ~6s — CI signal on every PR

## Installation

### Prerequisites

- Node.js >= 24
- pnpm >= 10 (or npm/yarn/bun)

### Claude CLI

Run the following command to add `next-mcp` as an MCP server:

```bash
claude mcp add --transport stdio --scope user next-mcp -- npx @chukaofili/next-mcp@latest
```

### Google Gemini CLI

Run the following command to add `next-mcp` as an MCP server:

```bash
gemini mcp add --transport stdio --scope user next-mcp npx @chukaofili/next-mcp@latest
```

### Cursor IDE

Add to your Cursor configuration file (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "next-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["@chukaofili/next-mcp@latest"]
    }
  }
}
```

## Available Tools

### scaffold_project

Create a complete Next.js project with your specified configuration.

**Key Configuration Options** (defaults shown):

- `typescript` — `true`. Enable TypeScript.
- `reactCompiler` — `false`. Enable the experimental React Compiler.
- `skipInstall` — `false`. Skip package-manager install (useful in CI).
- `packageManager` — `pnpm`. One of `npm`, `pnpm`, `yarn`, `bun`.
- `database` — `postgres`. One of `none`, `postgres`, `mysql`, `mongodb`, `sqlite`.
- `orm` — `prisma`. One of `none`, `prisma`, `drizzle`, `mongoose`.
- `auth` — `better-auth`. One of `none`, `better-auth`.
- `uiLibrary` — `shadcn`. One of `none`, `shadcn`.
- `stateManagement` — `none`. One of `none`, `zustand`, `redux`.
- `testing` — `none`. One of `none`, `jest`, `vitest`, `playwright`.
- `monorepo` — `none`. One of `none` (flat), `minimal` (workspace + `apps/web`), `full` (workspace + opinionated `packages/*`).
- `rpc` — `none`. One of `none`, `orpc`. `orpc` requires `monorepo: 'full'`.

**Full-mode emission gates.** In `monorepo: 'full'`, the `packages/*` directories appear conditionally:

- `packages/db` — when `database !== 'none'` and `orm !== 'none'`
- `packages/auth` — when `auth === 'better-auth'` (and a db package exists)
- `packages/ui` — when `uiLibrary === 'shadcn'`
- `packages/orpc` — when `rpc === 'orpc'`
- `packages/eslint-config`, `packages/typescript-config` — always emitted in full mode

**Example:**

```json
{
  "config": {
    "name": "my-awesome-app",
    "architecture": {
      "monorepo": "full",
      "typescript": true,
      "database": "postgres",
      "orm": "prisma",
      "auth": "better-auth",
      "uiLibrary": "shadcn",
      "rpc": "orpc",
      "stateManagement": "zustand",
      "testing": "vitest"
    }
  },
  "targetPath": "/path/to/projects"
}
```

### Other Tools

- **generate_dockerfile** — Generate production-ready Docker configuration. Selects between flat-mode `Dockerfile` and `Dockerfile.monorepo` (turbo-prune multi-stage build) based on `monorepo`. Emits `Dockerfile.migrate` for prisma + drizzle.
- **setup_shadcn** — Initialize shadcn/ui with all components. In `monorepo: 'full' + uiLibrary: 'shadcn'`, runs `shadcn init` in both `apps/web` and `packages/ui`.
- **generate_base_components** — Generate essential React components and layouts (routed through `apps/web` in monorepo modes).
- **setup_database** — Configure database connection and migrations. In full mode (with a db + orm), routes sources into `packages/db`.
- **setup_authentication** — Configure better-auth with login/signup pages. In full mode, routes server config into `packages/auth` and wires `apps/web` against it as a `workspace:*` dep.
- **validate_project** — Run comprehensive validation checks.
- **generate_readme** — Generate comprehensive project documentation.

### Schema Constraints

`ProjectConfigSchema` enforces three cross-field rules at config-parse time. Violations surface as Zod errors before any tool work begins.

- **better-auth requires a database.** Setting `auth: 'better-auth'` with `database: 'none'` is rejected with: _"Better Auth requires a database. Set architecture.database to one of: postgres, mysql, mongodb, sqlite."_
- **ORM/database compatibility.** `mongoose` only pairs with `mongodb`; `drizzle` excludes `mongodb`; `prisma` accepts all four. The error message names the offending pair and lists the valid databases for the chosen ORM (e.g. _"Invalid combination: orm 'drizzle' does not support database 'mongodb'. Valid databases for drizzle: postgres, mysql, sqlite"_).
- **oRPC requires full mode.** Setting `rpc: 'orpc'` with `monorepo !== 'full'` is rejected with: _"rpc: 'orpc' requires monorepo: 'full'"_.

## Example Workflow

A typical full-mode flow exercises all eight tools in sequence:

1. **Scaffold the workspace.** _"Use next-mcp to scaffold a project named 'my-app' with `monorepo: 'full'`, postgres + prisma, better-auth, shadcn, and orpc."_
2. **Wire the database package.** _"Run setup_database against the project."_ — emits `packages/db/{prisma,src}` and adds `@my-app/db: workspace:*` to `apps/web/package.json`.
3. **Wire authentication.** _"Run setup_authentication."_ — emits `packages/auth/src/{server,client}.ts` and login/signup routes under `apps/web/src/app`.
4. **Initialize shadcn/ui.** _"Run setup_shadcn."_ — initializes `apps/web` and `packages/ui`, installs all components into `packages/ui`.
5. **Generate Docker assets.** _"Run generate_dockerfile."_ — emits `Dockerfile.monorepo`, `Dockerfile.migrate`, `docker-compose.yml`, and `.dockerignore`.
6. **Generate base components.** _"Run generate_base_components."_ — pages and layouts under `apps/web/src/app`.
7. **Generate the README.** _"Run generate_readme."_
8. **Validate.** _"Run validate_project."_

## Development

### Build, test, smoke

```bash
# Build
pnpm build

# Run tests (vitest)
pnpm test

# Run all five smoke presets (~6s total, CI-safe)
pnpm smoke

# Run a single preset
pnpm smoke variant-d-flat-regression

# Run with MCP Inspector
pnpm inspector

# Lint and format
pnpm lint
pnpm format
```

The smoke driver (`tools/smoke.ts`) drives the MCP server over stdio for five preset configs (flat, minimal, full × 3 variants) running the canonical 8-tool sequence end-to-end. It runs on every PR via CI.

### Project Structure

```text
next-mcp/
├── src/
│   ├── index.ts              # MCP server (single-file; ProjectConfigSchema, helpers, NextMCPServer class)
│   └── templates/            # Project templates (auth, database, docker, packages, root files)
├── tools/
│   └── smoke.ts              # Headless smoke driver (5 presets, runs in CI)
├── tests/
│   ├── unit/                 # Pure-function tests
│   └── integration/          # End-to-end tool tests via MCPTestClient
└── docs/
    └── plans/                # Design docs, implementation plans, smoke procedure, fix punch list
```

## Environment Variables

After scaffolding, configure these in your project's `.env`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"

# Authentication
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"

# Application
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Troubleshooting

### Logs

All logs are stored in `~/.next-mcp/`:

```bash
# View production logs
tail -f ~/.next-mcp/next-mcp.log

# View test logs
tail -f ~/.next-mcp/next-mcp-test.log
```

### MCP Connection Issues

1. Check your Claude Desktop configuration syntax
2. Verify the project is built (`pnpm build` if running locally)
3. Ensure Node.js >= 24 is installed
4. Check logs in `~/.next-mcp/next-mcp.log`

If MCP transport seems off but you want to verify generation works, `pnpm smoke` is the fastest path — it bypasses any client-side wiring and runs the server directly over stdio.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Submit a Pull Request

## Links

- [GitHub Repository](https://github.com/chukaofili/next-mcp)
- [Issue Tracker](https://github.com/chukaofili/next-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com)

---

Made with ❤️ for the Next.js community
