# sproott-ai

APM marketplace of AI primitives for coding agents — reusable skills, instructions, and hooks that teach your agent how to work with [APM](https://github.com/microsoft/apm), build software spec-first, and cut token usage.

Packages ship here:

| Package                                       | What it gives your agent                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[apm](packages/apm)**                       | Skills for working with APM itself — authoring primitives, package lifecycle, marketplaces, dependencies, and security auditing.                                |
| **[sdd](packages/sdd)**                       | Spec-Driven Development toolkit — specs before code, task breakdown, TDD, incremental delivery, and reconciliation.                                              |
| **[personal](packages/personal)**             | sproott's personal skills and prompts.                                                                                                                            |
| **[caveman](packages/caveman)**                | Ultra-compressed communication mode. Cuts 65% of output tokens (measured) while keeping full technical accuracy.                                                 |
| **[rtk](packages/rtk)**                       | Rust CLI proxy that cuts LLM token consumption 60-90% on common dev commands (git, cargo, npm, docker, kubectl, etc.), with a PATH-wide shim.                     |
| **[rules-on-create](packages/rules-on-create)** | Surfaces a path-scoped `.claude/rules/*.md` when Claude authors a new matching file — the case native read-triggered path-rule loading misses.                 |
| **[fallow](packages/fallow)**                  | Codebase intelligence for TypeScript/JavaScript — dead code, duplication, architecture boundaries, and PR-risk audit.                                            |
| **[fsharp](packages/fsharp)**                  | Blocks on FSharpLint findings in edited F# files, for projects that pin `dotnet-fsharplint` as a local dotnet tool.                                          |
| **[oxlint](packages/oxlint)** | Runs project-defined Oxlint and Oxfmt scripts on agent-edited files. |
| **[playwright-cli](packages/playwright-cli)** | Browser automation from the shell with Playwright — snapshots, element refs, screenshots, tracing, request mocking, test generation.                    |
| **[impeccable](packages/impeccable)** | Design skills, native agents, and design-check hooks for Claude Code and GitHub Copilot. |

All packages deploy to **Claude Code** and **GitHub Copilot** out of the box.

## Install

Requires the [`apm` CLI](https://github.com/microsoft/apm). The `fsharp`, `oxlint`, `personal` (comment-style), and `rules-on-create` hooks also require `node` on the harness's `PATH`. Install Node.js separately if your harness does not provide it; without it these hooks do not run.

These packages ship through the `sproott-ai` marketplace — register it once, then install the plugins you want.

```bash
apm marketplace add sproott/ai-marketplace       # register the marketplace
apm install apm@sproott-ai                        # APM authoring skills
apm install sdd@sproott-ai                        # Spec-Driven Development skills
apm install personal@sproott-ai                   # personal skills and prompts
apm install caveman@sproott-ai                    # ultra-compressed communication mode
apm install rtk@sproott-ai                        # token-saving CLI proxy
apm install rules-on-create@sproott-ai            # path-scoped rules on file creation
apm install fallow@sproott-ai                     # codebase intelligence for TS/JS
apm install fsharp@sproott-ai                     # FSharpLint on edited F# files
apm install oxlint@sproott-ai                    # Oxlint and Oxfmt on edited files (per repo)
apm install playwright-cli@sproott-ai             # browser automation via playwright-cli
apm install impeccable@sproott-ai                 # design skills, agents, and checks
```

Browse what's available first with `apm marketplace browse sproott-ai`.

All packages were tested with **APM 0.39.0**. Update this version after verifying all packages with each APM upgrade.

Scope which agents receive the files with `-t` (e.g. `apm install apm@sproott-ai -t claude`), or install globally with `-g`.

## What's inside

### apm

Skills for working with APM in any repo, from scaffolding a package to auditing what you install.

- **apm-package-init** — scaffold a package, fill in `apm.yml`, pick target harnesses, deploy.
- **apm-author-primitive** — add a skill, prompt, agent, instruction, or hook with the right path and frontmatter.
- **apm-author-marketplace** — set up a marketplace to publish packages for others to install.
- **apm-install-deps** — add, update, pin, or remove APM and MCP dependencies; the lockfile; private-package auth.
- **apm-audit-security** — supply-chain safety: content hashes, unicode scanning, drift detection, `apm audit` as a CI gate.

### sdd

Skills that keep your agent honest: write the spec, break down the work, prove it works.

- **spec-driven-development** — write a spec before coding when requirements are unclear or new.
- **planning-and-task-breakdown** — turn a spec into ordered, implementable tasks.
- **test-driven-development** — drive any logic change with tests.
- **incremental-implementation** — land multi-file changes in small, reviewable steps.
- **context-engineering** — set up rules files and context so agent output stays sharp.
- **spec-reconciliation** — fold what was actually built back into the spec, then close the work out.

### caveman

Ultra-compressed communication mode and its supporting skills — see the [package README](packages/caveman) for the full command list (`/caveman`, `/caveman-commit`, `/caveman-review`, `/caveman-stats`, `cavecrew` subagents, etc.).

### rtk

Ships the `rtk` CLI shim and hooks that route dev commands (git, cargo, npm, docker, kubectl) through it transparently. Session-start guidance covers setup.

### rules-on-create

A hook that watches file creation and surfaces the matching `.claude/rules/*.md` (with `paths:` frontmatter) that native read-triggered rule loading would otherwise miss.

### fallow

A skill wrapping the `fallow-mcp` server for dead-code, duplication, architecture-boundary, and PR-risk analysis on TypeScript/JavaScript codebases.

### fsharp

A post-edit hook that lints the edited `.fs`/`.fsx` file with FSharpLint and hands the findings back to the agent to fix. It runs only when the nearest dotnet tool manifest (`.config/dotnet-tools.json` or `dotnet-tools.json`) lists `dotnet-fsharplint`, restoring the pinned tool if needed; every other project sees no output.

### oxlint

A per-repository post-edit hook that runs Oxlint fixes and then Oxfmt on edited files. [Configure the two `package.json` scripts](packages/oxlint) with your project's flags and either plain Oxlint or `effect-tsgo oxlint --type-aware`.

### playwright-cli

Microsoft's official `playwright-cli` skill, vendored from [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli). Needs the CLI itself: `npm install -g @playwright/cli`.

### impeccable

[Impeccable](https://github.com/pbakaus/impeccable) design skills, native agents, and design-check hooks. Hook adapters require Node.js and a POSIX shell; the pinned engine downloads on first use.

### personal

sproott's own instructions and skills: comment-style, git-signing, and writing-tests conventions.

## Development

`packages/dev` holds the authoring skills and instructions for working on this repo (hook authoring, the built-package workflow, maintainer CLI conventions). It is not published; the root `apm.yml` installs it as a dev dependency.

From the repository root, run `bun install --frozen-lockfile` to install the CLI and
its development dependencies. Use Bun to run the CLI. Vitest and the TypeScript
Oxlint plugin require Node.js 22.18 or later in the 22.x series, 24.x, or 26 and later.

```bash
bun run cli --help
bun run cli build caveman --help
```

| Task | CLI | `just` shortcut |
| --- | --- | --- |
| Regenerate every buildable package | `bun run cli build` | `just build` |
| Regenerate one package | `bun run cli build caveman --validate` | `just build caveman --validate` |
| Update upstream releases | `bun run cli update rtk` | `just update rtk` |
| Summarize context weight | `bun run cli weigh --summary` | `just weigh --summary` |
| Build an authored hook bundle | `bun run cli build fsharp` | `just build fsharp` |
| Run TypeScript tests | `bun run test` | `just test-bun` |
| Run TypeScript and shell tests | — | `just test` |
| Run all tests, type checks, and lint | — | `just check` |

Use `bun run check` for TypeScript tests and lint without the shell suites.

Omit the package name to update all upstream-backed packages. Updates advance source
pins, rebuild the selected packages, then run tests, deploy, and audit. Edit the sources
of generated package files, not the generated files themselves.

`.claude-plugin/marketplace.json` is generated from `apm.yml`'s `marketplace:` block via
`apm pack -m claude`. Enable the repo's git hook once to keep it in sync automatically:

```bash
git config core.hooksPath .githooks
```

This regenerates and re-stages `marketplace.json` on commit if it's stale.

Each package owns its hook sources and copied assets under `packages/<package>/src/hooks/`, including the Caveman, Fallow, Impeccable, and RTK adapters. Package shell suites are named `test-*.sh` and live under `packages/<package>/tests/`. The shared TypeScript I/O module and its test live in `packages/_shared/hook-io/`.

Run `just build <package>` after editing hook sources. Consumers run the generated `.cjs` bundles with Node.js; they do not need Bun or `node_modules`. `just test` rejects stale hook bundles across all packages, including Caveman and both Impeccable targets. `just check` also type-checks the CLI and hook sources.

## License

MIT — see [LICENSE](LICENSE).
