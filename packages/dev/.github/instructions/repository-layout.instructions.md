---
description: Repository boundaries and target layout for maintainer tooling, package assets, and tests
---

# Repository layout

Use the target paths below for new files. Move existing files only when the task calls for it; update their callers, tests, and docs in the same change.

```text
scripts/
  cli/                 # Maintainer CLI only
    src/
      cli.ts           # Entry point and command tree
      commands/        # One module or folder per command, with its private helpers
      packages/        # One definition per marketplace package: <pkg>.ts, or <pkg>/index.ts when it needs more modules
      package-model/   # Package registry, definition helper, and strategy types
      shared/          # Plumbing used across commands and packages
    tests/             # Vitest tests for the CLI
  assets/<owner>/      # Native sources copied into marketplace packages
  shell/               # Repo-level shell utilities that do not ship
tests/shell/           # Shell integration suites for repo or package behavior
packages/<package>/    # Marketplace package manifests, primitives, and deployment outputs
vendor/<upstream>/     # Pinned upstream inputs
```

- Keep CLI fixtures with the tests that use them. Keep shared configuration and `justfile` at the repository root.
- Keep a shell test beside its source under `scripts/assets/<owner>/` when it exercises a copied asset directly. Put tests that exercise the repo or a deployed package under `tests/shell/`. Name shell suites `test-*.sh` so the runner can discover them recursively. Do not copy tests into marketplace packages.
- Use `just test` as the single entry point for the Vitest suite and all discovered shell suites. Keep the CLI typecheck and lint scoped to CLI source and tests. Keep distributed hooks in their native runtimes; a CLI module setting must not change how a shipped hook loads.
- Edit package-authored primitives in `packages/<package>/.apm/`. For generated primitives, edit the CLI builder or its inputs and rebuild. Do not hand-edit generated package files. Keep repository tooling out of `vendor/`.
