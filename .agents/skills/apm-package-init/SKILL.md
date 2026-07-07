---
name: apm-package-init
description: Scaffolds and configures an APM package — apm init, apm.yml manifest fields, target harnesses, and building/deploying the package with apm install (apm compile is an optional instructions-only regenerate). Use when creating a package, editing apm.yml fields, choosing target harnesses, or deploying a package's primitives.
---

# APM Package Init

## Overview

An APM package is one `apm.yml` manifest plus a `.apm/` source tree. `apm init` scaffolds
the manifest; you author primitives under `.apm/`; **`apm install` builds and deploys them**
into the harness directories (`.claude/`, `.github/`, …) and resolves dependencies. Install
is the command you actually use — it handles skills, prompts, agents, hooks, *and*
instructions in one step. See `apm-install-deps`.

`apm compile` is an optional, narrower tool: it regenerates only the instruction files
(`AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` / …) and never deploys skills
or touches dependencies. Most workflows never need it — reach for it only to validate
frontmatter without a full install, or to regenerate just the instruction outputs.

## When to Use

- Creating a new APM package from scratch
- Editing `apm.yml` manifest fields or the `targets` list
- Building/deploying a package's primitives (via `apm install`)

**When NOT to use:** authoring the primitive files themselves (`apm-author-primitive`),
installing dependencies (`apm-install-deps`), or the marketplace block
(`apm-author-marketplace`).

## `apm init`

```bash
apm init                                    # scaffold apm.yml in the current dir
apm init my-project                         # name the project
apm init --target copilot,claude            # explicit harness selection
apm init -y                                 # auto-detect + write all detected harnesses, no prompt
```

Writes an `apm.yml` with sensible defaults for `name`, `author`, `description`, plus empty
dependency and script blocks.

## `apm.yml` Manifest

```yaml
# Required
name: my-pkg
version: 1.0.0

# Optional metadata
description: Code review skills for Python services
author: Jane Doe            # or a map: {name, email, url}
license: MIT
homepage: https://example.com/my-pkg
repository: https://github.com/org/my-pkg
keywords: [ai, review, python]

# Which harnesses to deploy to (resolution order: --target > this field > auto-detect)
targets:
  - claude
  - copilot

# Content inclusion strategy
includes: auto              # or an explicit list of repo paths

# Runtime dependencies (see apm-install-deps for reference forms)
dependencies:
  apm: []
  mcp: []

# Dev-only dependencies (installed locally, not shipped to consumers)
devDependencies:
  apm: []                   # e.g. a packages/dev sibling — see "Dev-only primitives" below

# Named scripts
scripts: {}
```

**Accepted `targets` values:** `copilot`, `claude`, `cursor`, `codex`, `gemini`,
`antigravity`, `opencode`, `windsurf`, `kiro`, `agent-skills` (and `all`).

Minimum viable manifest is just `name` + `version`; everything else is optional. Match the
shape of sibling packages in the same repo (e.g. `packages/sdd/apm.yml`) for consistency.

## Workflow

1. `apm init` (or hand-write `apm.yml`) — set `name`, `version`, `targets`.
2. Author primitives under `.apm/` (see `apm-author-primitive`).
3. **`apm install`** — build and deploy all primitives into the harness dirs and resolve
   dependencies. This is the normal build step; it also generates the instruction files.
   See `apm-install-deps` for its flags.
4. Never edit generated output; re-run `apm install` after editing `.apm/` sources.

## Dev-only primitives for an APM-package repo

A shipped package's `.apm/` goes out to consumers, so primitives meant only for developing
this repo don't belong there. Put them in a sibling dev package — convention `packages/dev`,
its own `apm.yml` + `.apm/` — and list it as a root `devDependency`:

```yaml
# root apm.yml
devDependencies:
  apm:
    - ./packages/dev
```

`apm install` deploys it locally without bundling it into what consumers get. (A non-package
repo has no shipped `.apm/`, so its dev primitives just live in the repo-root `.apm/`.)

## `apm compile` (optional — instructions only)

You usually don't need this: `apm install` already deploys everything, instructions
included. Reach for `apm compile` only to validate frontmatter without deploying, or to
regenerate just the instruction files.

```bash
apm compile --validate                      # check frontmatter/structure, write nothing
apm compile                                 # regenerate instruction files for configured targets
apm compile --target claude,copilot         # scope to specific harnesses (or 'all')
apm compile --dry-run                        # show placement decisions without writing
apm compile --single-agents                 # one combined file at project root
apm compile --clean                         # remove orphaned AGENTS.md from prior compiles
apm compile --watch                         # re-run on every file change
```

### Distributed vs single-file output

- **Distributed (default):** APM writes a focused instruction file next to each directory
  that has matching instructions, driven by each instruction's `applyTo:` glob.
- **Single-file:** one combined file at the project root — via `--single-agents` or
  `compilation.single_file: true` in `apm.yml`. Use when a harness expects a single
  monolithic instructions file.

## Red Flags

- Reaching for `apm compile` to deploy a skill — it only touches instruction files; use
  `apm install`.
- Editing generated `.claude/` / `.github/` files instead of `.apm/` sources — clobbered on
  the next `apm install`.
- A `targets` value outside the accepted list → ignored/errors.
