# APM-Managed Repos: Where Global Instructions Live

If `apm.yml` exists at the repo root, then `AGENTS.md`, `CLAUDE.md`,
`.github/copilot-instructions.md`, and `.claude/rules/*` are **compiled outputs** — APM
regenerates them from `.apm/` on every `apm install`. Editing them directly gets clobbered
and flagged as drift by `apm audit`.

**Rule:** author/edit global instructions in `.apm/instructions/<name>.instructions.md`
(required frontmatter: `description`; add `applyTo: "<glob>"` only to scope to matching
files). Then run `apm install` — in a monorepo with multiple `apm.yml`, that deploys only
one package, so use the `apm-install-deps` skill to deploy every package. If there's no
root `apm.yml`, this doesn't apply — edit `AGENTS.md`/`CLAUDE.md` normally.
