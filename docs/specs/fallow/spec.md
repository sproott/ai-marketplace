# Spec: fallow Marketplace Package

## Objective

Publish `fallow` (npm: `fallow`, codebase intelligence for TypeScript/JavaScript — dead
code, duplication, architecture boundaries, PR-risk audit) as a package in this repo's APM
marketplace (`sproott-ai`), following the vendor + generator pattern established by
`packages/caveman` and `packages/rtk` (see `docs/specs/rtk/spec.md`) — but with a
**CLI-generated scratch dir** as the vendoring source instead of a git submodule, since
fallow ships no static "agent primitives" tree in its own repo; it *writes* one on demand
via `fallow agent install`.

Source of truth: run `fallow agent install --root <scratch> --harness claude --approve` in
an isolated scratch directory, then map its output into `packages/fallow/.apm/`. `claude` is
the only harness with a working PreToolUse hook implementation (`codex`'s hook is a doc
block only; `cursor`'s is unsupported) and its skill/MCP output is harness-generic enough
for APM to redistribute to any target — so it's the richest single source, not a
compromise.

Success looks like: `bun run cli build fallow` produces a clean, valid
`packages/fallow/` that `apm install` deploys into `.claude/`, `.agents/`, and `.github/` (or any configured target) —
skill, MCP server dependency, PreToolUse gate hook, and task-map instruction — with no
hand-editing.

## Tech Stack

- **Generator: TypeScript and Effect, run via Bun** from the repository root.
- **Vendoring: on-demand CLI generation**, not a submodule. The generator shells out to
  `bunx fallow@<pinned-version> agent install --root <tmp-scratch> --harness claude
  --approve`, reads the scratch dir's output, then deletes the scratch dir (a scoped temp
  directory, removed on success or failure). No `vendor/fallow` directory exists.
- **Package format: APM package** (`apm.yml` + `.apm/`), matching `packages/rtk` /
  `packages/caveman` structure.

## Commands

From the repository root, install dependencies with `bun install --frozen-lockfile`.

| Task | Command |
| --- | --- |
| Generate package | `bun run cli build fallow` |
| Generate and validate with APM | `bun run cli build fallow --validate` |
| Deploy every package | `just install` |
| Update to the upstream release | `bun run cli update fallow` |

## Project Structure

```
scripts/cli/src/
  packages/fallow.ts      → package definition: generator + release source (npm
                                    `fallow` latest). Reads the pinned `version:` out of
                                    packages/fallow/apm.yml (or `--out <dir>`/apm.yml), runs
                                    `bunx fallow@<version> agent install --root <tmp>
                                    --harness claude --approve` in a throwaway scratch dir,
                                    maps its output into packages/fallow/.apm/, deletes the
                                    scratch dir. Fails with a typed `FallowBuildError` when
                                    an upstream assumption it rewrites against is broken.
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
  src/hooks/fallow-gate-io.sh   → AUTHORED gate adapter (copied into .apm/hooks/)
  tests/test-fallow-gate-io.sh  → adapter tests
  .mcp.json  .claude/ .agents/  → DEPLOYED by apm install, committed
  .github/  apm.lock.yaml
  .apm/                          → GENERATED tree
    skills/
      fallow/                   → copied from scratch/.claude/skills/fallow/ (frontmatter
                                    untouched), then references/cli-reference.md is split:
                                    each `## ` section except the table of contents becomes
                                    references/cli/<command-or-anchor>.md,
                                    cli-reference.md becomes an index linking them, and
                                    `cli-reference.md#<anchor>` links in SKILL.md and
                                    references/{gotchas,patterns,mcp}.md are remapped onto
                                    the split files
    hooks/
      fallow-gate.json          → descriptor: PreToolUse, matcher `Bash|bash` (Claude Code
                                    and Copilot CLI shell tool names), command
                                    `./fallow-gate-io.sh` — APM hooks resolve sibling
                                    scripts via a relative `./` path, same as rtk's
                                    `./rtk-hook-wrapper.sh`
      fallow-gate-io.sh         → AUTHORED (packages/fallow/src/hooks/fallow-gate-io.sh). Harness I/O
                                    layer around the vendored gate: passes payloads without
                                    a `toolArgs` key through; reshapes a Copilot CLI
                                    camelCase payload (`toolArgs` JSON string) into
                                    `tool_input.command` and turns the gate's exit-2 block
                                    into a top-level `permissionDecision: "deny"` with the
                                    gate output as `permissionDecisionReason`. Runs the
                                    gate in the checkout the command targets (leading
                                    `cd <dir> &&`, `git -C <dir>`, else payload `cwd`), at
                                    the nearest directory with `fallow.toml`,
                                    `.fallowrc.json`, or `.fallowrc.jsonc`, else the
                                    repository root. Without `jq` it passes the payload
                                    straight to the gate
      fallow-gate.sh            → copied verbatim from scratch/.claude/hooks/fallow-gate.sh
    instructions/
      fallow-task-map.instructions.md
                                → extracted from scratch/AGENTS.md: only the `## Fallow`
                                   section plus the `<!-- generated:task-matrix -->` and
                                   `<!-- fallow:setup-hooks -->` marked blocks (+ injected
                                   `description` frontmatter). The setup-hooks block's
                                   duplicate `## Fallow task map` table is dropped and its
                                   one "the task map below" pointer becomes "above". The blank scaffold sections
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

Root repo:
  apm.yml                        → fallow under marketplace.packages
                                     (source: ./packages/fallow, version <pinned>)
```

Generated + authored primitive mapping:

| Scratch source | → | APM primitive |
|---|---|---|
| `.claude/skills/fallow/**` | → | `.apm/skills/fallow/**` (copy, with `references/cli-reference.md` split into `references/cli/*.md` and links remapped) |
| `.mcp.json` | → | `apm.yml`'s `dependencies.mcp` entry (parsed + rewritten by the generator, not copied as a file) |
| `.claude/hooks/fallow-gate.sh` | → | `.apm/hooks/fallow-gate.sh` (verbatim) + generated `.apm/hooks/fallow-gate.json` (command `./fallow-gate-io.sh`) |
| `packages/fallow/src/hooks/fallow-gate-io.sh` *(authored here)* | → | `.apm/hooks/fallow-gate-io.sh` |
| `AGENTS.md` (`## Fallow` + task-matrix + setup-hooks blocks only) | → | `.apm/instructions/fallow-task-map.instructions.md` |
| `CLAUDE.md`, `.claude/settings.local.json`, `AGENTS.md` scaffold placeholders | → | *(not vendored — see Decisions)* |

## Code Style

The `mcp:` derivation is the one place the generator writes YAML — parse `.mcp.json`'s
single `mcpServers.<name>` entry into APM's stdio-server shape (confirmed empirically via
`apm mcp install fallow -- fallow-mcp`, which writes exactly this shape). `.mcp.json` must
decode to servers with string `type` and `command` and optional string `args`, and must
hold exactly one server (`UnexpectedMcpServerCount` otherwise):

```js
const [name, server] = the single entry of mcpJson.mcpServers;
const mcpEntry = {
  name,
  registry: false,
  transport: server.type, // "stdio"
  command: server.command, // "fallow-mcp"
  ...(server.args?.length ? { args: server.args } : {}),
};
// replaces the source range of packages/fallow/apm.yml's dependencies.mcp sequence with
// [mcpEntry], keeping its flow/block style, indentation, and line endings; every other
// byte of the file is untouched. A missing or non-sequence dependencies.mcp is an error.
```

Hook descriptor mirrors rtk's `PreToolUse` + shell-tool matcher shape (same
`apm compile --validate`-confirmed convention, see rtk spec Open Question 1):

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash|bash",
      "hooks": [{ "type": "command", "command": "./fallow-gate-io.sh" }]
    }
  ]
}
```

## Testing Strategy

Same shape as `packages/rtk`'s determinism/validate/install-e2e coverage:

- **Gate adapter:** `packages/fallow/tests/test-fallow-gate-io.sh` exercises the package-owned wrapper; `just test` discovers it.
- **Builder contracts:** `scripts/cli/tests/build-fallow.test.ts` checks that the
  installer receives the exact pin and Claude harness flags and that the scratch dir is
  removed when it fails; that a fixture installer's output yields byte-exact descriptor and
  instruction files; the task-map heading and direction-count errors; MCP server-count,
  manifest-shape, and args handling plus byte-preserving manifest rewrites; and the CLI
  reference split (slugging, preamble, fenced headings, link remapping, index).
- **Determinism:** run the generator twice against the same pinned version; `git diff
  packages/fallow/.apm/` (and `apm.yml`'s `mcp:` block) is empty on the second run.
- **Validate:** `bun run cli build fallow --validate` → `apm compile
  --validate` exits 0.
- **Install end-to-end:** `just install` runs `apm install` in `packages/fallow/`, which
  deploys the skill into `.claude/skills/` and `.agents/skills/`, the `fallow-gate` hook
  wired to `PreToolUse` into `.claude/settings.json` + `.claude/hooks/fallow/` and
  `.github/hooks/`, the task-map instruction into `.github/instructions/`, and the `fallow`
  MCP server (stdio, `fallow-mcp`) for the claude and copilot targets; the package's
  `apm.lock.yaml` records the deployed files and the `fallow` MCP server.
- **Scratch-dir cleanup check:** no leftover temp directory survives a generator run,
  success or failure (the scratch dir is a scoped temp directory).
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
  `fallow-gate-io.sh` + `fallow-gate.sh`, and `instructions/fallow-task-map.instructions.md`.
- Generator is idempotent: two consecutive runs against the same pin produce zero diff.
- `--validate` passes (`apm compile --validate` exits 0 inside `packages/fallow`).
- Root `apm.yml`: `fallow` present under `marketplace.packages`
  (`source: ./packages/fallow`); not a root dependency.
- `apm install` in `packages/fallow/` deploys all fallow primitives and updates
  `apm.lock.yaml`; the `fallow-gate` hook is wired to `PreToolUse`/`Bash|bash`.
- `bun run cli update fallow` resolves the latest npm `fallow` version, updates both
  version pins, rebuilds, then runs `just test`, `just install`, and a non-blocking
  `just audit`.
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
- **The generator reads the version pin from one place:** `packages/fallow/apm.yml`'s
  `version:` field. The generator reads it and runs `bunx fallow@<that version>` — no
  hardcoded version constant to drift out of sync; `cli update fallow` writes the same
  version to that field and to the root marketplace entry (unlike rtk, which pins a submodule ref
  separately from `apm.yml`'s `version:`; fallow has no submodule to pin).
- **`bunx`, not `npx`**, per explicit instruction — the generator's shellout and any
  documented bump command use `bunx fallow@<version> ...` throughout.

## Open Questions

None outstanding.
