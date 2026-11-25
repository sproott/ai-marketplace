# Spec: fsharp Marketplace Package

## Objective

After an agent edits or creates F# source files, lint each of those files with FSharpLint and
make the agent fix what it finds before moving on — but only in projects that have opted
in by installing FSharpLint as a **local dotnet tool**. Projects without it see nothing: no
output, no latency beyond the manifest lookup, no install nag.

Ships as a new marketplace package, `fsharp`, so it installs independently of `personal`
and gives future F# primitives a home.

User stories:

- As a dev in an F# repo whose `.config/dotnet-tools.json` lists `dotnet-fsharplint`, when
  the agent writes a lint-violating `.fs` file, the agent is told the violations (file,
  line, rule, message) and is expected to fix them.
- As a dev in an F# repo *without* FSharpLint in the tool manifest, editing `.fs` files
  behaves exactly as if the hook were not installed.
- As a dev in a non-F# repo, the hook exits immediately on every edit.

## Assumptions

1. "Installed locally as a tool" means a dotnet local-tool manifest
   (`.config/dotnet-tools.json` or `dotnet-tools.json`) found by walking up from the edited
   file's directory, whose `tools` object has a `dotnet-fsharplint` key. Global installs
   (`dotnet tool install -g`) do **not** count.
2. Invocation is `dotnet fsharplint --format msbuild lint <absolute file path>`
   (`--format` is a global option and must precede `lint`), run with cwd = the
   directory holding the manifest's owning root (the dir containing `.config/` or the
   bare `dotnet-tools.json`). FSharpLint then finds that root's `fsharplint.json` by its
   own default lookup; the hook passes no `--lint-config`. A project `fsharplint.json`
   replaces FSharpLint's defaults: only the rules it enables run.
3. Linted extensions: `.fs`, `.fsx`. `.fsi` is skipped (FSharpLint targets implementation
   files).
4. Triggering tools: `WRITE_TOOLS` from `hook-io.ts` — Claude Code `Edit`, `Write`; VS Code Copilot
   Chat `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`,
   `insert_edit_into_file`, `apply_patch`; Copilot CLI `apply_patch` (its only editing
   tool), plus `str_replace_editor`, `edit`, `create`, `write`, which Copilot's docs name but
   its runtime does not register. Payload reading is the shared harness I/O layer
   `packages/_shared/hook-io/hook-io.ts`, bundled into the hook by `just build fsharp`: it yields every file a call left behind — one for an argument
   object (`file_path`/`filePath`/`path`/`file`), one per entry of a `replacements` array,
   every added, updated or moved-to file for an `apply_patch` patch (a raw string, or under
   the `input` key), deleted files excluded.
   Claude Code handlers are scoped in the hook config by `if:` rules, one per tool and
   extension (`Edit(*.fs)`, `Edit(*.fsx)`, … — `if:` takes a single rule, no braces or
   `||`; `*.fs` matches at any depth), so non-F# edits never spawn the script. They pass
   `--scoped`. Every other host ignores `if:`: Copilot CLI gets one unscoped
   `apply_patch|str_replace_editor|edit|create|write` handler, and VS Code ignores matchers
   too, so it runs all five handlers on every tool call. The script exits under `--scoped`
   on any non-Claude payload (`hook.host !== Host.CLAUDE`), so each edit lints once, via
   the unscoped handler. Claude Code matches case-sensitively, so it never fires the
   lowercase group.
5. The hook bundle requires `node` on the harness's `PATH` and has no external module dependencies.
6. A manifest-listed but unrestored tool is restored by the hook itself
   (`dotnet tool restore`, see Behavior step 4). The manifest pins the exact version, so
   this runs only what the project already declared — same as the dev running it.
7. Any other failure of the hook itself (dotnet missing, restore fails, unparseable
   output, timeout, unexpected error) **warns the user** through `systemMessage` and never
   blocks on its own breakage. Only real lint findings block.

## Tech Stack

- Hook: TypeScript bundled to CommonJS and invoked with Node.js.
- Linter: FSharpLint (`dotnet-fsharplint`), whatever version the target project pins in
  its tool manifest. The package pins nothing; it only restores the project's pin.
- Runtime: .NET SDK on PATH (`dotnet`). Absent in a project that lists FSharpLint ⇒ user
  warning, no lint.
- Packaging: APM package (`apm.yml` + `.apm/hooks/`), targets `claude` + `copilot`.

## Behavior

Given a PostToolUse payload:

1. `--scoped` with a non-Claude payload ⇒ exit 0, no output. Resolve tool name and the
   files the call left behind. Not a triggering tool, or no file with extension in
   `{.fs, .fsx}` ⇒ exit 0, no output. Steps 2–5 run per F# file, in patch order, each file
   once.
2. Walk up from the file's directory to the filesystem root looking for
   `.config/dotnet-tools.json`, then `dotnet-tools.json`, at each level (dotnet's own
   order). First manifest found wins. None found, unreadable, invalid JSON, or no
   `tools["dotnet-fsharplint"]` ⇒ exit 0, no output.
3. Run `dotnet fsharplint --format msbuild lint <abs path>` with cwd = manifest root.
   Hook timeout 60 s; every lint, restore and retry of one hook call shares one 50 s
   subprocess budget.
   A cold first restore may exceed it — the edit then gets an out-of-time warning and the
   next edit, with a warm cache, lints normally. `dotnet` not on PATH ⇒ warning
   ``FSharpLint hook: `dotnet` is not on PATH; edited F# files were not linted.``
4. If the lint run fails because the tool is not restored (stderr contains dotnet's
   `Run "dotnet tool restore" to make the "dotnet-fsharplint" command available.`, exit 1),
   run `dotnet tool restore` once per manifest root per hook call with the same cwd,
   then retry the lint once. Restore and retry share the one subprocess budget. Restore restores every
   tool in the manifest (dotnet has no single-tool restore); needs network on first run.
   Restore exits non-zero ⇒ warning ``FSharpLint hook: `dotnet tool restore` failed in
   <root> (exit N); F# files there were not linted.``, no retry. Budget runs out ⇒
   warning ``FSharpLint hook ran out of time; some edited F# files were not linted.``
   The next edit tries again.
5. Parse findings from stdout, one msbuild line each:
   `<path>(<line>,<col>,<endLine>,<endCol>):FSharpLint warning|error <RuleId>: <message>`.
   Other stdout lines (banner, `Linting …`, `Finished: N warnings`) are ignored. FSharpLint
   exits 0 when clean and 255 with findings; a file that fails to parse reports 0 warnings.
   No parsed findings and exit 0 ⇒ no output. No parsed findings and a non-zero exit is a
   tool failure ⇒ warning ``FSharpLint hook: `dotnet fsharplint` exited N on <path> without
   findings: <last stderr line, else last stdout line>``.
7. Emit once per hook call: the block response from step 6 (or none) plus every distinct
   warning, joined into `systemMessage` by `emit` from `hook-io.ts`.
6. Findings in any file ⇒ emit one block response through `block` from `hook-io.ts`, in the schema
   of the host that sent the payload:
   - Claude-shaped payload: `{"decision": "block", "reason": <text>}` plus
     `hookSpecificOutput.additionalContext` = same text.
   - Copilot CLI payload: top-level `additionalContext` and, on a successful tool result,
     `modifiedResult` appending the text to `textResultForLlm`, since Copilot's
     PostToolUse has no block decision.
   - Text: per file with findings, a header naming the file and count, then one line per
     finding `<path>:<line> <RuleId> <message>` sorted by line, capped at 30 findings with a "+N more"
     tail; file sections separated by a blank line.

The edit itself has already happened (PostToolUse); "block" means the agent receives the
findings as a must-address error, not that the write is undone.

## Commands

```
Build:           just build fsharp
Deploy:          just install                     # or: cd packages/fsharp && apm install
Audit:           just audit
Test:            just test-bun
Single test:     bun run test packages/fsharp/tests/fsharplint.test.ts
Manual check:    echo '<payload json>' | node packages/fsharp/.apm/hooks/fsharplint_check.cjs
```

## Project Structure

```
packages/fsharp/
  apm.yml                           → name: fsharp, version 1.0.0, targets claude+copilot
  .apm/hooks/
    fsharplint.json                 → PostToolUse, timeout 60: groups Edit / Write,
                                      each with `if:` *.fs and *.fsx handlers running
                                      fsharplint_check.cjs --scoped; group
                                      apply_patch|str_replace_editor|edit|create|write
                                      running it unscoped
    fsharplint_check.cjs            → generated Node.js bundle
  src/hooks/fsharplint_check.ts     → hook source
  tests/fsharplint.test.ts          → tests (stub `dotnet` on PATH)
  (.claude/, .github/ …)            → apm install outputs, never hand-edited
apm.yml (root)                      → new marketplace.packages entry `fsharp`
packages/_shared/hook-io/hook-io.ts   → shared I/O layer
packages/_shared/hook-io/hook-io.test.ts → shared I/O tests
justfile                            → runs Vitest and shell suites
docs/specs/fsharp/spec.md  → this file
```

## Code Style

Use the shared I/O module for harness payloads and responses. Catch unexpected hook errors at the entry point.

## Testing Strategy

Vitest cases in `packages/fsharp/tests/fsharplint.test.ts` create temporary project dirs, pass payload JSON to the Node bundle, and assert on stdout. A stub `dotnet` script on `PATH` returns canned FSharpLint output / exit codes so
tests run without the .NET SDK and stay fast and deterministic.

Cases:

- should skip linting when the edited file is not F#
- should skip linting when the edited file is an F# signature
- should skip linting when the tool does not edit
- should skip linting when the payload has no path
- should skip linting when there is no tool manifest
- should skip linting when the manifest lacks FSharpLint
- should skip linting when the manifest is invalid JSON
- should lint from the manifest root when an ancestor has a .config manifest
- should lint from the manifest root when an ancestor has a bare manifest
- should follow the nearest manifest when only an outer manifest lists FSharpLint
- should lint the absolute path when the edit uses a relative path
- should emit a block decision with sorted findings when lint reports warnings
- should report the path as given when the edit uses a relative path
- should cap the list and report the remainder when there are more than 30 findings
- should emit nothing when lint output has zero findings
- should warn the user without blocking when dotnet fails with unparseable output
- should warn the user without blocking when dotnet is absent
- should restore and retry when the tool is not restored
- should warn the user without retrying when restore fails
- should restore at most once when the retry still reports an unrestored tool
- should append findings when create sends JSON-encoded tool arguments
- should lint every added or updated F# file when apply_patch changes several files
- should restore only once when apply_patch touches several F# files under the same root
- should block on findings when a scoped handler receives a Claude edit
- should skip linting when a scoped handler receives a Copilot edit
- should skip linting when a scoped handler receives a VS Code create
- should block on findings when an unscoped handler receives a VS Code edit
- should scope only the Claude handlers when registered for both Claude and Copilot

Payload parsing and response rendering are tested in `packages/_shared/hook-io/hook-io.test.ts`.

One optional integration case runs real FSharpLint against a fixture when
`dotnet fsharplint --version` works in a fixture project; skipped otherwise. It pins the
output format the parser depends on, and uses a fixture `fsharplint.json` enabling only
`redundantNewKeyword` to prove the config is found from the manifest-root cwd (FL0014
reported, default-on FL0065 absent).

## Boundaries

- Always: warn the user, never block, on any hook-internal failure; lint only the edited file; edit
  sources, then run `just build fsharp` and `apm install` to regenerate outputs.
- Ask first: installing anything beyond what the project's tool manifest pins or linting the whole project or solution.
- Never: block on hook breakage; hand-edit generated `.claude/`/`.github/` outputs;
  touch `personal` package's hooks.

## Success Criteria

- [ ] `packages/fsharp` exists, listed in root `apm.yml` marketplace, `just audit` clean.
- [ ] After `apm install`, Claude Code settings in the package carry the PostToolUse hook;
      Copilot hook JSON is generated.
- [ ] In a fixture repo with `dotnet-fsharplint` in its manifest and a violating `.fs`
      file, a Claude Code `Write` yields a `decision: block` response listing
      `path:line RuleId message`.
- [ ] Same fixture without the manifest entry: zero output, exit 0.
- [ ] Non-F# edit: zero output, no `dotnet` process spawned.
- [ ] All test cases above pass via `just test-bun`.

## Open Questions

1. Copilot CLI PostToolUse: confirm no block equivalent exists; if one does, use it. Until
   then findings reach Copilot via top-level `additionalContext` and `modifiedResult`.
