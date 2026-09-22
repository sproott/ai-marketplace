# `config`: Show Resolved Config

Prints the loaded config file path and the resolved config (with `extends` merged) as JSON. Useful for verifying which config fallow picked up, especially in monorepos.

```bash
fallow config            # path on first line, JSON below
fallow config --path     # only the path (scriptable)
```

### Flags

<!-- generated:flags:config:start -->
| Flag | Type | Default | Description |
|---|---|---|---|
| `--path` | `bool` | `false` | Print only the config file path, no JSON |

Common global flags for this command: [`--format`](global-flags.md), [`--quiet`](global-flags.md), [`--config`](global-flags.md), [`--root`](global-flags.md).
<!-- generated:flags:config:end -->
### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Config file found and loaded |
| `2` | Error (parse failure, explicit `--config` path missing) |
| `3` | No config file found; defaults are in effect |

Honors the global `--config <path>` flag: if passed, that path is loaded directly instead of walking the directory tree.

The `loaded config: <path>` line is also emitted to stderr automatically at the start of every human-format CLI run (suppressed by `--quiet` and non-human formats).

---
