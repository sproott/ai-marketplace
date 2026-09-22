# `inspect`: Target Evidence Bundle

Compose one evidence bundle before editing a file or exported symbol. This is the CLI equivalent of the MCP `inspect_target` tool.

### Usage

```bash
fallow inspect --file src/api.ts --format json --quiet
fallow inspect --symbol src/api.ts:fetchUser --format json --quiet
fallow inspect --file src/api.ts --churn --format json --quiet
```

### Target Flags

| Flag | Description |
|------|-------------|
| `--file <PATH>` | Inspect one project-relative file |
| `--symbol <FILE:EXPORT>` | Inspect one exported symbol. Supporting dead-code, duplication, complexity, and security evidence is file-scoped in the first version |
| `--churn` | Add target-level git churn evidence. Off by default; missing git history is reported as `unavailable` |

Common global flags: `--format`, `--quiet`, `--root`, `--config`, `--workspace`, `--production`, `--no-cache`, `--threads`.

### JSON Output Structure

```json
{
  "kind": "inspect_target",
  "target": { "type": "file", "file": "src/api.ts" },
  "identity": {
    "file": "src/api.ts",
    "is_reachable": true,
    "is_entry_point": false,
    "export_count": 3,
    "import_count": 2,
    "imported_by_count": 1
  },
  "evidence": {
    "trace_file": { "status": "ok", "scope": "file", "data": {} },
    "dead_code": { "status": "ok", "scope": "file", "data": {} },
    "duplication": { "status": "ok", "scope": "project_filtered_to_file", "data": {} },
    "complexity": { "status": "ok", "scope": "project_filtered_to_file", "data": {} },
    "security": { "status": "ok", "scope": "file", "data": {} },
    "churn": { "status": "ok", "scope": "project_filtered_to_file", "data": {} }
  },
  "warnings": []
}
```

Each evidence section carries `status` and `scope`. The optional churn section can report `ok`, `unavailable`, or `error`. Non-fatal analysis failures become section-level errors and warnings, so callers can still use the remaining evidence.

---
