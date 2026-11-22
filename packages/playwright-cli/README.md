# playwright-cli

Local APM package for [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) —
the `playwright-cli` skill for driving a browser from the shell (snapshots, element refs,
screenshots, tracing, request mocking, test generation).

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun scripts/build-playwright-cli-package.ts` (repo root) from the vendored, untouched submodule
at `vendor/playwright-cli`. Only `apm.yml` and this README are fixed, hand-authored sources.

The skill drives the `playwright-cli` binary, which this package does not install:
`npm install -g @playwright/cli`.

To pick up a new release: bump `vendor/playwright-cli` to the new tag, re-run the generator,
then bump `version:` in `apm.yml` to match.
