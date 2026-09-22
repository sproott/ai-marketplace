# Configuration File Format

Config files are searched in priority order: `.fallowrc.json` > `.fallowrc.jsonc` > `fallow.toml` > `.fallow.toml`. Both `.fallowrc.json` and `.fallowrc.jsonc` are parsed as JSON-with-comments; the `.jsonc` extension lets editors auto-detect JSONC syntax highlighting.

### JSON Format (`.fallowrc.json` / `.fallowrc.jsonc`)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",

  // Entry points (glob patterns)
  "entry": ["src/index.ts", "scripts/*.ts"],

  // Files to ignore (glob patterns)
  "ignorePatterns": ["**/*.generated.ts", "**/*.d.ts"],

  // Dependencies to ignore
  "ignoreDependencies": ["autoprefixer"],

  // Suppress unused-export findings when the symbol is referenced inside its
  // declaring file (knip parity). Boolean or { type, interface } object form.
  "ignoreExportsUsedInFile": true,

  // Per-issue-type severity
  "rules": {
    "unused-files": "error",
    "unused-exports": "warn",
    "unused-types": "off",
    "unused-dependencies": "error",
    "unused-dev-dependencies": "warn",
    "unused-enum-members": "error",
    "unused-class-members": "warn",
    "unresolved-imports": "error",
    "unlisted-dependencies": "error",
    "duplicate-exports": "warn",
    "circular-dependencies": "warn",
    "boundary-violation": "error",
    "type-only-dependencies": "error",
    "test-only-dependencies": "warn",
    "stale-suppressions": "warn"
  },

  // Per-path rule overrides
  "overrides": [
    {
      "files": ["*.test.ts", "*.spec.ts"],
      "rules": { "unused-exports": "off" }
    }
  ],

  // Duplication settings
  "duplicates": {
    "mode": "mild",
    "near": false,
    "minTokens": 50,
    "minLines": 5,
    "threshold": 0,
    "ignoreDefaults": true,
    "ignoredClones": ["dup:6f12ab34:2"],
    "skipLocal": false,
    "ignorePatterns": ["**/*.generated.ts"]
  },

  // Extraction cache settings. FALLOW_CACHE_DIR overrides cache.dir.
  "cache": {
    "dir": "/tmp/fallow-cache",
    "maxSizeMb": 256
  },

  // Architecture boundaries (preset, custom zones/rules, or auto-discovered feature zones)
  // Presets: "layered", "hexagonal", "feature-sliced", "bulletproof"
  // Rules accept an optional `allowTypeOnly: [zones]` list that admits type-only imports
  // (`import type`, inline `{ type Foo }`, namespace type imports, and `export type` re-exports)
  // to the listed zones even when not present in `allow`. Mixed-specifier imports still fire.
  "boundaries": {
    "preset": "bulletproof"
    // Or:
    // "zones": [
    //   { "name": "app", "patterns": ["src/app/**"] },
    //   { "name": "features", "patterns": ["src/features/**"], "autoDiscover": ["src/features"] },
    //   { "name": "shared", "patterns": ["src/shared/**"] }
    // ],
    // "rules": [
    //   { "from": "app", "allow": ["features", "shared"] },
    //   { "from": "features", "allow": ["shared"], "allowTypeOnly": ["features"] }
    // ]
  },

  // Resolve framework convention auto-imports (Nuxt components) as graph edges.
  // Edges for `<Card001 />`-style template tags are always synthesized; setting
  // this to true also drops the Nuxt component entry patterns so an
  // unreferenced component is reported as unused-file. Kept conservative: a
  // `components:` key in nuxt.config keeps the entry patterns. Default false.
  "autoImports": false,

  // Production mode
  "production": false,

  // Workspace packages that are public libraries.
  // Exported API surface from these packages is not flagged as unused.
  "publicPackages": ["@myorg/shared-lib", "@myorg/utils"],

  // Glob patterns for files that are dynamically loaded at runtime.
  // These files are treated as always-used and never flagged as unused.
  "dynamicallyLoaded": ["plugins/**/*.ts", "locales/**/*.json"],

  // Inherit from base config (prefer local paths or trusted npm packages)
  "extends": ["./base-config.json", "npm:@my-org/fallow-config"],

  // Custom external plugins
  "plugins": ["tools/plugins/"],

  // Inline framework definitions
  "framework": [
    {
      "name": "my-framework",
      "enablers": ["my-framework"],
      "entryPoints": ["src/routes/**/*.ts"]
    }
  ]
}
```

### TOML Format (`fallow.toml`)

```toml
entry = ["src/index.ts", "scripts/*.ts"]
ignorePatterns = ["**/*.generated.ts"]
ignoreDependencies = ["autoprefixer"]
ignoreExportsUsedInFile = true
production = false
publicPackages = ["@myorg/shared-lib", "@myorg/utils"]
dynamicallyLoaded = ["plugins/**/*.ts", "locales/**/*.json"]

[rules]
unused-files = "error"
unused-exports = "warn"
unused-types = "off"

[duplicates]
mode = "mild"
near = false
minTokens = 50
minLines = 5
ignoreDefaults = true
ignoredClones = ["dup:6f12ab34:2"]

[[overrides]]
files = ["*.test.ts"]
[overrides.rules]
unused-exports = "off"

[boundaries]
preset = "bulletproof"
```

### Configuration field notes

- `ignoreExportsUsedInFile`: knip-compatible; suppress unused-export findings when the exported symbol is referenced inside the file that declares it. Boolean (`true` covers all kinds) or `{ "type": true, "interface": true }` object form for knip parity. Fallow groups type aliases and interfaces under the same `unused-types` issue, so both type-kind fields behave identically. References inside the export specifier itself (`export { foo }`, `export default foo`) do not count as same-file uses; those exports are still reported when no other in-file expression references the binding
- `publicPackages`: workspace packages that are public libraries; exported API surface from these packages is not flagged as unused
- `dynamicallyLoaded`: glob patterns for files loaded at runtime (plugin dirs, locale files); treated as always-used
- `cache.dir`: override the persistent extraction cache directory. `FALLOW_CACHE_DIR` wins over this config field, and `--no-cache` disables caching entirely
- `cache.maxSizeMb`: cap the serialized extraction cache size in megabytes. `FALLOW_CACHE_MAX_SIZE` wins over this config field
- `usedClassMembers`: class method/property names that extend the built-in Angular/React lifecycle allowlist with framework-invoked names. Each entry is a plain string (global suppression) or a scoped object `{ extends?, implements?, members }` matching only classes with the given heritage. Strings can be exact names (`"agInit"`) or glob patterns (`"*"` matches every member, `"enter*"` prefix, `"*Handler"` suffix, `"on*Event"` combined). Use scoped rules for common names like `refresh` or `execute` to avoid false negatives on unrelated classes; global strings for unique names like `agInit`. Example: `["agInit", { "implements": "ICellRendererAngularComp", "members": ["refresh"] }, { "extends": "BaseCommand", "members": ["execute"] }, { "extends": "GrammarBaseListener", "members": ["enter*", "exit*"] }]`. Glob patterns that match zero members emit a `WARN` so dead allowlist entries surface. An unconstrained scoped rule (no `extends` or `implements`) is rejected at load time. Use plugin-level `usedClassMembers` in a `.fallow/plugins/*.jsonc` file for library-specific allowlists
- `resolve.conditions`: additional package.json `exports` / `imports` condition names to honor during module resolution. Baseline conditions (`development`, `import`, `require`, `default`, `types`, `node`, plus `react-native` / `browser` under RN/Expo) are always included; user entries prepend ahead of them. Use for community conditions like `worker`, `edge-light`, `deno`, or custom bundler conditions. Example: `{ "resolve": { "conditions": ["worker", "edge-light"] } }`
- `unusedComponentProps.ignorePattern`: opt-in regex that exempts a component prop from `unused-component-props` when the prop's LOCAL destructure binding name matches (the leading-underscore "accepted-but-intentionally-unused" convention, mirroring TS `noUnusedParameters` + ESLint `varsIgnorePattern` / `argsIgnorePattern`). Applies to Vue, Svelte, Astro, and React/Preact props. The match is on the local alias (`_stage` in `let { stage: _stage } = $props()`), not the public prop name the finding reports (`stage`); matching is unanchored like ESLint's `RegExp.test`, so anchor with `^_`. An invalid regex fails config load. Example: `{ "unusedComponentProps": { "ignorePattern": "^_" } }`

---
