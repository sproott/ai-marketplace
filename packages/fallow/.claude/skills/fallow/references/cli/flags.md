# `flags`: Feature Flag Detection

Detects feature flag patterns in the codebase. Identifies environment variable flags (`process.env.FEATURE_*`), SDK calls from common providers (LaunchDarkly, Statsig, Unleash, GrowthBook, Split, PostHog, Vercel Flags, ConfigCat, Flagsmith, Optimizely, Eppo), and config object patterns (opt-in). Reports flag locations, detection confidence, and cross-references with dead code findings.

### Flags

<!-- generated:flags:flags:start -->
| Flag | Type | Default | Description |
|---|---|---|---|
| `--top` | `string` | - | Show only the top N flags |

Common global flags for this command: [`--format`](global-flags.md), [`--quiet`](global-flags.md), [`--changed-since`](global-flags.md), [`--workspace`](global-flags.md).
<!-- generated:flags:flags:end -->
### Examples

```bash
# Detect all feature flags with JSON output
fallow flags --format json --quiet

# Top 10 flags
fallow flags --format json --quiet --top 10

# Single workspace package
fallow flags --format json --quiet --workspace my-package
```

### JSON Output Structure

```json
{
  "schema_version": 7,
  "version": "3.25.0",
  "elapsed_ms": 116,
  "feature_flags": [],
  "total_flags": 0
}
```

---
