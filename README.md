# sproott-ai

APM marketplace of AI primitives for coding agents — reusable skills, instructions, and hooks that teach your agent how to work with [APM](https://github.com/microsoft/apm), build software spec-first, and cut token usage.

Eight packages ship here:

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

All packages deploy to **Claude Code** and **GitHub Copilot** out of the box.

## Install

Requires the [`apm` CLI](https://github.com/microsoft/apm). These packages ship through the `sproott-ai` marketplace — register it once, then install the plugins you want.

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
```

Browse what's available first with `apm marketplace browse sproott-ai`.

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

Ships the `rtk` CLI shim plus the hooks and instructions that route dev commands (git, cargo, npm, docker, kubectl) through it transparently.

### rules-on-create

A hook that watches file creation and surfaces the matching `.claude/rules/*.md` (with `paths:` frontmatter) that native read-triggered rule loading would otherwise miss.

### fallow

A skill wrapping the `fallow-mcp` server for dead-code, duplication, architecture-boundary, and PR-risk analysis on TypeScript/JavaScript codebases.

### fsharp

A post-edit hook that lints the edited `.fs`/`.fsx` file with FSharpLint and hands the findings back to the agent to fix. It runs only when the nearest dotnet tool manifest (`.config/dotnet-tools.json` or `dotnet-tools.json`) lists `dotnet-fsharplint`, restoring the pinned tool if needed; every other project sees no output.

### personal

sproott's own instructions and skills: comment-style, git-signing, and writing-tests conventions.

## Development

`.claude-plugin/marketplace.json` is generated from `apm.yml`'s `marketplace:` block via
`apm pack -m claude`. Enable the repo's git hook once to keep it in sync automatically:

```bash
git config core.hooksPath .githooks
```

This regenerates and re-stages `marketplace.json` on commit if it's stale.

## License

MIT — see [LICENSE](LICENSE).

`.claude-plugin/marketplace.json` is generated from `apm.yml`'s `marketplace:` block via
`apm pack -m claude`. Enable the repo's git hook once to keep it in sync automatically:

```bash
git config core.hooksPath .githooks
```

This regenerates and re-stages `marketplace.json` on commit if it's stale.

## License

MIT — see [LICENSE](LICENSE).
