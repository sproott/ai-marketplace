# Task runner for this repo. `just` lists every recipe.

apm_skills := "packages/apm/.apm/skills"

default:
    @just --list

# Token weight of every instruction and skill, by package and file (pass --help for flags)
[positional-arguments]
weigh *args:
    bun run cli weigh "$@"

# Deploy every package's .apm/ sources — a root-only `apm install` leaves package mirrors stale
install *args:
    bash {{ apm_skills }}/apm-install-deps/scripts/install-all.sh . {{ args }}

# Audit every package for drift and supply-chain integrity
audit:
    bash {{ apm_skills }}/apm-audit-security/scripts/audit-all.sh .

# Update one upstream-backed package, or all of them, then rebuild and verify
update package="all":
    bun run cli update {{ quote(package) }}

# Regenerate every upstream-backed package, or one with its flags: just build caveman --validate
[positional-arguments]
build *args:
    bun run cli build "$@"

# Copy scripts/assets/hook-io/hook_io.py into every package whose hooks import it
[positional-arguments]
sync-hook-io *args:
    bun run cli sync-hook-io "$@"

check: test
    bun run lint

test: test-bun test-shell

test-bun:
    bun run test

test-shell:
    #!/usr/bin/env bash
    set -euo pipefail
    find scripts/assets tests/shell -type f -name 'test-*.sh' -print0 | sort -z |
      while IFS= read -r -d '' test; do
        printf '== %s\n' "$test"
        bash "$test" </dev/null
      done
