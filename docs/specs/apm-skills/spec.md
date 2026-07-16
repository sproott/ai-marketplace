# Spec: APM Skills Package

## Objective

APM (Agent Package Manager, https://microsoft.github.io/apm/) is a dependency manager for AI agent context — skills, prompts, instructions, agents, hooks, plugins, MCP servers — declared in `apm.yml` and compiled to eight harness formats (`.claude/`, `.github/`, `.cursor/`, etc.).

This repo already consumes APM (root `apm.yml`, `packages/sdd`) but has no skills teaching *how to work with APM itself*. Add a new package, `packages/apm`, bundling skills that cover the APM primitive-authoring and package lifecycle, distributed through this repo's marketplace and also consumed locally (devDependency) so this repo's own APM work benefits immediately.

There is no persona split between "authors" and "consumers" — anyone using APM both writes primitives under `.apm/` and installs others'. Skills are split by **workflow** (what task is being done), not by role.

Success looks like: an agent working in any APM-managed repo can be told "add a skill to this APM package," "wire up the marketplace," "install this dependency," or "audit before I commit," and the right skill triggers with accurate, doc-grounded guidance — without re-deriving APM mechanics from scratch or guessing at file layout.

## Tech Stack

- APM CLI (`apm`), version referenced in this repo's `apm.lock.yaml`: `0.23.1` (skills should not hardcode version-specific behavior beyond what's stable in the public docs)
- Skill format: Anthropic Agent Skills (`SKILL.md` + optional `references/`), per existing conventions in `packages/sdd/.apm/skills/*`
- Distribution format: APM package (`apm.yml` manifest + `.apm/` source tree), matching `packages/sdd` structure exactly

## Project Structure

```
packages/apm/
  apm.yml                                    → package manifest (name: apm, targets: claude, copilot)
  .gitignore                                 → ignores apm_modules/
  .apm/
    instructions/
      apm.instructions.md                    → standing rule: route global agent instructions
                                                to .apm/instructions/<name>.instructions.md
                                                instead of AGENTS.md/CLAUDE.md, when repo is APM-managed
    skills/
      apm-author-primitive/SKILL.md          → write skill/prompt/agent/instructions/hook files
                                                under .apm/, correct frontmatter+format per type
      apm-package-init/SKILL.md              → apm init, apm.yml fields, targets, apm compile
      apm-author-marketplace/SKILL.md        → marketplace.json / apm.yml marketplace: block,
                                                versioning via tags, local-path vs remote packages
      apm-install-deps/SKILL.md              → apm install, dependency refs (apm/mcp/git),
                                                lockfile mechanics, apm update/outdated
      apm-audit-security/SKILL.md            → apm audit (unicode scan, drift, CI gate),
                                                content-hash verification model

Root repo changes:
  apm.yml                                    → add packages/apm to devDependencies.apm and
                                                marketplace.packages (mirrors packages/sdd entry)
```

Each `SKILL.md` follows the existing repo convention: frontmatter `name` + `description` (trigger phrasing, third-person, specific), body organized as Overview → When to Use → workflow steps → concrete command/file examples lifted from the APM docs.

## Code Style

Match the existing `packages/sdd/.apm/skills/specify/SKILL.md` shape: terse Markdown, real command blocks (not prose descriptions of commands), a template/example block per major concept, a "Red Flags" or "Common Rationalizations" section where useful. Reference exact APM CLI flags and YAML keys verbatim from the docs — no invented syntax.

Example (from the source doc, style to emulate for command reference sections):

```bash
apm install <package>                   # add new dependency
apm install --mcp io.github.github/github-mcp-server
apm install --frozen                    # lockfile-only (CI)
```

## Testing Strategy

Skills are Markdown, not executable code — "testing" means:
- Each skill's command syntax is checked against the fetched APM docs (https://microsoft.github.io/apm/llms-small.txt) for accuracy before finalizing.
- After authoring, run `apm compile` in `packages/apm/` to confirm the package compiles cleanly to `.claude/` and `.github/` targets with no validation errors (`apm compile --validate`).
- Manually dry-run one skill end-to-end in this repo (e.g., ask the author-primitive skill to scaffold a trivial skill) to confirm triggering and guidance are usable.

## Boundaries

- **Always do:** ground every command/flag/YAML key in the fetched docs content; match `packages/sdd`'s file layout and manifest conventions exactly; keep skills workflow-scoped (no persona-based duplication).
- **Ask first:** changing root `apm.yml` marketplace structure beyond adding the new package entry; adding `devDependencies` beyond `./packages/apm`; any skill that would need APM CLI behavior not covered in the fetched doc (should flag as an open question rather than guess).
- **Never do:** include an `apm pack` / local-bundle-publishing workflow (explicitly out of scope — this repo installs packages via direct GitHub reference, not packed bundles); include a policy/governance (`apm-policy.yml`) skill (deferred, not v1); invent CLI flags not present in the docs.

## Success Criteria

- `packages/apm/apm.yml` exists, valid manifest, `name: apm`, targets `claude` + `copilot`.
- Five skills exist under `packages/apm/.apm/skills/`: `apm-author-primitive`, `apm-package-init`, `apm-author-marketplace`, `apm-install-deps`, `apm-audit-security`, each with accurate SKILL.md content grounded in the fetched docs.
- One instructions file exists at `packages/apm/.apm/instructions/apm.instructions.md` encoding the global-instructions-routing rule.
- Root `apm.yml` updated: `packages/apm` added under `marketplace.packages` (with `./packages/apm` present under `devDependencies.apm`).
- `packages/apm` marketplace entry uses **lockstep** tagging — no per-package `tag_pattern`, so it inherits root `build.tagPattern: v{version}` (mirrors `packages/sdd`).
- `apm compile --validate` succeeds for `packages/apm` with no validation errors, producing `.claude/` and `.github/` output.
- Running `apm install` at repo root deploys the five skills into `.claude/skills/apm-*`, and the instructions file into `.claude/rules/apm.md` and `.github/instructions/`; the root `apm.lock.yaml` gains a `_local/apm` entry (deployed files + hashes).
- `apm-audit-security` mentions `apm-policy.yml` in a single pointer line only (org-level allow/deny lives there — see APM docs); no policy-authoring guidance.
