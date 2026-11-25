# Spec: caveman Marketplace Package

## Objective

Publish `JuliusBrussee/caveman` as a first-class package in this repo's APM marketplace (`sproott-ai`), sitting alongside `packages/apm`, `packages/sdd`, `packages/personal`.

The constraint that shapes everything: **caveman source is never modified.** caveman ships its primitives in its own native layout (`skills/<name>/SKILL.md`, `agents/cavecrew-*.md`, `src/rules/caveman-activate.md`, `src/hooks/*`) — not APM's `.apm/` layout. So we vendor caveman as an untouched git **submodule** and run a **generator** (living in *this* repo) that transforms caveman's native sources into a committed APM package at `packages/caveman/`. Bumping caveman = update the submodule ref + re-run the generator.

caveman is a *local, republished package*, shipped through this marketplace and versioned with the vendored submodule. This repo does not install its own packages: the root `apm.yml` lists caveman only under `marketplace.packages`.

Success looks like: `bun run cli update caveman` (or `bun run cli build caveman` against the pinned submodule) produces a clean, valid `packages/caveman/` whose own `apm install` deploys into `.claude/` (skills, agents, activation rule, hooks) with no hand-editing and no changes inside `vendor/caveman`.

## Tech Stack

- **Generator: TypeScript and Effect, run via Bun** from the repository root. It applies the
  mapping table below.
- **Vendoring: git submodule** at `vendor/caveman` → `git@github.com:JuliusBrussee/caveman.git` (SSH), pinned to a release tag (`v<version>`).
- **Package format: APM package** (`apm.yml` + `.apm/` source tree), matching `packages/sdd` / `packages/apm` structure exactly.
- APM CLI version per `apm.lock.yaml`.

## Commands

From the repository root, install dependencies with `bun install --frozen-lockfile`.

| Task | Command |
| --- | --- |
| Generate package | `bun run cli build caveman` |
| Generate and validate with APM | `bun run cli build caveman --validate` |
| Deploy every package | `just install` |
| Update to the upstream release | `bun run cli update caveman` |

## Project Structure

```
vendor/
  caveman/                    → git submodule, JuliusBrussee/caveman, UNMODIFIED, pinned ref

scripts/cli/src/
  packages/caveman.ts         → package definition: generator + release source (latest
                                 vendor/caveman release tag). Reads vendor/caveman native sources, writes packages/caveman/.apm/
                                 only (apm.yml + README are fixed authored sources it never touches).
                                 Source root = vendor/caveman, default --out = packages/caveman.
                                 Fails with a typed error when an upstream assumption it rewrites
                                 against is broken (see Code Style).

packages/caveman/             → committed. .apm/ is generated (don't hand-edit); apm.yml + README
                                 are our fixed authored sources; compiled outputs are apm-produced
                                 (don't hand-edit).
  apm.yml                     → FIXED authored manifest (name: caveman, targets [claude, copilot],
                                 includes: auto). `version` is pinned by `cli update caveman`.
  README.md                   → FIXED authored short package README (NOT caveman's product README)
  src/hooks/caveman-hook-io.ts → authored Node.js adapter
  tests/caveman-hook-io.test.ts → adapter tests
  .apm/                       → GENERATED source tree — the only thing the generator writes
    skills/<name>/SKILL.md    → from vendor/caveman/skills/<name>/ (+ companion subdirs, e.g.
                                 caveman-compress/scripts/)
    prompts/<name>.prompt.md  → from vendor/caveman/commands/<name>.md for caveman,
                                 caveman-commit, caveman-review, caveman-stats
    agents/cavecrew-*.agent.md→ from vendor/caveman/agents/cavecrew-*.md (renamed .md → .agent.md)
    instructions/
      caveman-activate.instructions.md
                              → from vendor/caveman/src/rules/caveman-activate.md
                                 (+ injected `description` frontmatter)
    hooks/                    → from vendor/caveman/src/hooks/ (*.js + statusline.sh/.ps1);
                                 caveman-activate.js has its statusline setup nudge removed
      caveman-hook-io.cjs     → bundled from packages/caveman/src/hooks/caveman-hook-io.ts. Harness I/O
                                 layer every descriptor command runs through. Selects
                                 Copilot CLI only when `sessionId` is present and
                                 `session_id` is absent, without generic `detectHost`.
                                 Passes other payloads and responses through untouched;
                                 reshapes a Copilot CLI camelCase payload
                                 into snake_case keys and returns the hook's plain-text or
                                 `hookSpecificOutput` context as top-level
                                 `additionalContext`
      caveman.json            → generated hook descriptor (SessionStart + UserPromptSubmit),
                                 commands `node ./caveman-hook-io.cjs <hook script>`
  .claude/ .agents/ .github/  → COMPILED by apm from .apm/, committed (matches packages/sdd
  AGENTS.md  apm.lock.yaml       convention). Regenerated by apm install/compile, not by hand.

Root repo:
  .gitmodules                 → vendor/caveman entry
  apm.yml                     → caveman under marketplace.packages (source: ./packages/caveman,
                                version = caveman's own release, no per-package tag_pattern)
```

Generated primitives (the mapping the script performs):

| caveman native source | → | APM primitive |
|---|---|---|
| `skills/<name>/` | → | `.apm/skills/<name>/` (companion subdirs verbatim; README/SECURITY dropped; `description` replaced, see Code Style) |
| `commands/<name>.md` (all but `caveman-init`) | → | `.apm/prompts/<name>.prompt.md` |
| `agents/cavecrew-*.md` | → | `.apm/agents/cavecrew-*.agent.md` |
| `src/rules/caveman-activate.md` | → | `.apm/instructions/caveman-activate.instructions.md` (+ `description` frontmatter) |
| `src/hooks/*.js`, `caveman-statusline.{sh,ps1}` | → | `.apm/hooks/*` (statusline nudge removed from `caveman-activate.js`) + generated `caveman.json` descriptor |
| `packages/caveman/src/hooks/caveman-hook-io.ts` *(authored here)* | → | `.apm/hooks/caveman-hook-io.cjs` |

## Code Style

The generator reads from `vendor/caveman`. `--out <dir>` selects the package
output directory, which defaults to `packages/caveman`.

Upstream rewrites, each checked before output is written:

- **Skill descriptions.** Each description stays in the agent's context for the whole session, so `SKILL_DESCRIPTIONS` replaces upstream's prose with a short trigger-focused one. The rewrite parses the frontmatter, accepts any YAML scalar style that decodes to a nonempty string, and must change only `description`. A `SKILL_DESCRIPTIONS` entry for a skill upstream no longer ships is an error.
- **Statusline nudge.** `caveman-activate.js` would ask the agent to set up caveman's statusline on every session start. Each of its three anchors must match exactly once.
- **`caveman-init` is not a prompt.** It downloads and runs caveman's standalone installer, which does not apply to an APM-deployed copy.

`apm.yml` and `README.md` are authored fixed sources, not generator output — the generator writes only `.apm/`, so they survive the surgical clean and every regenerate. The authored `apm.yml` stays honest to upstream: `name: caveman`, `author: Julius Brussee`, `homepage`/`repository` → `JuliusBrussee/caveman`, `version` set to caveman's release tag without the `v`, `targets: [claude, copilot]`, `includes: auto` to match sibling packages.

## Testing Strategy

- **Builder contracts:** `scripts/cli/tests/build-caveman.test.ts` breaks each upstream assumption in a minimal fixture and asserts the error tag and fields, checks that authored files survive regeneration, and checks that copied content is preserved byte for byte.

- **Adapter:** `packages/caveman/tests/caveman-hook-io.test.ts` covers payload and response adaptation. `just test` checks the generated adapter for drift.
- **Determinism:** run the generator twice; `git diff packages/caveman/.apm/` is empty on the second run. Surgical clean (`rmrf .apm` + rewrite) means an upstream-removed skill disappears from the package; the authored `apm.yml`/`README.md` are untouched.
- **Validate:** `bun run cli build caveman --validate` → `apm compile --validate` in `packages/caveman/` exits 0, producing `.claude/` (+ `.github/`) with no validation errors.
- **Install end-to-end:** `just install` runs `apm install` in `packages/caveman/`, which deploys caveman skills into `packages/caveman/.claude/skills/caveman*` + `.claude/skills/cavecrew`, agents into `.claude/agents/cavecrew-*`, the activation rule into `.claude/rules/`, and hooks into `.claude/settings.json` + `.claude/hooks/`.
- **No-touch check:** `git -C vendor/caveman status` is clean after a full generate + install cycle.

## Boundaries

- **Always do:** regenerate `packages/caveman/.apm/` via the script and commit it; keep `vendor/caveman` pristine; keep the authored `apm.yml` + `README.md` honest to upstream; match `packages/sdd` layout and `includes: auto` convention.
- **Ask first:** updating to a new upstream release (ships behavior changes to installers); adding or changing an upstream rewrite; changing which primitives are included or the package's `targets`; altering root `apm.yml` marketplace structure beyond the caveman entry + dependency swap.
- **Never do:** edit any file inside `vendor/caveman`; hand-edit the generated `.apm/` or apm-compiled outputs under `packages/caveman/`; commit `apm_modules/` or `build/` (gitignored); overwrite caveman's product README.

## Success Criteria

- `vendor/caveman` exists as a submodule (`.gitmodules` records it), pinned to a release ref, working tree clean.
- `scripts/cli/src/packages/caveman.ts` generates `packages/caveman/.apm/` from `vendor/caveman` (leaving the authored `apm.yml`/`README.md` untouched); a second run leaves `git diff` empty.
- `packages/caveman/apm.yml` is a valid manifest: `name: caveman`, `includes: auto`, `targets: [claude, copilot]`, `version` equal to the pinned release tag and to the root marketplace entry.
- `packages/caveman/.apm/` contains all 7 skills, 3 cavecrew agents, the `caveman-activate` instruction, and 4 prompts, and the hooks bundle + `caveman.json`.
- `packages/caveman/` also commits the apm-compiled outputs (`.claude/`, `.agents/`, `.github/`, `AGENTS.md`, `apm.lock.yaml`), matching the `packages/sdd` convention.
- `bun run cli build caveman --validate` succeeds (`apm compile --validate` exits 0).
- Root `apm.yml`: `caveman` under `marketplace.packages` (`source: ./packages/caveman`); not a root dependency.
- `bun run cli update caveman` resolves the latest release tag, updates both version pins, and rebuilds.
- `git -C vendor/caveman status` clean after generate + install — caveman source untouched.

## Decisions

- **`targets`:** `[claude, copilot]` (match siblings; hooks fire on `claude` only regardless).
- **Marketplace versioning:** entry `version:` = caveman's own release version; no per-package `tag_pattern` (`source` is local). Release tags version the skills independently of the npm package, so `update` reads the tag, not `package.json`.
- **Submodule:** SSH URL, pinned to a release tag.
- **Hook descriptor:** `caveman.json`; `includes: auto` discovers it.
- **Prompts:** emitted for every upstream command except `caveman-init`.
- **Compiled outputs:** committed alongside `.apm/`, matching the `packages/sdd` convention.
