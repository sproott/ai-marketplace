# Spec: fallow Marketplace Package

## Objective

Publish `fallow` (npm: `fallow`, codebase intelligence for TypeScript/JavaScript — dead
code, duplication, architecture boundaries, PR-risk audit) as a package in this repo's APM
marketplace (`sproott-ai`), following the vendor + generator pattern established by
`packages/caveman` and `packages/rtk` (see `docs/specs/rtk-package/spec.md`) — but with a
**CLI-generated scratch dir** as the vendoring source instead of a git submodule, since
fallow ships no static "agent primitives" tree in its own repo; it *writes* one on demand
via `fallow agent install`.

Source of truth: run `fallow agent install --root <scratch> --harness claude --approve` in
an isolated scratch directory, then map its output into `packages/fallow/.apm/`. `claude` is
the only harness with a working PreToolUse hook implementation (`codex`'s hook is a doc
block only; `cursor`'s is unsupported) and its skill/MCP output is harness-generic enough
for APM to redistribute to any target — so it's the richest single source, not a
compromise.

Success looks like: `bun scripts/build-fallow-package.ts` produces a clean, valid
`packages/fallow/` that `apm install` deploys into `.claude/` (or any configured target) —
skill, MCP server dependency, PreToolUse gate hook, and task-map instruction — with no
hand-editing.

## Tech Stack

- **Generator language: TypeScript, run via Bun** (built-ins + a scratch-dir shellout), matching
  `scripts/build-rtk-package.ts`. New file: `scripts/build-fallow-package.ts`.
- **Vendoring: on-demand CLI generation**, not a submodule. The generator shells out to
  `bunx fallow@<pinned-version> agent install --root <tmp-scratch> --harness claude
  --approve`, reads the scratch dir's output, then deletes the scratch dir. No `vendor/
  fallow` directory exists.
- **Package format: APM package** (`apm.yml` + `.apm/`), matching `packages/rtk` /
  `packages/caveman` structure.

## Commands

```
Generate package:   bun scripts/build-fallow-package.ts
Validate package:   bun scripts/build-fallow-package.ts --validate   # apm compile --validate in packages/fallow/
Install (deploy):   apm install                                        # from repo root
Bump fallow:        bump `version:` in packages/fallow/apm.yml by hand to the target
                      release, then: bun scripts/build-fallow-package.ts
                      && git add packages/fallow
                    # the generator reads the pin FROM apm.yml — there is no second
                    # hardcoded version to keep in sync
```

## Project Structure

```
scripts/
  build-fallow-package.ts       → generator (TypeScript/Bun). Reads the pinned `version:` out of
                                    packages/fallow/apm.yml, runs `bunx fallow@<version>
                                    agent install --root <tmp> --harness claude --approve`
                                    in a throwaway scratch dir, maps its output into
                                    packages/fallow/.apm/, deletes the scratch dir.
                                    apm.yml and README.md are fixed, hand-authored sources
                                    except for the `mcp:` dependency list, which the
                                    generator derives from the scratch dir's `.mcp.json`
                                    and rewrites in place (see Decisions).

packages/fallow/                → committed. .apm/ is generated (don't hand-edit).
  apm.yml                        → mostly-fixed authored manifest (name: fallow, license:
                                    MIT, targets [claude, copilot], includes: auto,
                                    version: pinned fallow release — the single source the
                                    generator reads); `dependencies.mcp` is the one
                                    generator-owned field, regenerated on every run.
  README.md                     → FIXED authored short package README
  .apm/                          → GENERATED tree
    skills/
      fallow/                   → copied verbatim from scratch/.claude/skills/fallow/
                                    (SKILL.md already has valid name/description/license
                                    frontmatter — no rewriting needed)
    hooks/
      fallow-gate.json          → descriptor: PreToolUse, matcher Bash, command
                                    `./fallow-gate.sh` (rewritten from scratch's
                                    `"$CLAUDE_PROJECT_DIR"/.claude/hooks/fallow-gate.sh` —
                                    APM hooks resolve sibling scripts via a relative `./`
                                    path, same as rtk's `./rtk-hook-wrapper.sh`)
      fallow-gate.sh            → copied verbatim from scratch/.claude/hooks/fallow-gate.sh
    instructions/
      fallow-task-map.instructions.md
                                → extracted from scratch/AGENTS.md: only the `## Fallow`
                                   section plus the `<!-- generated:task-matrix -->` and
                                   `<!-- fallow:setup-hooks -->` marked blocks (+ injected
                                   `description` frontmatter). The blank scaffold sections
                                   (Project Overview / Architecture Notes / Commands / Agent
                                   Rules placeholders) are NOT vendored — see Decisions.

Not vendored (see Decisions):
  - scratch/CLAUDE.md            → its `@AGENTS.md` import is redundant with APM's own
                                     compiled CLAUDE.md, which already surfaces AGENTS.md
                                     content for the claude target.
  - scratch/.claude/settings.local.json (enabledMcpjsonServers)
                                  → the `--approve` equivalent; `apm mcp install`'s own
                                     Claude Code configurator produces the equivalent
                                     approval when the package's `mcp:` dependency deploys.
  - scratch/AGENTS.md scaffold sections (Project Overview, Architecture Notes, Commands,
    Agent Rules placeholders) → per-consumer fill-in-the-blank content, not a standing rule.

Root repo changes:
  apm.yml                        → add ./packages/fallow to devDependencies.apm;
                                     add fallow to marketplace.packages
                                     (source: ./packages/fallow, version <pinned>)
```

Generated + authored primitive mapping:

| Scratch source | → | APM primitive |
|---|---|---|
| `.claude/skills/fallow/**` | → | `.apm/skills/fallow/**` (verbatim copy) |
| `.mcp.json` | → | `apm.yml`'s `dependencies.mcp` entry (parsed + rewritten by the generator, not copied as a file) |
| `.claude/settings.json` (hooks.PreToolUse) + `.claude/hooks/fallow-gate.sh` | → | `.apm/hooks/fallow-gate.json` (command rewritten to `./fallow-gate.sh`) + `.apm/hooks/fallow-gate.sh` (verbatim) |
| `AGENTS.md` (`## Fallow` + task-matrix + setup-hooks blocks only) | → | `.apm/instructions/fallow-task-map.instructions.md` |
| `CLAUDE.md`, `.claude/settings.local.json`, `AGENTS.md` scaffold placeholders | → | *(not vendored — see Decisions)* |

## Code Style

The `mcp:` derivation is the one place the generator writes YAML instead of copying a file
verbatim — parse `.mcp.json`'s `mcpServers.<name>` entry into APM's stdio-server shape
(confirmed empirically via `apm mcp install fallow -- fallow-mcp`, which writes exactly
this shape):

```js
const mcpJson = JSON.parse(fs.readFileSync(path.join(SCRATCH, '.mcp.json'), 'utf8'));
const [name, server] = Object.entries(mcpJson.mcpServers)[0];
const mcpEntry = {
  name,
  registry: false,
  transport: server.type, // "stdio"
  command: server.command, // "fallow-mcp"
  ...(server.args?.length ? { args: server.args } : {}),
};
// merged into packages/fallow/apm.yml's dependencies.mcp: [mcpEntry], preserving every
// other hand-authored field in that file untouched.
```

Hook descriptor mirrors rtk's `PreToolUse` + `matcher: Bash` shape exactly (same
`apm compile --validate`-confirmed convention, see rtk spec Open Question 1):

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "./fallow-gate.sh" }]
    }
  ]
}
```

## Testing Strategy

Same shape as `packages/rtk`'s determinism/validate/install-e2e coverage:

- **Determinism:** run the generator twice against the same pinned version; `git diff
  packages/fallow/.apm/` (and `apm.yml`'s `mcp:` block) is empty on the second run.
- **Validate:** `bun scripts/build-fallow-package.ts --validate` → `apm compile
  --validate` exits 0.
- **MCP derivation unit check:** feed the generator's mcp-derivation function a sample
  `.mcp.json` and assert the exact `{name, registry: false, transport, command, args?}`
  shape, matching what `apm mcp install fallow -- fallow-mcp` independently produces.
- **Install end-to-end:** `apm install` deploys the skill, the `fallow-gate` hook wired to
  `PreToolUse`, the `fallow` MCP server (stdio, `fallow-mcp`), and the task-map instruction;
  `apm.lock.yaml` gains a `_local/fallow` entry.
- **Scratch-dir cleanup check:** no leftover temp directory survives a generator run,
  success or failure (use a `finally`-style cleanup, not best-effort).
- **No-network-fallback check:** `bunx fallow@<pinned>` is invoked with an exact version
  (never `@latest`), so a run against a stale local bunx cache still produces byte-identical
  output to a fresh one — no floating tag anywhere in the generator.

## Boundaries

- **Always do:** regenerate `packages/fallow/.apm/` (and the `mcp:` block) via the script
  and commit the result; run `bunx fallow@<version>` with the exact pin read from
  `apm.yml`, never `@latest`; delete the scratch dir after every run.
- **Ask first:** bumping the pinned fallow version; changing which scratch-dir outputs get
  vendored (e.g. deciding to also ship the AGENTS.md scaffold, or switching the source
  harness away from `claude`).
- **Never do:** hand-edit generated `.apm/` content or the generator-owned `mcp:` block in
  `packages/fallow/apm.yml`; invoke `bunx fallow` without a pinned version; vendor
  `.claude/settings.local.json` or the `CLAUDE.md` import (both are redundant with what APM
  itself already produces for the claude target).

## Success Criteria

- `packages/fallow/apm.yml` is valid: `name: fallow`, `license: MIT`, `includes: auto`,
  `targets: [claude, copilot]`, `version:` set to the pinned fallow release, and
  `dependencies.mcp` containing the single derived `fallow` stdio entry.
- `packages/fallow/.apm/` contains `skills/fallow/`, `hooks/fallow-gate.json` +
  `fallow-gate.sh`, and `instructions/fallow-task-map.instructions.md`.
- Generator is idempotent: two consecutive runs against the same pin produce zero diff.
- `--validate` passes (`apm compile --validate` exits 0 inside `packages/fallow`).
- Root `apm.yml`: `./packages/fallow` present under `devDependencies.apm`; `fallow` present
  under `marketplace.packages`.
- `apm install` deploys all fallow primitives and updates `apm.lock.yaml`; the `fallow-gate`
  hook is wired to `PreToolUse`/`Bash`.
- No `vendor/fallow` directory and no leftover scratch directories exist after a full
  generate cycle.

## Decisions

- **Source harness = `claude` only**, not `auto`/multi-harness merge. `codex`'s and
  `cursor`'s hook steps are not real hooks (doc block / unsupported), and both already
  write the skill under `.agents/skills/` while `claude` writes `.claude/skills/` — but
  since APM recompiles `.apm/skills/*` to whichever target dirs a consumer configures, the
  scratch-dir source location doesn't matter. `claude` is strictly richer (it's the only
  one with a real hook to translate), so there is no tradeoff being made, just a strictly
  better source.
- **Guide step included** (no `--without guide`), but only its two marked content blocks
  (`## Fallow` task-map + `fallow:setup-hooks`) are vendored into an instruction — the
  blank Project-Overview/Architecture-Notes/Commands/Agent-Rules scaffold in `AGENTS.md` is
  per-consumer fill-in-the-blank content, not a standing rule an APM instruction should
  assert.
- **`CLAUDE.md`'s `@AGENTS.md` import is not vendored.** This repo's own CLAUDE.md is
  already an APM-compiled output (`<!-- Generated by APM CLI -->`) that surfaces AGENTS.md
  content for the claude target; vendoring fallow's own import block would duplicate or
  conflict with APM's existing compile step.
- **`.claude/settings.local.json` (the `--approve` file) is not vendored.** Its effect
  (pre-approving the project-scoped MCP server) is produced independently by `apm mcp
  install`'s own Claude Code configurator when the package's `mcp:` dependency deploys —
  confirmed empirically (`apm mcp install fallow -- fallow-mcp` configures Claude Code
  directly, no separate settings.local.json step required).
- **MCP dependency is derived, not vendored as a raw file.** The generator parses
  `.mcp.json` and writes APM's own `dependencies.mcp` shape (`{name, registry: false,
  transport, command, args?}`), which is the format `apm mcp install` itself produces —
  keeping the fallow MCP server on APM's own dependency-resolution and lockfile path
  instead of a static asset APM doesn't understand as a dependency.
- **Version pin lives in exactly one place:** `packages/fallow/apm.yml`'s `version:`
  field. The generator reads it and runs `bunx fallow@<that version>` — no second
  hardcoded version constant to drift out of sync (unlike rtk, which pins a submodule ref
  separately from `apm.yml`'s `version:`; fallow has no submodule to pin).
- **`bunx`, not `npx`**, per explicit instruction — the generator's shellout and any
  documented bump command use `bunx fallow@<version> ...` throughout.

## Open Questions

None outstanding.
