# Spec: Shared Hook I/O

## Objective

Give every first-party hook in the marketplace one I/O layer that reads a hook payload from
any supported harness and turns it into one normalized `HookInput`, then renders a
decision back in the schema of the harness that sent the payload. Hook logic reads only
normalized fields and never branches on wire keys.

The module is `packages/_shared/hook-io/hook-io.ts`. It is never deployed on its own: the
maintainer CLI bundles it into each consuming hook as a self-contained CommonJS file that
needs only Node.js at runtime.

User stories:

- As a hook author, I import `read`, a tool set and a response helper, and my hook behaves
  the same on Claude Code, VS Code Copilot Chat and Copilot CLI.
- As a dev installing a package, the hook runs with `node` alone: no `npm install`, no
  Bun, no TypeScript.
- As a maintainer, `just test` fails when a committed bundle no longer matches its sources.

## Assumptions

1. Supported hosts are Claude Code, VS Code Copilot Chat (Local harness) and Copilot CLI.
   VS Code's Copilot-target Agent Host sends Copilot CLI payloads and counts as Copilot CLI.
   opencode has no stdin hooks and is out of scope.
2. Claude Code and VS Code share one wire format: a snake_case envelope (`tool_name`,
   `tool_input`, `session_id`, `hook_event_name`) and `hookSpecificOutput` responses. VS Code
   alone adds `timestamp`. Copilot CLI uses camelCase (`toolName`, `toolArgs`, `sessionId`,
   `toolResult`) and flat responses.
3. Each host has its own tool names and argument keys. `references/cross-host.md` in
   `packages/dev/.apm/skills/harness-hooks/` lists them. Where the docs and this module
   differ, the module is ground truth.
4. Copilot CLI has no post-tool block decision. A post-tool finding reaches its model
   through `additionalContext` and an amended tool result.
5. Hook descriptors start every hook with
   `sh -c 'cd "${CLAUDE_PROJECT_DIR:-$PWD}" && exec node ./<script>.cjs'`, so the process
   cwd is the project root on every host.

## Tech Stack

- Module: TypeScript, Node built-ins (`node:fs`) and Valibot for payload validation.
- Bundler: `bun build --target=node --format=cjs --minify-whitespace`, driven by the
  Effect maintainer CLI in `scripts/cli/`.
- Runtime of a shipped hook: Node.js on the harness's `PATH`. Valibot and the module are
  inlined; only Node built-ins stay as `require` calls.
- Tests: Vitest (`vitest.config.mts` includes `packages/_shared/hook-io/**/*.test.ts`),
  plus `@effect/vitest` for the bundling tests.
- Type-check: `tsc -p tsconfig.hooks.json`, which covers `packages/*/src/hooks/**/*.ts`,
  `packages/_shared/hook-io/**/*.ts` and `packages/*/tests/**/*.ts` with Node types.

## Contract

### Hosts

`Host` is `{ CLAUDE: 'claude', VSCODE: 'vscode', COPILOT: 'copilot' }`.

`detectHost(payload)` checks in this order:

1. `toolName`, `toolArgs` or `sessionId` is present with a value other than `undefined`
   ⇒ `copilot`. A Copilot marker wins even when snake_case fields or `timestamp` are also
   present.
2. Else a `timestamp` key is present, whatever its value ⇒ `vscode`.
3. Else ⇒ `claude`.

`parse` calls `detectHost` on the validated envelope. An envelope field with the wrong type
becomes `undefined` first, so a wrong-typed `toolName` does not make a payload Copilot.

### Input: `parse(value, event)` and `read(event)`

`read(event)` reads all of stdin synchronously and returns `parse(stdin, event)`.

`parse` accepts a JSON string or an already-decoded value and returns `HookInput`:

| Field | Source |
|---|---|
| `host` | `detectHost` |
| `event` | `hook_event_name` if non-empty, else the `event` argument |
| `tool` | `tool_name`, else `toolName`, lowercased; `''` when both are missing |
| `changes` | file changes from `tool_input`, else `toolArgs` (see below) |
| `command` | the `command` argument, else `null` |
| `prompt` | `prompt`, else `null` |
| `session_id` | `session_id`, else `sessionId`, else `null` |
| `tool_result` | Copilot only: `toolResult.textResultForLlm` when `toolResult.resultType` is `success`, else `null`. Always `null` for `claude` and `vscode` |

The envelope and the argument objects are validated with Valibot. Unknown fields are
allowed. A known field with the wrong type falls back to `undefined` and does not discard
the other fields. `toolArgs`, `tool_input`, a `replacements` entry and `toolResult` can be
an object or a JSON string; a string that does not parse as JSON gives no arguments.

`command` is the raw `command` argument for any tool. For Copilot CLI `str_replace_editor`
it is the editor sub-command (`create`, `str_replace`, …), not a shell command.

### Tool name sets

Members are lowercased tool names, compared against `hook.tool`:

- `CREATE_TOOLS` — tools that can create a file: `write`, `create`, `apply_patch`,
  `str_replace_editor`, `create_file`.
- `WRITE_TOOLS` — tools that can change a file: every `CREATE_TOOLS` member plus `edit`,
  `replace_string_in_file`, `multi_replace_string_in_file`, `insert_edit_into_file`.

By host: Claude Code `Edit`, `Write`; VS Code `replace_string_in_file`,
`multi_replace_string_in_file`, `create_file`, `insert_edit_into_file`, `apply_patch`;
Copilot CLI `apply_patch`, `edit`, `create`, `write`, `str_replace_editor`.

### File changes

`changes` is a list of `FileChange` `{ path, old_text, new_text }`, derived only from the
arguments, whatever the tool name. Consumers filter by tool set before they trust it.
Paths are returned exactly as the payload gives them; the module does not resolve
relative paths. The arguments are read in this order:

1. **Patch.** If the arguments are a raw string, or have an `input` string, that starts
   (after leading whitespace) with `*** Begin Patch`, parse it as a V4A patch:
   - `*** Add File: <p>` ⇒ `{ path: p, old_text: null, new_text: <+ lines> }`.
   - `*** Update File: <p>` ⇒ `{ path: p, old_text: <- and context lines>, new_text: <+ and context lines> }`.
   - `*** Move to: <q>` after an update ⇒ the same change reported under `q`; the source
     path is not reported.
   - `*** Delete File: <p>` ⇒ no change.
   - Other `*** ` lines and `@@` lines are skipped. A context line (leading space) goes to
     both sides; the first character of each body line is removed. Header paths are
     trimmed. Changes come out in patch order.
2. **Replacements.** If `replacements` is an array, each entry is parsed as an argument
   object by these same rules and the results are joined in order.
3. **Single file.** The path is `file_path`, else `filePath`, else `path`, else `file`.
   No path ⇒ no change.
   - New text from `new_string` / `newString` / `new_str` / `newStr` / `code` ⇒ an
     in-place edit: `old_text` from `old_string` / `oldString` / `old_str` / `oldStr`,
     else `''`.
   - Otherwise ⇒ a whole-file write: `old_text: null`, `new_text` from `content` /
     `file_text` / `fileText` / `text`, else `null`.

`old_text: null` marks a created or overwritten file. `old_text: ''` marks an edit that
names no old text (VS Code `insert_edit_into_file`).

### cwd

The module has no cwd handling. It does not read the payload's `cwd`, does not change
directory and returns paths unresolved. Consumers resolve relative paths against
`process.cwd()`, which the descriptor sets to `${CLAUDE_PROJECT_DIR:-$PWD}`.

### Responses

All helpers return plain objects. `emit(response, warnings = [])` writes one JSON line to
stdout: the response, plus `systemMessage` set to the warnings joined by newlines when
there are any. `response` may be `null`, so a hook can emit warnings alone. With neither,
`emit` writes nothing; hooks emit nothing when they have nothing to say.

Warnings report the hook's own breakage (a missing tool, a timeout, an unexpected error)
to the user. `systemMessage` is shown to the user, not the model, on Claude Code and VS
Code, so the agent does not try to repair the user's toolchain. Whether Copilot CLI
displays it is unverified. `failure(name, error)` formats an unexpected error as
`<name> hook failed: <message>`.

| Helper | `claude` / `vscode` | `copilot` |
|---|---|---|
| `context(hook, text)` | `{ hookSpecificOutput: { hookEventName: hook.event, additionalContext: text } }` | `copilotContext(hook.tool_result, text)` |
| `block(hook, text)` | `{ decision: 'block', reason: text, hookSpecificOutput: { hookEventName, additionalContext: text } }` | `copilotContext(hook.tool_result, text)` |
| `deny(hook, reason)` | `{ hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason: reason } }` | `{ permissionDecision: 'deny', permissionDecisionReason: reason }` |

Building blocks, also exported for adapters that bypass `parse`:

- `claudeContext(event, text)` — the `hookSpecificOutput.additionalContext` object.
- `copilotContext(result, text)` — `{ additionalContext: text }`; when `result` is not
  `null`, also `modifiedResult: { resultType: 'success', textResultForLlm: result + '\n\n' + text }`.

`block` is for post-tool findings; on Copilot CLI it is the same as `context`. `deny` is
for `PreToolUse`.

### Errors

- `parse` does not throw on bad payloads. Invalid JSON, a non-object payload or a payload
  with no known fields gives a `claude` input with `tool: ''` and no changes.
- `read` throws if stdin cannot be read.
- The module never exits the process and never writes to stderr. Every consumer wraps its
  entry point in `try`/`catch` and, on an unexpected error, exits 0 with
  `emit(null, [failure(<name>, error)])`, so a hook failure warns the user and never blocks
  the agent.

## Consumers

| Package | Entry (`src/hooks/`) | Event | Uses |
|---|---|---|---|
| `fsharp` | `fsharplint_check.ts` | PostToolUse | `read`, `WRITE_TOOLS`, `Host`, `block` |
| `oxlint` | `oxlint_check.ts` | PostToolUse | `read`, `WRITE_TOOLS`, `block`, `context` |
| `personal` | `comment_style_check.ts` | PostToolUse | `read`, `WRITE_TOOLS`, `context` |
| `rules-on-create` | `rules_on_create.ts` | PreToolUse | `read`, `CREATE_TOOLS`, `deny` |
| `caveman` | `caveman-hook-io.ts` | SessionStart, UserPromptSubmit | `copilotContext` only; it detects Copilot CLI itself (`sessionId` present and `session_id` absent) and forwards Claude-shaped input to the vendored scripts |
| `impeccable` | `hook.ts` | SessionStart, PostToolUse, Stop (Claude target only) | `detectHost`, `Host`, `claudeContext`, `copilotContext`; reads the raw payload, and the build target (`claude` or `copilot`) overrides detection |

Each consumer imports the module by relative path
(`../../../_shared/hook-io/hook-io.ts`) and ships the bundle next to its descriptor in
`.apm/hooks/`. APM copies that `.cjs` to `.claude/hooks/<pkg>/` and
`.github/hooks/scripts/<pkg>/`.

## Bundling and staleness

`bundleHook(entrypoint, destination, check = false)` in
`scripts/cli/src/shared/build-hook-bundle.ts`:

1. Runs `bun build` into a scoped temp dir with the banner `// Generated hook bundle.` and a
   metafile.
2. Fails unless the metafile shows exactly one output.
3. Fails when any external import, in the inputs or the output, is not a Node built-in
   (`node:module` `isBuiltin`). The message names the import.
4. Without `check`: creates the destination directory and copies the bundle there.
5. With `check`: compares the bundle with the destination byte for byte. A difference or a
   missing destination fails with `Stale hook bundle: <destination>; run just build <package>`.

The output does not depend on the checkout path, so a bundle built in one clone checks
clean in another.

Callers:

- `scripts/cli/src/packages/authored-hooks.ts` registers one hook per authored package —
  `fsharp/fsharplint_check`, `oxlint/oxlint_check`, `personal/comment_style_check`,
  `rules-on-create/rules_on_create` — bundling `packages/<pkg>/src/hooks/<hook>.ts` to
  `packages/<pkg>/.apm/hooks/<hook>.cjs`. Each is a `build <pkg>` sub-command with a
  `--check` flag. `build` with no sub-command rebuilds every package, the authored hooks
  included.
- The `caveman` and `impeccable` builders call `bundleHook` as one step of their full
  generation. Their bundles are checked by `scripts/cli/tests/hook-bundles.test.ts`.

## Commands

```
Build one hook:     just build <pkg>                 # bun run cli build <pkg>
Build everything:   just build
Staleness check:    bun run cli build <pkg> --check
Type-check:         bun run typecheck                # includes tsc -p tsconfig.hooks.json
Test (Vitest):      just test-bun                    # --check for fsharp, oxlint, personal, rules-on-create, then bun run test
Single test:        bun run test packages/_shared/hook-io/hook-io.test.ts
Everything:         just check                       # typecheck, lint, test
Manual check:       echo '<payload json>' | node packages/<pkg>/.apm/hooks/<hook>.cjs
```

## Project Structure

```
packages/_shared/hook-io/
  hook-io.ts                        → the module
  hook-io.test.ts                   → payload parsing and response tests
packages/<pkg>/src/hooks/<hook>.ts  → consumer source
packages/<pkg>/.apm/hooks/<hook>.cjs → generated bundle, committed
scripts/cli/src/shared/build-hook-bundle.ts → bundleHook
scripts/cli/src/packages/authored-hooks.ts  → authored hook registry and build sub-commands
scripts/cli/tests/hook-bundles.test.ts      → relocated-build checks for caveman, impeccable
tsconfig.hooks.json                 → type-check scope for hooks, hook-io and package tests
justfile                            → test-bun runs every authored --check before Vitest
packages/dev/.apm/skills/harness-hooks/     → author workflow and host references
docs/specs/hook-io/spec.md          → this file
```

## Code Style

- Validate every consumed wire field with Valibot and let unknown fields through.
- A new wire field gets a schema entry and a normalized `HookInput` field here, never a raw
  payload read in a consumer.
- Return response objects from pure helpers; only `emit` and `read` touch stdio.

## Testing Strategy

`packages/_shared/hook-io/hook-io.test.ts` calls `parse`, `detectHost` and the response
helpers directly on literal payloads.

Wire format:

- should detect Copilot CLI when camelCase markers accompany snake_case metadata
  (`toolName`, `toolArgs`, `sessionId`)

Hook input:

- should normalize file changes when Claude edits a file
- should normalize file changes when Claude writes a whole file
- should normalize file changes when Copilot CLI sends JSON string arguments
- should normalize file changes when Copilot CLI sends malformed arguments
- should normalize file changes when VS Code inserts code
- should normalize file changes when VS Code edits multiple files
- should preserve both sides of surviving files when parsing a patch (Copilot raw string
  and VS Code `input`)
- should keep valid envelope fields when another field has the wrong type
- should keep the change when a text argument has the wrong type
- should normalize the edit when a harness adds unknown fields
- should decode the command when Copilot CLI sends JSON string arguments

Hook responses:

- should nest context when the payload is Claude-shaped (Claude and VS Code)
- should include the finding when blocking in Claude Code
- should append a finding when Copilot CLI cannot block
- should use the native denial shape when responding to Claude Code
- should use the native denial shape when responding to Copilot CLI

`scripts/cli/tests/hook-bundles.test.ts` copies hook sources and `hook-io` into a nested
temp checkout and runs `bundleHook` with `check`:

- should match a relocated build when checking caveman/caveman-hook-io for caveman
- should match a relocated build when checking impeccable/hook for impeccable/claude
- should match a relocated build when checking impeccable/hook for impeccable/copilot

The four authored bundles are checked by `just test-bun`. Each consumer's own suite runs
its bundle through Node with a payload per host.

## Boundaries

- Always: add a `hook-io.test.ts` case with every new wire shape; rebuild and commit every
  consuming bundle after changing the module; keep bundles free of non-built-in imports.
- Ask first: adding a host, removing or renaming a `HookInput` field or a tool-set member,
  adding a runtime dependency other than Valibot.
- Never: hand-edit a `.cjs` bundle or a deployed copy; read raw payload keys in a consumer
  that uses `read`; throw or exit from the module.

## Success Criteria

- [ ] Each host's payload for each write tool listed above yields the expected `changes`.
- [ ] `context`, `block` and `deny` render the shapes in the response table per host.
- [ ] `just test-bun` passes: every authored bundle is fresh and all Vitest suites pass.
- [ ] `bun run typecheck` passes.
- [ ] Every shipped bundle runs with `node` alone and requires only Node built-ins.
