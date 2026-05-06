import { describe, expect, it } from 'vitest';

import {
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
});
