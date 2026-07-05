# Implementation Plan: APM Skills Package

## Overview

Build `packages/apm/`, a new APM package bundling 5 skills + 1 instructions file covering APM primitive-authoring and package-lifecycle workflows, then wire it into this repo's root `apm.yml` (devDependency + marketplace entry) and verify it compiles and deploys.

## Architecture Decisions

- **Mirror `packages/sdd` exactly** — same manifest shape, same `.apm/skills/<name>/SKILL.md` layout, same `.gitignore` (ignore `apm_modules/`). Proven pattern already in this repo; no need to invent a new one.
- **Workflow-scoped skills, not persona-scoped** — confirmed in spec: one person both authors and consumes, so skills split by task (author primitive / init package / author marketplace / install deps / audit) not by role.
- **Instructions file, not a skill, for the routing rule** — "put global instructions in `.apm/instructions/global.instructions.md` instead of AGENTS.md/CLAUDE.md" is a standing rule that should always apply in an APM-managed repo, not something an agent decides to invoke. Matches how `packages/sdd` uses `.apm/instructions/sdd.instructions.md` for its own standing project-structure rule.
- **No `apm pack` / policy skill in v1** — explicit scope cut per spec Boundaries.

## Task List

### Phase 1: Package Scaffold

- [ ] Task 1: Scaffold `packages/apm/` manifest and gitignore

**Description:** Create the package shell so skill files have somewhere to land.

**Acceptance criteria:**
- [ ] `packages/apm/apm.yml` exists: `name: apm`, `version: 1.0.0`, `description`, `author: sproott`, `targets: [claude, copilot]`, `dependencies: {apm: [], mcp: []}`, `includes: auto`, `scripts: {}`
- [ ] `packages/apm/.gitignore` exists, contains `apm_modules/`

**Verification:**
- [ ] `cat packages/apm/apm.yml` matches `packages/sdd/apm.yml` shape (diff structure, not content)

**Dependencies:** None

**Files touched:** `packages/apm/apm.yml`, `packages/apm/.gitignore`

**Estimated scope:** XS (2 files)

---

### Phase 2: Author Skills (parallelizable — independent files)

- [ ] Task 2: Write `apm-author-primitive` skill

**Description:** Skill covering how to write each primitive type (instructions, skills, prompts, agents, hooks) correctly under `.apm/`, with accurate frontmatter per type, grounded in the fetched APM doc.

**Acceptance criteria:**
- [ ] Covers all primitive types from doc: instructions (`applyTo` glob), skills (`SKILL.md` entry point), prompts (`.prompt.md`), agents (`.agent.md`), hooks (`.json`, lifecycle events like `PreToolUse`/`PostToolUse`)
- [ ] Includes the verbatim frontmatter example from the doc (instructions type) and file-path conventions (`.apm/skills/<name>/SKILL.md`, etc.)
- [ ] Frontmatter `description` is specific enough to trigger correctly (third-person, names concrete triggers per `existing skill conventions in this repo`)

**Verification:**
- [ ] Cross-check every path/frontmatter key against the fetched doc content (no invented syntax)
- [ ] File builds valid YAML frontmatter (parse check)

**Dependencies:** Task 1

**Files touched:** `packages/apm/.apm/skills/apm-author-primitive/SKILL.md`

**Estimated scope:** S (1 file)

---

- [ ] Task 3: Write `apm-package-init` skill

**Description:** Skill covering `apm init`, `apm.yml` manifest fields, `targets`, and `apm compile` (distributed vs single-agent output, validate/watch/clean flags).

**Acceptance criteria:**
- [ ] Documents `apm init [project-name]`, `--target`, `-y` flags
- [ ] Documents full `apm.yml` field set from doc (name, version, description, author, targets, dependencies, devDependencies, scripts)
- [ ] Documents `apm compile` and all its flags (`--target`, `--single-agents`, `--clean`, `--validate`, `--watch`, `--dry-run`)

**Verification:**
- [ ] Cross-check flags against fetched doc

**Dependencies:** Task 1

**Files touched:** `packages/apm/.apm/skills/apm-package-init/SKILL.md`

**Estimated scope:** S (1 file)

---

- [ ] Task 4: Write `apm-author-marketplace` skill

**Description:** Skill covering marketplace authoring — root `apm.yml` `marketplace:` block (owner, build.tagPattern, outputs, packages list) and standalone `marketplace.json` format, versioning via tags, local-path vs remote package entries.

**Acceptance criteria:**
- [ ] Documents both marketplace forms from doc: `marketplace.json` (`{"packages": {name: source}}`) and the `apm.yml` `marketplace:` block (owner/build/outputs/packages, per-package `tag_pattern`/`ref`/`subdir`/`category`)
- [ ] Uses this repo's own root `apm.yml` marketplace block as a live example (local-path entry pattern: `packages/sdd`)
- [ ] Explicitly notes `apm pack` is out of scope for this repo's workflow (GitHub-direct install only) — mention it exists per docs but don't teach it as the primary path
- [ ] No policy-authoring content (deferred; at most a one-line pointer that `apm-policy.yml` exists and is a separate concern)

**Verification:**
- [ ] Cross-check against fetched doc + against actual root `apm.yml` in this repo

**Dependencies:** Task 1

**Files touched:** `packages/apm/.apm/skills/apm-author-marketplace/SKILL.md`

**Estimated scope:** S (1 file)

---

- [ ] Task 5: Write `apm-install-deps` skill

**Description:** Skill covering `apm install` (all flags), dependency reference forms (`apm:`, `mcp:`, git-host form with `git/path/ref`), lockfile mechanics, `apm update`/`apm outdated`/`apm list`, auth resolution order.

**Acceptance criteria:**
- [ ] Documents `apm install` flags: bare, `<package>`, `--mcp`, `./local-bundle`, `--frozen`, `--dry-run`, `--force`, `--no-policy`, `--trust-transitive-mcp`, `-t`/`--target`, `-g`
- [ ] Documents dependency shapes: short form (`owner/repo#ref`, `owner/repo/skills/name`), git-host form (`git:`/`path:`/`ref:`)
- [ ] Documents `apm.lock.yaml` purpose (pinned commit SHA + content hash) without re-deriving the audit skill's content
- [ ] Documents `apm update`, `apm outdated`, `apm list`
- [ ] Documents auth resolution order (env var precedence, `gh auth token`, credential helper) for private packages

**Verification:**
- [ ] Cross-check against fetched doc

**Dependencies:** Task 1

**Files touched:** `packages/apm/.apm/skills/apm-install-deps/SKILL.md`

**Estimated scope:** S (1 file)

---

- [ ] Task 6: Write `apm-audit-security` skill

**Description:** Skill covering `apm audit` (unicode scan, drift detection, CI gate, strip), content-hash verification model, cache integrity checks. Brief pointer to `apm-policy.yml` as a related-but-separate concern (no policy-authoring guidance).

**Acceptance criteria:**
- [ ] Documents `apm audit` flags: bare, `--ci`, `--strip`, `--dry-run`, `--file`, `--format json|sarif|markdown`
- [ ] Documents the 4-part security model from doc: content-hash verification, cache integrity (HEAD-ref vs resolved_commit), unicode scanning, drift detection
- [ ] One-line pointer: "org-level allow/deny enforcement lives in `apm-policy.yml` — see APM docs; not covered by this skill"

**Verification:**
- [ ] Cross-check against fetched doc

**Dependencies:** Task 1

**Files touched:** `packages/apm/.apm/skills/apm-audit-security/SKILL.md`

**Estimated scope:** S (1 file)

---

- [ ] Task 7: Write `apm.instructions.md` (global-instructions routing rule)

**Description:** Standing instructions file: when a repo is APM-managed (root `apm.yml` present), any global agent instructions the agent authors or updates should go to `.apm/instructions/global.instructions.md`, not `AGENTS.md`/`CLAUDE.md` directly — since those are compiled outputs APM regenerates.

**Acceptance criteria:**
- [ ] Frontmatter matches instructions-primitive convention from doc (`description`, `applyTo` — likely `applyTo: "**"` or repo-root scope, since this is a routing rule not a file-glob code-style rule)
- [ ] Body states the rule, why (APM regenerates AGENTS.md/CLAUDE.md from `.apm/` — direct edits get clobbered on next `apm compile`), and how to apply (detect `apm.yml` at repo root → write/edit `.apm/instructions/global.instructions.md` instead)

**Verification:**
- [ ] Cross-check frontmatter shape against doc's instructions example

**Dependencies:** Task 1

**Files touched:** `packages/apm/.apm/instructions/apm.instructions.md`

**Estimated scope:** XS (1 file)

### Checkpoint: Phase 2 Complete

- [ ] All 6 files exist under `packages/apm/.apm/`
- [ ] Every command/flag/YAML key spot-checked against fetched doc content (no invented syntax)
- [ ] Human review of skill content before wiring into root manifest

---

### Phase 3: Wire Into Root + Verify

- [ ] Task 8: Add `packages/apm` to root `apm.yml`

**Description:** Register the new package as both a devDependency (so this repo gets the skills deployed locally) and a marketplace entry (so others can install it), mirroring the existing `packages/sdd` entries exactly.

**Acceptance criteria:**
- [ ] `devDependencies.apm` includes `./packages/apm` (alongside existing `./packages/sdd`)
- [ ] `marketplace.packages` includes a new entry: `name: apm`, `source: ./packages/apm`, `description: <matches apm.yml>`, `version: 1.0.0`

**Verification:**
- [ ] `apm compile --validate` at repo root passes

**Dependencies:** Tasks 2-7

**Files touched:** `apm.yml` (root)

**Estimated scope:** XS (1 file)

---

- [ ] Task 9: Compile and deploy verification

**Description:** Run APM CLI to confirm the package compiles cleanly and deploys into this repo's `.claude/skills/`.

**Acceptance criteria:**
- [ ] `apm compile --validate` (in `packages/apm/`) passes with no errors
- [ ] `apm install` (or `apm compile`) at repo root deploys all 5 skills + 1 instructions file into `.claude/skills/apm-*` and `.claude/rules/` (or equivalent instructions target) plus `.github/` if `copilot` target compiles cleanly
- [ ] `apm.lock.yaml` at repo root updates with a new `_local/apm` entry (matching the `_local/sdd` entry shape)

**Verification:**
- [ ] Run the actual commands; inspect output; inspect `git status` / `git diff` on `.claude/`, `.github/`, `apm.lock.yaml`

**Dependencies:** Task 8

**Files touched:** `.claude/**` (generated), `.github/**` (generated), `apm.lock.yaml` (root, generated)

**Estimated scope:** XS (verification only, no hand-written files)

### Checkpoint: Complete

- [ ] All success criteria from `specs/apm-skills/spec.md` met
- [ ] `apm compile` clean at both package and root level
- [ ] Ready for human review before commit

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| APM CLI not installed / different version locally than doc describes | Med | `apm.lock.yaml` shows `apm_version: 0.23.1` already used in this repo — verify CLI presence before Task 9; if absent, ask user rather than guessing behavior |
| Doc summary (fetched via WebFetch) missed or mis-summarized a flag/field | Med | Re-fetch specific doc sections if a skill author task hits an ambiguous or seemingly-missing detail, rather than inventing syntax |
| Instructions-file frontmatter shape guessed wrong (doc example is minimal) | Low | Cross-check against `packages/sdd/.apm/instructions/sdd.instructions.md`'s actual frontmatter as a second real-world reference alongside the doc |

## Open Questions

(carried from spec, unresolved — do not block Phase 1-2 on these, resolve before Task 8)

- Tag pattern for `packages/apm` marketplace entry: independent (`apm-v{version}`) vs lockstep with root repo tags. Default: independent `apm-v{version}`, confirm with user at Task 8.
- Whether `apm-audit-security` mentions `apm-policy.yml` — resolved in Task 6 acceptance criteria: one-line pointer only, no policy-authoring content.
