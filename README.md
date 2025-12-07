# @chukaofili/next-mcp

A Model Context Protocol (MCP) server for scaffolding production-ready Next.js applications with Docker support, authentication, database integration, and more.

[![npm version](https://badge.fury.io/js/@chukaofili%2Fnext-mcp.svg)](https://www.npmjs.com/package/@chukaofili/next-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Automated Next.js Setup**: Generate complete Next.js projects with TypeScript, React Compiler, and modern tooling
- **Database Integration**: Support for PostgreSQL, MySQL, MongoDB, and SQLite with Prisma, Drizzle, or Mongoose
- **Authentication**: Pre-configured better-auth integration with user management
- **UI Components**: Automatic shadcn/ui setup with all components
- **State Management**: Optional Zustand or Redux integration
- **Testing**: Built-in support for Vitest, Jest, or Playwright
- **Docker Support**: Production-ready Dockerfile and docker-compose.yml generation

## Installation

### Prerequisites

- Node.js >= 24
- pnpm >= 10 (or npm/yarn/bun)

### Claude Desktop

Add to your configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "next-mcp": {
      "command": "npx",
      "args": ["@chukaofili/next-mcp"]
    }
  }
}
```

### Cursor IDE

1. Open Cursor Settings (Cmd/Ctrl + Shift + P → "Preferences: Open User Settings (JSON)")
2. Add to your settings:

```json
{
  "mcp.servers": {
    "next-mcp": {
      "command": "npx",
      "args": ["@chukaofili/next-mcp"]
    }
  }
}
```

### Google Gemini Code Assist

Add to your Gemini configuration file (`~/.config/gemini/mcp.json`):

```json
{
  "mcpServers": {
    "next-mcp": {
      "command": "npx",
      "args": ["@chukaofili/next-mcp"]
    }
  }
}
```

### ChatGPT Desktop (via MCP Bridge)

Install an MCP bridge for ChatGPT, then configure:

```json
{
  "servers": {
    "next-mcp": {
      "command": "npx",
      "args": ["@chukaofili/next-mcp"]
    }
  }
}
```

> Note: ChatGPT doesn't natively support MCP. You'll need a third-party bridge like [mcp-chatgpt-bridge](https://github.com/modelcontextprotocol/mcp-chatgpt-bridge).

## Available Tools

### scaffold_project

Create a complete Next.js project with your specified configuration.

**Key Configuration Options:**

- `typescript` (default: `true`): Enable TypeScript
- `database`: `none`, `postgres`, `mysql`, `mongodb`, `sqlite`
- `orm`: `none`, `prisma`, `drizzle`, `mongoose`
- `auth`: `none`, `better-auth`
- `uiLibrary`: `none`, `shadcn`
- `stateManagement`: `none`, `zustand`, `redux`
- `testing`: `none`, `jest`, `vitest`, `playwright`
- `packageManager`: `npm`, `pnpm`, `yarn`, `bun`

**Example:**

```json
{
  "config": {
    "name": "my-awesome-app",
    "architecture": {
      "typescript": true,
      "database": "postgres",
      "orm": "prisma",
      "auth": "better-auth",
      "uiLibrary": "shadcn",
      "stateManagement": "zustand",
      "testing": "vitest"
    }
  },
  "targetPath": "/path/to/projects"
}
```

### Other Tools

- **generate_dockerfile**: Generate production-ready Docker configuration
- **setup_shadcn**: Initialize shadcn/ui with all components
- **generate_base_components**: Generate essential React components and layouts
- **setup_database**: Configure database connection and migrations
- **setup_authentication**: Configure better-auth with login/signup pages
- **validate_project**: Run comprehensive validation checks
- **generate_readme**: Generate comprehensive project documentation

## Example Workflow

1. **Create the project:**

   ```text
   "Use next-mcp to scaffold a new Next.js project called 'my-app' with PostgreSQL, Prisma, and better-auth"
   ```

2. **Add Docker support:**

   ```text
   "Generate Dockerfile and docker-compose.yml for the project"
   ```

3. **Set up UI components:**
   ```text
   "Initialize shadcn/ui and generate base components"
   ```

## Configuration Examples

### Full-Stack App with Auth

```json
{
  "architecture": {
    "typescript": true,
    "database": "postgres",
    "orm": "prisma",
    "auth": "better-auth",
    "uiLibrary": "shadcn",
    "stateManagement": "zustand",
    "testing": "vitest"
  }
}
```

### Simple Landing Page

```json
{
  "architecture": {
    "typescript": true,
    "database": "none",
    "orm": "none",
    "auth": "none",
    "uiLibrary": "shadcn"
  }
}
```

## Development

### Build and Test

```bash
# Build
pnpm build

# Run tests
pnpm test

# Run with MCP Inspector
pnpm inspector

# Lint and format
pnpm lint
pnpm format
```

### Project Structure

```text
next-mcp/
├── src/
│   ├── index.ts              # Main MCP server
│   └── templates/            # Project templates
│       ├── auth/
│       ├── database/
│       └── docker/
├── tests/
│   ├── unit/
│   └── integration/
└── dist/                     # Compiled output
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

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Submit a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Links

- [GitHub Repository](https://github.com/chukaofili/next-mcp)
- [Issue Tracker](https://github.com/chukaofili/next-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com)

---

Made with ❤️ for the Next.js community
