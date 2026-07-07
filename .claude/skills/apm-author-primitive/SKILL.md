---
name: apm-author-primitive
description: Authors APM primitives (instructions, skills, prompts, agents, hooks) under .apm/ with the correct path and frontmatter per type. Use when adding a skill, prompt, agent, instruction, or hook to a package, or unsure which type fits or what frontmatter it needs.
---

# Authoring APM Primitives

## Overview

An APM package holds its source primitives under `.apm/`. Each primitive **type** has a
fixed location and frontmatter shape. You author the source under `.apm/`, then run
**`apm install`** — it deploys all primitives (skills, prompts, agents, hooks, instructions)
into the per-harness output (e.g. `.claude/skills/<name>/`), resolves dependencies, and
writes the lockfile. That is what actually applies a new primitive; never edit the deployed
output directly. See `apm-install-deps`.

(`apm compile` exists too but only regenerates instruction files and doesn't deploy skills
— you rarely need it; `apm install` covers instructions as well.)

Pick the type by intent:

| Intent | Type | Location |
|---|---|---|
| Always-on rule for the agent (style, structure, conventions) | **instructions** | `.apm/instructions/<name>.instructions.md` |
| A capability the agent *invokes* for a task (multi-step, may bundle files) | **skill** | `.apm/skills/<name>/SKILL.md` |
| A reusable, parameterized request run on demand | **prompt** | `.apm/prompts/<name>.prompt.md` |
| A specialized sub-agent with its own system prompt + tools | **agent** | `.apm/agents/<name>.agent.md` |
| Code that runs on a lifecycle event | **hook** | `.apm/hooks/<name>.json` |

## First: shipped or dev-only?

Before picking a type, decide which `.apm/` the primitive belongs in:

- **Shipped** (consumers get it on install) → the package's own `.apm/`, as below.
- **Dev-only** (tooling for working *on* this repo) → the repo-root `.apm/`. But when
  the repo root is itself a shipped APM package, its `.apm/` ships to consumers — so put
  dev-only primitives in a sibling dev package (`packages/dev`) wired as a `devDependency`.
  See `apm-package-init`.

## When to Use

- Adding any new instruction / skill / prompt / agent / hook to an APM package
- Unsure which primitive type a piece of guidance should be
- Unsure what frontmatter keys a given type requires

**When NOT to use:** wiring dependencies or the marketplace block (see `apm-install-deps`,
`apm-author-marketplace`), or `apm.yml`/`apm compile` mechanics (see `apm-package-init`).

## Rule 0: instructions vs skill

The most common mistake is authoring a skill for something that should be instructions.

- **Instructions** are *pushed* into context and always apply — a standing rule. No
  invocation decision. Use for "how we do things here."
- **Skills** are *pulled* — the agent decides to invoke one based on its `description`
  when a matching task appears. Use for a discrete capability with steps.

If it's a standing rule, it's instructions. If the agent should decide "this task needs
it," it's a skill.

## Type Reference

### Instructions — `.apm/instructions/<name>.instructions.md`

```markdown
---
description: Python PEP 8 standards
applyTo: "**/*.py"
---

# Python PEP 8 Guidelines

...the standing rule...
```

- `description` (required).
- `applyTo` (optional glob) scopes the rule to matching files; APM compiles a focused
  output next to each matching directory (distributed placement). **Omit `applyTo` for a
  repo-wide rule** — it then applies globally.

### Skills — `.apm/skills/<name>/SKILL.md`

```markdown
---
name: code-review
description: Multi-file code analysis and review. Use when reviewing a diff before merge, or when asked to audit a file for correctness and style.
---

# Code Review Skill

...steps, examples...
```

- `name` and `description` (both required). `version` optional.
- The **`description` is the trigger** — write it third-person and specific, naming
  concrete situations ("Use when…"). A vague description means the skill never fires.
- Companion files (templates, scripts, `references/`) live alongside `SKILL.md` in the
  same directory.

### Prompts — `.apm/prompts/<name>.prompt.md`

```markdown
---
name: review
description: Review code changes
model: claude-3-5-sonnet
temperature: 0.7
---

# Code Review Prompt

Review the following code for bugs and style issues:
```

- `name`, `description`; optional `model`, `temperature`. Custom frontmatter reaches the
  harness as-is.

### Agents — `.apm/agents/<name>.agent.md`

```markdown
---
name: api-architect
description: API design specialist
model: claude-3-5-sonnet
tools: [file_search, code_execution]
---

# API Architect Agent

You are an expert in REST API design.
```

- `name`, `description`; optional `model`, `tools` (whitelist). The body is the system
  prompt.

### Hooks — `.apm/hooks/<name>.json`

```json
{
  "lifecycle": "PreToolUse",
  "command": "npx ts-node hooks/pre-tool-use.ts",
  "env": { "DEBUG": "true" }
}
```

- Lifecycle events: `PreToolUse`, `PostToolUse`, `Stop` (support varies by harness — check
  the target harness before relying on one).

## Workflow

1. Choose the type (table above). If it's a standing rule → instructions.
2. Create the file at the exact path for that type.
3. Add the required frontmatter for that type — no invented keys.
4. Run `apm install` to deploy the primitive, then confirm it appears under `.claude/` /
   `.github/` (e.g. `.claude/skills/<name>/SKILL.md`).
5. (Optional) `apm compile --validate` first if you want to check frontmatter/structure
   without deploying.

## Red Flags

- Authoring a skill for a standing rule that should be instructions (Rule 0).
- A skill `description` that's a title, not a trigger ("Code review" vs "Use when reviewing
  a diff before merge") — it won't fire.
- Editing the deployed output (`.claude/skills/...`, `AGENTS.md`) instead of the `.apm/`
  source — the edit is clobbered on the next `apm install`.
- Inventing frontmatter keys not listed for the type.
- Wrong path shape: `SKILL.md` must sit in its own dir (`.apm/skills/<name>/SKILL.md`),
  instructions/prompts/agents are `<name>.<type>.md` files.
