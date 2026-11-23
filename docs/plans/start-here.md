# Start Here — Source-Side Fixes for next-mcp

> Paste-ready prompt for the next Claude Code session.

## Prompt to paste

```text
You are continuing work on next-mcp at
/Users/chukaofili/projects/chukaofili/next-mcp on branch
feat/upgrade-packages.

Required reading (in this order):
  1. docs/plans/2026-05-07-handoff-after-smoke-pause.md
     — what state we're in, what was attempted, the source-side
       fix order, the validation plan after fixes land.
  2. docs/plans/2026-05-07-monorepo-smoke-findings.md
     — canonical findings from the 2026-05-07 manual smoke run.
       The handoff doc summarizes; this doc is authoritative.
  3. docs/plans/2026-05-07-monorepo-smoke-test-v2.md
     — the smoke procedure. The §4 invariants are still authoritative
       except where the handoff doc §6 calls out spec drift.

Run these immediately to understand the working state:
  - git status
  - git log feat/upgrade-packages --oneline -10
  - pnpm test  (baseline: 20 files / 302 tests)
  - pnpm run smoke  (headless 5-preset driver)

Some operator-side template changes were made mid-smoke and may
not be committed yet (orpc private flag, prisma client factory
shape, auth server factory shape, scripts/generate.ts emission,
root db:auth:generate script, auth-consumer templates at
templates/web/lib/*). Confirm with git status. If anything is
local-only, decide whether to commit before starting fixes — the
handoff doc treats these as "in flight, may need productionizing".

This session is for SOURCE-SIDE FIXES, not for re-running the
manual smoke. The fix order is in the handoff doc §4, organized
into 5 groups by leverage:

  Group 1 — apps/web tsconfig paths removal, baseUrl removal,
            install missing peer deps for better-auth-ui
            (clears ~70 of ~100 typecheck errors)
  Group 2 — Toaster import path, ../ui/X relative path rewrites,
            global.d.ts CSS module declaration, stale Geist
            cleanup, use-mobile relocation
  Group 3 — setup_authentication B1 + B6 fixes, setup_database
            B6 + ordering + --output path, generate_readme
            monorepo-blindness + name resolution, validate_project
            monorepo-blindness, observability gaps
  Group 4 — Catalog pin policy lockstep (typescript / @typescript-eslint
            / zod / react / tailwindcss), catalog re-add noise
  Group 5 — Deferred follow-ups (better-auth-ui upstream, db:auth:generate
            per-PM, dangling empty dirs, dockerfile pnpm pinning,
            docker-compose depends_on.migrate, env secret consistency)

Use superpowers:subagent-driven-development for non-trivial fix work.
Stop and check in with me between fix groups so I can review the
diff before moving on. This is a stable operating principle, not a
per-group instruction.

After each group lands:
  - pnpm install && pnpm build  (rebuild dist)
  - pnpm test  (catch test-side regressions)
  - pnpm run smoke  (headless 5-preset, catches generation-only
    regressions in ~6s — fast feedback)

After all fix groups land + tests + headless smoke are green:
  - Re-run the manual everything-on full smoke per
    docs/plans/2026-05-07-monorepo-smoke-test-v2.md against a clean
    /tmp/next-mcp-smoke/ (delete the prior smoke project first).
  - If clean, proceed through Variants A / B / C / D-shadcn / D-non-shadcn
    per smoke-v2 §6.
  - Open the merge PR feat/upgrade-packages → main once all variants
    are green; pull from the findings doc's per-variant subsections
    for the PR description.

Tests and smoke baselines may shift — the prisma client factory
pivot is a breaking change, so some integration tests that import
db as an instance need rewriting. Treat baseline drift as expected
the first time through, but verify each delta is intentional.

The prior smoke directory at /tmp/next-mcp-smoke/smoke-full is the
in-flight scaffold from the 2026-05-07 run with operator-side
patches applied. Treat as read-only reference (it documents the
"what got fixed by hand" delta for each Group 3 finding). Do not
patch it further — re-scaffold cleanly when validating fixes.

Update docs/plans/2026-05-07-monorepo-smoke-test-v2.md as fixes
land where the handoff doc §6 flags spec drift (success-message
wording, idempotency phrasing, etc).
```

## When to use this prompt

- Fresh Claude Code session in
  `/Users/chukaofili/projects/chukaofili/next-mcp`.
- Branch `feat/upgrade-packages` checked out.
- Docker daemon running and reachable (only needed at the validation
  re-run stage; not for the source-side fix stage itself).

## Notes for adapting

- If the next session is meant to fix only Groups 1+2 (typecheck wall)
  and not the larger setup-tool regressions, drop Groups 3–5 from the
  prompt above and add a "stop and hand back to me after Group 2 +
  re-run of pnpm test + pnpm run smoke" instruction.
- If new findings surface during fixes that aren't in the findings
  doc, add them as a "Findings discovered during fixes" section in
  `2026-05-07-monorepo-smoke-findings.md` rather than creating a new
  doc — the findings doc is the single source of truth across this
  pause window.
- The "stop and check in between groups" instruction is a stable
  operating principle. Keep it in any derivative prompt even if the
  group list changes.
