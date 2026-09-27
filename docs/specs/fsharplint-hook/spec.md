# Spec: fsharplint Hook

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
4. Triggering tools: `hook_io.WRITE_TOOLS` — Claude Code `Edit`, `Write`; VS Code Copilot
   Chat `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`,
   `insert_edit_into_file`, `apply_patch`; Copilot CLI `apply_patch` (its only editing
   tool), plus `str_replace_editor`, `edit`, `create`, `write`, which Copilot's docs name but
   its runtime does not register. Payload reading is the shared harness I/O layer
   `hook_io.py` (canonical `scripts/hook-io/hook_io.py`, synced into the package by
   `just sync-hook-io`): it yields every file a call left behind — one for an argument
   object (`file_path`/`filePath`/`path`/`file`), one per entry of a `replacements` array,
   every added, updated or moved-to file for an `apply_patch` patch (a raw string, or under
   the `input` key), deleted files excluded.
   Claude Code handlers are scoped in the hook config by `if:` rules, one per tool and
   extension (`Edit(*.fs)`, `Edit(*.fsx)`, … — `if:` takes a single rule, no braces or
   `||`; `*.fs` matches at any depth), so non-F# edits never spawn the script. They pass
   `--scoped`. Every other host ignores `if:`: Copilot CLI gets one unscoped
   `apply_patch|str_replace_editor|edit|create|write` handler, and VS Code ignores matchers
   too, so it runs all five handlers on every tool call. The script exits under `--scoped`
   on any non-Claude payload (`hook_io.Host` is not `CLAUDE`), so each edit lints once, via
   the unscoped handler. Claude Code matches case-sensitively, so it never fires the
   lowercase group.
5. Hook script is Python 3 stdlib only, matching `comment_style_check.py` and
   `rules_on_create.py`. No third-party deps.
6. A manifest-listed but unrestored tool is restored by the hook itself
   (`dotnet tool restore`, see Behavior step 4). The manifest pins the exact version, so
   this runs only what the project already declared — same as the dev running it.
7. Any other failure of the hook itself (dotnet missing, restore fails, unparseable
   output, timeout) is **silent** — the hook never blocks on its own breakage. Only real lint
   findings block.

## Tech Stack

- Hook: Python 3 (stdlib: `json`, `subprocess`, `pathlib`), invoked by `sh -c` like the
  sibling hooks.
- Linter: FSharpLint (`dotnet-fsharplint`), whatever version the target project pins in
  its tool manifest. The package pins nothing; it only restores the project's pin.
- Runtime: .NET SDK on PATH (`dotnet`). Absent ⇒ silent no-op.
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
   A cold first restore may exceed it — the edit is then silent and the next edit, with a
   warm cache, lints normally.
4. If the lint run fails because the tool is not restored (stderr contains dotnet's
   `Run "dotnet tool restore" to make the "dotnet-fsharplint" command available.`, exit 1),
   run `dotnet tool restore` once per manifest root per hook call with the same cwd,
   then retry the lint once. Restore and retry share the one subprocess budget. Restore restores every
   tool in the manifest (dotnet has no single-tool restore); needs network on first run.
   Restore fails or budget runs out ⇒ silent; the next edit tries again.
5. Parse findings from stdout, one msbuild line each:
   `<path>(<line>,<col>,<endLine>,<endCol>):FSharpLint warning|error <RuleId>: <message>`.
   Other stdout lines (banner, `Linting …`, `Finished: N warnings`) are ignored. FSharpLint
   exits 0 when clean and 255 with findings; a file that fails to parse reports 0 warnings.
   No parsed findings ⇒ exit 0, no output, whatever the exit code (a non-zero exit without
   findings is a tool failure ⇒ silent).
6. Findings in any file ⇒ emit one block response through `hook_io.block`, in the schema
   of the host that sent the payload:
   - Claude-shaped payload: `{"decision": "block", "reason": <text>}` plus
     `hookSpecificOutput.additionalContext` = same text.
   - Copilot CLI payload: top-level `additionalContext` and, on a successful tool result,
     `modifiedResult` appending the text to `textResultForLlm`, since Copilot's
     PostToolUse has no block decision.
   - Text: per file with findings, a header naming the file and count, then one line per
     finding `<path>:<line> <RuleId> <message>`, capped at 30 findings with a "+N more"
     tail; file sections separated by a blank line.

The edit itself has already happened (PostToolUse); "block" means the agent receives the
findings as a must-address error, not that the write is undone.

## Commands

```
Deploy:          just install                     # or: cd packages/fsharp && apm install
Audit:           just audit
Test:            just test-shell                  # runs scripts/fsharp/test-*.sh
Single test:     bash scripts/fsharp/test-fsharplint-hook.sh
Manual check:    echo '<payload json>' | python3 packages/fsharp/.apm/hooks/fsharplint_check.py
```

## Project Structure

```
packages/fsharp/
  apm.yml                           → name: fsharp, version 1.0.0, targets claude+copilot
  .apm/hooks/
    fsharplint.json                 → PostToolUse, timeout 60: groups Edit / Write,
                                      each with `if:` *.fs and *.fsx handlers running
                                      fsharplint_check.py --scoped; group
                                      apply_patch|str_replace_editor|edit|create|write
                                      running it unscoped
    fsharplint_check.py             → the hook's core logic
    hook_io.py                      → harness I/O layer, synced copy of
                                      scripts/hook-io/hook_io.py
  (.claude/, .github/ …)            → apm install outputs, never hand-edited
apm.yml (root)                      → new marketplace.packages entry `fsharp`
scripts/fsharp/
  test-fsharplint-hook.sh           → tests (stub `dotnet` on PATH)
scripts/hook-io/
  hook_io.py, sync.sh,
  test-hook-io.sh                   → shared I/O layer, its sync, its tests + drift check
justfile                            → test-shell glob widened to scripts/*/test-*.sh
docs/specs/fsharplint-hook/spec.md  → this file
```

## Code Style

Match `packages/personal/.apm/hooks/comment_style_check.py`: module docstring stating the
hook's contract, harness payload and response handled only through `hook_io`, small
top-level functions, `main()` wrapped in
`contextlib.suppress(Exception)` so the hook can never crash the harness, comments only
for non-obvious intent per the comment-style rule.

```python
def manifest_root(start: Path) -> Path | None:
    for d in (start, *start.parents):
        for candidate in (d / ".config" / "dotnet-tools.json", d / "dotnet-tools.json"):
            if candidate.is_file():
                return d if has_fsharplint(candidate) else None
    return None
```

## Testing Strategy

Shell tests in `scripts/fsharp/test-fsharplint-hook.sh`, style of
`scripts/rtk/test-*.sh`: build temp dirs, pipe payload JSON into the hook, assert on
stdout. A stub `dotnet` script on `PATH` returns canned FSharpLint output / exit codes so
tests run without the .NET SDK and stay fast and deterministic.

Cases:

- should emit nothing when edited file is not `.fs`/`.fsx`
- should emit nothing when no tool manifest exists up the tree
- should emit nothing when manifest lacks `dotnet-fsharplint`
- should find manifest in `.config/` of an ancestor dir and run with that cwd
- should prefer nearest manifest when nested manifests exist
- should emit nothing when lint output has zero findings
- should emit block decision when findings exist
- should cap listed findings and report remainder
- should stay silent when `dotnet` exits non-zero with unparseable output
- should stay silent when `dotnet` is absent from PATH
- should run `dotnet tool restore` then retry lint when tool is not restored
- should restore at most once per invocation and stay silent when restore fails
- should handle Copilot payload shape (`toolName`/`toolArgs`, `create`)
- should lint every updated or added F# file in a Copilot `apply_patch`, skipping non-F#
  and deleted files, and report each
- should restore at most once per manifest root when a patch touches several files
- should lint a Claude payload and skip a Copilot payload under `--scoped`
- should skip a VS Code payload under `--scoped` and lint it from the unscoped handler
- should scope every Claude Code handler with `if:` + `--scoped` and leave one unscoped Copilot handler

Payload parsing and response rendering are tested once, in `scripts/hook-io/test-hook-io.sh`.

One optional integration case runs real FSharpLint against a fixture when
`dotnet fsharplint --version` works in a fixture project; skipped otherwise. It pins the
output format the parser depends on, and uses a fixture `fsharplint.json` enabling only
`redundantNewKeyword` to prove the config is found from the manifest-root cwd (FL0014
reported, default-on FL0065 absent).

## Boundaries

- Always: stay silent on any hook-internal failure; lint only the edited file; edit
  `.apm/` sources, then `apm install` to regenerate outputs.
- Ask first: installing anything beyond what the project's tool manifest pins; linting whole project/solution; adding non-stdlib Python deps.
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
- [ ] All test cases above pass via `just test-shell`.

## Open Questions

1. Copilot CLI PostToolUse: confirm no block equivalent exists; if one does, use it. Until
   then findings reach Copilot via top-level `additionalContext` and `modifiedResult`.
