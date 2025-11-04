import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/templates/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'src/templates/', '**/*.test.ts', '**/*.config.ts', '**/types.ts'],
    },
    testTimeout: 60000, // 30 seconds for tests that might scaffold projects
    hookTimeout: 60000,
  },
});
