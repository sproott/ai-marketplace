# playwright-cli

Local APM package for [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) —
the `playwright-cli` skill for driving a browser from the shell (snapshots, element refs,
screenshots, tracing, request mocking, test generation).

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun run cli build playwright-cli` (repo root) from the vendored, untouched submodule
at `vendor/playwright-cli`. Only `apm.yml` and this README are fixed, hand-authored sources.

The skill drives the `playwright-cli` binary, which this package does not install:
`npm install -g @playwright/cli`.

Run `bun install --frozen-lockfile` at the repository root before building. To update
to the upstream release, run `bun run cli update playwright-cli`.
