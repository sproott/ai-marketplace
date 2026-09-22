# `explain`: Rule Explanation

Print rule rationale, examples, fix guidance, and docs URL for one issue type without running analysis.

### Usage

```bash
fallow explain unused-export
fallow explain fallow/code-duplication --format json --quiet
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<issue-type>` | Issue type token or rule id, for example `unused-export`, `unused-exports`, `fallow/unused-dependency`, `high-complexity`, or `code-duplication`. |

### JSON Output Structure

```json
{
  "id": "fallow/unused-export",
  "name": "Unused Exports",
  "summary": "Export is never imported",
  "rationale": "Named exports that are never imported by any other module in the project. Includes both direct exports and re-exports through barrel files. The export may still be used locally within the same file.",
  "example": "export const formatPrice = ... exists in src/money.ts, but no module imports formatPrice.",
  "how_to_fix": "Remove the export or make it file-local. If it is public API, import it from an entry point or add an intentional suppression with context.",
  "docs": "https://docs.fallow.tools/explanations/dead-code#unused-exports"
}
```

MCP equivalent: `fallow_explain` with required `issue_type`.

---
