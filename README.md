# sproott-ai

APM marketplace of AI primitives for coding agents — reusable skills that teach your agent how to work with [APM](https://github.com/microsoft/apm) and how to build software spec-first.

Two packages ship here:

| Package                 | What it gives your agent                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **[apm](packages/apm)** | Skills for working with APM itself — authoring primitives, package lifecycle, marketplaces, dependencies, and security auditing. |
| **[sdd](packages/sdd)** | Spec-Driven Development toolkit — specs before code, task breakdown, TDD, incremental delivery, and reconciliation.              |

Both deploy to **Claude Code** and **GitHub Copilot** out of the box.

## Install

Requires the [`apm` CLI](https://github.com/microsoft/apm). These packages ship through the `sproott-ai` marketplace — register it once, then install the plugins you want.

```bash
apm marketplace add sproott/ai-marketplace   # register the marketplace
apm install apm@sproott-ai                    # APM authoring skills
apm install sdd@sproott-ai                    # Spec-Driven Development skills
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

## License

MIT — see [LICENSE](LICENSE).
