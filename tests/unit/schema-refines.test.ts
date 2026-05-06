import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ProjectConfigSchema } from '../../src/index.js';

/**
 * Tier 3 schema refines: cross-field combos that used to error at runtime
 * inside setup tools (after scaffolding) are now rejected at parse time at
 * the MCP boundary. These tests pin each refine + a happy-path counterexample
 * so future schema changes can't silently regress the behavior.
 */
describe('ProjectConfigSchema cross-field refines', () => {
  describe('better-auth requires a database', () => {
    it('rejects auth:better-auth + database:none', () => {
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: {
            auth: 'better-auth',
            database: 'none',
            orm: 'none',
          },
        })
      ).toThrow(/Better Auth requires a database/i);
    });

    it('accepts auth:better-auth + database:postgres', () => {
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: {
            auth: 'better-auth',
            database: 'postgres',
            orm: 'prisma',
          },
        })
      ).not.toThrow();
    });

    it('accepts auth:none + database:none (no auth, no db needed)', () => {
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: {
            auth: 'none',
            database: 'none',
            orm: 'none',
          },
        })
      ).not.toThrow();
    });
  });

  describe('orm/database compatibility', () => {
    it('accepts orm:mongoose + database:mongodb', () => {
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: { orm: 'mongoose', database: 'mongodb' },
        })
      ).not.toThrow();
    });

    it('rejects orm:mongoose + database:postgres with a message naming the bad combo', () => {
      // The message must list both fields and the valid alternatives so a
      // user pasting an invalid config into Claude can fix it without
      // round-tripping the schema.
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: { orm: 'mongoose', database: 'postgres' },
        })
      ).toThrow(/mongoose.*does not support.*postgres/i);
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: { orm: 'mongoose', database: 'postgres' },
        })
      ).toThrow(/Valid databases for mongoose:.*mongodb/);
    });

    it('rejects orm:drizzle + database:mongodb', () => {
      expect(() =>
        ProjectConfigSchema.parse({
          architecture: { orm: 'drizzle', database: 'mongodb' },
        })
      ).toThrow(/drizzle.*does not support.*mongodb/i);
    });

    it('accepts orm:drizzle with each of postgres/mysql/sqlite', () => {
      for (const database of ['postgres', 'mysql', 'sqlite'] as const) {
        expect(() =>
          ProjectConfigSchema.parse({
            architecture: { orm: 'drizzle', database },
          })
        ).not.toThrow();
      }
    });

    it('accepts orm:prisma with each of postgres/mysql/sqlite/mongodb', () => {
      // Symmetric to the drizzle happy-path loop above. Catches an accidental
      // future drop of any of prisma's compat dbs from
      // ORM_DATABASE_COMPATIBILITY.prisma.
      for (const database of ['postgres', 'mysql', 'sqlite', 'mongodb'] as const) {
        expect(() =>
          ProjectConfigSchema.parse({
            architecture: { orm: 'prisma', database },
          })
        ).not.toThrow();
      }
    });

    it('rejects any non-none ORM combined with database:none', () => {
      // Implicit rule: if you opted into an ORM, you must point it at a
      // database. Falls out of ORM_DATABASE_COMPATIBILITY (no non-`none` ORM
      // lists `none` as a valid database). Pin the message format so a
      // future refactor can't reduce it to a bare ZodError without naming
      // the bad fields and listing valid alternatives.
      for (const orm of ['prisma', 'drizzle', 'mongoose'] as const) {
        expect(() =>
          ProjectConfigSchema.parse({
            architecture: { orm, database: 'none', auth: 'none' },
          })
        ).toThrow(ZodError);
        expect(() =>
          ProjectConfigSchema.parse({
            architecture: { orm, database: 'none', auth: 'none' },
          })
        ).toThrow(new RegExp(`Valid databases for ${orm}`));
      }
    });

    it('orm:none is unconstrained on database (including database:none)', () => {
      const dbs = ['none', 'postgres', 'mysql', 'mongodb', 'sqlite'] as const;
      for (const database of dbs) {
        expect(() =>
          ProjectConfigSchema.parse({
            architecture: {
              orm: 'none',
              database,
              // disable auth when there's no database, otherwise the
              // better-auth refine (separate rule) would also fire
              auth: database === 'none' ? 'none' : 'better-auth',
            },
          })
        ).not.toThrow();
      }
    });
  });
});
