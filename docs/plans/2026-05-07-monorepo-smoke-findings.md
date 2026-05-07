# Monorepo Smoke Test — Findings (2026-05-07 run)

> Companion to [`2026-05-07-monorepo-smoke-test-v2.md`](./2026-05-07-monorepo-smoke-test-v2.md).
> That doc is the procedure / source of truth; this one captures the
> per-variant outcomes of a specific run so smoke-v2 stays a clean
> spec. Earlier runs were captured inline in smoke-v2 §9 and in v1's
> findings — see those for prior history.
>
> Fill in **during the run**, one subsection per variant. Empty
> bullets are fine — leave them as a record that the variant was
> attempted and passed.

## Run metadata

- Branch: `feat/upgrade-packages`
- HEAD SHA: `d5aae9a` (`fix(scaffold): three Codex-flagged R1 regressions` — newer than the smoke-v2 prompt's referenced `368ad49`; recent commits since: `d5aae9a, 2cfc26c, 368ad49`)
- Test baseline: 20 files / 302 tests passing (per smoke-v2 header)
- Driver: MCP Inspector (Option B) — `npx @modelcontextprotocol/inspector node ~/projects/chukaofili/next-mcp/dist/index.js`
- Operator: Chuka Ofili
- Host (OS / Docker runtime / Node / pnpm): macOS (Darwin 25.4.0) / Docker 29.4.2 desktop-linux / Node 24.15.0 / pnpm 10.33.3
- Network notes (registry availability, shadcn CLI version observed): TBD — record on first scaffold_project run (shadcn CLI version is currently `@latest`, design doc §8.5)

## Per-variant findings

### Everything-on full (pnpm + postgres + prisma + better-auth + shadcn + orpc)

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant A — Full + npm

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant B — Full + bun + sqlite + drizzle

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant C — Minimal + pnpm

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant D — Flat regression (shadcn)

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

### Variant D' — Flat regression (non-shadcn)

- Date run:
- Run by:
- Notable observations:
- Errors / blockers:
- Follow-up tickets filed:

## Cross-cutting findings

> Use this section for anything that surfaced across multiple
> variants (e.g. shadcn CLI drift, dependency-pin mismatch, registry
> flake) so it isn't buried under one variant's heading.

-

## Follow-up tickets

> Title + one-line summary + suggested file path / area. File the
> actual issue separately and link it back here once it has a number.

-
