# Spec: Marketplace maintainer CLI

## Objective

Maintainers use one Bun CLI to generate packages, update upstream releases, measure context weight, and bundle hooks. Given the same inputs, building all packages in a clean checkout leaves `packages/` unchanged, including file modes and the absence of unexpected files.

## Command contract

Run from the repository root. The CLI rejects a working directory without `apm.yml` and `packages/`. `bun run cli --help` lists commands; each command has its own help. Existing `just build [<package>]`, `just weigh`, `just update`, and `just test` recipes remain usable. `just build <package>` also bundles the hook for `fsharp`, `oxlint`, `personal`, or `rules-on-create`; add `--check` to verify the bundle without writing.

| Example | Contract |
| --- | --- |
| `bun run cli build caveman --validate` | `build` with no package runs the authored hook builders and all five upstream builders: `caveman`, `fallow`, `impeccable`, `playwright-cli`, and `rtk`. Caveman, Fallow, and RTK support APM validation. All five upstream builders accept `--out <dir>`: Impeccable takes the packages parent; the others take the package destination. Authored files survive regeneration. |
| `bun run cli weigh --summary` | Estimates locally by default. Preserves the text and JSON report formats, defaults, and `--exact`, `--model`, `--package`, `--all`, `--summary`, `--sort`, `--window`, and `--json` options. Malformed primitive frontmatter is skipped with a diagnostic on stderr; valid entries still appear in the report. Only exact counts require credentials. |
| `bun run cli update rtk` | Accepts one supported package or `all` (default). Resolves each candidate from the package's declared source: npm latest, a stable Git release tag, a release tag matching the default branch's manifest version, or RTK's license-checked default branch. Tag-based updates check out the release tag. Validation precedes version pin changes and rebuilding. After the builds succeed, runs tests and installation in order and stops on failure, then runs audit and reports a failure without failing the update. |

Invalid invocations and failed subprocesses produce actionable diagnostics and a nonzero exit status. Invalid package selection performs no update.

## Stack and layout

- Bun manages dependencies and runs the CLI. TypeScript 7, Effect v4 (`effect/cli`), and the Bun platform runtime are the CLI stack. The root lockfile records compatible versions.
- `scripts/cli/src/cli.ts` owns the command tree and runtime. `scripts/cli/src/packages/` holds each package's self-contained definition: its builder, release source, and package-only helpers. A package is one `<package>.ts` file, or a `<package>/` folder with `index.ts` when it needs more modules. `scripts/cli/src/package-model/` holds the registry, `defineBuilder` with the shared vendor and package path conventions, and the release-source strategies. `scripts/cli/src/commands/` holds one module or folder per command; helpers used by one command live in its folder. `scripts/cli/src/shared/` holds process, filesystem, and failure plumbing used across commands and packages. `bun run cli build` regenerates all packages concurrently, because each builder writes only its own package directory. Package-owned hook sources and copied assets live under `packages/<package>/src/hooks/`, with Vitest `*.test.ts` or shell `test-*.sh` suites under `packages/<package>/tests/`. The shared TypeScript `hook-io.ts` and `hook-io.test.ts` live under `packages/_shared/hook-io/`. The native probe lives in `scripts/shell/`.
- `scripts/cli/tests/` holds the TypeScript suite using Vitest and `@effect/vitest`. Vendored code, generated packages, and redistributed runtime assets are not CLI lint targets.
- `bun run typecheck` checks the CLI, its tests, and its Oxlint rules, then hook sources, package tests, and `hook-io` through `tsconfig.hooks.json`, with strict TS7 settings, including exact optional properties and unchecked indexed access. `bun run lint` runs type-aware Oxlint with Effect diagnostics enabled and fails on warnings. Repository rules in `scripts/cli/oxlint/` and `.oxlintrc.json` reject explicit throws, raw JSON APIs, hand-written `_tag` objects, destructured Effect services, and unstable APIs outside an explicit allowlist. VS Code and Cursor workspace settings select a compatible native toolchain. Repository guidance in `packages/dev/.apm/instructions/effect-solutions.instructions.md` tells agents how to consult `effect-solutions` and its v4 source reference when working on Effect code.

## Code style and boundaries

Use the Effect Solutions CLI style, for example `import { Argument, Command, Flag } from "effect/cli"`. Keep text transformations pure; represent filesystem, process, and network operations at Effect boundaries so failure and test substitution are explicit. Extract shared behavior where two builders actually use it. Builders validate the upstream assumptions they rewrite against and fail with typed errors grouped by source; command handlers match the tags and format each diagnostic once. Brand a value when its validated invariant or distinction from another value prevents a concrete mistake.

- **Always:** preserve package-specific transformation rules, executable permissions, validation, and authored content. Keep credentials out of logs and fixtures.
- **Ask first:** before changing output formats, supported flags, package layout, or verification policy.
- **Never:** hand-edit a generated mirror to pass parity, run a real upstream update in the test suite, or introduce a second implementation behind `just`.

## Verification

`bun run test` runs the Vitest suites under `scripts/cli/tests/`, `packages/*/tests/`, and `packages/_shared/hook-io/`. `just test` also runs the `test-*.sh` suites under `packages/<package>/tests/` and rejects stale hook bundles across all packages, including Caveman and both Impeccable targets. `just check` adds CLI and hook type checks and lint. Cover command parsing, output transforms, update failure boundaries, and read-only drift detection. Test exact-count behavior without real credentials or a live service. A full builder parity check needs no golden files: with clean `packages/` and matching upstream inputs, `just build` succeeds and `git status --porcelain --untracked-files=all -- packages/` prints nothing. Typecheck, lint, and tests must pass independently.
