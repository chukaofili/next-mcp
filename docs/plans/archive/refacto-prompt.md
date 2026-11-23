You are running Phase 0 (derisking spike) of the monorepo+shadcn
scaffolding refactor. The full plan is in
docs/plans/2026-05-07-monorepo-shadcn-refactor-design.md — read it
first as the source of truth, especially §6.2 (proposed shadcn-led
scaffold flow) and §8 (six open questions this spike needs to answer).

Working dir: /Users/chukaofili/projects/chukaofili/next-mcp
Branch: feat/upgrade-packages
HEAD: 3843166 (or current — `git log --oneline -1` to verify)

SCOPE: Phase 0 only. NO code changes to next-mcp source. The output
of this session is a written go/no-go decision (recommendation to
proceed with R1's main implementation in Phase 4, or fall back to the
narrower "B5 fix only" path in Phase 1) plus empirical answers to
design doc §8.1, §8.3, and §8.6 — answered by actually running
shadcn init with various flags and observing what it produces.

Reference scaffold from the prior smoke run lives at /tmp/test-2 —
verified output of `pnpm dlx shadcn@latest init --preset b0
--template next --monorepo --pointer --name test-2`. Use it as the
"this is what shadcn produces" baseline. Don't delete it; if you need
fresh scaffolds, drop them in /tmp/r1-spike-* directories.

YOUR ROLE in this session:
  1. You run commands locally — shadcn init, pnpm install, manual
     augmentation passes (rename sweep, catalog block, etc.), then
     end-to-end build/docker/migrate against the manually-augmented
     project.
  2. You interpret outputs and tell me explicitly which assumptions
     in the design doc hold and which don't.
  3. You produce a written decision document at the end:
     docs/plans/2026-05-07-r1-spike-results.md, capturing:
       - go/no-go recommendation
       - empirical answers to §8.1 (--name rename scope), §8.2 (flat
         vs src/ layout — verify what shadcn actually produces and
         whether moving it post-init is realistic), §8.3 (which pins
         shadcn writes; which the augmentation must override), §8.6
         (what shadcn writes in the bun/npm/yarn cases — verify by
         running with --packageManager=npm if shadcn supports it,
         otherwise note that shadcn always pins pnpm and document
         the override path)
       - a flagged list of any design-doc assumptions that turned
         out wrong, with the corrected statement
       - a concrete patch sketch for the R1 implementation (in
         words — not actual code) showing the order of augmentation
         passes that worked end-to-end in your manual exercise

PROCEDURE for the spike (target ~3 hours):

Step 1 — Reproduce the reference scaffold against ONE config (the
   "everything-on full" config from the v2 smoke doc §3, except
   skipping next-mcp's tool calls entirely — directly invoke shadcn
   init):
     mkdir -p /tmp/r1-spike-1 && cd /tmp/r1-spike-1
     pnpm dlx shadcn@latest init --preset b0 --template next \
       --monorepo --pointer --name r1-spike-1
   Diff its output against /tmp/test-2 — should be near-identical
   (only --name differs). Confirm §5 of the design doc's inventory.

Step 2 — Empirically resolve §8.1 (--name behavior). What did shadcn
   rename: directory? root package.json `name`? The @workspace/...
   scope? Document verbatim what changes between the test-2 baseline
   and r1-spike-1.

Step 3 — Run the augmentation passes manually. Use /tmp/r1-spike-1 as
   your subject. Apply, in this order, the 11 augmentation steps
   from §6.2 of the design doc:
     (1) project-scope rename (sed sweep across .json/.ts/.tsx/.js/.mjs)
     (2) catalog block in pnpm-workspace.yaml (mirror what
         scaffoldMonorepoRoot writes today)
     (3) pin alignment per §8.3 — bump packageManager, engines.node,
         engines.pnpm; bump apps/web's next/react if needed
     (4) layout decision — do the flat→src/ move pass if you go with
         §8.2 option (a), OR document why option (b) (keep flat) is
         the right call
     (5) emit .env, .env.example, .env.local at workspace root
     (6) add docker scripts to root package.json
     (7) conditional dotenv-cli + auth:generate (skip — prisma path
         in this config, but note where you'd wire it for drizzle)
     (8) skip — testing !== 'none' in this config
     (9) emit packages/db, packages/auth, packages/orpc — copy from
         next-mcp's templates manually for the spike (don't worry
         about catalog substitution; just symlink in the deps)
     (10) patch packages/db deps (whatever getDbDeps would produce
          for prisma+postgres — look it up in src/index.ts)
     (11) updateGitignore + apps/web tweaks

Step 4 — Run the runtime checks from smoke v2 §5 against the
   manually-augmented project:
     pnpm install
     pnpm typecheck
     pnpm build
     docker build .
     docker compose run --rm migrate
   Each failure is a data point about whether the augmentation
   approach is viable. Don't fix-and-retry blindly — root-cause each
   failure before moving on, because each failure is information
   about a step the R1 implementation will need to handle correctly.

Step 5 — Try ONE additional axis to derisk §8.6. Pick whichever feels
   highest-risk: (a) re-run the spike with packageManager=npm to see
   if shadcn supports it, (b) re-run with --no-monorepo to confirm
   flat-mode behavior, or (c) run the "minimal" config to confirm
   §8.4's recommendation works.

Step 6 — Write the decision doc. Be precise about what worked, what
   didn't, what surprised you, and what the R1 implementation needs
   to handle that the design doc didn't fully anticipate. Update
   the design doc itself if you find any of its claims (§5 inventory,
   §6.2 augmentation list, §8 open questions) need correction.

CONSTRAINTS:
  - Don't change next-mcp source. The whole point of Phase 0 is to
    validate the design doc empirically before committing the
    refactor.
  - Don't run the smoke variants from smoke-v2 doc — that's Phase 4's
    job. Phase 0 only proves out the everything-on full config plus
    one risk-axis from Step 5.
  - If you discover that R1 is fundamentally infeasible (e.g. shadcn
    init has some hard incompatibility with one of the augmentation
    passes that can't be worked around), STOP and write the no-go
    decision. Don't try to refactor the design doc into a different
    architecture in this session — that's a separate session's job.
  - If the spike succeeds end-to-end, the result is a green light
    for Phase 4 (the main refactor). Phase 1 (non-shadcn B5 fix) and
    Phase 2/3 are independent of R1's outcome and can land separately.

REFERENCE DOCS (read these in order):
  1. docs/plans/2026-05-07-monorepo-shadcn-refactor-design.md
     — the source of truth for what to validate
  2. docs/plans/2026-05-05-monorepo-smoke-test.md (Findings →
     "Everything-on full") — verbatim smoke findings B1–B7 with
     file/line refs; provides context for why R1 exists
  3. docs/plans/2026-05-07-monorepo-smoke-test-v2.md
     — what the post-R1 smoke procedure should look like; useful to
     anticipate Phase 5/6 implications of decisions you make in
     Phase 0
  4. /tmp/test-2 — canonical reference scaffold (don't delete)

Start by:
  - Confirming you've read the design doc and the smoke v1
    findings.
  - Confirming /tmp/test-2 still exists and is intact.
  - Listing the six §8 open questions from the design doc and
    noting which ones this session can resolve empirically (1, 3,
    6 — yes via running shadcn; 2 partially; 4 partially; 5 no, that's
    a policy question for Phase 4) before kicking off Step 1.

---

# Next prompt — Phase 1 (B5 targeted fix, non-shadcn paths)

Phase 0 (above) landed go for R1 on 2026-05-07; results in
docs/plans/2026-05-07-r1-spike-results.md. Phase 4 (the main R1
refactor) is unblocked but not yet scoped into a session prompt —
this prompt covers Phase 1 instead, which the design doc marks "do
first, 1 small PR, independent of R1".

The full plan is in
docs/plans/2026-05-07-monorepo-shadcn-refactor-design.md — read §6.4
(non-shadcn fallback fix) and §7 Phase 1 first; they are the source
of truth for what this session is actually doing.

Working dir: /Users/chukaofili/projects/chukaofili/next-mcp
Branch: feat/upgrade-packages (verify with `git status -sb`; create a
new branch off it if you'd rather keep this PR clean from the spike's
docs commits).
HEAD: run `git log --oneline -1` to verify.

SCOPE: Phase 1 only. Two tightly-scoped code edits and one smoke
assertion:

  (1) In `scaffoldProject` (`src/index.ts:1386-1460`), after the
      `create-next-app` subprocess returns successfully and BEFORE
      any monorepo-root scaffolding runs, delete the rogue files
      `create-next-app --use-pnpm` leaves at the app level. They are
      `apps/web/pnpm-workspace.yaml` (a stub containing only
      `ignoredBuiltDependencies`) and `apps/web/pnpm-lock.yaml`.
      These are the root cause of B5 in the smoke v1 findings —
      every later `pnpm <add|install>` invoked from inside `apps/web/`
      walks up the tree, finds the rogue workspace yaml first, and
      fails to resolve real workspace deps (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`).

      Implement as `fs.rm(..., { force: true })` on both paths,
      gated on `isMonorepo` (i.e. `monorepo !== 'none'`). The exact
      sketch is in design doc §6.4 — copy it verbatim, idiomatic
      to the surrounding code style.

      For belt-and-suspenders, do this even when `packageManager !== 'pnpm'`
      (the rogue files only exist for `--use-pnpm`, but `force: true`
      makes a missing-file path a no-op). That keeps the fix
      package-manager-agnostic and survives any future scaffold-tool
      switcheroos.

  (2) Update the headless smoke driver in `tools/smoke.ts` to
      assert, post-`scaffold_project`, that **neither**
      `apps/web/pnpm-workspace.yaml` nor `apps/web/pnpm-lock.yaml`
      exists in any monorepo variant. This is the canonical "B5
      regression catch" — match the assertion to smoke v2 §4.0's
      universal regression catches so the wording stays consistent
      across the headless and manual smokes.

  (3) Smoke v2 (docs/plans/2026-05-07-monorepo-smoke-test-v2.md)
      already documents this as a §4.0 universal regression catch —
      no doc edit needed unless §4.0's wording needs to be tightened.

NO source changes outside src/index.ts and tools/smoke.ts. The full
R1 refactor (Phase 4) is a separate session — don't pre-empt it
from this PR.

PROCEDURE (target ~30-60min):

Step 1 — Read the design doc §6.4 and the smoke v1 finding B5
   (smoke doc §"Errors / blockers" "B5 ⭐"). Both have verbatim
   reproductions and rationale. The fix is mechanically obvious;
   the value of the spike is the rationale, which informs the test
   assertion.

Step 2 — Implement edit (1) in `src/index.ts`. Locate
   `scaffoldProject`'s monorepo branch (currently at
   `src/index.ts:1417-1425`, run `git grep -n 'scaffoldMonorepoRoot' src/index.ts`
   to confirm before editing — line numbers may have drifted).
   Insert the `fs.rm` cleanup between `create-next-app` returning
   and `scaffoldMonorepoRoot` being called.

   `appPath` is already in scope at that point; `path.join(appPath,
   'pnpm-workspace.yaml')` is the right resolution. Add a one-line
   comment explaining why (the rogue file shadows the real
   workspace; ref design doc §6.4 + smoke v1 B5).

Step 3 — Implement edit (2) in `tools/smoke.ts`. Find where the
   driver asserts post-conditions per variant (search for an
   existing `apps/web` or `pnpm-workspace.yaml` assertion to
   anchor on). Add the negative-existence assertion for the two
   rogue files in every monorepo variant (full + minimal).

Step 4 — Verify locally:
   - `pnpm install && pnpm build` (build the MCP server).
   - `pnpm run smoke` — must pass green; the new assertion fires
     for every variant that hits the create-next-app path.
   - `pnpm run smoke variant-d-flat-pnpm` (flat) — confirm the
     assertion does NOT trigger spuriously on flat mode (no
     monorepo, no rogue files possible by construction).

Step 5 — `pnpm test` to make sure the integration tests still pass
   (the smoke driver shares fixtures with `tests/integration/tools/scaffold-project*.test.ts`;
   if any test was implicitly relying on the rogue file existing,
   it'll need updating in lockstep).

Step 6 — Commit and push as a separate small PR titled along the
   lines of "fix(scaffold): delete create-next-app workspace
   leftovers (B5)". The PR description should include:
   - Reference to smoke v1 finding B5 (with the verbatim
     `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` symptom).
   - The one-line code change + smoke assertion.
   - Note that Phase 4 (R1) supersedes this for shadcn paths but
     this PR lands now to unblock everything else.

CONSTRAINTS:
  - Don't touch anything in src/index.ts beyond the targeted edit.
  - Don't pre-emptively start the Phase 4 refactor (the shadcn-led
    `scaffoldViaShadcnMonorepo` helper). That's a separate, bigger
    session; the spike-results doc has the patch sketch for it.
  - If `tools/smoke.ts` doesn't have an obvious extension point for
    a new assertion, surface the structural concern rather than
    forcing it in awkwardly — flagging is better than a hack that
    becomes load-bearing.
  - If the integration tests fail unexpectedly, root-cause first:
    a test relying on the rogue file's existence is itself a bug
    that should be reported alongside this fix, not silently
    accommodated.

REFERENCE DOCS (read these in order):
  1. docs/plans/2026-05-07-monorepo-shadcn-refactor-design.md §6.4
     and §7 Phase 1 — the source of truth for this fix.
  2. docs/plans/2026-05-05-monorepo-smoke-test.md, "Errors /
     blockers" → "B5 ⭐" — the verbatim symptom, root cause, and
     reproduction.
  3. docs/plans/2026-05-07-monorepo-smoke-test-v2.md §4.0 — the
     post-fix invariant the new smoke assertion mirrors.
  4. docs/plans/2026-05-07-r1-spike-results.md — Phase 0's results;
     read the "What's deferred" / Phase 4 patch sketch for context
     on how this fix interacts with R1.
