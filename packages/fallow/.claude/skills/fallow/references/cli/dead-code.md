# `dead-code`: Dead Code Analysis

Analyzes the project for unused files, exports, dependencies, types, members, and more. Running `fallow` with no subcommand runs all analyses (dead code + duplication + complexity). Use `fallow dead-code` for dead code only.

### Flags

<!-- generated:flags:dead-code:start -->
| Flag | Type | Default | Description |
|---|---|---|---|
| `--include-dupes` | `bool` | `false` | Cross-reference with duplication findings |
| `--trace` | `string` | - | Trace export usage chain |
| `--trace-file` | `string` | - | Show all edges for a file |
| `--trace-dependency` | `string` | - | Trace where a dependency is used |
| `--impact-closure` | `string` | - | Compute the impact closure for a file (the transitive affected-but-not-in-diff set + coordination gap). Walks reverse-deps and re-export chains; powers the `inspect_target` MCP tool |
| `--symbol-impact` | `string` | - | Compute exact-symbol consumers, affected files, and targeted tests |
| `--top` | `string` | - | Show only the top N items per category |
| `--file` | `string` | - | Scope output to specific files. Only issues in the specified files are reported. Project-wide dependency issues are suppressed. Warns on non-existent paths. Useful for lint-staged |

Common global flags for this command: [`--format`](global-flags.md), [`--quiet`](global-flags.md), [`--output-file`](global-flags.md), [`--changed-since`](global-flags.md), [`--max-file-size`](global-flags.md), [`--production`](global-flags.md), [`--no-production`](global-flags.md), [`--production-dead-code`](global-flags.md), [`--baseline`](global-flags.md), [`--save-baseline`](global-flags.md), [`--workspace`](global-flags.md), [`--changed-workspaces`](global-flags.md), [`--include-entry-exports`](global-flags.md).
<!-- generated:flags:dead-code:end -->
### Issue Type Filters

<!-- generated:flags:dead-code-filters:start -->
| Flag | Issue Type |
|---|---|
| `--unused-files` | Unused files |
| `--unused-exports` | Unused exports |
| `--unused-deps` | Unused dependencies, devDependencies, optionalDependencies, type-only production deps, and test-only production deps |
| `--unused-types` | Unused types |
| `--private-type-leaks` | Opt-in API hygiene check (default `off`) for exported signatures that reference same-file private types. Storybook `*.stories.*` story files and framework routing convention files (Next.js App + Pages Router, Gatsby, Remix v2, TanStack Router, Expo Router) are skipped to avoid noise. Enable via this flag or `private-type-leaks: "warn"` / `"error"` in [`rules`](configuration-file-format.md). |
| `--unused-enum-members` | Unused enum members |
| `--unused-class-members` | Unused class members |
| `--unused-store-members` | Unused Pinia store members |
| `--unprovided-injects` | inject() / getContext() reads a key that no provide() / setContext() supplies |
| `--unrendered-components` | A Vue / Svelte component is reachable through a barrel but rendered nowhere |
| `--unused-component-props` | A Vue defineProps prop or React component prop is referenced nowhere in its own component |
| `--unused-component-emits` | A Vue <script setup> defineEmits event is emitted nowhere in its own component |
| `--unused-component-inputs` | An Angular @Input() / signal input() / model() is read nowhere in its own component (class body or template); needs `@angular/core` dep |
| `--unused-component-outputs` | An Angular @Output() / signal output() is emitted (.emit()) nowhere in its own component; needs `@angular/core` dep |
| `--unused-svelte-events` | A Svelte createEventDispatcher event is listened to nowhere in the project |
| `--unused-server-actions` | A Next.js Server Action exported from a "use server" file is referenced by no code in the project |
| `--unused-load-data-keys` | A SvelteKit load() return-object key is read by no consumer |
| `--unresolved-imports` | Unresolved imports |
| `--unlisted-deps` | Unlisted dependencies |
| `--duplicate-exports` | Duplicate exports |
| `--circular-deps` | Circular dependencies |
| `--re-export-cycles` | Re-export cycles (`kind: multi-node` for barrel files re-exporting from each other in a loop, `kind: self-loop` for a barrel re-exporting from itself). File-scoped finding; chain propagation through the loop is a no-op so imports may silently come up empty. Distinct from `--circular-deps` (runtime cycles). |
| `--boundary-violations` | Boundary violations (imports crossing architecture zone boundaries, unzoned source files when `boundaries.coverage.requireAllFiles` is set, and forbidden calls from `boundaries.calls.forbidden`; suppression token `boundary-violation`, with `boundary-call-violation` and `boundary-call-violations` accepted as aliases for the whole family) |
| `--policy-violations` | Rule-pack policy violations (banned calls, imports, and catalogue-derived effects declared via the `rulePacks` config key) |
| `--stale-suppressions` | Stale suppression comments or `@expected-unused` JSDoc tags |
| `--unused-catalog-entries` | Unused pnpm catalog entries |
| `--empty-catalog-groups` | Empty named pnpm catalog groups |
| `--unresolved-catalog-references` | Package references to missing pnpm catalog entries |
| `--unused-dependency-overrides` | Unused package-manager dependency overrides |
| `--misconfigured-dependency-overrides` | Misconfigured package-manager dependency overrides |
<!-- generated:flags:dead-code-filters:end -->
### Examples

```bash
# Full analysis with JSON output
fallow dead-code --format json --quiet

# Only unused exports
fallow dead-code --format json --quiet --unused-exports

# PR check: only changed files
fallow dead-code --format json --quiet --changed-since main --fail-on-issues

# CI mode with SARIF upload
fallow dead-code --ci

# Production-only analysis
fallow dead-code --format json --quiet --production

# Single workspace package
fallow dead-code --format json --quiet --workspace my-package

# Multiple workspaces: comma-separated
fallow dead-code --format json --quiet --workspace web,admin

# Glob (matches package name OR relative path)
fallow dead-code --format json --quiet --workspace 'apps/*'

# Exclude a workspace from the set
fallow dead-code --format json --quiet --workspace 'apps/*,!apps/legacy'

# Monorepo CI: auto-scope to workspaces containing any file changed since origin/main
fallow dead-code --format json --quiet --changed-workspaces origin/main

# Debug: trace an export
fallow dead-code --format json --quiet --trace src/utils.ts:myFunction

# Incremental adoption with baseline
fallow dead-code --format json --quiet --save-baseline fallow-baselines/dead-code.json
fallow dead-code --format json --quiet --baseline fallow-baselines/dead-code.json --fail-on-issues

# Regression detection: update regression.baseline in the discovered config
fallow dead-code --format json --quiet --save-regression-baseline
# Then compare on PRs
fallow dead-code --format json --quiet --fail-on-regression --tolerance 2%

# Scope to specific files (e.g., lint-staged)
fallow dead-code --format json --quiet --file src/utils.ts --file src/helpers.ts

# Catch typos in entry file exports
fallow dead-code --format json --quiet --include-entry-exports
```

---
