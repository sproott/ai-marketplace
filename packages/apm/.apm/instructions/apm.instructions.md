---
description: In an APM-managed repo (apm.yml at root), author global agent instructions in .apm/instructions/, not in the compiled AGENTS.md / CLAUDE.md / .github / .claude/rules outputs.
---

# APM-Managed Repos: Where Global Instructions Live

If `apm.yml` exists at the repo root, then `AGENTS.md`, `CLAUDE.md`,
`.github/copilot-instructions.md`, and `.claude/rules/*` can be **APM-generated outputs**.
Edit their source instructions, not the generated files.

**Rule:** author/edit global instructions in `.apm/instructions/<name>.instructions.md`
(required frontmatter: `description`; add `applyTo: "<glob>"` only to scope to matching
files). Run `apm install` to deploy primitives. APM 0.39.0 deploys Claude Code rules to
`.claude/rules/`. On APM 0.38.x, run `apm compile` to put always-on instructions in `AGENTS.md`. If you maintain your own
`CLAUDE.md`, add `@AGENTS.md` so Claude Code reads the compiled instructions.

In a monorepo, run these commands in each relevant `apm.yml` directory. If there is no
root `apm.yml`, edit `AGENTS.md` or `CLAUDE.md` directly.
