import { describe, expect, it } from 'vitest';

import {
  getDbDeps,
  hasAuthPackageEmitted,
  hasDbPackageEmitted,
  hasOrpcPackageEmitted,
  hasUiPackageEmitted,
} from '../../src/index.js';
import { createMockConfig } from '../helpers/test-utils.js';

describe('Package-emission gate helpers', () => {
  describe('hasDbPackageEmitted', () => {
    it('returns true for monorepo:full + postgres + prisma', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
      });
      expect(hasDbPackageEmitted(config)).toBe(true);
    });

    it('returns false for monorepo:full + postgres + orm:none', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'none', auth: 'none' },
      });
      expect(hasDbPackageEmitted(config)).toBe(false);
    });

    it('returns false for monorepo:full + database:none + orm:none', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'none', orm: 'none', auth: 'none' },
      });
      expect(hasDbPackageEmitted(config)).toBe(false);
    });

    it('returns false for monorepo:minimal + postgres + prisma', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'minimal', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
      });
      expect(hasDbPackageEmitted(config)).toBe(false);
    });

    it('returns false for monorepo:none + postgres + prisma', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'none', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
      });
      expect(hasDbPackageEmitted(config)).toBe(false);
    });
  });

  describe('hasAuthPackageEmitted', () => {
    it('returns true for monorepo:full + postgres + prisma + better-auth', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
      });
      expect(hasAuthPackageEmitted(config)).toBe(true);
    });

    it('returns false for monorepo:full + postgres + prisma + auth:none', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'prisma', auth: 'none' },
      });
      expect(hasAuthPackageEmitted(config)).toBe(false);
    });

    it('returns false for monorepo:full + postgres + orm:none + auth:none (db gate fails)', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'none', auth: 'none' },
      });
      expect(hasAuthPackageEmitted(config)).toBe(false);
    });

    // Locks the load-bearing composition: hasAuthPackageEmitted = hasDbPackageEmitted && better-auth.
    // If a future edit drops the db-gate composition and re-inlines as
    // `monorepo === 'full' && auth === 'better-auth'`, the auth gate alone
    // would let this case through (true), but the auth template hard-codes
    // `@<projectName>/db: workspace:*` and packages/db is not emitted here.
    it('returns false for monorepo:full + postgres + orm:none + better-auth (composition guards against missing packages/db)', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'none', auth: 'better-auth' },
      });
      expect(hasAuthPackageEmitted(config)).toBe(false);
    });

    it('returns false for monorepo:minimal + postgres + prisma + better-auth', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'minimal', database: 'postgres', orm: 'prisma', auth: 'better-auth' },
      });
      expect(hasAuthPackageEmitted(config)).toBe(false);
    });
  });

  describe('hasUiPackageEmitted', () => {
    it('returns true for monorepo:full + shadcn', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', uiLibrary: 'shadcn', auth: 'none', database: 'none', orm: 'none' },
      });
      expect(hasUiPackageEmitted(config)).toBe(true);
    });

    it('returns false for monorepo:full + uiLibrary:none', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', uiLibrary: 'none', auth: 'none', database: 'none', orm: 'none' },
      });
      expect(hasUiPackageEmitted(config)).toBe(false);
    });

    it('returns false for monorepo:minimal + shadcn', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'minimal', uiLibrary: 'shadcn', auth: 'none', database: 'none', orm: 'none' },
      });
      expect(hasUiPackageEmitted(config)).toBe(false);
    });
  });

  describe('hasOrpcPackageEmitted', () => {
    it('returns true for monorepo:full + orpc', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', rpc: 'orpc', auth: 'none', database: 'none', orm: 'none' },
      });
      expect(hasOrpcPackageEmitted(config)).toBe(true);
    });

    it('returns false for monorepo:full + rpc:none', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', rpc: 'none', auth: 'none', database: 'none', orm: 'none' },
      });
      expect(hasOrpcPackageEmitted(config)).toBe(false);
    });
  });

  describe('getDbDeps', () => {
    it('returns dialect-agnostic prisma deps for orm:prisma (no driver adapter)', () => {
      // The prisma client.ts.template uses bare `new PrismaClient()` so
      // the same deps work for postgres, mysql, sqlite, and mongodb. The
      // generator no longer wires `@prisma/adapter-pg` or the postgres
      // driver `pg` — opt into them on the consumer's package.json if
      // adapter throughput matters.
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'prisma', auth: 'none' },
      });
      const { dependencies, devDependencies } = getDbDeps(config);
      expect(dependencies).toMatchObject({
        '@prisma/client': expect.any(String),
        dotenv: expect.any(String),
      });
      expect(dependencies['@prisma/adapter-pg']).toBeUndefined();
      expect(dependencies.pg).toBeUndefined();
      expect(devDependencies).toMatchObject({ prisma: expect.any(String) });
    });

    it('returns drizzle-orm + pg + dotenv for orm:drizzle + postgres', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'drizzle', auth: 'none' },
      });
      const { dependencies, devDependencies } = getDbDeps(config);
      expect(dependencies).toMatchObject({
        'drizzle-orm': expect.any(String),
        pg: expect.any(String),
        dotenv: expect.any(String),
      });
      expect(devDependencies).toMatchObject({ 'drizzle-kit': expect.any(String) });
      expect(dependencies.mysql2).toBeUndefined();
      expect(dependencies['better-sqlite3']).toBeUndefined();
    });

    it('returns drizzle-orm + mysql2 for orm:drizzle + mysql', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'mysql', orm: 'drizzle', auth: 'none' },
      });
      const { dependencies, devDependencies } = getDbDeps(config);
      expect(dependencies).toMatchObject({
        'drizzle-orm': expect.any(String),
        mysql2: expect.any(String),
      });
      expect(devDependencies).toMatchObject({ 'drizzle-kit': expect.any(String) });
      expect(dependencies.pg).toBeUndefined();
      expect(dependencies.dotenv).toBeUndefined();
    });

    it('returns drizzle-orm + better-sqlite3 + types for orm:drizzle + sqlite', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'sqlite', orm: 'drizzle', auth: 'none' },
      });
      const { dependencies, devDependencies } = getDbDeps(config);
      expect(dependencies).toMatchObject({
        'drizzle-orm': expect.any(String),
        'better-sqlite3': expect.any(String),
      });
      expect(devDependencies).toMatchObject({
        'drizzle-kit': expect.any(String),
        '@types/better-sqlite3': expect.any(String),
      });
      expect(dependencies.pg).toBeUndefined();
      expect(dependencies.mysql2).toBeUndefined();
    });

    it('returns empty for orm:none', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'postgres', orm: 'none', auth: 'none' },
      });
      expect(getDbDeps(config)).toEqual({ dependencies: {}, devDependencies: {} });
    });

    it('returns empty for orm:mongoose (deps live in the mongoose package template)', () => {
      const config = createMockConfig({
        architecture: { monorepo: 'full', database: 'mongodb', orm: 'mongoose', auth: 'none' },
      });
      expect(getDbDeps(config)).toEqual({ dependencies: {}, devDependencies: {} });
    });
  });
});
