import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ProjectConfigSchema } from '../../src/index.js';
import { createMockConfig } from '../helpers/test-utils.js';

describe('ProjectConfig', () => {
  it('should create valid default config', () => {
    const config = createMockConfig();

    expect(config.name).toBeUndefined();
    expect(config.description).toBeUndefined();
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
    const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'] as const;

    packageManagers.forEach((pm) => {
      const config = createMockConfig({
        architecture: { packageManager: pm },
      });
      expect(config.architecture.packageManager).toBe(pm);
    });
  });

  it('should support all database options', () => {
    const databases = ['none', 'postgres', 'mysql', 'mongodb', 'sqlite'] as const;

    databases.forEach((db) => {
      const config = createMockConfig({
        architecture: { database: db },
      });
      expect(config.architecture.database).toBe(db);
    });
  });

  it('should support all ORM options', () => {
    const orms = ['none', 'prisma', 'drizzle', 'mongoose'] as const;

    orms.forEach((orm) => {
      const config = createMockConfig({
        architecture: { orm },
      });
      expect(config.architecture.orm).toBe(orm);
    });
  });

  it('should support all auth options', () => {
    const authOptions = ['none', 'better-auth'] as const;

    authOptions.forEach((auth) => {
      const config = createMockConfig({
        architecture: { auth },
      });
      expect(config.architecture.auth).toBe(auth);
    });
  });

  it('should support all UI library options', () => {
    const uiLibs = ['none', 'shadcn'] as const;

    uiLibs.forEach((lib) => {
      const config = createMockConfig({
        architecture: { uiLibrary: lib },
      });
      expect(config.architecture.uiLibrary).toBe(lib);
    });
  });

  it('should support all testing frameworks', () => {
    const testFrameworks = ['none', 'jest', 'vitest', 'playwright'] as const;

    testFrameworks.forEach((framework) => {
      const config = createMockConfig({
        architecture: { testing: framework },
      });
      expect(config.architecture.testing).toBe(framework);
    });
  });
});

describe('ProjectConfigSchema Zod Validation', () => {
  it('should apply default values for missing fields', () => {
    const minimalConfig = {
      architecture: {},
    };

    const result = ProjectConfigSchema.parse(minimalConfig);

    expect(result.architecture.typescript).toBe(true);
    expect(result.architecture.reactCompiler).toBe(false);
    expect(result.architecture.skipInstall).toBe(false);
    expect(result.architecture.packageManager).toBe('pnpm');
    expect(result.architecture.database).toBe('postgres');
    expect(result.architecture.orm).toBe('prisma');
    expect(result.architecture.auth).toBe('better-auth');
    expect(result.architecture.uiLibrary).toBe('shadcn');
    expect(result.architecture.stateManagement).toBe('none');
    expect(result.architecture.testing).toBe('none');
  });

  it('should reject invalid package manager', () => {
    const invalidConfig = {
      architecture: {
        packageManager: 'invalid',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid database option', () => {
    const invalidConfig = {
      architecture: {
        database: 'invalid-db',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid ORM option', () => {
    const invalidConfig = {
      architecture: {
        orm: 'sequelize',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid auth option', () => {
    const invalidConfig = {
      architecture: {
        auth: 'auth0',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid UI library option', () => {
    const invalidConfig = {
      architecture: {
        uiLibrary: 'material-ui',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid state management option', () => {
    const invalidConfig = {
      architecture: {
        stateManagement: 'mobx',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should reject invalid testing framework', () => {
    const invalidConfig = {
      architecture: {
        testing: 'mocha',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });

  it('should validate and preserve valid config values', () => {
    const validConfig = {
      name: 'my-app',
      description: 'My awesome app',
      architecture: {
        typescript: false,
        reactCompiler: true,
        skipInstall: true,
        packageManager: 'yarn' as const,
        database: 'mongodb' as const,
        orm: 'mongoose' as const,
        auth: 'none' as const,
        uiLibrary: 'none' as const,
        stateManagement: 'zustand' as const,
        testing: 'playwright' as const,
      },
    };

    const result = ProjectConfigSchema.parse(validConfig);

    expect(result.name).toBe('my-app');
    expect(result.description).toBe('My awesome app');
    expect(result.architecture.typescript).toBe(false);
    expect(result.architecture.reactCompiler).toBe(true);
    expect(result.architecture.skipInstall).toBe(true);
    expect(result.architecture.packageManager).toBe('yarn');
    expect(result.architecture.database).toBe('mongodb');
    expect(result.architecture.orm).toBe('mongoose');
    expect(result.architecture.auth).toBe('none');
    expect(result.architecture.uiLibrary).toBe('none');
    expect(result.architecture.stateManagement).toBe('zustand');
    expect(result.architecture.testing).toBe('playwright');
  });

  it('should accept optional name and description', () => {
    const config = {
      architecture: {
        packageManager: 'npm' as const,
      },
    };

    const result = ProjectConfigSchema.parse(config);

    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('should validate booleans for typescript and reactCompiler', () => {
    const invalidConfig = {
      architecture: {
        typescript: 'yes',
        reactCompiler: 'no',
      },
    };

    expect(() => ProjectConfigSchema.parse(invalidConfig)).toThrow(ZodError);
  });
});
