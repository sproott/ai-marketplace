# Spec: caveman Marketplace Package

## Objective

Publish `JuliusBrussee/caveman` as a first-class package in this repo's APM marketplace (`sproott-ai`), sitting alongside `packages/apm`, `packages/sdd`, `packages/personal`.

The constraint that shapes everything: **caveman source is never modified.** caveman ships its primitives in its own native layout (`skills/<name>/SKILL.md`, `agents/cavecrew-*.md`, `src/rules/caveman-activate.md`, `src/hooks/*`) — not APM's `.apm/` layout. So we vendor caveman as an untouched git **submodule** and run a **generator** (living in *this* repo) that transforms caveman's native sources into a committed APM package at `packages/caveman/`. Bumping caveman = update the submodule ref + re-run the generator.

Today caveman is only a *remote dependency* (`JuliusBrussee/caveman` under `dependencies.apm`). This spec makes it a *local, republished package* — installable and shippable through this marketplace, versioned with the vendored submodule.

Success looks like: `git submodule update --remote vendor/caveman && node scripts/build-caveman-package.js` produces a clean, valid `packages/caveman/` that `apm install` deploys into `.claude/` (skills, agents, activation rule, hooks) with no hand-editing and no changes inside `vendor/caveman`.

## Tech Stack

- **Generator language: Node.js** (no deps, built-ins only). Chosen because caveman already requires Node to run its hooks and installer, so no new runtime enters the repo. Repo root has no `package.json` — the script is invoked directly (`node scripts/build-caveman-package.js`). The generator is authored fresh in this repo: caveman ships **no** `bin/build-apm.js`. apm's own autodiscovery of caveman (native → `.apm/`) is the reference oracle for the output shape — the generator reproduces it with the deltas in the mapping table below.
- **Vendoring: git submodule** at `vendor/caveman` → `git@github.com:JuliusBrussee/caveman.git` (SSH), pinned to tag `v1.9.1` (commit `0d95a81`, matches `bin/install.js` `PINNED_REF`). First submodule in this repo (no `.gitmodules` today).
- **Package format: APM package** (`apm.yml` + `.apm/` source tree), matching `packages/sdd` / `packages/apm` structure exactly.
- APM CLI version per `apm.lock.yaml`.

## Commands

```
Generate package:   node scripts/build-caveman-package.js
Validate package:   node scripts/build-caveman-package.js --validate   # runs `apm compile --validate` in packages/caveman/
Install (deploy):   apm install                                        # from repo root
Bump caveman:       git -C vendor/caveman fetch --tags \
                      && git -C vendor/caveman checkout <ref> \
                      && node scripts/build-caveman-package.js \
                      && git add vendor/caveman packages/caveman
                    # then bump `version:` in packages/caveman/apm.yml by hand to match <ref>
```

## Project Structure

```
vendor/
  caveman/                    → git submodule, JuliusBrussee/caveman, UNMODIFIED, pinned ref

scripts/
  build-caveman-package.js    → generator (Node, authored here — caveman ships no build-apm.js).
                                 Reads vendor/caveman native sources, writes packages/caveman/.apm/
                                 only (apm.yml + README are fixed authored sources it never touches).
                                 Source root = vendor/caveman, default --out = packages/caveman.
                                 Output oracle: apm's autodiscovery of caveman, reproduced with
                                 the deltas in the mapping table below.

packages/caveman/             → committed. .apm/ is generated (don't hand-edit); apm.yml + README
                                 are our fixed authored sources; compiled outputs are apm-produced
                                 (don't hand-edit).
  apm.yml                     → FIXED authored manifest (name: caveman, targets [claude, copilot],
                                 includes: auto). version bumped by hand when the submodule bumps.
  README.md                   → FIXED authored short package README (NOT caveman's product README)
  .apm/                       → GENERATED source tree — the only thing the generator writes
    skills/<name>/SKILL.md    → from vendor/caveman/skills/<name>/ (+ companion subdirs, e.g.
                                 caveman-compress/scripts/)
    agents/cavecrew-*.agent.md→ from vendor/caveman/agents/cavecrew-*.md (renamed .md → .agent.md)
    instructions/
      caveman-activate.instructions.md
                              → from vendor/caveman/src/rules/caveman-activate.md
                                 (+ injected `description` frontmatter)
    hooks/                    → from vendor/caveman/src/hooks/ (*.js + statusline.sh/.ps1)
      caveman.json            → generated hook descriptor (SessionStart + UserPromptSubmit)
  .claude/ .agents/ .github/  → COMPILED by apm from .apm/, committed (matches packages/sdd
  AGENTS.md  apm.lock.yaml       convention). Regenerated by apm install/compile, not by hand.

Root repo changes:
  .gitmodules                 → new: vendor/caveman entry
  apm.yml                     → remove JuliusBrussee/caveman from dependencies.apm;
                                add ./packages/caveman to devDependencies.apm;
                                add caveman to marketplace.packages (source: ./packages/caveman,
                                version = caveman's own 1.9.1, no per-package tag_pattern)
```

Generated primitives (the mapping the script performs):

| caveman native source | → | APM primitive |
|---|---|---|
| `skills/<name>/` | → | `.apm/skills/<name>/` (SKILL.md + companion subdirs verbatim; README/SECURITY dropped) |
| `agents/cavecrew-*.md` | → | `.apm/agents/cavecrew-*.agent.md` |
| `src/rules/caveman-activate.md` | → | `.apm/instructions/caveman-activate.instructions.md` (+ `description` frontmatter) |
| `src/hooks/*.js`, `caveman-statusline.{sh,ps1}` | → | `.apm/hooks/*` + generated `caveman.json` descriptor |

## Code Style

The generator matches caveman's house style: thin, built-ins only, section-divider comments (`// ---- generators ----`), a source→primitive doc block at the top. Key path constants:

```js
// Source root is the vendored submodule, not this script's parent dir.
const CAVEMAN_ROOT = path.resolve(__dirname, '..', 'vendor', 'caveman');
// Default output is the package dir (a fully-owned subdir → gets its own README).
const OUT_DIR = path.resolve(REPO_ROOT, opt('--out', 'packages/caveman'));
```

`apm.yml` and `README.md` are authored fixed sources, not generator output — the generator writes only `.apm/`, so they survive the surgical clean and every regenerate. The authored `apm.yml` stays honest to upstream: `name: caveman`, `author: Julius Brussee`, `homepage`/`repository` → `JuliusBrussee/caveman`, `version` set to match caveman's pinned release (`vendor/caveman/bin/install.js` `PINNED_REF` → `1.9.1`, bumped by hand when the submodule bumps), `targets: [claude, copilot]`, `includes: auto` to match sibling packages.

## Testing Strategy

Generated Markdown/config, not executable logic — "testing" = determinism + valid compile + real install:

- **Determinism:** run the generator twice; `git diff packages/caveman/.apm/` is empty on the second run. Surgical clean (`rmrf .apm` + rewrite) means an upstream-removed skill disappears from the package; the authored `apm.yml`/`README.md` are untouched.
- **Validate:** `node scripts/build-caveman-package.js --validate` → `apm compile --validate` in `packages/caveman/` exits 0, producing `.claude/` (+ `.github/`) with no validation errors.
- **Install end-to-end:** `apm install` at repo root deploys caveman skills into `.claude/skills/caveman*` + `.claude/skills/cavecrew`, agents into `.claude/agents/cavecrew-*`, the activation rule into `.claude/rules/`, and hooks into `.claude/settings.json` + `.claude/hooks/`. Root `apm.lock.yaml` gains a `_local/caveman` entry and drops the old `juliusbrussee/caveman` marketplace_plugin entry.
- **No-touch check:** `git -C vendor/caveman status` is clean after a full generate + install cycle.

## Boundaries

- **Always do:** regenerate `packages/caveman/.apm/` via the script and commit it; keep `vendor/caveman` pristine; keep the authored `apm.yml` + `README.md` honest to upstream; match `packages/sdd` layout and `includes: auto` convention.
- **Ask first:** bumping the submodule to a new upstream version (ships behavior changes to installers); changing which primitives are included or the package's `targets`; altering root `apm.yml` marketplace structure beyond the caveman entry + dependency swap.
- **Never do:** edit any file inside `vendor/caveman`; hand-edit the generated `.apm/` or apm-compiled outputs under `packages/caveman/`; commit `apm_modules/` or `build/` (gitignored); overwrite caveman's product README.

## Success Criteria

- `vendor/caveman` exists as a submodule (`.gitmodules` records it), pinned to a release ref, working tree clean.
- `scripts/build-caveman-package.js` (Node) generates `packages/caveman/.apm/` from `vendor/caveman` (leaving the authored `apm.yml`/`README.md` untouched); a second run leaves `git diff` empty.
- `packages/caveman/apm.yml` is a valid manifest: `name: caveman`, `includes: auto`, `targets: [claude, copilot]`, version `1.9.1` from caveman's pinned release.
- `packages/caveman/.apm/` contains all 7 skills, 3 cavecrew agents, the `caveman-activate` instruction, and the hooks bundle + `caveman.json` — matching apm's autodiscovery output for caveman.
- `packages/caveman/` also commits the apm-compiled outputs (`.claude/`, `.agents/`, `.github/`, `AGENTS.md`, `apm.lock.yaml`), matching the `packages/sdd` convention.
- `node scripts/build-caveman-package.js --validate` succeeds (`apm compile --validate` exits 0).
- Root `apm.yml`: `JuliusBrussee/caveman` removed from `dependencies.apm`; `./packages/caveman` present under `devDependencies.apm`; `caveman` present under `marketplace.packages` (`source: ./packages/caveman`).
- `apm install` at repo root deploys the caveman primitives into `.claude/` and updates `apm.lock.yaml` (`_local/caveman` in, remote `juliusbrussee/caveman` out).
- `git -C vendor/caveman status` clean after generate + install — caveman source untouched.

## Decisions

- **`targets`:** `[claude, copilot]` (match siblings; hooks fire on `claude` only regardless).
- **Marketplace versioning:** entry `version:` = caveman's own `1.9.1`; no per-package `tag_pattern` (`source` is local).
- **Submodule:** SSH URL, pinned to tag `v1.9.1` (commit `0d95a81`).
- **Compiled outputs:** committed alongside `.apm/`, matching the `packages/sdd` convention.

## Open Questions

Resolve during implementation (verify against the tool, don't guess):

1. **`includes: auto` and hooks.** Verify auto-discovery picks up `.apm/hooks/` + the descriptor; if not, fall back to an explicit `includes:` list in the generated manifest.
2. **Hook descriptor filename.** Spec targets `caveman.json`; apm's autodiscovery emits `hooks.json`. Use whichever apm's loader actually reads — confirm before finalizing the generator.
3. **Emit `.apm/prompts/`?** apm's autodiscovery produced `prompts/*` (Codex/Gemini command stubs); the target `.apm/` here omits them. Decide whether the generator emits them.
