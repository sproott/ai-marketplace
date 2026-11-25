# Spec: impeccable Marketplace Package

## Objective

Publish [Impeccable](https://github.com/pbakaus/impeccable) (Paul Bakaus's design skill, native
subagents, and design-check hooks) as a package in this repo's APM marketplace (`sproott-ai`).

Impeccable ships one skill plus per-harness native integrations (subagents and hook manifests)
that its own build script renders for each harness. This package republishes the Claude Code
and GitHub Copilot renderings through APM:

- one shared `impeccable` skill, deployed to every target;
- the Claude Code native agents and hooks, deployed only to `claude`;
- the GitHub Copilot native agents and hooks, deployed only to `copilot`.

The constraint that shapes the layout: **Impeccable source is never modified.** `vendor/impeccable`
is a read-only input to the builder. The builder runs Impeccable's own build in a temporary copy,
reads its `dist/` output, and writes three APM packages under `packages/impeccable/`.

Success looks like: `bun run cli build impeccable` regenerates `packages/impeccable/` with no
hand-editing, and `apm install impeccable@sproott-ai` deploys the skill, the five native agents,
and the design-check hooks for both Impeccable targets.

## Tech Stack

- **Builder:** TypeScript and Effect, run with Bun from the repository root
  (`scripts/cli/src/packages/impeccable/`).
- **Vendoring:** git submodule `vendor/impeccable` → `https://github.com/pbakaus/impeccable.git`,
  checked out at a skill release (`skill-v<version>`).
- **Upstream build:** The builder copies the source to a temporary directory, excluding `.git`,
  `node_modules/`, `dist/`, and `build/`. It installs build dependencies from upstream's `bun.lock`
  with `bun install --frozen-lockfile --ignore-scripts --no-optional`, then runs
  `bun scripts/build.js --skip-root-sync` there. The install may need registry access if Bun's
  cache is cold. The temporary tree is removed after the build.
- **Hook adapter:** `packages/impeccable/src/hooks/hook.ts`, bundled to a standalone `hook.cjs`
  with the shared `packages/_shared/hook-io` module. Consumers need Node.js and a POSIX shell.
- **Package format:** APM `hybrid` packages, one umbrella plus two local sub-packages.

## Commands

From the repository root, install dependencies with `bun install --frozen-lockfile`.

| Task | Command |
| --- | --- |
| Generate package | `bun run cli build impeccable` (or `just build impeccable`) |
| Generate into another parent directory | `bun run cli build impeccable --out <parent>` → writes `<parent>/impeccable/` |
| Update to the upstream release | `bun run cli update impeccable` |
| Deploy every package | `just install` |
| Test (hook adapter, builder, bundle drift) | `just test` |

The builder declares `parent: true`, so `--out` names the directory that receives `impeccable/`.
It does not support `--validate`.

## Project Structure

```
vendor/impeccable/               → git submodule, UNMODIFIED. Inputs the builder reads:
  package.json                   → version, author, license
  bun.lock                       → locked build dependencies
  LICENSE, NOTICE.md             → copied into each generated package
  scripts/build.js               → run with --skip-root-sync in a temporary copy

temporary build tree:
  dist/claude-code/.claude/      → skills/impeccable/, agents/, settings.json (hook manifest)
  dist/github/.github/           → agents/, hooks/impeccable.json (hook manifest)

scripts/cli/src/packages/impeccable/
  index.ts                       → builder + definition (release source, failure tags)
  guidance.ts                    → ImpeccableBuildError, anchored rewrite helpers, skill
                                   guidance adaptations

packages/impeccable/             → umbrella package `impeccable`
  apm.yml                        → GENERATED manifest (JSON), depends on ./claude and ./copilot
  LICENSE, NOTICE.md             → copied from upstream
  .apm/skills/impeccable/        → GENERATED shared skill
  src/hooks/hook.ts              → AUTHORED hook adapter (bundled into both targets)
  src/hooks/launcher.sh          → AUTHORED hook launcher shim (copied into both targets)
  tests/hook.test.ts             → AUTHORED adapter tests
  .claude/ .agents/ .github/     → COMPILED by apm install, committed
  apm.lock.yaml

  claude/                        → sub-package `impeccable-claude`, alias impeccable-claude
    apm.yml                      → GENERATED, targets [claude]
    LICENSE, NOTICE.md
    .apm/agents/*.agent.md       → GENERATED from dist/claude-code/.claude/agents/
    .apm/hooks/hook.cjs          → bundled from src/hooks/hook.ts
    .apm/hooks/skills/impeccable/scripts/impeccable
                                 → copy of src/hooks/launcher.sh
    .apm/hooks/impeccable.json   → GENERATED hook descriptor
    .claude/  apm.lock.yaml      → COMPILED by apm install, committed

  copilot/                       → sub-package `impeccable-copilot`, alias impeccable-copilot
    (same shape as claude/, targets [copilot], agents from dist/github/.github/agents/,
     compiled output under .github/)

scripts/cli/tests/
  build-impeccable.test.ts       → builder contract tests with minimal vendor fixtures
  impeccable-regression.test.ts  → guidance anchor tests; descriptor/launcher discovery check
  hook-bundles.test.ts           → committed hook.cjs matches a rebuild (both targets)
  update.test.ts                 → update flow for impeccable
```

Each run removes and rebuilds the `.apm/` directory of all three packages and rewrites their
`apm.yml`, `LICENSE`, and `NOTICE.md`. It leaves `src/`, `tests/`, and compiled APM outputs
alone.

### Mapping

| Upstream source | → | Generated output |
|---|---|---|
| `package.json` `version`, `author`, `license` | → | `apm.yml` of all three packages |
| `LICENSE`, `NOTICE.md` | → | copied into all three packages |
| `dist/claude-code/.claude/skills/impeccable/` | → | `.apm/skills/impeccable/` (umbrella), with the rewrites below |
| `dist/claude-code/.claude/agents/*.md` | → | `claude/.apm/agents/*.agent.md` |
| `dist/github/.github/agents/*` | → | `copilot/.apm/agents/*.agent.md` |
| `dist/claude-code/.claude/settings.json` `hooks` | → | `claude/.apm/hooks/impeccable.json`; its `SessionStart` also goes to `copilot/` |
| `dist/github/.github/hooks/impeccable.json` `hooks` | → | `copilot/.apm/hooks/impeccable.json` |
| `packages/impeccable/src/hooks/hook.ts` *(authored)* | → | `<target>/.apm/hooks/hook.cjs` |
| `packages/impeccable/src/hooks/launcher.sh` *(authored)* | → | `<target>/.apm/hooks/skills/impeccable/scripts/impeccable` |

Agent files are renamed to end in `.agent.md` (an existing `.agent.md` suffix is kept).

### Generated manifests

The builder writes each `apm.yml` as JSON:

- `name`: `impeccable`, `impeccable-claude`, or `impeccable-copilot`.
- `version`, `author`, `license`: from upstream `package.json`; `author` and `license` are
  omitted when upstream omits them.
- `description`: a fixed string, the same for all three.
- `type: hybrid`.
- `targets`: `[claude, copilot]` for the umbrella, `[claude]` or `[copilot]` for each sub-package.
- `dependencies.apm`: the umbrella lists `{path: ./claude, alias: impeccable-claude}` and
  `{path: ./copilot, alias: impeccable-copilot}`; sub-packages list none. `dependencies.mcp` is
  empty.

## Code Style

### Upstream rewrites

Every text rewrite requires its anchor to match exactly once. A missing or repeated anchor fails
with `UnexpectedAnchorCount`.

- **Skill-path links.** In every Markdown file of the skill and of both agent sets,
  `.claude/skills/impeccable/` and `.github/skills/impeccable/` become `<skill-base-dir>/`.
- **Update check.** APM owns updates, so both skill launchers get
  `IMPECCABLE_NO_UPDATE_CHECK=1`: after the `#!/bin/sh` line of `scripts/impeccable` and after
  the `setlocal` line of `scripts/impeccable.cmd`.
- **Guidance adaptations** (`adaptGuidance`):
  - `SKILL.md`: drops the native Pin / Unpin route; replaces the Hooks route with one that points
    to `reference/hooks.md` and says APM installs the hook manifests.
  - `reference/doctor.md`: the tool-version line directs updates to `apm update` then
    `apm install`; the `auto` repair line restores hook wiring with `apm install` and runs
    `doctor --fix` only when no hook-manifest findings exist.
  - `reference/hooks.md`: replaces the native harness-administration section, from
    `Supported harnesses:` up to `## Triage findings`, with APM guidance and the
    `hooks ignore-*` commands. It also removes the consent, cloud-manifest, bundled-hook-location,
    and Cursor migration remarks.
  - `reference/live.md` and `reference/generate.md`: add a paragraph that sets
    `IMPECCABLE_LIVE_COPY_AGENT=chat` for every live launcher command, and enables the auto
    fallback (a local coding agent with approval and sandbox bypass) only with explicit user
    approval.

All other skill content, including `scripts/` and `reference/`, is copied byte for byte. The
engine binary is not vendored. The skill launcher downloads the pinned engine on first use and
verifies it against `engine-checksums.txt`.

### Hook manifests

Structured inputs are schema-checked before output is written:

- `package.json`: string `version`, optional JSON `author`, optional string `license`
  (`InvalidPackageMetadata`).
- Claude `settings.json`: `hooks` with a nonempty `SessionStart` list of groups with nonempty
  `command` handlers; other events are lists of groups (`InvalidClaudeHookManifest`).
- Copilot `hooks/impeccable.json`: `hooks` maps camelCase events to lists of `{type: command,
  bash, matcher?, timeoutSec?, statusMessage?}` handlers; `matcher`, if present, is a string
  (`InvalidCopilotHookManifest`).
- A missing or unreadable input fails with `UnreadableUpstreamInput`.

Copilot events are capitalized (`postToolUse` → `PostToolUse`), and each handler becomes a group
with a single `command` handler. `timeoutSec` becomes `timeout`. Copilot's `SessionStart` uses
Claude's `SessionStart` handlers without Claude-specific matchers.

Each upstream command must end in `" <verb>`, the launcher verb that follows the quoted launcher
path (`MissingLauncherVerb` otherwise). It is rewritten to:

```
sh ./skills/impeccable/scripts/impeccable <verb> <target> <Event>
```

The builder keeps `timeout`, a nonempty `statusMessage`, and a nonempty `matcher` on the generated
hook group. The current descriptors:

| Target | Event | Matcher | Timeout |
|---|---|---|---|
| claude | SessionStart | — | 5 |
| claude | PostToolUse | `Edit\|Write` | 5 |
| claude | Stop | — | 30 |
| copilot | PostToolUse | `edit\|create\|apply_patch` | 5 |
| copilot | SessionStart | — | 5 |

The relative `./skills/impeccable/scripts/impeccable` command matches the path Impeccable's
`doctor` recognizes as its own hook. The file at that path inside the hook directory is the
authored `launcher.sh`, not the skill launcher.

## Hook Runtime

APM deploys each target's hooks into `.claude/hooks/impeccable-claude/` or
`.github/hooks/scripts/impeccable-copilot/`. On each event:

1. `launcher.sh` runs `node <hook dir>/hook.cjs <target> <Event> <verb>`.
2. `hook.cjs` reads the JSON payload from stdin. A non-object payload or missing arguments exit 1.
3. The project directory is the payload `cwd`, else `CLAUDE_PROJECT_DIR`, else the process cwd.
4. It finds the skill launcher `impeccable/scripts/impeccable` in the first existing candidate
   skills directory, in this order:
   - the deployed root's `skills/` (`.claude/` or `.github/`) and its sibling `.agents/skills/`;
   - `<harness dir>/skills` and `.agents/skills` in the project directory and each ancestor;
   - the user's home skills (`~/.claude/skills` or `~/.github/skills`, and `~/.agents/skills`).
     For `claude` with `CLAUDE_CONFIG_DIR` set, `<CLAUDE_CONFIG_DIR>/skills` replaces the home
     candidates.

   If no launcher is found, it prints an error naming the umbrella package and exits 1.
5. The harness is `claude` for the claude target. For copilot it is `github` when the payload is
   from Copilot CLI and `vscode` otherwise.
6. **SessionStart** does not run the engine. On `claude` with `CLAUDE_ENV_FILE` set and a safe
   `session_id`, it appends `export IMPECCABLE_SESSION_ID='<id>'` unless that is already the last
   value. It then returns context telling the agent to read the skill and run
   `"<launcher>" context` once per session. Copilot CLI gets top-level `additionalContext`;
   Claude and VS Code get `hookSpecificOutput`.
7. **Other events** run `sh <skill launcher> <verb>` in the project directory. For the Copilot target, a `PostToolUse` event naming a non-edit tool exits silently before launcher lookup; VS Code may invoke the wrapper without honoring the descriptor matcher. The payload is
   passed through with `hook_event_name` added. The environment adds
   `IMPECCABLE_HOOK_HARNESS=<harness>` and `IMPECCABLE_LIVE_COPY_AGENT=chat`. The engine's stdout,
   stderr, and exit status pass through.

## Release and Update

`bun run cli update impeccable`:

1. fetches the upstream default branch and reads a stable `X.Y.Z` from its `package.json`;
2. fetches `skill-vX.Y.Z`, verifies that the tagged manifest has the same version, and checks out the tag;
3. rewrites the version in `packages/impeccable/apm.yml` and in the root `apm.yml`
   `marketplace.packages` entry;
4. rebuilds the package, then runs `just test` and `just install`, and reports `just audit`
   without failing on it.

The root `apm.yml` lists `impeccable` only under `marketplace.packages`
(`source: ./packages/impeccable`). `.claude-plugin/marketplace.json` carries the same entry.

## Testing Strategy

- **Builder contracts** (`scripts/cli/tests/build-impeccable.test.ts`, minimal vendor fixtures):
  - two builds into a relative `--out` parent produce identical bytes, and only `impeccable/`
    appears in that parent;
  - compiled outputs survive and stale `.apm` primitives are removed;
  - agents are preserved with links normalized;
  - Claude and Copilot manifests render to the descriptors above;
  - each schema failure, missing input, missing launcher verb, and zero or two launcher markers
    returns its `ImpeccableBuildError` reason;
  - a build installs locked dependencies even when the vendor input has no `node_modules`, and
    leaves the vendor tree unchanged;
  - a failing upstream install or build returns `SubprocessExited` and leaves existing output in place.
- **Guidance anchors** (`impeccable-regression.test.ts`): each `adaptGuidance` anchor fails with
  `UnexpectedAnchorCount` when dropped or repeated. Each committed descriptor command must execute
  `sh ./skills/impeccable/scripts/impeccable hook…`, and that path must exist in the hook
  directory.
- **Hook adapter** (`packages/impeccable/tests/hook.test.ts`): payload, harness, verb, cwd, and
  `IMPECCABLE_LIVE_COPY_AGENT=chat` reach a stub engine for Claude, Copilot CLI, and VS Code
  payloads, with skills installed in the project, globally, in the user home, or next to the
  wrapper. Further cases: SessionStart guidance without running the engine, Claude session
  identity, Copilot CLI top-level context, and `CLAUDE_CONFIG_DIR` handling.
- **Bundle drift** (`hook-bundles.test.ts`): both committed `hook.cjs` bundles match a rebuild
  from a relocated checkout.
- **Determinism end to end:** `just build impeccable` twice leaves `git status -- packages/`
  unchanged.

## Boundaries

- **Always do:** regenerate with `bun run cli build impeccable` and commit the result; edit hook
  behavior only in `src/hooks/`, then rebuild; keep `vendor/impeccable` tracked files pristine.
- **Ask first:** updating to a new upstream release; adding, removing, or changing an upstream
  rewrite or guidance adaptation; adding a harness beyond Claude Code and Copilot.
- **Never do:** edit files under `vendor/impeccable`; hand-edit generated `.apm/`, generated
  `apm.yml`, or compiled outputs; vendor the engine binary.

## Success Criteria

- `vendor/impeccable` is a submodule at a skill release, and its tracked files are clean after a
  build.
- `packages/impeccable/`, `claude/`, and `copilot/` each have a generated `apm.yml` whose
  `version` equals upstream `package.json`, the root marketplace entry, and
  `.claude-plugin/marketplace.json`.
- The umbrella `.apm/` holds only `skills/impeccable/`. Each target `.apm/` holds the five
  native agents, `hooks/hook.cjs`, the launcher shim, and `hooks/impeccable.json`.
- Two consecutive builds produce no diff.
- `just test` passes, including bundle drift for both Impeccable targets.
- `just install` deploys the skill to `.claude/skills` and `.agents/skills`, Claude agents and
  hooks to `.claude/`, and Copilot agents and hooks to `.github/`.

## Decisions

- **Three packages, not one.** Agents and hooks are target-specific renderings, so each lives in
  a sub-package with a single target. The umbrella owns the shared skill and depends on both.
- **Claude's skill rendering is the shared source.** Paths to harness skill directories are
  normalized to `<skill-base-dir>/`, so one copy serves every target.
- **Copilot reuses Claude's SessionStart.** Upstream's Copilot manifest has no session-start
  hook; the adapter's SessionStart only emits setup context.
- **The manifest is generated.** Version, author, and license come from upstream
  `package.json`, so the package has no hand-authored `apm.yml` or README.
