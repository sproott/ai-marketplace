---
name: add-built-package
description: Adds a marketplace package generated from an upstream project by the maintainer CLI, covering its vendor input, package definition, registration, tests, and docs. Use when packaging a new upstream tool. Not for hand-authored packages.
---

# Add a built package

A built package is regenerated from upstream by `bun run cli build <name>` and kept current by `bun run cli update <name>`. The `variant-definitions` and `upstream-builder-contracts` instructions apply throughout.

## 1. Choose the inputs

Decide where the builder reads upstream content and how `update` finds the latest stable version. Pick a strategy from `ReleaseSource` in `scripts/cli/src/package-model/release-source.ts`. Find out what each strategy does from its case in `scripts/cli/src/commands/update/resolve-release.ts`.

If no strategy fits, add a variant to `ReleaseSource` and its case to the `ReleaseSource.match` in `scripts/cli/src/commands/update/resolve-release.ts`. The compiler then fails until the case exists.

For submodule strategies, run `git submodule add <url> vendor/<name>`. Never edit files under `vendor/`.

Done when the strategy is chosen and any vendor checkout is pinned.

## 2. Author the package shell

Create `packages/<name>/apm.yml` and `packages/<name>/README.md` by hand, modelled on an existing built package such as `packages/rtk/`. Set `version` to the current stable upstream version.

Add one entry to `marketplace.packages` in the root `apm.yml`, with `source: ./packages/<name>` and the same `version`. `update` fails unless the two pins exist exactly once and the names match.

The builder owns only `packages/<name>/.apm/`. The manifest and README stay hand-authored.

Done when both manifests pin the same version.

## 3. Write the definition

Create `scripts/cli/src/packages/<name>.ts`. When it needs more than one module, create `scripts/cli/src/packages/<name>/` with `index.ts` as the entry point. Export one `defineBuilder(...)` from `scripts/cli/src/package-model/define.ts`:

- `name`: the package name, which becomes the CLI subcommand.
- `generate(out, validate)`: write to `path.resolve(root, out ?? packageDir(name))`, removing and recreating its `.apm/`. Read upstream from `vendorDir(name)`. Run `apm compile --validate` in the destination when `validate` is true.
- `reportFailures(...)`: name every error tag the builder can fail with.
- Options: `release` with the strategy from step 1, `validate: true` when `--validate` is supported, and `parent: true` only when `--out` names a parent directory.

Done when the definition compiles and does not reference any other package.

## 4. Register it

Add the export to the `packages` tuple in `scripts/cli/src/package-model/registry.ts`. Do not add it anywhere else. The CLI subcommand, `just build <name>`, `update` dispatch, and the update test fixture all come from this tuple.

Done when `bun run cli build --help` lists the package.

## 5. Test it

Add `scripts/cli/tests/build-<name>.test.ts` with minimal fixtures. Use `scripts/cli/tests/build-rtk.test.ts` as the model.

- The builder replaces only the generated tree and keeps authored files.
- Each required upstream assumption, when broken, produces the expected error tag and fields.

Done when `bun run test` passes.

## 6. Document it

- Add the package to the package table and to "What's inside" in `README.md`.
- Write `docs/specs/<name>/spec.md` with the `specify` skill.

Done when both documents describe the package.

## 7. Verify

Run these commands in order. Fix every failure in steps 1–4:

1. `bun run typecheck` and `bun run lint`
2. `just test`
3. Run `just build <name>` twice. The second run must leave `git status -- packages/` unchanged.
4. `just install`
5. `just audit`. Do not block on this step, because APM audit often fails, including failures that predate the change. Report each failure, and say whether it involves the new package.

Done when steps 1–4 pass and the audit result is reported.
