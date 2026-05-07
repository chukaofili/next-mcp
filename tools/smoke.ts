#!/usr/bin/env tsx
/**
 * Headless smoke driver — Tier 5a (see
 * docs/plans/2026-05-06-recommended-fixes.md lines 110-118).
 *
 * Drives the MCP server over stdio for each of the five preset configs from
 * docs/plans/2026-05-05-monorepo-smoke-test.md (everything-on full + variants
 * A–D). Each preset:
 *   - validates its config via ProjectConfigSchema.parse (catches Tier 3
 *     schema-refine regressions before we even spawn the server)
 *   - runs the canonical tool sequence (scaffold -> setup_db -> setup_auth ->
 *     setup_shadcn -> generate_dockerfile -> generate_base_components ->
 *     generate_readme -> validate_project)
 *   - asserts a small set of file-existence post-conditions per variant
 *   - cleans up its temp dir in a finally block
 *
 * Default mode runs with `skipInstall: true` so generation is verified without
 * the multi-minute `<pm> install` + `<pm> build` pass — that's CI-friendly.
 *
 * NOTE: a `--full` flag (run real `<pm> install` + `<pm> build` against each
 * generated project) is intentionally out of scope for this commit. The
 * manual procedure in `docs/plans/2026-05-05-monorepo-smoke-test.md` remains
 * the canonical path for that signal until we add it.
 *
 * Exit codes:
 *   0 — every preset (or the named one) passed
 *   1 — at least one preset failed (post-condition or tool error)
 *   2 — argument error (unknown preset name)
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { ProjectConfigSchema, type ProjectConfig } from '../src/schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PostConditions {
  /** Files/dirs that MUST exist after the tool sequence runs. */
  exists: string[];
  /** Files/dirs that MUST NOT exist (gating regressions). */
  absent: string[];
}

interface Preset {
  name: string;
  config: ProjectConfig;
  postConditions: PostConditions;
}

/**
 * Build the five preset configs. Each config is run through
 * `ProjectConfigSchema.parse` so refines (rpc⇒full, better-auth⇒db, orm⇔db
 * compatibility) get exercised at module load time, well before we spawn a
 * server. A schema regression here will throw with a Zod error pointing at
 * the offending preset.
 */
function buildPresets(): Preset[] {
  const fullEverythingOn: ProjectConfig = ProjectConfigSchema.parse({
    name: 'smoke-full',
    architecture: {
      monorepo: 'full',
      packageManager: 'pnpm',
      database: 'postgres',
      orm: 'prisma',
      auth: 'better-auth',
      uiLibrary: 'shadcn',
      rpc: 'orpc',
      stateManagement: 'none',
      testing: 'vitest',
      skipInstall: true,
    },
  });

  const variantANpm: ProjectConfig = ProjectConfigSchema.parse({
    name: 'smoke-variant-a',
    architecture: {
      monorepo: 'full',
      packageManager: 'npm',
      database: 'postgres',
      orm: 'prisma',
      auth: 'better-auth',
      uiLibrary: 'shadcn',
      rpc: 'none',
      stateManagement: 'none',
      testing: 'vitest',
      skipInstall: true,
    },
  });

  const variantBBunSqliteDrizzle: ProjectConfig = ProjectConfigSchema.parse({
    name: 'smoke-variant-b',
    architecture: {
      monorepo: 'full',
      packageManager: 'bun',
      database: 'sqlite',
      orm: 'drizzle',
      auth: 'none',
      uiLibrary: 'none',
      rpc: 'none',
      stateManagement: 'none',
      testing: 'vitest',
      skipInstall: true,
    },
  });

  const variantCMinimal: ProjectConfig = ProjectConfigSchema.parse({
    name: 'smoke-variant-c',
    architecture: {
      monorepo: 'minimal',
      packageManager: 'pnpm',
      database: 'none',
      orm: 'none',
      auth: 'none',
      uiLibrary: 'none',
      rpc: 'none',
      stateManagement: 'none',
      testing: 'vitest',
      skipInstall: true,
    },
  });

  const variantDFlat: ProjectConfig = ProjectConfigSchema.parse({
    name: 'smoke-variant-d',
    architecture: {
      monorepo: 'none',
      packageManager: 'pnpm',
      database: 'postgres',
      orm: 'prisma',
      auth: 'better-auth',
      uiLibrary: 'shadcn',
      rpc: 'none',
      stateManagement: 'none',
      testing: 'vitest',
      skipInstall: true,
    },
  });

  return [
    {
      name: 'full-everything-on',
      config: fullEverythingOn,
      postConditions: {
        exists: [
          'apps/web/package.json',
          'packages/db/package.json',
          'packages/auth/package.json',
          'packages/ui/package.json',
          'packages/orpc/package.json',
          'Dockerfile',
          'Dockerfile.migrate',
          // Tier 2a: generate_base_components must route into apps/web/.
          'apps/web/src/app/page.tsx',
        ],
        absent: [
          // B5 regression catch — create-next-app --use-pnpm leaves these
          // shadowing files at the app level; scaffold_project must delete
          // them post-subprocess. See smoke-v2 §4.0 + design doc §6.4.
          'apps/web/pnpm-workspace.yaml',
          'apps/web/pnpm-lock.yaml',
        ],
      },
    },
    {
      name: 'variant-a-full-npm',
      config: variantANpm,
      postConditions: {
        exists: [
          'apps/web/package.json',
          'packages/db/package.json',
          'packages/auth/package.json',
          'packages/ui/package.json',
          'Dockerfile',
          'Dockerfile.migrate',
          // npm catalog substitution: there is no native catalog so the root
          // package.json must carry a literal `workspaces` array.
          'package.json',
        ],
        absent: [
          // rpc:'none' so packages/orpc must NOT be emitted.
          'packages/orpc',
          // B5 regression catch — see full-everything-on for rationale.
          // npm doesn't emit these today, but the fix is unconditional;
          // future-proof against any scaffold-tool switch.
          'apps/web/pnpm-workspace.yaml',
          'apps/web/pnpm-lock.yaml',
        ],
      },
    },
    {
      name: 'variant-b-full-bun-sqlite-drizzle',
      config: variantBBunSqliteDrizzle,
      postConditions: {
        exists: [
          'apps/web/package.json',
          'packages/db/package.json',
          'Dockerfile',
          // OoS-2: Dockerfile.migrate now supports Drizzle. Variant B's
          // post-condition flipped from `absent` to `exists` — drizzle-kit
          // migrate against sqlite (with better-sqlite3) is the migrate-image
          // CMD. Mongoose remains excluded; that gate is exercised by the
          // mongoose unit tests in tests/integration/tools/generate-dockerfile.test.ts.
          'Dockerfile.migrate',
        ],
        absent: [
          // auth/ui/orpc all opted out:
          'packages/auth',
          'packages/ui',
          'packages/orpc',
          // B5 regression catch — see full-everything-on for rationale.
          // bun doesn't emit these today, but assertion future-proofs.
          'apps/web/pnpm-workspace.yaml',
          'apps/web/pnpm-lock.yaml',
        ],
      },
    },
    {
      name: 'variant-c-minimal-pnpm',
      config: variantCMinimal,
      postConditions: {
        exists: [
          'apps/web/package.json',
          'pnpm-workspace.yaml',
          'turbo.json',
        ],
        absent: [
          // Minimal mode emits NO packages/* directory at all.
          'packages',
          // B5 regression catch — minimal + pnpm IS the canonical case
          // create-next-app --use-pnpm exhibits the leftover-file bug.
          // See full-everything-on for rationale.
          'apps/web/pnpm-workspace.yaml',
          'apps/web/pnpm-lock.yaml',
        ],
      },
    },
    {
      name: 'variant-d-flat-regression',
      config: variantDFlat,
      postConditions: {
        exists: [
          // Flat mode: top-level Next.js project layout.
          'package.json',
          'src/app/page.tsx',
        ],
        absent: [
          'apps',
          'packages',
          'turbo.json',
          // Note: pnpm-workspace.yaml is NOT asserted absent here. Recent
          // create-next-app emits a top-level pnpm-workspace.yaml carrying
          // only `ignoredBuiltDependencies:` (sharp, unrs-resolver) — that
          // is a non-monorepo file for pnpm's built-deps allowlist, not a
          // workspace declaration. Asserting its absence would catch a
          // create-next-app behaviour we have no business policing.
        ],
      },
    },
  ];
}

/** Same semantics as MCPTestClient.isFailure: ❌ in body or isError flag. */
function isToolFailure(result: unknown): { failed: boolean; text: string } {
  const res = result as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  const textNode = res.content?.find((c) => c.type === 'text');
  const text = textNode && 'text' in textNode ? (textNode.text ?? '') : '';
  if (res.isError) return { failed: true, text };
  if (text.includes('❌') || text.includes('Failed')) return { failed: true, text };
  return { failed: false, text };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const TOOL_SEQUENCE = [
  'scaffold_project',
  'setup_database',
  'setup_authentication',
  'setup_shadcn',
  'generate_dockerfile',
  'generate_base_components',
  'generate_readme',
  'validate_project',
] as const;

async function runPreset(
  preset: Preset,
  serverPath: string
): Promise<{ ok: boolean; reason?: string }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'next-mcp-smoke-'));
  const projectPath = path.join(tempDir, preset.config.name as string);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });
  const client = new Client(
    { name: 'next-mcp-smoke', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    for (const tool of TOOL_SEQUENCE) {
      const args =
        tool === 'scaffold_project'
          ? { config: preset.config, targetPath: tempDir }
          : { config: preset.config, projectPath };
      const result = await client.callTool({ name: tool, arguments: args });
      const { failed, text } = isToolFailure(result);
      if (failed) {
        // Truncate noisy responses for log readability.
        const snippet = text.length > 400 ? `${text.slice(0, 400)}…` : text;
        return { ok: false, reason: `tool ${tool} failed: ${snippet}` };
      }
    }

    // Post-conditions: required-exists.
    for (const rel of preset.postConditions.exists) {
      const abs = path.join(projectPath, rel);
      if (!(await pathExists(abs))) {
        return { ok: false, reason: `expected file/dir missing: ${rel}` };
      }
    }
    // Post-conditions: required-absent.
    for (const rel of preset.postConditions.absent) {
      const abs = path.join(projectPath, rel);
      if (await pathExists(abs)) {
        return { ok: false, reason: `expected file/dir present (should be absent): ${rel}` };
      }
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `unexpected error: ${msg}` };
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore disconnect errors — we still want to clean up the temp dir.
    }
    if (process.env.NEXT_MCP_SMOKE_KEEP_TMP === '1') {
      console.error(`[smoke] keeping temp dir for inspection: ${tempDir}`);
    } else {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        // Swallow cleanup errors so a transient ENOTEMPTY (Windows-style FS,
        // antivirus race on a CI runner) doesn't replace the original error
        // surfaced from the try block. Same discipline as client.close() above.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[smoke] failed to clean up temp dir ${tempDir}: ${msg}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const presetFilter = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;

  // Validate every preset's config up-front — Zod refines fire here, well
  // before we spend cycles spawning a server.
  const presets = buildPresets();
  const presetsToRun = presetFilter
    ? presets.filter((p) => p.name === presetFilter)
    : presets;

  if (presetFilter && presetsToRun.length === 0) {
    console.error(
      `Unknown preset: ${presetFilter}. Available: ${presets.map((p) => p.name).join(', ')}`
    );
    process.exit(2);
  }

  const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
  if (!(await pathExists(serverPath))) {
    console.error(
      `Built MCP server not found at ${serverPath}. Run 'pnpm run build' first.`
    );
    process.exit(2);
  }

  let allOk = true;
  for (const preset of presetsToRun) {
    const start = Date.now();
    const { ok, reason } = await runPreset(preset, serverPath);
    const ms = Date.now() - start;
    if (ok) {
      console.log(`PASS ${preset.name} (${ms}ms)`);
    } else {
      console.error(`FAIL ${preset.name} (${ms}ms): ${reason ?? 'unknown failure'}`);
      allOk = false;
    }
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
