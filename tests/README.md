# Testing Documentation

This directory contains the test suite for the Next.js MCP Server.

## Test Structure

```text
tests/
├── helpers/              # Test utilities and helper functions
│   ├── test-utils.ts    # General testing utilities
│   └── mcp-test-client.ts # MCP client for integration testing
├── unit/                 # Unit tests
│   ├── config.test.ts   # ProjectConfig tests
│   └── helpers.test.ts  # Test utility tests
├── integration/          # Integration tests
│   ├── tools.test.ts    # MCP server tools tests
│   └── readme.test.ts   # README generation tests
└── README.md            # This file
```

## Running Tests

### All Tests

```bash
pnpm test
```

### Watch Mode

```bash
pnpm test:watch
```

### Unit Tests Only

```bash
pnpm test:unit
```

### Integration Tests Only

```bash
pnpm test:integration
```

### With UI

```bash
pnpm test:ui
```

### With Coverage

```bash
pnpm test:coverage
```

## Test Categories

### Unit Tests

Unit tests focus on testing individual functions and utilities in isolation:

- **config.test.ts**: Tests for project configuration creation and validation
- **helpers.test.ts**: Tests for test utility functions

### Integration Tests

Integration tests verify the MCP server's tools work correctly:

- **tools.test.ts**: Tests all MCP server tools and their interactions
- **readme.test.ts**: Comprehensive tests for README generation with various configurations

## Test Utilities

### Test Helper Functions

Located in `helpers/test-utils.ts`:

- `createTempDir()`: Create temporary directories for testing
- `cleanupTempDir()`: Clean up temporary directories
- `fileExists()`: Check if a file exists
- `dirExists()`: Check if a directory exists
- `readFile()`: Read file contents
- `createPackageJson()`: Create a test package.json
- `createMockConfig()`: Create mock ProjectConfig objects
- `verifyNextJsStructure()`: Verify Next.js project structure

### MCP Test Client

Located in `helpers/mcp-test-client.ts`:

The `MCPTestClient` class provides a convenient way to test MCP server functionality:

```typescript
import { MCPTestClient } from '../helpers/mcp-test-client.js';

const client = new MCPTestClient();
await client.connect(serverPath);

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('generate_readme', {
  config: mockConfig,
  projectPath: '/path/to/project',
});

// Check results
const text = client.getTextContent(result);
const success = client.isSuccess(result);

await client.disconnect();
```

## Writing New Tests

### Unit Test Example

```typescript
import { describe, expect, it } from 'vitest';

import { createMockConfig } from '../helpers/test-utils.js';

describe('MyFeature', () => {
  it('should do something', () => {
    const config = createMockConfig();
    expect(config.name).toBeDefined();
  });
});
```

### Integration Test Example

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MCPTestClient } from '../helpers/mcp-test-client.js';
import { cleanupTempDir, createTempDir } from '../helpers/test-utils.js';

describe('MyTool', () => {
  let client: MCPTestClient;
  let tempDir: string;

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.connect(serverPath);
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await client.disconnect();
    await cleanupTempDir(tempDir);
  });

  it('should work correctly', async () => {
    const result = await client.callTool('my_tool', {
      projectPath: tempDir,
    });

    expect(client.isSuccess(result)).toBe(true);
  });
});
```

## Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Cleanup**: Always clean up temporary files and directories
3. **Timeouts**: Integration tests have 30-second timeouts for operations that might take time
4. **Mock Data**: Use `createMockConfig()` for consistent test data
5. **Descriptive Names**: Use clear, descriptive test names
6. **Assertions**: Include meaningful assertions with good error messages

## Testing Philosophy

### Unit Tests

- Fast execution
- Test individual functions
- No external dependencies
- Mock external resources

### Integration Tests

- Test real interactions
- Verify tool behavior end-to-end
- Use actual MCP client/server communication
- Test edge cases and error handling

## Coverage Goals

We aim for:

- **Unit Tests**: 80%+ coverage for utility functions
- **Integration Tests**: Cover all MCP tools and major workflows
- **Edge Cases**: Test error conditions and invalid inputs

## Continuous Integration

Tests run automatically on:

- Every pull request
- Every push to main
- Before publishing packages

## Debugging Tests

### Run a Single Test File

```bash
pnpm vitest tests/unit/config.test.ts
```

### Run a Single Test

```bash
pnpm vitest -t "should create valid default config"
```

### Debug Mode

```bash
pnpm vitest --inspect-brk
```

### View in UI

```bash
pnpm test:ui
```

This opens a browser-based UI where you can:

- See test results visually
- Re-run specific tests
- View console output
- Inspect test snapshots

## Common Issues

### Tests Timing Out

If integration tests timeout, increase the timeout in the test:

```typescript
it('long running test', async () => {
  // test code
}, 60000); // 60 seconds
```

### Temp Directory Cleanup Failures

If cleanup fails on Windows, use:

```typescript
await cleanupTempDir(tempDir);
```

The function includes error handling for permission issues.

### MCP Client Connection Issues

Ensure the server is built before running integration tests:

```bash
pnpm build
pnpm test:integration
```

## Contributing

When adding new features:

1. Write unit tests for new utility functions
2. Write integration tests for new MCP tools
3. Ensure all tests pass before submitting PR
4. Update this README if adding new test categories
