# Plan: fsharplint-hook

Specs touched:

- creates: docs/specs/fsharplint-hook/spec.md

## Overview

New APM package `packages/fsharp` shipping one PostToolUse hook, `fsharplint_check.py`.
After an `Edit`/`Write`/`MultiEdit` (Claude Code) or `edit`/`create` (Copilot CLI) on a
`.fs`/`.fsx` file, it walks up to the nearest dotnet tool manifest; if that manifest lists
`dotnet-fsharplint`, it lints the one file and returns findings as a blocking error. Every
other path, including hook breakage, is silent.

## Research Results (spec open questions, resolved by running FSharpLint 0.27.0, .NET SDK 10.0.112)

1. **Output format.** `--format msbuild` exists and is a *global* option — it must precede
   the subcommand: `dotnet fsharplint --format msbuild lint <abs path>`. After `lint` it is
   rejected. Findings go to **stdout**, one per line:

   ```
   /abs/Bad.fs(3,16,3,48):FSharpLint warning FL0065: `if a then true else false` might be able to be refactored into `a`.
   ```

   Parser regex: `^(?P<path>.+)\((?P<line>\d+),(?P<col>\d+),\d+,\d+\):FSharpLint (?:warning|error) (?P<rule>FL\d+): (?P<msg>.*)$`.
   Other stdout lines (`Running FSharpLint…`, `========== Linting …`, `Finished: N warnings`)
   are noise to skip. The default (non-msbuild) format is multi-line and not worth parsing.
2. **Exit codes.** `0` = clean, `255` = findings present. A file that fails to parse yields
   `0 warnings`, exit 0 (silent — fine). Parser keys on parsed lines, not exit code; exit
   code only disambiguates "non-zero + zero findings" ⇒ tool failure ⇒ silent.
3. **Unrestored tool.** Manifest pins a version absent from the cache ⇒ stderr
   `Run "dotnet tool restore" to make the "dotnet-fsharplint" command available.`, exit 1.
   Detect on substring `dotnet tool restore` in stderr.
4. **Command name.** Manifest command is `dotnet-fsharplint`; `dotnet fsharplint` resolves
   to it (dotnet strips the `dotnet-` prefix). Keep spec's spelling.
5. **Manifest location.** .NET 10 `dotnet new tool-manifest` writes a bare
   `dotnet-tools.json` at the root (not `.config/`). Spec already walks both; tests must
   cover both.
6. **Latency.** Warm single-file lint ≈ 2.1 s. `.fsx` lints fine. 60 s hook / 50 s
   subprocess budget holds for warm runs; a cold first restore may exceed it ⇒ silent,
   next edit retries (spec Q4: keep 60 s).

## Architecture Decisions

- **Invocation**: `["dotnet", "fsharplint", "--format", "msbuild", "lint", str(abs_path)]`,
  cwd = manifest root, `capture_output=True, text=True`. Spec Assumption 2 / Behavior step 3
  get amended to include `--format msbuild` (Task 5).
- **Shared budget**: one `deadline = time.monotonic() + 50`; each subprocess call gets
  `timeout=deadline - time.monotonic()`, skipped if ≤ 0. Covers lint → restore → lint.
- **Copilot `toolArgs` is a JSON string** (see `scripts/rtk/rtk-hook-io.sh` and
  `test-rtk-shim-gate.sh` fixtures). Hook `json.loads` it when it is a `str`. Relative
  paths resolve against cwd (hook `cd`s to `$CLAUDE_PROJECT_DIR`).
- **Output**: reuse the shape of `output_for` from `comment_style_check.py` (copied, not
  imported — separate package; spec forbids touching `personal`), adding top-level
  `"decision": "block", "reason": text`.
- **Lines in report**: `<path as given in payload>:<line> <RuleId> <message>`, sorted by
  line, capped at 30 + `… +N more`.
- **Tests**: bash + `jq`, stub `dotnet` in a temp dir prepended to `PATH`. Stub behaviour
  driven by env vars (`STUB_LINT_OUT`, `STUB_LINT_EXIT`, `STUB_RESTORE_EXIT`,
  `STUB_UNRESTORED=1` until restore called) and logs every invocation + cwd to a file so
  tests assert "not spawned", cwd, and restore count. "dotnet absent" = PATH without stub
  and without real dotnet (`PATH=<stubdir-empty>:/usr/bin:/bin` minus `/bin/dotnet` —
  real dotnet lives at `/bin/dotnet` here, so use a PATH holding only a dir with a
  `python3` symlink).
- **Package layout** mirrors `packages/rules-on-create` (apm.yml, `.gitignore` with
  `apm_modules/` and `__pycache__/`, `.apm/hooks/`). Generated outputs committed as for
  siblings.

## Dependency Graph

```
apm.yml + hook json + script skeleton (silent gates)   ← Task 1 (+ test harness, justfile)
        │
        ├── lint + parse + block output                 ← Task 2
        │        │
        │        └── restore + retry                    ← Task 3
        │        │
        │        └── real-FSharpLint integration case   ← Task 4
        │
        └── marketplace entry + apm install + audit + spec amendments  ← Task 5
```

## Task List

### Phase 1: Foundation

- [ ] Task 1: Package skeleton, test harness, silent-exit gates
- [ ] Task 2: Lint, parse, emit block response

### Checkpoint: Core

- [ ] `just test-shell` green (rtk + fsharp tests)
- [ ] Manual pipe of a payload against scratch fixture with real FSharpLint yields block JSON

### Phase 2: Robustness

- [ ] Task 3: Restore-and-retry within shared budget
- [ ] Task 4: Optional real-FSharpLint integration case

### Phase 3: Ship

- [ ] Task 5: Register in marketplace, deploy, audit, amend spec

### Checkpoint: Complete

- [ ] All spec Success Criteria met
- [ ] `just audit` clean
- [ ] Human review before commit (batch commit, only on request)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| FSharpLint changes msbuild line format in a future version | Med | Task 4 integration case pins it; parser failure ⇒ silent, not wrong block |
| FSharpLint doesn't pick up `fsharplint.json` from manifest-root cwd | Med | Task 4 fixture includes an `fsharplint.json` disabling one rule and asserts it's absent |
| Copilot drops `additionalContext`, and `modifiedResult` only fires on `resultType == "success"` | Med | Same dual channel as `comment_style_check.py`; accept |
| Cold `dotnet tool restore` exceeds 50 s budget | Low | Silent; next edit retries with warm cache |
| APM hook `command` path rewriting differs for a new package | Low | Copy `rules-on-create.json` command shape exactly; verify generated `.claude/settings.json` in Task 5 |
| Stale scratch fixture state leaks into tests | Low | Tests build their own temp dirs, `trap` cleanup |

## Open Questions

1. Copilot CLI PostToolUse block equivalent (spec Q3) — not verifiable offline. Plan keeps
   `additionalContext` + `modifiedResult`. `scripts/copilot-hook-probe.sh` could confirm
   payload keys for `edit`/`create`; run it before Task 2 if you want certainty.
2. Side finding, out of scope: `comment_style_check.py` reads `toolArgs` as a dict, but
   Copilot CLI sends a JSON string ⇒ that hook is silently a no-op on Copilot. Spec forbids
   touching `personal` here; track separately?
