# Todo: fsharplint-hook

Plan: `docs/tasks/fsharplint-hook/plan.md` (read its Research Results first — they fix the
invocation and parser the spec left open). Spec: `docs/specs/fsharplint-hook/spec.md`.

## Task 1: Package skeleton, test harness, silent-exit gates

**Description:** Create `packages/fsharp` with `apm.yml`, `.gitignore`, hook JSON and a
`fsharplint_check.py` that resolves tool/path (both payload shapes, `toolArgs` as JSON
string), filters extension, and finds the manifest root — exiting silently on every gate.
Lint call is a stub that returns nothing yet. Build the test script with the `dotnet` stub
and widen `just test-shell`.

**Acceptance criteria:**
- [ ] Non-F# edit, `.fsi` edit, non-triggering tool, missing path ⇒ no stdout, exit 0, stub log shows no `dotnet` call
- [ ] `manifest_root` finds `.config/dotnet-tools.json` and bare `dotnet-tools.json` in ancestors; nearest wins; manifest without `dotnet-fsharplint`, invalid JSON ⇒ `None`
- [ ] Copilot payload (`toolName: "create"`, `toolArgs` JSON string) resolves path like Claude payload

**Verification:**
- [ ] `bash scripts/fsharp/test-fsharplint-hook.sh` passes
- [ ] `just test-shell` runs both `scripts/rtk/` and `scripts/fsharp/` tests

**Dependencies:** None

**Files likely touched:**
- `packages/fsharp/apm.yml`, `packages/fsharp/.gitignore`
- `packages/fsharp/.apm/hooks/fsharplint.json`
- `packages/fsharp/.apm/hooks/fsharplint_check.py`
- `scripts/fsharp/test-fsharplint-hook.sh`
- `justfile`

**Estimated scope:** M

## Task 2: Lint, parse, emit block response

**Description:** Run `dotnet fsharplint --format msbuild lint <abs>` in manifest root under
the shared 50 s deadline; parse msbuild lines; emit Claude block + Copilot channels.

**Acceptance criteria:**
- [ ] Findings ⇒ JSON with `decision: "block"`, `reason`, `hookSpecificOutput.additionalContext`, top-level `additionalContext`, and `modifiedResult` when `toolResult.resultType == "success"`; lines `<path>:<line> <RuleId> <message>`, header names file + count
- [ ] >30 findings ⇒ 30 listed + `+N more`
- [ ] Zero findings (exit 0), non-zero exit with unparseable output, `dotnet` absent from PATH, subprocess timeout ⇒ silent; stub log shows cwd = manifest root

**Verification:**
- [ ] `bash scripts/fsharp/test-fsharplint-hook.sh` passes
- [ ] Manual: `jq -nc '{tool_name:"Write",tool_input:{file_path:"<scratch>/fx/Bad.fs"}}' | python3 packages/fsharp/.apm/hooks/fsharplint_check.py` against a real-FSharpLint fixture prints block JSON

**Dependencies:** Task 1

**Files likely touched:**
- `packages/fsharp/.apm/hooks/fsharplint_check.py`
- `scripts/fsharp/test-fsharplint-hook.sh`

**Estimated scope:** S

## Checkpoint: Core
- [ ] `just test-shell` green
- [ ] Manual real-FSharpLint check done

## Task 3: Restore-and-retry within shared budget

**Description:** When lint stderr contains `dotnet tool restore`, run `dotnet tool restore`
once (same cwd, remaining budget), then retry lint once. Any failure ⇒ silent.

**Acceptance criteria:**
- [ ] Stub reports unrestored until restore runs ⇒ log shows lint, restore, lint; findings from retry emitted
- [ ] Restore exits non-zero ⇒ silent, exactly one restore call, no second lint
- [ ] Retry still reports unrestored ⇒ silent, still exactly one restore

**Verification:**
- [ ] `bash scripts/fsharp/test-fsharplint-hook.sh` passes

**Dependencies:** Task 2

**Files likely touched:**
- `packages/fsharp/.apm/hooks/fsharplint_check.py`
- `scripts/fsharp/test-fsharplint-hook.sh`

**Estimated scope:** S

## Task 4: Optional real-FSharpLint integration case

**Description:** Test case that builds a temp fixture (bare `dotnet-tools.json` pinning
`dotnet-fsharplint` 0.27.0, violating `.fs`, `fsharplint.json` disabling one rule) and runs
the hook with real `dotnet`. Skips (prints SKIP, not FAIL) when `dotnet fsharplint --version`
fails in the fixture — no network restore attempted by the test itself beyond what the hook does.

**Acceptance criteria:**
- [ ] With FSharpLint available: block JSON lists expected `FL00xx` rules with correct line numbers
- [ ] Rule disabled in fixture `fsharplint.json` is absent (proves config lookup from manifest-root cwd)
- [ ] Without FSharpLint: case reported SKIP, suite still passes

**Verification:**
- [ ] `bash scripts/fsharp/test-fsharplint-hook.sh` passes on this machine (FSharpLint 0.27.0 cached)

**Dependencies:** Task 2

**Files likely touched:**
- `scripts/fsharp/test-fsharplint-hook.sh`

**Estimated scope:** S

## Task 5: Register in marketplace, deploy, audit, amend spec

**Description:** Add `fsharp` to root `apm.yml` `marketplace.packages`, run `just install`,
check generated outputs, `just audit`. Amend spec with research results: invocation includes
`--format msbuild` before `lint`, exit 255 = findings, unrestored stderr text, resolved open
questions (Q1, Q2, Q4) removed/replaced.

**Acceptance criteria:**
- [ ] `packages/fsharp/.claude/settings.json` carries PostToolUse hook (matcher `Edit|Write|MultiEdit|edit|create`, timeout 60); `.github/hooks/` Copilot JSON generated; marketplace JSON lists `fsharp`
- [ ] `just audit` clean
- [ ] Spec Assumption 2 / Behavior steps 3–5 match implementation; Open Questions list only what's still open

**Verification:**
- [ ] `just install && just audit`
- [ ] `just test` green
- [ ] Manual: spec Success Criteria checklist walked in scratch fixture (with / without manifest entry, non-F# edit)

**Dependencies:** Tasks 1–4

**Files likely touched:**
- `apm.yml`
- `packages/fsharp/` generated outputs (`.claude/`, `.github/`, `apm.lock.yaml`)
- `docs/specs/fsharplint-hook/spec.md`

**Estimated scope:** M (mostly generated files)

## Checkpoint: Complete
- [ ] All spec Success Criteria met
- [ ] Human review; commit only when asked
