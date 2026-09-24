# Task runner for this repo. `just` lists every recipe.

apm_skills := "packages/apm/.apm/skills"

default:
    @just --list

# Token weight of every instruction and skill, by package and file (pass --help for flags)
weigh *args:
    bun scripts/context-weight.ts {{ args }}

# Deploy every package's .apm/ sources — a root-only `apm install` leaves package mirrors stale
install *args:
    bash {{ apm_skills }}/apm-install-deps/scripts/install-all.sh . {{ args }}

# Audit every package for drift and supply-chain integrity
audit:
    bash {{ apm_skills }}/apm-audit-security/scripts/audit-all.sh .

# Regenerate the vendored packages from their upstream submodules
build: build-caveman build-fallow build-rtk

build-caveman *args:
    bun scripts/build-caveman-package.ts {{ args }}

build-fallow *args:
    bun scripts/build-fallow-package.ts {{ args }}

build-rtk *args:
    bun scripts/build-rtk-package.ts {{ args }}

test: test-bun test-shell

test-bun:
    for t in scripts/test-*.ts; do echo "== $t"; bun "$t" || exit 1; done

test-shell:
    for t in scripts/*/test-*.sh; do echo "== $t"; bash "$t" || exit 1; done
