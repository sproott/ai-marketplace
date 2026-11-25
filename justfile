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

# Regenerate all buildable packages, or one with its flags: just build caveman --validate
[positional-arguments]
build *args:
    bun run cli build "$@"

check:
    bun run typecheck
    bun run lint
    just test

test: test-bun test-shell

test-bun:
    bun run cli build fsharp --check
    bun run cli build oxlint --check
    bun run cli build personal --check
    bun run cli build rules-on-create --check
    bun run test

test-shell:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    printf '%s\0' packages/*/tests/test-*.sh | sort -z |
      while IFS= read -r -d '' test; do
        [[ -n "$test" ]] || continue
        printf '== %s\n' "$test"
        bash "$test" </dev/null
      done
