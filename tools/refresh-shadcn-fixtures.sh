#!/usr/bin/env bash
# Regenerate the committed shadcn-init fixtures used by the integration
# test suite. Run this when shadcn ships a b0-preset change that affects
# our augmentation pipeline (or whenever `pnpm run smoke` flags drift).
#
# What it does:
#   1. Runs `pnpm dlx shadcn@latest init --monorepo …` and `--no-monorepo …`
#      against fresh tmp dirs.
#   2. Strips node_modules / .git / lockfiles (the augmentation pipeline
#      and a downstream `<pm> install` regenerate those).
#   3. Replaces the contents of tests/fixtures/shadcn-{monorepo,flat}-init/.
#
# Usage:
#   pnpm run refresh-shadcn-fixtures
#   git diff tests/fixtures/   # inspect changes
#   pnpm test                  # confirm fixtures still drive the suite
#   git add tests/fixtures && git commit
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures"
TMP_ROOT="$(mktemp -d -t next-mcp-fixture-refresh-XXXXXX)"
trap 'rm -rf "${TMP_ROOT}"' EXIT

EXCLUDES=(--exclude='node_modules' --exclude='.git' --exclude='pnpm-lock.yaml' \
          --exclude='package-lock.json' --exclude='yarn.lock' \
          --exclude='bun.lock' --exclude='bun.lockb')

echo "[refresh] generating shadcn monorepo init at ${TMP_ROOT}/monorepo …"
mkdir -p "${TMP_ROOT}/monorepo"
pnpm dlx shadcn@latest init --preset b0 --template next \
  --monorepo --pointer --silent --name shadcn-monorepo-init \
  --cwd "${TMP_ROOT}/monorepo"

echo "[refresh] generating shadcn flat init at ${TMP_ROOT}/flat …"
mkdir -p "${TMP_ROOT}/flat"
pnpm dlx shadcn@latest init --preset b0 --template next \
  --no-monorepo --pointer --silent --name shadcn-flat-init \
  --cwd "${TMP_ROOT}/flat"

echo "[refresh] replacing ${FIXTURE_ROOT}/shadcn-monorepo-init/ …"
rm -rf "${FIXTURE_ROOT}/shadcn-monorepo-init"
mkdir -p "${FIXTURE_ROOT}/shadcn-monorepo-init"
rsync -a "${EXCLUDES[@]}" "${TMP_ROOT}/monorepo/shadcn-monorepo-init/" \
  "${FIXTURE_ROOT}/shadcn-monorepo-init/"

echo "[refresh] replacing ${FIXTURE_ROOT}/shadcn-flat-init/ …"
rm -rf "${FIXTURE_ROOT}/shadcn-flat-init"
mkdir -p "${FIXTURE_ROOT}/shadcn-flat-init"
rsync -a "${EXCLUDES[@]}" "${TMP_ROOT}/flat/shadcn-flat-init/" \
  "${FIXTURE_ROOT}/shadcn-flat-init/"

echo "[refresh] done. Inspect via:"
echo "  git diff --stat tests/fixtures/"
