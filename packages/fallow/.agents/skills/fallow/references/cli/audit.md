# `audit`: Changed-File Quality Gate

Audits changed files for dead code, complexity, duplication, and styling. Returns a verdict (pass/warn/fail). Purpose-built for PR quality gates and reviewing AI-generated code. When `--base` is not set, the base is the `git merge-base` against the branch's upstream or the remote default (`origin/HEAD`, `origin/main`, `origin/master`); set `FALLOW_AUDIT_BASE` to pin it without a flag. Defaults to `--gate new-only`, which fails only on findings introduced by the current changeset and reports inherited findings as context.

### Flags

<!-- generated:flags:audit:start -->
| Flag | Type | Default | Description |
|---|---|---|---|
| `--production-dead-code` | `bool` | `false` | Per-analysis production mode for the dead-code sub-analysis only |
| `--production-health` | `bool` | `false` | Per-analysis production mode for the health sub-analysis only |
| `--production-dupes` | `bool` | `false` | Per-analysis production mode for the duplication sub-analysis only |
| `--dead-code-baseline` | `string` | - | Baseline file (produced by `fallow dead-code --save-baseline`). Pre-existing dead-code issues are excluded from the verdict. |
| `--health-baseline` | `string` | - | Baseline file (produced by `fallow health --save-baseline`). Pre-existing complexity findings are excluded from the verdict. |
| `--dupes-baseline` | `string` | - | Baseline file (produced by `fallow dupes --save-baseline`). Pre-existing clone groups are excluded from the verdict. |
| `--max-crap` | `string` | - | Forwarded to the health sub-analysis. Functions meeting or exceeding this CRAP score cause audit to fail. Same formula as `health --max-crap`. Pair with coverage data for accurate per-function CRAP. |
| `--coverage` | `string` | - | Path to Istanbul-format coverage data (`coverage-final.json`) for accurate per-function CRAP scores in the health sub-analysis. Same format and semantics as `health --coverage`. Also configurable via `FALLOW_COVERAGE`, then `health.coverage` (the same chain as `fallow health`). Relative paths resolve against `--root`. |
| `--coverage-root` | `string` | - | Absolute prefix to strip from file paths in coverage data before prepending the project root. Also configurable via `FALLOW_COVERAGE_ROOT`, then `health.coverageRoot`. Use when coverage was generated under a different checkout root in CI / Docker (e.g., `/home/runner/work/myapp` on GitHub Actions). |
| `--no-css` | `bool` | `false` | Disable styling analytics in audit |
| `--css-deep` | `bool` | `false` | Enable deep CSS analysis for audit explicitly: project-wide styling reachability, narrowed back to changed anchors. Deep CSS is on by default; use this to override `audit.cssDeep = false` |
| `--no-css-deep` | `bool` | `false` | Disable deep CSS analysis while keeping local styling analytics on |
| `--gate` | `new-only\|all` | - | Which findings affect the verdict. `new-only` gates only introduced findings; `all` gates every finding in changed files and skips the extra base-snapshot attribution pass. |
| `--runtime-coverage` | `string` | - | Paid runtime-coverage sidecar input. Accepts a V8 directory, a single V8 JSON file, or an Istanbul coverage map JSON. Spawns the `fallow-cov` sidecar as part of the audit pipeline so the `hot-path-touched` verdict surfaces alongside dead-code and complexity findings without requiring a second `fallow health` invocation in CI. License-gated; the verdict is informational (no exit code change) until a future `--gate hot-path-touched` knob lands |
| `--min-invocations-hot` | `string` | `100` | Threshold for hot-path classification, forwarded to the sidecar when `--runtime-coverage` is set |
| `--gate-marker` | `string` | - | Internal marker identifying a gate run (e.g. `pre-commit`), set by the generated git hook so Fallow Impact can record a containment event when the gate blocks then clears. Hidden; never changes the verdict, exit code, or output |
| `--brief` | `bool` | `false` | Render the deterministic review brief instead of the gating audit report. The brief answers "where do I look?" rather than "will CI block this?", runs the same analysis, and ALWAYS exits 0 (the verdict is carried informationally). Implied by `fallow review`. Orthogonal to `--format` |
| `--max-decisions` | `string` | `4` | Cap on the number of consequential structural decisions surfaced in the review brief's decision surface (the working-memory limit). Default 4; clamped to the 3-5 band (4 plus or minus 1). Only consulted on the brief path |
| `--walkthrough-guide` | `bool` | `false` | Emit the agent-contract WALKTHROUGH GUIDE: the current digest (brief + decision surface), the review direction, the JSON schema the agent must return, and a deterministic graph-snapshot hash pinned into the digest. The digest is built from the graph only (PR prose is never folded in, so it is injection-resistant). Implies the brief; always exits 0. A thin agent skill calls this to fetch the current guide, produces judgment JSON, then reopens with `--walkthrough-file` |
| `--walkthrough-file` | `string` | - | Ingest an agent's judgment JSON and POST-VALIDATE it against the LIVE graph. Rejects any judgment whose `signal_id` fallow did not emit (anti-hallucination); refuses the whole payload as stale when the echoed graph-snapshot hash no longer matches (the tree moved). The verifier is the graph, not a second model. Implies the brief; always exits 0. The agent's free-text framing is fenced as non-deterministic and never gates or auto-posts |
| `--walkthrough` | `bool` | `false` | Render the existing walkthrough guide as a staged HUMAN terminal tour (Stage 1 load-bearing / Stage 2 mechanical), or markdown with `--format markdown`. Implies the brief; always exits 0. `--format json --walkthrough` emits the same agent-contract JSON as `--walkthrough-guide` |
| `--mark-viewed` | `string` | - | Record one or more changed files as VIEWED in the local walkthrough viewed-state ledger (`.fallow/walkthrough-state.json`), then render the tour. Files already viewed (and still current) collapse into the Cleared panel. Repeatable. Stale marks (the tree moved) are ignored on render but never deleted. Only consulted on the `--walkthrough` path |
| `--show-cleared` | `bool` | `false` | Expand the Cleared panel in the human/markdown walkthrough tour: list each de-prioritized and already-viewed file instead of the collapsed one-line summary. Only consulted on the `--walkthrough` path |
| `--show-deprioritized` | `bool` | `false` | Expand the de-prioritized units in the review brief's weighted focus map ("show me what you de-prioritized"). The `deprioritized` escape-hatch list is ALWAYS present in `--format json` regardless; this flag only re-expands the collapse-by-default human focus render. Only consulted on the brief path |

Common global flags for this command: [`--format`](global-flags.md), [`--quiet`](global-flags.md), [`--changed-since`](global-flags.md), [`--diff-file`](global-flags.md), [`--diff-stdin`](global-flags.md), [`--workspace`](global-flags.md), [`--changed-workspaces`](global-flags.md), [`--group-by`](global-flags.md), [`--output-file`](global-flags.md).
<!-- generated:flags:audit:end -->
### Verdicts

| Verdict | Exit code | When |
|---------|-----------|------|
| pass | 0 | No issues in changed files |
| warn | 0 | Issues found, all warn-severity |
| fail | 1 | Error-severity issues found |
| error | 2 | Runtime error (invalid ref, not a git repo) |

With `--gate new-only`, inherited error-severity findings can be present in the JSON output while the verdict remains `pass`; check the `attribution` object and per-finding `introduced` booleans.

### JSON contract: which fields are severity-aware

| Field | Severity-aware? | What it counts |
|-------|-----------------|----------------|
| `verdict` | **yes** | Overall outcome honoring per-rule severity (`pass` / `warn` / `fail`) |
| `attribution.*_introduced` | no | Findings introduced by the changeset under `gate: new-only`, ignoring severity |
| `summary.*` | no | All findings in changed files, ignoring severity |
| Per-finding `introduced` | no | Whether each finding was introduced by the changeset |

For CI gating and any "did this PR pass?" question, read `verdict` (or exit code). Counting introduced findings ignores severity and breaks projects with `unused-exports: warn`. For agent triage, read `verdict` first, then `attribution` for new-vs-inherited counts, then the per-category finding arrays for actionable details.

### Examples

```bash
# Auto-detect base branch
fallow audit --format json --quiet

# Explicit base ref
fallow audit --format json --quiet --base main

# Audit last 3 commits
fallow audit --format json --quiet --base HEAD~3

# Strict mode: fail on inherited findings too
fallow audit --format json --quiet --gate all

# Production code only in a monorepo workspace
fallow audit --format json --quiet --production --workspace @app/api

# Production-only health, full-tree dead-code and dupes
fallow audit --format json --quiet --production-health --workspace @app/api

# CI mode (SARIF + fail on issues + quiet)
fallow audit --ci

# Per-analysis baselines: only fail on genuinely new issues
fallow audit \
  --dead-code-baseline fallow-baselines/dead-code.json \
  --health-baseline    fallow-baselines/health.json \
  --dupes-baseline     fallow-baselines/dupes.json
# Or set these under `audit.*Baseline` in .fallowrc.json so `fallow audit` picks them up with no flags.
# The global --baseline / --save-baseline flags are REJECTED on audit (exit 2) because each sub-analysis uses a different baseline format.
```

### JSON Output Structure

```json
{
  "kind": "audit",
  "schema_version": 7,
  "version": "3.25.0",
  "command": "audit",
  "verdict": "fail",
  "changed_files_count": 12,
  "base_ref": "611d151e8250146426ff3178e94207f8a8d3cc7b",
  "base_description": "merge-base with origin/main",
  "head_sha": "d4a2f91",
  "elapsed_ms": 2140,
  "summary": {
    "dead_code_issues": 2,
    "dead_code_has_errors": true,
    "complexity_findings": 1,
    "max_cyclomatic": 28,
    "duplication_clone_groups": 0
  },
  "attribution": {
    "gate": "new-only",
    "dead_code_introduced": 2,
    "dead_code_inherited": 0,
    "complexity_introduced": 1,
    "complexity_inherited": 0,
    "duplication_introduced": 0,
    "duplication_inherited": 0,
    "styling_introduced": 0,
    "styling_inherited": 0
  },
  "dead_code": {
    "schema_version": 3,
    "total_issues": 2,
    "unused_exports": [{ "path": "src/api.ts", "export_name": "oldApi", "introduced": true, "actions": [...] }]
  },
  "complexity": {
    "findings": [...]
  },
  "duplication": {
    "clone_groups": []
  }
}
```

The `verdict` field is always present and is the primary decision signal. With the default `new-only` gate, the `attribution` object counts introduced vs inherited findings across dead code, complexity, duplication, and styling, and audit sub-results annotate individual findings with `introduced: true/false`. With `gate=all`, audit skips that extra base-snapshot attribution pass, so introduced/inherited counts stay `0` and per-finding `introduced` fields are omitted. Dead code, complexity, and duplication sections follow their respective schemas from the individual commands. Thresholds for complexity are inherited from `fallow health` config (defaults: cyclomatic 20, cognitive 15).

Audit creates a temporary git worktree to compare against the base ref. When the current checkout has `node_modules`, audit links it into the base worktree so tsconfig `extends` chains into installed packages and path aliases resolve like the working tree. The worktree is removed on normal exit. If the process is force-killed, run `git worktree prune` to clean up stale `.git/worktrees/fallow-audit-base-*` entries.

---
