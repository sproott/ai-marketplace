# Spec: oxlint Marketplace Package

## Objective

After an agent edits or creates files, run the repository's own Oxlint and Oxfmt package
scripts on exactly those files, so lint autofixes and formatting apply immediately and
remaining lint errors go back to the agent as findings it must address. The repository
opts in by defining two root `package.json` scripts; the hook never installs tools.

Ships as the marketplace package `oxlint`, installed per repository (not globally).

User stories:

- As a dev whose root `package.json` defines `lint:oxlint` and `format:oxfmt`, when the
  agent edits a `.ts` file, Oxlint runs with `--fix` on that file, then Oxfmt formats it;
  if Oxlint still exits non-zero, the agent receives its output as a finding.
- As a dev who has installed the hook but not yet added the scripts, every edit tells the
  agent which script to add and what it should contain, without blocking.
- As a dev using Effect's patched Oxlint, the setup guidance names
  `effect-tsgo oxlint --type-aware` as the lint command.
- As a dev in a monorepo, one patch touching several workspaces runs each root script once
  with all edited paths, never a nested workspace's scripts.

## Assumptions

1. The repository root is the harness project directory: the hook command runs
   `cd "${CLAUDE_PROJECT_DIR:-$PWD}"` and the script uses its (realpath'd) cwd as root.
   Only the root `package.json` is read; nested `package.json` files are ignored.
2. Script names are fixed: `lint:oxlint` and `format:oxfmt`. A generic `lint` or `format`
   script is never run.
3. The user owns the script bodies. The hook appends arguments only: `--fix` plus the
   edited paths for lint, the edited paths for format. The scripts should therefore carry
   no file/directory arguments, no `--fix`, and no `--check`.
4. Package manager resolution, first match wins:
   1. the root `packageManager` field, name before `@` (`pnpm@10.0.0` ⇒ `pnpm`);
   2. the first root lockfile found, checked in order bun (`bun.lock`, `bun.lockb`),
      pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`), yarn (`yarn.lock`, `.pnp.cjs`),
      npm (`package-lock.json`, `npm-shrinkwrap.json`);
   3. `npm`.
      Any name other than `npm`, `pnpm`, `yarn`, `bun` is unsupported.
5. Triggering tools: `WRITE_TOOLS` from the shared hook I/O layer (see
   `docs/specs/hook-io/spec.md` for host detection, tool-name normalisation and how a
   payload yields its changed files). One unscoped handler serves every host; there is no
   `if:` scoping and no `--scoped` flag.
6. The hook executes repository code (its package scripts). Install only in trusted
   repositories.
7. Requires `node` on the harness's `PATH` and a POSIX `sh`. The bundle has no external
   module dependencies.

## Tech Stack

- Hook: TypeScript (`src/hooks/oxlint_check.ts`) bundled to self-contained CommonJS by
  `bun run cli build oxlint`; runs under Node.js.
- Manifest validation: valibot (bundled).
- Linter / formatter: whatever `oxlint`/`effect-tsgo` and `oxfmt` the repository installs
  as dev dependencies, invoked through its package manager's `run`.
- Packaging: APM package (`apm.yml` + `.apm/hooks/`), targets `claude` + `copilot`.

## Behavior

Given a PostToolUse payload, with a 50 s internal budget starting at process start:

1. Read the payload via `read('PostToolUse')`. Tool not in `WRITE_TOOLS` ⇒ exit 0, no
   output.
2. Resolve each changed path against the root (realpath, so symlinks resolve). Drop paths
   that do not exist, are not regular files, or resolve outside the root. Remaining paths
   become `./<repo-relative path>` with `/` separators, deduplicated, in payload order. None
   left ⇒ exit 0, no output.
3. Read the root `package.json`. Missing, unreadable, invalid JSON, or failing the schema
   ⇒ treated as absent. Non-string `packageManager` or script values are treated as unset.
4. Resolve the package manager (Assumption 4). Unsupported ⇒ emit a non-blocking context
   message `Oxlint hook: unsupported package manager '<name>' in the root package.json.`
   and run nothing.
5. For each script in order `lint:oxlint`, then `format:oxfmt`:
   - Script missing or blank ⇒ add a setup warning (`Oxlint hook: in the root package.json
     scripts, add …` with the recommended script body; the lint guidance also names
     `effect-tsgo oxlint --type-aware`) and continue. The warning is added whether or not
     any edited file would have reached that script.
   - Lint receives only files whose extension is one of `.js .jsx .mjs .cjs .ts .tsx .mts
     .cts .vue .svelte .astro`; format receives every edited file. No files for the script
     ⇒ skip it silently.
   - Budget exhausted ⇒ add `Oxlint hook ran out of time; some edited files were not
     checked.` and stop.
   - Run `<manager> run <script> [--] <args>` with cwd = root, stdin ignored, timeout
     `min(20 s, remaining budget)`, SIGKILL on timeout. `--` is inserted for npm only.
     Lint args: `--fix` then the files. Format args: the files with each of `[ * ? { }`
     wrapped as `[c]`, because Oxfmt treats existing paths as glob patterns. Each file is
     one literal argv entry (no shell), and the `./` prefix keeps a leading-dash name from
     being read as a flag.
   - Exit 0 ⇒ no finding. Manager not on PATH ⇒ user warning ``Oxlint hook: `<manager>`
     is not on PATH; <script> did not run.`` Any other spawn error, timeout or signal ⇒
     user warning `Oxlint hook: <script> did not finish (<error or signal>).` These
     failures go to `systemMessage` via `emit(..., failures)`, never to the agent, and
     never block. A completed script with a nonzero exit ⇒ finding `<script> exited with status N:`
     followed by stdout and stderr joined, trimmed to the last 4000 characters.
6. Respond, in the schema of the host that sent the payload (rendering per
   `docs/specs/hook-io/spec.md`):
   - Any finding ⇒ `block(...)` with findings then warnings, separated by blank lines.
     Claude Code and VS Code get `{"decision":"block","reason":…}` plus
     `hookSpecificOutput.additionalContext`; Copilot CLI gets top-level `additionalContext`
     (plus `modifiedResult` on a successful tool result) and no block decision.
   - Warnings only ⇒ `context(...)` with the warnings joined by newlines (non-blocking).
   - Neither ⇒ no response object; failure warnings, if any, are still emitted alone.
7. Any unexpected exception ⇒ exit 0 with `emit(null, [failure("Oxlint", error)])`: a `systemMessage` warning to the user, no block.

`--fix` and the formatter rewrite the edited files on disk after the agent's edit. The
edit itself has already happened (PostToolUse); "block" means the agent receives the
output as an error to address, not that the write is undone.

Hook timeout is 60 s. Two scripts at 20 s each fit inside the 50 s budget, so the
"ran out of time" warning only appears if earlier work consumed the budget.

## Commands

```
Build:           bun run cli build oxlint          # or: just build oxlint
Stale check:     bun run cli build oxlint --check
Deploy:          just install                      # or: cd packages/oxlint && apm install
Audit:           just audit
Test:            just test-bun
Single test:     bun run test packages/oxlint/tests/oxlint.test.ts
Manual check:    echo '<payload json>' | node packages/oxlint/.apm/hooks/oxlint_check.cjs
```

## Project Structure

```
packages/oxlint/
  apm.yml                       → name: oxlint, version 1.0.0, targets claude+copilot
  README.md                     → install and script setup for users
  .apm/hooks/
    oxlint.json                 → PostToolUse, timeout 60, one handler, matcher
                                  Edit|Write|apply_patch|str_replace_editor|edit|create|
                                  write|replace_string_in_file|multi_replace_string_in_file|
                                  create_file|insert_edit_into_file, command
                                  sh -c 'cd "${CLAUDE_PROJECT_DIR:-$PWD}" && exec node ./oxlint_check.cjs'
    oxlint_check.cjs            → generated Node.js bundle
  src/hooks/oxlint_check.ts     → hook source
  tests/oxlint.test.ts          → Vitest tests (stub package manager on PATH)
  (.claude/, .github/ …)        → apm install outputs, never hand-edited
apm.yml (root)                  → marketplace.packages entry `oxlint`
packages/_shared/hook-io/hook-io.ts → shared I/O layer (docs/specs/hook-io/spec.md)
scripts/cli/src/packages/authored-hooks.ts → registers `oxlint` / `oxlint_check` for bundling
justfile                        → test-bun runs the --check build before Vitest
```

## Code Style

Use the shared I/O module for payload parsing and responses. Spawn package managers with
an argv array, never through a shell. Catch unexpected hook errors at the entry point.

## Testing Strategy

Vitest cases in `packages/oxlint/tests/oxlint.test.ts` create a temporary project, put a
stub package-manager script on `PATH` (the only `PATH` entry) that logs its cwd, name and
argv and prints `unused variable` with a configurable exit code, pass payload JSON to the
Node bundle, and assert on the logged calls and stdout.

Cases:

- script execution
  - should lint only the edited file when an npm script opts in
  - should run the root script once when a patch edits different workspaces
  - should select the manager from the lockfile when no manager is declared
  - should format after linting when both scripts are configured
  - should escape glob characters when formatting a literal edited path
  - should pass a file as one literal operand when its name starts with a dash and
    contains shell punctuation
- host responses
  - should block with lint findings when Claude Code reports the edit
  - should put lint findings in hook context when VS Code reports the edit
  - should report non-blocking findings when Copilot CLI reports a patch
- setup and skip behavior
  - should warn without running lint when only the generic script exists
  - should warn about only the formatter when lint succeeds and the formatter is missing
  - should warn the user without blocking when the configured package manager is missing
  - should stay silent when the tool does not write

Payload parsing and response rendering are tested in
`packages/_shared/hook-io/hook-io.test.ts`.

## Boundaries

- Always: run only the two named root scripts; pass only edited files inside the root;
  edit `src/`, then run `bun run cli build oxlint` and `apm install` to regenerate outputs.
- Ask first: installing tools, running whole-project lint/format, reading nested
  `package.json` scripts, adding more package managers.
- Never: execute scripts through a shell string; hand-edit the generated `.cjs` or the
  `.claude/`/`.github/` outputs; block on an unexpected hook exception.

## Success Criteria

- [ ] `packages/oxlint` is listed in the root `apm.yml` marketplace; `just audit` clean.
- [ ] `bun run cli build oxlint --check` reports the bundle current.
- [ ] After `apm install`, the package's Claude settings and Copilot hook JSON carry the
      PostToolUse handler.
- [ ] In a fixture repo with both scripts, a Claude Code `Edit` of a violating `.ts` file
      yields `decision: block` containing the Oxlint output; a clean file yields no output.
- [ ] In a fixture repo with neither script, an edit yields a non-blocking context message
      naming both scripts and runs no package manager.
- [ ] All test cases above pass via `just test-bun`.
