# Spec: rtk Marketplace Package + Shimmed Hook

## Objective

Publish `rtk-ai/rtk` (Rust CLI proxy, cuts LLM token consumption 60-90% on common dev
commands: git, cargo, npm, docker, kubectl, etc.) as a package in this repo's APM
marketplace (`sproott-ai`), following the same vendor-submodule + generator pattern already
established for `packages/caveman` (see `docs/specs/caveman-package/spec.md`).

Unlike caveman, we do not ship rtk's Claude Code hook unmodified. Upstream's current hook
(since rtk v0.37.2) is a **native binary invocation** — `settings.json`'s `PreToolUse`
command is the resolved absolute path to the `rtk` binary itself, hardcoded at `rtk init`
time (e.g. `/opt/homebrew/bin/rtk hook claude`). We replace that with our own **wrapper
script** that:

1. Resolves the real `rtk` binary at run time instead of trusting a path baked in at
   install time (rtk can be installed via `install.sh` → `~/.local/bin`, `cargo install` →
   `~/.cargo/bin`, or Homebrew → `/opt/homebrew/bin` / `/usr/local/bin` /
   `/home/linuxbrew/.linuxbrew/bin` — any of these can change or coexist).
2. Exports `RTK_ACTIVE=1` before exec'ing into the real binary, **except** in bypass modes
   (`rtk proxy <cmd>` — rtk's own documented raw-passthrough-no-filtering meta-command — and
   whenever `RTK_DISABLED` is already set in the environment, rtk's existing per-command
   disable switch). This lets our build infrastructure's own tooling (invoked as a child of
   the real `rtk` binary — e.g. `cargo`, `npm` under `rtk cargo build`) detect it is running
   filtered through rtk and adjust its own output accordingly.
3. Is installed as a **PATH-wide shim** (a dedicated shim directory containing a file
   literally named `rtk`, prepended ahead of the real binary's directory in `PATH`) — not
   just wired into `settings.json`. This is required for (2) to work at all: `PreToolUse`
   hooks are one-shot processes whose environment does not carry over to the later, separate
   process Claude Code spawns to actually execute the rewritten command (e.g. `rtk cargo
   build`). Only by intercepting *every* invocation of `rtk` — the hook's own internal
   `rtk hook claude` call **and** the later direct `rtk cargo build` call — does `RTK_ACTIVE`
   reach the real child processes rtk itself shells out to.

We do **not** touch or rename the user's actual installed `rtk` binary. The shim lives in
its own directory; installation is "add a directory to PATH," never "replace a file the
package manager (Homebrew, cargo) thinks it owns."

Success looks like: `git submodule update --remote vendor/rtk && node
scripts/build-rtk-package.js` produces a clean, valid `packages/rtk/` that `apm install`
deploys into `.claude/` — the awareness instruction, the suggest-nudge hook, and our own
authored wrapper + shim-installer hooks — with no hand-editing and no changes inside
`vendor/rtk`.

## Tech Stack

- **Generator language: Node.js** (built-ins only), matching `scripts/build-caveman-package.js`.
  New file: `scripts/build-rtk-package.js`.
- **Vendoring: git submodule** at `vendor/rtk` → `https://github.com/rtk-ai/rtk` (SSH:
  `git@github.com:rtk-ai/rtk.git`), pinned to tag `v0.43.0` (latest release; license
  Apache-2.0). Second submodule in this repo, alongside `vendor/caveman`.
- **Wrapper scripts: POSIX shell (bash)**, authored fresh in this repo — rtk ships no
  such wrapper itself (its own hook is either the legacy thin-delegator shell script,
  deprecated since v0.37.2, or the native binary invocation used today). These are new
  source, not a transform of vendored content.
- **Package format: APM package** (`apm.yml` + `.apm/`), matching `packages/caveman` /
  `packages/sdd` structure.

## Commands

```
Generate package:   node scripts/build-rtk-package.js
Validate package:   node scripts/build-rtk-package.js --validate   # apm compile --validate in packages/rtk/
Install (deploy):   apm install                                    # from repo root
Bump rtk:           git -C vendor/rtk fetch --tags \
                       && git -C vendor/rtk checkout <ref> \
                       && node scripts/build-rtk-package.js \
                       && git add vendor/rtk packages/rtk
                     # then bump `version:` in packages/rtk/apm.yml by hand to match <ref>
```

## Project Structure

```
vendor/
  rtk/                          → git submodule, rtk-ai/rtk, UNMODIFIED, pinned v0.43.0

scripts/
  build-rtk-package.js          → generator (Node). Reads vendor/rtk's consumer-facing
                                    native sources, writes packages/rtk/.apm/ only
                                    (apm.yml + README are fixed authored sources).
                                    ALSO copies our own authored wrapper/installer scripts
                                    (which live in this repo, not vendor/rtk) into .apm/hooks/.

packages/rtk/                   → committed. .apm/ is generated (don't hand-edit); apm.yml +
                                    README are fixed authored sources.
  apm.yml                       → FIXED authored manifest (name: rtk, license: Apache-2.0,
                                    targets [claude, copilot], includes: auto)
  README.md                     → FIXED authored short package README
  .apm/                         → GENERATED + authored source tree
    instructions/
      rtk-awareness.instructions.md
                                → from vendor/rtk/hooks/claude/rtk-awareness.md
                                   (+ injected `description` frontmatter), PLUS an authored
                                   "Shim Activation" section appended after the vendored body
                                   (SHIM_ACTIVATION_ADDENDUM in the generator — see Decisions).
                                   Standing rule: meta-commands, install verification, hook
                                   explanation, PATH-activation check.
    hooks/
      rtk-suggest.json          → descriptor: PreToolUse, matcher Bash, non-blocking
                                   systemMessage nudge (unchanged rewrite of any commands)
      rtk-suggest.sh            → vendored verbatim from vendor/rtk/.claude/hooks/rtk-suggest.sh
      rtk-hook.json             → descriptor: PreToolUse, matcher Bash, command
                                   `./rtk-hook-wrapper.sh hook claude` (see Code Style —
                                   argv is required because Claude Code passes hook JSON over
                                   stdin only, no argv of its own)
      rtk-hook-wrapper.sh       → AUTHORED FRESH (this repo). Deployed as the actual
                                   PreToolUse command in place of upstream's hardcoded
                                   absolute-path invocation. Also the file symlinked into
                                   the PATH shim directory as `rtk`.
      rtk-shim-install.sh       → AUTHORED FRESH (this repo). Idempotent: creates
                                   ~/.rtk/shim/, symlinks rtk-hook-wrapper.sh there as `rtk`,
                                   chmod +x. Never auto-edits shell rc — prints the PATH
                                   export line for the user to add (mirrors rtk's own
                                   `--no-patch` UX: print instructions, don't silently
                                   mutate the user's files). Wired as an idempotent
                                   SessionStart hook (see Decisions) that checks-then-installs.
  .claude/ .agents/ .github/    → COMPILED by apm from .apm/, committed (matches
  AGENTS.md  apm.lock.yaml         packages/caveman / packages/sdd convention).

Root repo changes:
  .gitmodules                   → add: vendor/rtk entry
  apm.yml                       → add ./packages/rtk to devDependencies.apm;
                                    add rtk to marketplace.packages
                                    (source: ./packages/rtk, version 0.43.0)
```

Generated + authored primitives (the mapping the generator performs):

| Source | → | APM primitive |
|---|---|---|
| `vendor/rtk/hooks/claude/rtk-awareness.md` | → | `.apm/instructions/rtk-awareness.instructions.md` (+ `description` frontmatter + authored Shim Activation section) |
| `vendor/rtk/.claude/hooks/rtk-suggest.sh` | → | `.apm/hooks/rtk-suggest.sh` + generated `rtk-suggest.json` descriptor |
| *(authored here, not vendored)* | → | `.apm/hooks/rtk-hook-wrapper.sh` + `rtk-hook.json` descriptor |
| *(authored here, not vendored)* | → | `.apm/hooks/rtk-shim-install.sh` (wired to SessionStart) |

## Code Style

`rtk-hook-wrapper.sh` is a thin, argv-based dispatcher — no `jq`, no stdin JSON parsing
(unlike the legacy `rtk-rewrite.sh`). It wraps *every* invocation of `rtk`, whether that's
the hook's own internal `rtk hook claude` call or a later direct `rtk cargo build` from the
Bash tool, so bypass detection reads `$1` (the subcommand), not the PreToolUse JSON payload:

```bash
#!/usr/bin/env bash
# rtk shim — resolves the real binary, injects RTK_ACTIVE unless bypassed, execs through.
# Never renames or replaces the real binary; lives in its own shim dir on PATH.

resolve_real_rtk() {
  # Skip our own shim dir so `command -v` can't resolve back to this script.
  local shim_dir
  shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  local IFS=:
  for dir in $PATH; do
    [ "$dir" = "$shim_dir" ] && continue
    [ -x "$dir/rtk" ] && { echo "$dir/rtk"; return; }
  done
  for candidate in "$RTK_INSTALL_DIR/rtk" "$HOME/.local/bin/rtk" "$HOME/.cargo/bin/rtk" \
                    /opt/homebrew/bin/rtk /usr/local/bin/rtk \
                    /home/linuxbrew/.linuxbrew/bin/rtk; do
    [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
}

REAL_RTK=${RTK_BIN:-$(resolve_real_rtk)}
if [ -z "$REAL_RTK" ]; then
  echo "[rtk-shim] WARNING: rtk binary not found. Install: https://github.com/rtk-ai/rtk#installation" >&2
  [ "$1" = "hook" ] && exit 0   # PreToolUse contract: never block the agent's command
  exit 127
fi

case "$1" in
  proxy) : ;;                                          # bypass: raw passthrough, no RTK_ACTIVE
  *) [ -z "${RTK_DISABLED:-}" ] && export RTK_ACTIVE=1 ;;
esac

exec "$REAL_RTK" "$@"
```

This matches rtk's own documented [Exit Code Contract](hooks/README.md#exit-code-contract)
and [Graceful Degradation](hooks/README.md#graceful-degradation): hooks must never block
command execution, so a missing binary or any resolution failure exits 0 for the `hook`
subcommand specifically (a direct `rtk <cmd>` call with no binary found is a genuine
command-not-found and exits 127, same as any missing binary would).

`rtk-hook.json`'s `command` is `./rtk-hook-wrapper.sh hook claude`, not the bare wrapper path.
Claude Code invokes a `PreToolUse` command exactly as written and pipes the hook JSON over
**stdin only** — it appends no argv. Since the wrapper dispatches on `$1`, a bare invocation
falls through to the default branch and execs the real `rtk` binary with zero arguments
(prints `--help`, which Claude Code surfaces as a hook error and blocks on). `hook claude` is
itself a real rtk subcommand ("process Claude Code PreToolUse hook, reads JSON from stdin"),
matching upstream's own native hook command shape.

## Testing Strategy

Same determinism/validate/install-e2e shape as `packages/caveman`, plus new coverage for the
authored wrapper logic (this part is executable shell, unlike caveman's copied assets):

- **Determinism:** run the generator twice; `git diff packages/rtk/.apm/` is empty on the
  second run.
- **Validate:** `node scripts/build-rtk-package.js --validate` → `apm compile --validate`
  exits 0.
- **Wrapper unit tests** (new, `vendor/rtk`-independent — test the authored script directly):
  - Given each of the known install layouts (binary at `~/.local/bin/rtk`, `~/.cargo/bin/rtk`,
    `/opt/homebrew/bin/rtk`, PATH-only), `resolve_real_rtk` finds it.
  - No binary anywhere → `hook`-subcommand invocation exits 0 with a stderr warning; a
    direct `rtk <cmd>` invocation exits 127.
  - `rtk proxy <cmd>` → `RTK_ACTIVE` is **not** set in the exec'd process's environment.
  - `RTK_DISABLED=1` already set → `RTK_ACTIVE` is **not** set (existing value preserved,
    not overwritten).
  - Any other subcommand (`hook claude`, `cargo build`, `git status`, …) → `RTK_ACTIVE=1` is
    set before exec.
  - `$RTK_BIN` override, when set, is used verbatim without running discovery.
- **Install end-to-end:** `apm install` deploys the instruction, both hook descriptors +
  scripts, and wires `rtk-shim-install.sh` to `SessionStart`; `apm.lock.yaml` gains a
  `_local/rtk` entry.
- **No-touch check:** `git -C vendor/rtk status` is clean after a full generate + install
  cycle.

## Boundaries

- **Always do:** regenerate `packages/rtk/.apm/` via the script and commit it; keep
  `vendor/rtk` pristine; keep `RTK_ACTIVE` injection and bypass detection in the wrapper
  script only (never duplicate that logic in the hook descriptor or elsewhere).
- **Ask first:** bumping the submodule to a new upstream rtk release; auto-patching the
  user's shell rc to prepend the shim directory to `PATH` (default behavior is print
  instructions, same as upstream's own `--no-patch` UX) — only wire an `--auto-patch`-style
  opt-in if explicitly requested; changing the bypass-mode list (currently `rtk proxy` +
  `RTK_DISABLED`) or which primitives ship in the package.
- **Never do:** edit any file inside `vendor/rtk`; rename, move, or replace the user's actual
  installed `rtk` binary; hand-edit generated `.apm/` or apm-compiled outputs; let the
  wrapper exit non-zero on the `hook` subcommand path under any failure (breaks the
  never-block-the-agent contract).

## Success Criteria

- `vendor/rtk` exists as a submodule, pinned to `v0.43.0`, working tree clean.
- `scripts/build-rtk-package.js` generates `packages/rtk/.apm/` deterministically (second run,
  empty diff); `--validate` passes.
- `packages/rtk/apm.yml` is valid: `name: rtk`, `license: Apache-2.0`, `includes: auto`,
  `targets: [claude, copilot]`, version `0.43.0`.
- `packages/rtk/.apm/` contains the `rtk-awareness` instruction, the `rtk-suggest` hook
  (vendored verbatim), and the authored `rtk-hook-wrapper.sh` + `rtk-shim-install.sh`.
- Wrapper unit tests (above) all pass, run outside of any Claude Code hook context.
- Root `apm.yml`: `./packages/rtk` present under `devDependencies.apm`; `rtk` present under
  `marketplace.packages`.
- `apm install` deploys all rtk primitives into `.claude/` and updates `apm.lock.yaml`.
- `git -C vendor/rtk status` clean after generate + install.
- Manually verified: with a real `rtk` binary installed and the shim on `PATH`, `rtk cargo
  build` run through the shim has `RTK_ACTIVE=1` visible to a child process (e.g. a
  throwaway `build.rs` or wrapper script printing `$RTK_ACTIVE`); `rtk proxy true` and
  `RTK_DISABLED=1 rtk cargo build` do not.

## Decisions

- **Wrapper is a PATH-wide shim, not just a `settings.json` hook-entry swap** — otherwise
  `RTK_ACTIVE` never reaches the actual build-tool child process (see Objective point 3).
- **Bypass modes = `rtk proxy` + `RTK_DISABLED`** — both are rtk's own existing "don't
  filter" signals; extending this list is an ask-first change.
- **Shim installation never touches the real binary** — dedicated `~/.rtk/shim/` directory
  prepended to `PATH`, not a rename-and-replace of the file Homebrew/cargo manages. Default
  behavior prints the PATH export line; never silently edits shell rc.
- **Package scope: consumer-facing primitives only** — `rtk-awareness.md` (instruction),
  `rtk-suggest.sh` (nudge hook), plus our authored wrapper + installer. rtk's own dev-tooling
  (its 12 skills, 6 agents, 3 rules for developing rtk-ai/rtk itself — `rust-patterns`,
  `tdd-rust`, `rtk-testing-specialist`, etc.) is out of scope, same reasoning as caveman
  excluding its own non-shipped internals.
- **Submodule:** SSH URL, pinned to tag `v0.43.0`.
- **Shim-activation reminder lives in the instruction, not the hook.** `rtk-shim-install.sh`'s
  PATH-export line only reaches the `SessionStart` hook's own stdout, which the user does not
  see. Rather than have the hook try to persist that message, the generator appends a
  standing "Shim Activation" section to `rtk-awareness.instructions.md` (authored here, not
  part of the vendored file — `vendor/rtk` stays untouched) instructing Claude to check
  `$PATH` each session and relay the export line to the user if the shim isn't on it yet.

## Open Questions

None outstanding. Resolutions from implementation:

1. **`PreToolUse` + `matcher: Bash` hook descriptor shape** — same top-level-key-by-lifecycle
   convention as caveman's `SessionStart`/`UserPromptSubmit`, with an explicit `matcher`:
   `{"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "..."}]}]}`.
   Confirmed via `apm compile --validate` (the declared `matcher` is preserved verbatim; apm
   only defaults to `"*"` when a descriptor omits `matcher` entirely) and independently via
   `vendor/rtk/src/hooks/init.rs`'s own `insert_hook_entry()`, which patches Claude Code's
   `settings.json` with the identical `{"matcher": "Bash", "hooks": [...]}` shape.
2. **`rtk-suggest.sh` currency** — still shipped and wired in v0.43.0
   (`vendor/rtk/.claude/hooks/rtk-suggest.sh`, referenced from `diagnose.md`,
   `technical-writer.md`, and the `security-guardian` skill). In scope, vendored verbatim.
3. **Shim activation mechanism** — an idempotent `SessionStart` hook fits APM's hook lifecycle
   the same way caveman's does; `rtk-shim-install.sh` is wired to `SessionStart` and verified
   via `apm install` end-to-end (Task 8).
4. **Windows-native support** — scoped out of this package. `rtk-hook-wrapper.sh` covers
   Linux/macOS/WSL only; no `.ps1`/`.cmd` equivalent ships. Adding one is a scope change (see
   Boundaries — ask first).
