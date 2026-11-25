# Spec: dev Package

## Objective

`packages/dev` holds the authoring knowledge for working on this marketplace itself: how to write hooks that behave the same on every supported harness, how to add a package generated from upstream by the maintainer CLI, and the conventions the maintainer CLI follows. Its consumer is this repo: the root `apm.yml` lists `./packages/dev` under `devDependencies.apm`, so its primitives deploy into the repo root (`.claude/`, `.agents/`, `.github/`) for agents working here. It is not published: `marketplace.packages` has no `dev` entry, and `README.md` mentions it only under Development.

User stories:

- As a maintainer adding or changing a `.apm/hooks` primitive, I get a step-by-step workflow that produces one descriptor and one bundled TypeScript script that fire correctly on Claude Code, VS Code Copilot Chat, and Copilot CLI.
- As a maintainer whose hook misfires on one host, I get a debug procedure and per-host reference schemas.
- As a maintainer packaging a new upstream tool, I get the ordered steps from vendor input to a verified, registered, tested, documented package.
- As an agent editing the maintainer CLI, I follow the repo's Effect v4, layout, variant-definition, and upstream-contract conventions without re-deriving them.

## Tech Stack

- APM CLI, version recorded in `packages/dev/apm.lock.yaml` (`0.38.1`)
- Skill format: Agent Skills (`SKILL.md` + `references/`); instruction format: APM `.instructions.md`
- Targets: `claude`, `copilot`
- Subject matter: the Bun + Effect v4 maintainer CLI in `scripts/cli/`, the shared hook I/O module `packages/_shared/hook-io/hook-io.ts`, `just` recipes

## Project Structure

```
packages/dev/
  apm.yml                       → manifest (name: dev, targets: claude, copilot, no dependencies)
  .gitignore                    → ignores apm_modules/
  apm.lock.yaml                 → deployed files and their hashes
  .apm/
    instructions/
      effect-solutions.instructions.md            → unscoped
      repository-layout.instructions.md           → unscoped
      variant-definitions.instructions.md         → unscoped
      upstream-builder-contracts.instructions.md  → applyTo "{scripts/cli/src/packages,scripts/cli/tests}/**/*.ts"
    skills/
      add-built-package/SKILL.md
      harness-hooks/
        SKILL.md
        references/cross-host.md    → tool names, matchers, response and exit-code differences
        references/claude.md        → Claude Code hook schema
        references/vscode.md        → VS Code Copilot Chat (Local) hook schema
        references/opencode.md      → opencode plugin model (out of the APM hook workflow)
  .claude/skills/, .claude/rules/, .agents/skills/, .github/instructions/
                                → apm install outputs, never hand-edited
  .apm-local/                   → APM local install state

Root repo:
  apm.yml        → devDependencies.apm includes ./packages/dev; no marketplace.packages entry
  .claude/rules/upstream-builder-contracts.md, .claude/skills/*, .github/instructions/*
                 → root deployment of this package
  README.md      → one Development paragraph; no package table row or install line
```

Deployment by target: skills go to `.claude/skills/` and `.agents/skills/`; all four instructions go to `.github/instructions/`; only the `applyTo`-scoped instruction also deploys to Claude as `.claude/rules/upstream-builder-contracts.md` (with `paths:` frontmatter).

## The Instructions

### effect-solutions

- **Scope:** unscoped; written for maintainer CLI changes.
- **Contract:** before changing Effect code, consult `effect-solutions list` / `show <topic>` and match the installed stable Effect v4 APIs, falling back to `node_modules/effect` and `~/.local/share/effect-solutions/effect` when guide and types differ. Pure text transforms; filesystem, subprocess, and network at Effect boundaries. `effect/cli` for parsing, `@effect/vitest` for tests. Run `bun run typecheck`, `bun run lint`, and `just test` before handoff.

### repository-layout

- **Scope:** unscoped.
- **Contract:** target paths for new files — `scripts/cli/src/{cli.ts,commands/,packages/,package-model/,shared/}`, `scripts/cli/tests/`, `scripts/shell/`, `packages/_shared/hook-io/`, `packages/<package>/{src/hooks/,tests/}`, `vendor/<upstream>/`. Fixtures live with their tests; package tests stay out of `.apm/` and shell suites are named `test-*.sh`. `just test` is the single test entry point (Vitest, shell suites, hook-bundle freshness). Authored descriptors are edited in `.apm/`, hook sources in `src/hooks/`; generated files are rebuilt, never hand-edited; repo tooling stays out of `vendor/`.

### variant-definitions

- **Scope:** unscoped; general rule for any code with several variants of one kind.
- **Contract:** one self-contained definition per variant, registered in one registry from which CLI choices, dispatch, order, and lookups derive; missing definitions are compile errors where possible. Shared code never names or branches on a variant; differences are data (tagged strategies). Shared conventions live in one helper. Tests derive variant lists from the registry. One file per variant, or a folder with `index.ts`.

### upstream-builder-contracts

- **Scope:** `applyTo` the package builders and CLI tests.
- **Contract:** each builder validates the assumptions its transforms rely on (keys, types, entry counts; exact wording and match count for text rewrites) and accepts unrelated upstream changes. Mismatches return tagged errors with typed fields, grouped per source with one `.format()` each, matched and formatted once at the command handler. Tests break each assumption with minimal fixtures and assert tags and fields, never the current contents of a vendored checkout; `just build` plus drift checks verify pinned inputs end to end.

## The Skills

### harness-hooks

- **Trigger:** adding or changing a `.apm/hooks` primitive, or a hook misfiring on one host.
- **Scope:** Claude Code, VS Code Copilot Chat, Copilot CLI. opencode needs a hand-written plugin and is reference-only. Primitive frontmatter, manifests, dependencies, and audit belong to the `apm` package's skills.
- **Contract:** APM renames event keys and rewrites script paths but does not translate tool names, matchers, payloads, or exit codes; `hook-io.ts` normalises them. Workflow: (1) choose a VS Code-supported event and a response (`context`, `block`, `deny`), and list the hook's failure modes: a hook never fails silently and never blocks on its own breakage, but warns the user through `emit(response, warnings)` as `systemMessage` (opt-in gates stay silent); (2) write a Claude-shaped descriptor in `.apm/hooks/` with an over-matching `matcher`, the `sh -c 'cd … && exec node ./<script>.cjs'` command, and the `--scoped`/unscoped handler pair when using `if:`; (3) write `src/hooks/<script>.ts` using only `HookInput` and `hook-io.ts` exports, filtering on `hook.tool`, exiting 0 silently when there is nothing to say, passing a warning per failure to `emit`, catching errors at the entry point with `emit(null, [failure(...)])`; new fields go into `hook-io.ts` with Valibot and a test case; (4) `just build <pkg>` bundles to `.apm/hooks/<script>.cjs` (Node built-ins only), committed; (5) Vitest per host payload shape plus an ignored-tool case and one `systemMessage` case per failure mode; (6) `just install`, check `.claude/settings.json` and `.github/hooks/<pkg>-<name>.json`, report `just audit` without blocking. Fixes go to sources, never bundles or deployed files.
- **References:** loaded on demand per the table in the skill.

### add-built-package

- **Trigger:** packaging a new upstream tool through the maintainer CLI. Not for hand-authored packages.
- **Contract:** applies `variant-definitions` and `upstream-builder-contracts` throughout. Steps, each with a done condition: (1) choose a `ReleaseSource` strategy (or add one plus its match case) and pin any `vendor/<name>` submodule; (2) hand-author `packages/<name>/apm.yml` and `README.md`, add one root `marketplace.packages` entry with the same version (the builder owns only `.apm/`); (3) write `scripts/cli/src/packages/<name>.ts` exporting one `defineBuilder(...)`; (4) register it in the `packages` tuple in `registry.ts` only; (5) add `scripts/cli/tests/build-<name>.test.ts` modelled on `build-rtk.test.ts`; (6) update `README.md` and write the package spec with `specify`; (7) verify: typecheck, lint, `just test`, `just build <name>` twice with no `packages/` drift, `just install`, then report `just audit` without blocking.

### How the primitives relate

The two skills are workflows; the instructions are the standing rules they invoke. `add-built-package` names `variant-definitions` and `upstream-builder-contracts`; `harness-hooks` relies on `repository-layout`'s split between `.apm/hooks/` descriptors and `src/hooks/` sources, and on the `hook-io` module (see `docs/specs/hook-io/spec.md`). Both skills defer APM mechanics to the `apm` package.

## Commands

```bash
cd packages/dev && apm compile --validate   # validate primitives
just install                                # deploy every package, then the root (devDependencies include ./packages/dev)
just audit                                  # drift and integrity check
just weigh --summary                        # token weight per package and file
```

## Testing Strategy

The package is Markdown only; there is no automated test suite for it. A change is verified by:

- `apm compile --validate` in `packages/dev/` with no errors.
- `just install` regenerating both `packages/dev/` outputs and the root deployment, with `apm.lock.yaml` hashes updated.
- `just audit` reporting no drift for `packages/dev` or the root.
- Every path, command, export, and file named in a skill or instruction exists in the repo as written (for example `registry.ts`, `defineBuilder`, `hook-io.ts` exports, `just` recipes).

## Boundaries

- **Always:** edit `.apm/` sources, then `just install`; keep skills consistent with the CLI and `justfile` they describe; scope file-specific instructions with `applyTo`.
- **Ask first:** adding a new instruction or skill; changing an instruction's `applyTo`; removing `./packages/dev` from root `devDependencies`.
- **Never:** hand-edit deployed outputs or the root deployment; put generic APM guidance here (it belongs in `packages/apm`); document behaviour the CLI does not have.

## Success Criteria

- `packages/dev/apm.yml` is valid: `name: dev`, targets `claude` + `copilot`, no dependencies.
- Four instructions and two skills exist under `.apm/`, with the four `harness-hooks` references.
- Root `apm.yml` lists `./packages/dev` under `devDependencies.apm`, and the root `.claude/` and `.github/` contain its deployed skills and instructions.
- `apm compile --validate` passes and `just audit` reports no drift for the package.

## Open Questions

- Three instructions are unscoped, so on the `claude` target they deploy nowhere (only `.github/instructions/`). Should they reach Claude Code?
