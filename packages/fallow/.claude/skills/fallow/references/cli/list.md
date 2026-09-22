# `list`: Project Introspection

Inspect discovered files, entry points, detected frameworks, and architecture boundary zones.

### Flags

<!-- generated:flags:list:start -->
| Flag | Type | Default | Description |
|---|---|---|---|
| `--entry-points` | `bool` | `false` | List detected entry points |
| `--files` | `bool` | `false` | List all discovered files |
| `--plugins` | `bool` | `false` | List active framework plugins |
| `--boundaries` | `bool` | `false` | Show architecture boundary zones, rules, per-zone file counts, and `logical_groups[]` for `autoDiscover` parents |
| `--workspaces` | `bool` | `false` | Show discovered monorepo workspaces plus any workspace-discovery diagnostics (malformed `package.json`, unreachable glob matches, missing tsconfig references). Available as the `fallow workspaces` alias too. |

Common global flags for this command: [`--format`](global-flags.md), [`--quiet`](global-flags.md).
<!-- generated:flags:list:end -->
### Examples

```bash
fallow list --files --format json --quiet
fallow list --entry-points --format json --quiet
fallow list --plugins --format json --quiet
fallow list --boundaries --format json --quiet
fallow list --workspaces --format json --quiet
fallow workspaces --format json --quiet  # alias of `fallow list --workspaces`
```

The `--workspaces` JSON output carries `workspaces[]` (name, project-root-relative path, `is_internal_dependency` bool) plus `workspace_diagnostics[]`. Each diagnostic has a `kind` discriminator (`undeclared-workspace`, `malformed-package-json`, `glob-matched-no-package-json`, `malformed-tsconfig`, `tsconfig-reference-dir-missing`, `malformed-pnpm-workspace-yaml`, `skipped-large-file`, `skipped-minified-file`, `skipped-source-dotdir`, `source-read-failure`, `bun-lockb-override-resolution-skipped`) with a typed payload (`error`, `pattern`, or none), and a `path` that is project-root-relative with forward slashes on every envelope that carries the array. The same `workspace_diagnostics[]` array is also surfaced on the `fallow dead-code --format json`, `fallow dupes --format json`, and `fallow health --format json` envelopes, at the top level of the bare combined `fallow --format json` envelope, on `fallow audit --format json` under `dead_code`, and on the `audit-brief` envelope shared by `fallow review --format json` and `fallow audit --brief --format json`, also under `dead_code` (omitted when empty). The combined carrier is the envelope root, not a section, so `--skip check`, `--only health`, and `--only dupes` all still report what their analyses recorded. The combined root is the union of what every analysis in the run recorded, deduplicated on the whole `kind` (typed payload included) plus `path`, so two overlapping globs still report the same package-less directory once per `pattern` (a declared glob's no-op `./` prefix is normalised away, so one glob written `"./apps/**"` in `package.json` and `apps/**` in `pnpm-workspace.yaml` stays one entry): a combined run walks the project once per analysis, and a per-analysis `production` mode (`production: { deadCode, health, dupes }`, `--production-health`) can give those walks different file sets, so only the union reports what the run as a whole saw. Each analysis contributes the workspace-discovery list its own config load produced, the same list `fallow list --workspaces` reports, so the combined root can carry an `undeclared-workspace` or `glob-matched-no-package-json` entry that the standalone `dead-code`, `check`, `health`, and `dupes` envelopes, which read the process diagnostics registry instead, do not. `fallow audit --format json` and the `audit-brief` envelope are on the same broad side: they fold the dead-code analysis's own list into their `dead_code.workspace_diagnostics[]`, so they too report an `undeclared-workspace` entry the standalone envelopes miss. The CLI and the programmatic route (MCP code mode, NAPI, embedders) agree on everything an analysis records: both folds close with the same process-registry read, which covers what an analysis records after its section captured its list (a `source-read-failure`, or the analysis-stage kinds a health run's own dead-code precompute records) and skips `skipped-large-file`, `skipped-minified-file`, and `skipped-source-dotdir`, since those reach an envelope only from the walk that recorded them. The two analysis-stage kinds (`malformed-pnpm-workspace-yaml`, `bun-lockb-override-resolution-skipped`) are recorded by the dead-code analyze pass, so they only appear on runs that include it: `fallow dupes --format json` and `fallow --only dupes` report the workspace-discovery and source-discovery kinds alone. A malformed ROOT `package.json` exits 2 at config load; everything else warns and continues.

The `--boundaries` JSON output carries `boundaries.logical_groups[]` alongside the existing `zones[]` / `rules[]` arrays. Each logical-group entry surfaces a user-authored `autoDiscover` parent zone (which expansion otherwise flattens into per-child zones like `features/auth` / `features/billing`): `name`, `children`, `auto_discover` (verbatim user strings), `status` (`ok` / `empty` / `invalid_path`), `source_zone_index`, summed `file_count`, optional `authored_rule` (the pre-expansion `{ allow, allowTypeOnly }` keyed on the parent), optional `fallback_zone` cross-reference when the parent also kept its own `patterns` (Bulletproof case), optional `merged_from` (parent zone indices when the user declared the same parent name twice; surfaces the duplicate in JSON instead of only in `tracing::warn!`), optional `original_zone_root` (echo of the parent's `root` subtree scope for monorepo patchers), and optional `child_source_indices` (parallel to `children`, attributing each child to a specific `auto_discover` entry when multiple paths were authored). The full shape is documented in `docs/output-schema.json` under `ListBoundariesOutput`.

---
