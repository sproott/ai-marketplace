# Spec: playwright-cli Marketplace Package

## Objective

Publish Microsoft's `playwright-cli` agent skill
([microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)) as a package in this
repo's APM marketplace (`sproott-ai`). The skill drives a browser from the shell: snapshots,
element refs, screenshots, tracing, request mocking, and test generation.

Upstream already ships the skill in a directory APM can use as-is, so the builder copies it
without changes. **Upstream source is never modified.** `vendor/playwright-cli` is an untouched
git submodule.

The package ships only the skill. Consumers install the `playwright-cli` binary themselves
(`npm install -g @playwright/cli`).

Success looks like: `bun run cli build playwright-cli` reproduces `packages/playwright-cli/.apm/`
from the pinned submodule, and `apm install playwright-cli@sproott-ai` deploys the skill.

## Tech Stack

- **Builder:** TypeScript and Effect, run with Bun from the repository root
  (`scripts/cli/src/packages/playwright-cli.ts`, export `playwrightCli`).
- **Vendoring:** git submodule `vendor/playwright-cli` →
  `git@github.com:microsoft/playwright-cli.git`, checked out at a release tag (`v<version>`).
- **Package format:** APM `hybrid` package, `targets: [claude, copilot]`, `includes: auto`.

## Commands

From the repository root, install dependencies with `bun install --frozen-lockfile`.

| Task                            | Command                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| Generate package                | `bun run cli build playwright-cli` (or `just build playwright-cli`)   |
| Generate into another directory | `bun run cli build playwright-cli --out <dir>` → writes `<dir>/.apm/` |
| Update to the upstream release  | `bun run cli update playwright-cli`                                   |
| Deploy every package            | `just install`                                                        |

`--out` names the package directory. It cannot be empty or the repository root. The builder does
not support `--validate`.

## Project Structure

```
vendor/playwright-cli/            → git submodule, UNMODIFIED
  package.json                    → `@playwright/cli`; its `version` is the release pin
  skills/playwright-cli/          → SKILL.md + references/ — the only builder input

scripts/cli/src/packages/
  playwright-cli.ts               → builder + definition (release source, failure tags)

packages/playwright-cli/
  apm.yml                         → AUTHORED manifest; `version` is pinned by `cli update`
  README.md                       → AUTHORED short package README
  .apm/skills/playwright-cli/     → GENERATED: byte-for-byte copy of the upstream skill
  .claude/ .agents/ apm.lock.yaml → COMPILED by apm install, committed
```

| Upstream source            | →   | Generated output                           |
| -------------------------- | --- | ------------------------------------------ |
| `skills/playwright-cli/**` | →   | `.apm/skills/playwright-cli/**` (verbatim) |

## Builder Behavior

1. Resolve the source `vendor/playwright-cli/skills/playwright-cli` and the destination
   `<out or packages/playwright-cli>/.apm`.
2. If `SKILL.md` is missing from the source, fail with `MissingPlaywrightSkill`. Its message asks
   the user to run `git submodule update --init vendor/playwright-cli`. Existing output is not
   touched.
3. Remove the destination `.apm/`, then copy the source directory to
   `.apm/skills/playwright-cli/`.

Filesystem failures surface as `CommandOperationFailed`, with the `playwright-cli` command
context. The builder writes nothing outside `.apm/`, so `apm.yml`, `README.md`, and compiled
outputs survive every run. It performs no content rewrites, so it has no upstream text anchors to
check.

## Manifest

The authored `apm.yml` stays honest to upstream:

- `name: playwright-cli`, `author: Microsoft`, `license: Apache-2.0`;
- `homepage` and `repository` point to `microsoft/playwright-cli`;
- `version` equals upstream `package.json` `version`;
- `type: hybrid`, `targets: [claude, copilot]`, `includes: auto`, empty `dependencies` and
  `scripts`.

The root `apm.yml` lists `playwright-cli` only under `marketplace.packages`
(`source: ./packages/playwright-cli`, same `version`). `.claude-plugin/marketplace.json` carries
the same entry.

## Release and Update

`bun run cli update playwright-cli`:

1. fetches the upstream default branch and reads a stable `X.Y.Z` from its `package.json`;
2. fetches `vX.Y.Z`, verifies that the tagged manifest has the same version, and checks out the tag;
3. rewrites the version in `packages/playwright-cli/apm.yml` and in the root marketplace entry;
4. rebuilds the package, then runs `just test` and `just install`, and reports `just audit`
   without failing on it.

## Testing Strategy

There is no `build-playwright-cli.test.ts`. The builder is covered in
`scripts/cli/tests/cli.test.ts`:

- a missing submodule skill exits 1 and leaves existing output intact;
- `build playwright-cli --out <dir>` runs only this builder, copies `SKILL.md`, removes stale
  primitives, and keeps authored files;
- an output path that is a file exits 1 with `CommandFailure: playwright-cli:` in the diagnostic.

End to end: `just build playwright-cli` twice leaves `git status -- packages/` unchanged, and
`.apm/skills/playwright-cli/` matches `vendor/playwright-cli/skills/playwright-cli/` exactly.

## Boundaries

- **Always do:** regenerate `.apm/` with the builder and commit it; keep `vendor/playwright-cli`
  pristine; keep the authored `apm.yml` and README honest to upstream.
- **Ask first:** updating to a new upstream release; adding any transform of upstream content;
  shipping more than the skill (for example installing the CLI binary).
- **Never do:** edit files under `vendor/playwright-cli`; hand-edit `.apm/` or compiled outputs.

## Success Criteria

- `vendor/playwright-cli` is a submodule at a release tag, and its working tree is clean.
- `packages/playwright-cli/apm.yml` `version` equals upstream `package.json`, the root marketplace
  entry, and `.claude-plugin/marketplace.json`.
- `.apm/` contains exactly `skills/playwright-cli/` (`SKILL.md` + `references/`), identical to
  upstream.
- Two consecutive builds produce no diff.
- `just install` deploys the skill to `.claude/skills/playwright-cli/` and
  `.agents/skills/playwright-cli/`.
