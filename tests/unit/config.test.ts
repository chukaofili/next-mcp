import { describe, it, expect } from 'vitest';
import { createMockConfig } from '../helpers/test-utils.js';

describe('ProjectConfig', () => {
  it('should create valid default config', () => {
    const config = createMockConfig();

    expect(config.name).toBe('test-app');
    expect(config.description).toBe('A test Next.js application');
    expect(config.architecture.appRouter).toBe(true);
    expect(config.architecture.typescript).toBe(true);
    expect(config.architecture.packageManager).toBe('pnpm');
  });

  it('should allow overriding config values', () => {
    const config = createMockConfig({
      name: 'custom-app',
      architecture: {
        packageManager: 'npm',
        database: 'mysql',
      },
    });

    expect(config.name).toBe('custom-app');
    expect(config.architecture.packageManager).toBe('npm');
    expect(config.architecture.database).toBe('mysql');
    // Default values should still exist
    expect(config.architecture.typescript).toBe(true);
  });

  it('should support all package managers', () => {
    const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'];

    packageManagers.forEach((pm) => {
      const config = createMockConfig({
        architecture: { packageManager: pm },
      });
      expect(config.architecture.packageManager).toBe(pm);
    });
  });

  it('should support all database options', () => {
    const databases = ['none', 'postgres', 'mysql', 'mongodb', 'sqlite'];

    databases.forEach((db) => {
      const config = createMockConfig({
        architecture: { database: db },
      });
      expect(config.architecture.database).toBe(db);
    });
  });

  it('should support all ORM options', () => {
    const orms = ['none', 'prisma', 'drizzle', 'mongoose'];

    orms.forEach((orm) => {
      const config = createMockConfig({
        architecture: { orm },
      });
      expect(config.architecture.orm).toBe(orm);
    });
  });

  it('should support all auth options', () => {
    const authOptions = ['none', 'better-auth'];

    authOptions.forEach((auth) => {
      const config = createMockConfig({
        architecture: { auth },
      });
      expect(config.architecture.auth).toBe(auth);
    });
  });

  it('should support all UI library options', () => {
    const uiLibs = ['none', 'shadcn'];

    uiLibs.forEach((lib) => {
      const config = createMockConfig({
        architecture: { uiLibrary: lib },
      });
      expect(config.architecture.uiLibrary).toBe(lib);
    });
  });

  it('should support all testing frameworks', () => {
    const testFrameworks = ['none', 'jest', 'vitest', 'playwright'];

    testFrameworks.forEach((framework) => {
      const config = createMockConfig({
        architecture: { testing: framework },
      });
      expect(config.architecture.testing).toBe(framework);
    });
  });
});
