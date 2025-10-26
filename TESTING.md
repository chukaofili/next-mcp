# Testing Guide for Next.js MCP Server

This document provides a comprehensive guide to the testing infrastructure for the Next.js MCP Server.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Test Architecture](#test-architecture)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Testing Tools](#testing-tools)
- [CI/CD Integration](#cicd-integration)

## Overview

The Next.js MCP Server uses **Vitest** as its testing framework. Vitest is chosen for:

- ✅ Native ESM support
- ✅ Fast execution with intelligent watch mode
- ✅ TypeScript support out of the box
- ✅ Jest-compatible API
- ✅ Built-in coverage reporting
- ✅ Beautiful UI for test visualization

## Getting Started

### Installation

Testing dependencies are already included. If you need to reinstall:

```bash
pnpm install
```

### Running Your First Test

```bash
# Run all tests
pnpm test

# Run in watch mode
pnpm test:watch

# Open the UI
pnpm test:ui
```

## Test Architecture

### Directory Structure

```text
tests/
├── helpers/
│   ├── test-utils.ts          # General utilities (file operations, mocks)
│   └── mcp-test-client.ts     # MCP client wrapper for testing
├── unit/
│   ├── config.test.ts         # Configuration tests
│   └── helpers.test.ts        # Helper function tests
├── integration/
│   ├── tools.test.ts          # MCP tools integration tests
│   └── readme.test.ts         # README generation tests
└── README.md                   # Testing documentation
```

### Test Types

#### 1. Unit Tests (`tests/unit/`)

Test individual functions and utilities in isolation:

```typescript
// tests/unit/config.test.ts
import { describe, expect, it } from 'vitest';

import { createMockConfig } from '../helpers/test-utils.js';

describe('ProjectConfig', () => {
  it('should create valid default config', () => {
    const config = createMockConfig();
    expect(config.name).toBe('test-app');
  });
});
```

**Characteristics:**

- Fast (< 1ms per test)
- No external dependencies
- Pure function testing
- Mock external resources

#### 2. Integration Tests (`tests/integration/`)

Test complete workflows and tool interactions:

```typescript
// tests/integration/tools.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../helpers/mcp-test-client.js';

describe('MCP Server Integration', () => {
  let client: MCPTestClient;

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('should list all tools', async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBeGreaterThan(0);
  });
});
```

**Characteristics:**

- Slower (can take seconds)
- Tests real MCP communication
- End-to-end workflows
- Real file system operations

## Running Tests

### Basic Commands

```bash
# Run all tests once
pnpm test

# Run in watch mode (re-runs on file changes)
pnpm test:watch

# Run only unit tests
pnpm test:unit

# Run only integration tests
pnpm test:integration

# Open Vitest UI
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

### Advanced Usage

#### Run Specific Test File

```bash
pnpm vitest tests/unit/config.test.ts
```

#### Run Specific Test by Name

```bash
pnpm vitest -t "should create valid default config"
```

#### Run Tests with Debugging

```bash
pnpm vitest --inspect-brk
```

#### Filter Tests by Pattern

```bash
pnpm vitest --grep "README"
```

## Writing Tests

### Creating a Unit Test

1. Create a new file in `tests/unit/` with `.test.ts` extension
2. Import testing utilities:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMockConfig } from '../helpers/test-utils.js';
```

3. Structure your tests:

```typescript
describe('Feature Name', () => {
  describe('Specific Functionality', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = someFunction(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### Creating an Integration Test

1. Create a new file in `tests/integration/` with `.test.ts` extension
2. Set up the MCP client and cleanup:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../helpers/mcp-test-client.js';
import { cleanupTempDir, createTempDir } from '../helpers/test-utils.js';

describe('My Tool Integration', () => {
  let client: MCPTestClient;
  let tempDir: string;

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  }, 30000); // 30 second timeout

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should work correctly', async () => {
    const result = await client.callTool('my_tool', {
      config: createMockConfig(),
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
  });
});
```

### Test Utilities

#### Creating Mock Configurations

```typescript
import { createMockConfig } from '../helpers/test-utils.js';

// Default config
const config = createMockConfig();

// Custom overrides
const customConfig = createMockConfig({
  name: 'my-app',
  architecture: {
    database: 'mysql',
    orm: 'drizzle',
    packageManager: 'npm',
  },
});
```

#### Working with Temporary Directories

```typescript
import { cleanupTempDir, createTempDir, fileExists } from '../helpers/test-utils.js';

// Create temp directory
const tempDir = await createTempDir();

// Use it for testing
// ...

// Clean up
await cleanupTempDir(tempDir);
```

#### Using the MCP Test Client

```typescript
import { MCPTestClient } from '../helpers/mcp-test-client.js';

const client = new MCPTestClient();
await client.connect(serverPath);

// List tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('generate_readme', {
  config: mockConfig,
  projectPath: tempDir,
});

// Extract text content
const text = client.getTextContent(result);

// Check success/failure
if (client.isSuccess(result)) {
  console.log('Tool succeeded!');
}

await client.disconnect();
```

## Testing Tools

### Available Test Utilities

Located in `tests/helpers/test-utils.ts`:

| Function                          | Description                      |
| --------------------------------- | -------------------------------- |
| `createTempDir(prefix?)`          | Create a temporary directory     |
| `cleanupTempDir(path)`            | Remove a temporary directory     |
| `fileExists(path)`                | Check if a file exists           |
| `dirExists(path)`                 | Check if a directory exists      |
| `readFile(path)`                  | Read file contents as string     |
| `createPackageJson(dir, config?)` | Create a test package.json       |
| `createMockConfig(overrides?)`    | Create mock ProjectConfig        |
| `verifyNextJsStructure(path)`     | Verify Next.js project structure |
| `waitFor(condition, timeout?)`    | Wait for async condition         |

### MCP Test Client API

Located in `tests/helpers/mcp-test-client.ts`:

| Method                   | Description              |
| ------------------------ | ------------------------ |
| `connect(serverPath)`    | Connect to MCP server    |
| `disconnect()`           | Disconnect from server   |
| `listTools()`            | Get all available tools  |
| `callTool(name, args)`   | Call a specific tool     |
| `getTextContent(result)` | Extract text from result |
| `isSuccess(result)`      | Check if tool succeeded  |
| `isFailure(result)`      | Check if tool failed     |

## Best Practices

### 1. Test Organization

✅ **DO:**

- Group related tests with `describe` blocks
- Use clear, descriptive test names
- Follow the Arrange-Act-Assert pattern

❌ **DON'T:**

- Write tests that depend on execution order
- Leave commented-out tests
- Use vague test names like "it works"

### 2. Async Testing

✅ **DO:**

```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBe('success');
});
```

❌ **DON'T:**

```typescript
it('should handle async operations', () => {
  asyncFunction().then((result) => {
    expect(result).toBe('success'); // Won't work!
  });
});
```

### 3. Cleanup

✅ **DO:**

```typescript
afterEach(async () => {
  await cleanupTempDir(tempDir);
});
```

❌ **DON'T:**

```typescript
it('test without cleanup', async () => {
  const dir = await createTempDir();
  // ... test code
  // No cleanup!
});
```

### 4. Timeouts

For long-running operations:

```typescript
it('long operation', async () => {
  // test code
}, 60000); // 60 seconds
```

### 5. Error Testing

```typescript
it('should handle errors', async () => {
  await expect(dangerousFunction()).rejects.toThrow('Expected error message');
});
```

## CI/CD Integration

### GitHub Actions

Tests run automatically via GitHub Actions (`.github/workflows/test.yml`):

- **On Every Push** to main/develop branches
- **On Every Pull Request**
- **Multiple Node Versions** (20.x, 22.x)

### Workflow Steps

1. Checkout code
2. Setup Node.js and pnpm
3. Install dependencies
4. Run linter
5. Build project
6. Run unit tests
7. Run integration tests
8. Generate coverage report
9. Upload coverage to Codecov

### Local CI Simulation

```bash
# Run the same checks as CI
pnpm lint && pnpm build && pnpm test
```

## Coverage Reports

### Generate Coverage

```bash
pnpm test:coverage
```

### View Coverage Report

Coverage reports are generated in:

- **HTML**: `coverage/index.html`
- **JSON**: `coverage/coverage-final.json`
- **Text**: Printed to console

### Coverage Goals

- **Unit Tests**: 80%+ coverage
- **Integration Tests**: All tools covered
- **Overall**: 70%+ code coverage

## Troubleshooting

### Tests Timing Out

**Problem:** Integration tests exceed timeout

**Solution:** Increase timeout or optimize test

```typescript
it('slow test', async () => {
  // test code
}, 60000); // Increase to 60s
```

### MCP Client Fails to Connect

**Problem:** Integration tests can't connect to server

**Solution:** Ensure build runs before tests

```bash
pnpm build
pnpm test:integration
```

### Temp Directory Permission Errors

**Problem:** Can't clean up temp directories

**Solution:** The `cleanupTempDir()` function handles this gracefully

### Import Errors

**Problem:** "Cannot find module" errors

**Solution:** Use `.js` extensions in imports (ESM requirement)

```typescript
// ✅ Correct

// ❌ Wrong
import { foo } from './utils';
import { foo } from './utils.js';
```

## Contributing

When contributing to the test suite:

1. **Add tests for new features** - Every new tool or function needs tests
2. **Maintain existing tests** - Update tests when refactoring
3. **Run tests before committing** - `pnpm test`
4. **Keep coverage high** - Don't decrease overall coverage
5. **Document complex tests** - Add comments for tricky test logic

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

## Questions?

If you have questions about testing:

1. Check this documentation
2. Look at existing tests for examples
3. Review the [tests/README.md](tests/README.md)
4. Open an issue on GitHub
