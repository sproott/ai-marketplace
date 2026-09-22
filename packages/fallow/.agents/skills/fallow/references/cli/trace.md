# `trace`: Symbol Call Chains

Walk the callers and callees of one exported symbol through the module graph. Callers are the modules that import the symbol (walked up); callees are the symbol's module's import-symbol edges plus its intra-module call sites (walked down). Best-effort and syntactic per ADR-001: resolved and unresolved callees are reported honestly, never silently dropped. This is its own surface, never folded into the ranked review brief.

The target is a positional argument, formatted as `FILE:SYMBOL` (for example `src/utils.ts:formatDate`). When neither `--callers` nor `--callees` is given, both directions are walked.

```bash
fallow trace src/utils.ts:formatDate
fallow trace src/utils.ts:formatDate --callers --depth 3
```

<!-- generated:flags:trace:start -->
| Flag | Type | Default | Description |
|---|---|---|---|
| `--path` | `string` | - | Shortest import path between two modules, as two file paths (e.g. `--path src/app.ts src/db.ts`). Mutually exclusive with the symbol target and the call-chain flags |
| `--callers` | `bool` | `false` | Walk UP to callers (modules that import the symbol). When neither `--callers` nor `--callees` is set, both directions are walked |
| `--callees` | `bool` | `false` | Walk DOWN to callees (the symbol's module's import-symbol edges plus unresolved call sites). When neither flag is set, both are walked |
| `--depth` | `string` | - | Chain depth bound for both directions (default 2). Symbol-level is best-effort, so a shallow bound keeps the trace legible |

Common global flags for this command: [`--format`](global-flags.md), [`--quiet`](global-flags.md), [`--root`](global-flags.md), [`--config`](global-flags.md).
<!-- generated:flags:trace:end -->

---
