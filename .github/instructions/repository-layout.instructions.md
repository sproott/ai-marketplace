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
  shell/               # Repo-level shell utilities that do not ship
packages/_shared/hook-io/ # Shared TypeScript hook I/O and its Vitest suite
packages/<package>/    # Marketplace package manifest, primitives, and deployment outputs
  src/hooks/           # Package-owned hook sources and copied assets
  tests/               # Vitest and test-*.sh suites for this package
vendor/<upstream>/     # Pinned upstream inputs
```

- Keep CLI fixtures with the tests that use them. Keep shared configuration and `justfile` at the repository root.
- Keep package tests in `packages/<package>/tests/`. Name shell suites `test-*.sh` for discovery by `just test`. Keep test files out of `.apm/`.
- Use `just test` as the single entry point for the Vitest suite, package shell suites, and freshness checks for all hook bundles. Keep the CLI typecheck and lint scoped to CLI source and tests. Keep distributed hooks in their native runtimes; a CLI module setting must not change how a shipped hook loads.
- Edit authored descriptors in `packages/<package>/.apm/` and package-owned hook sources and assets in `packages/<package>/src/hooks/`. For generated primitives, edit their sources or build inputs and rebuild. Do not hand-edit generated package files. Keep repository tooling out of `vendor/`.
