---
name: harness-hooks
description: Knowledge base of per-harness hook data formats — Claude Code, VS Code Copilot Chat, opencode — and the gotchas an APM hook primitive must survive. Use when authoring or debugging a .apm/hooks/*.json primitive or its script, choosing matcher tool names, reading hook stdin payloads, rendering hook output, or when a hook fires in one harness but silently no-ops or double-fires in another.
---

# Harness Hooks

One APM hook primitive (`packages/<pkg>/.apm/hooks/<name>.json`) deploys to every target.
The compiler only renames event keys and rewrites script paths. It does not translate tool
names, matchers, payload keys, or exit-code meaning — so a hook can deploy, pass
`apm audit`, and never fire, or fire on everything. Every failure below is silent.

Per-harness detail:

- `references/claude.md` — schema, events, matcher/`if` rules, `tool_input` per tool, exit codes, JSON output.
- `references/vscode.md` — Local harness: config locations, accepted formats, events, payloads, tool names, JSON output.
- `references/opencode.md` — plugin API, throw-to-block, tool names, `permission` block.

Out of scope: primitive frontmatter (`apm-author-primitive`), manifests (`apm-package-init`),
dependencies (`apm-install-deps`), audit (`apm-audit-security`).

## At a glance

| | Claude Code | VS Code Copilot Chat | opencode |
|---|---|---|---|
| Mechanism | JSON config | JSON config | JS/TS plugin only |
| Loads from | `.claude/settings.json` | `.github/hooks/*.json` (`.claude/` opt-in) | `.opencode/plugins/` |
| Event key | `PostToolUse` | `PostToolUse` (also maps Copilot camelCase) | `tool.execute.after` |
| Edit tools | `Edit`, `Write` | `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`, `insert_edit_into_file`, `apply_patch` | `edit`, `write`, `patch` |
| Shell / read | `Bash` / `Read` | `run_in_terminal` / `read_file` | `bash` / `read` |
| Matcher | exact list or unanchored regex | **ignored** — all handlers run | code: `input.tool === "bash"` |
| Path filter | `if: "Edit(*.fs)"` | ignored | code |
| Tool / args keys | `tool_name` / `tool_input` (snake_case args) | `tool_name` / `tool_input` (camelCase args) | `input.tool` / `output.args` |
| Block | exit 2 or JSON | exit 2 or JSON | `throw new Error()` |
| Output schema | `hookSpecificOutput` | `hookSpecificOutput` | n/a |

## Authoring form

Claude shape, PascalCase event keys:

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|replace_string_in_file|multi_replace_string_in_file|create_file|insert_edit_into_file|apply_patch",
      "hooks": [
        {
          "type": "command",
          "if": "Edit(*.fs)",
          "command": "sh -c 'cd \"${CLAUDE_PROJECT_DIR:-$PWD}\" && exec python3 ./my_check.py --scoped'",
          "timeout": 60
        },
        {
          "type": "command",
          "command": "sh -c 'cd \"${CLAUDE_PROJECT_DIR:-$PWD}\" && exec python3 ./my_check.py'",
          "timeout": 60
        }
      ]
    }
  ]
}
```

- Scripts sit flat beside the JSON in `.apm/hooks/`, referenced as `./script`. Compiler copies and rewrites the path.
- `${CLAUDE_PROJECT_DIR:-$PWD}` — variable exists only under Claude; fallback makes one command work everywhere.
- No `matcher` = match all. Required shape for `SessionStart` / `UserPromptSubmit`.

## Compiler output

| Target | Output | Transform |
|---|---|---|
| `claude` | `.claude/settings.json` `hooks` + `.claude/apm-hooks.json` (with `_apm_source` per group) | keys verbatim; scripts → `.claude/hooks/<pkg>/`; path → `${CLAUDE_PROJECT_DIR}/.claude/hooks/<pkg>/<script>` |
| `copilot` | `.github/hooks/<pkg>-<name>.json` — **the file VS Code loads** | keys → lowerCamelCase; wrapped `{"hooks":{…},"version":1}` (Copilot format); scripts → `.github/hooks/scripts/<pkg>/`; `matcher`/`if` copied verbatim, VS Code ignores both |
| `opencode` | none | needs hand-written plugin |

## Gotchas

### VS Code runs every handler on every tool

No matcher, no `if`. Consequences:

- Script must filter by `tool_name` itself. A PostToolUse lint hook also fires on `read_file`, `run_in_terminal`, …
- Claude `--scoped` + unscoped handler pair both run → work done twice. `--scoped` handler must exit unless payload is Claude's (PascalCase tool name).
- `chat.useClaudeHooks` on → `.claude/settings.json` loads too → every hook runs twice (once per file). Keep it off, or make hooks idempotent.

```python
if "--scoped" in sys.argv[1:] and hook.host is not hook_io.Host.CLAUDE:
    return
```

### Matchers (Claude)

Union all edit tools. Over-match, filter in script. `Edit.*` regex also hits
`NotebookEdit`. `MultiEdit` no longer exists.

### Payload: isolate in an I/O layer

Hook = I/O layer (read stdin, detect host, normalize; render decision in host schema) +
core (normalized input → decision). Core never sees harness keys.

Claude and VS Code both send snake_case envelope + `hookSpecificOutput` response. Tell apart
by `timestamp` (VS Code only) or tool name (`Edit` vs `replace_string_in_file`).

Edit-arg shapes to normalize:

| Source | Shape |
|---|---|
| Claude `Edit` / `Write` | `file_path`, `old_string`, `new_string` / `content` |
| VS Code `replace_string_in_file` | `filePath`, `oldString`, `newString` |
| VS Code `multi_replace_string_in_file` | `replacements: [{filePath, oldString, newString}]` — several files |
| VS Code `create_file` | `filePath`, `content` |
| VS Code `insert_edit_into_file` | `filePath`, `code` (partial, with `...existing code...` markers) |
| VS Code `apply_patch` | `input`: V4A patch. Headers `*** Update File:` / `Add File:` / `Delete File:` / `Move to:`; `+` new, `-` old, space both |

Repo I/O layers:

- `scripts/hook-io/hook_io.py` — Python (`read`, `HookInput`, `Host` claude/vscode/copilot, `WRITE_TOOLS`/`CREATE_TOOLS`, `context`/`block`/`deny`, `emit`). Parses every edit shape above. Canonical; `just sync-hook-io` copies it into each package using it. Importers set `sys.dont_write_bytecode = True` first.
- `packages/rtk/.apm/hooks/rtk-hook-io.sh` — bash, rtk PreToolUse rewrites.
- Vendored hooks: wrapper owns I/O, feeds vendored script a Claude payload, translates answer. `scripts/fallow/fallow-gate-io.sh`, `scripts/caveman/caveman-hook-io.js`.

### Output differences

| | Claude | VS Code |
|---|---|---|
| deny (pre-tool) | `hookSpecificOutput.permissionDecision: "deny"` | same; `defer` not supported |
| block (post-tool) | top-level `decision: "block"` + `reason` | same |
| `Stop` block | top-level `decision` + `reason` | nested in `hookSpecificOutput` |
| exit 1 | non-blocking | non-blocking warning |
| exit 2 | blocks, overrides JSON | blocks, stderr to model |

- Wrong script path → exit 127 → non-blocking; gate silently off in both.
- Exit 1 never blocks. Prefer JSON decisions.

### Event names

VS Code Local supports only `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`. Other Claude events
deploy but never fire. APM lowercases keys for `.github/hooks/`; VS Code maps them as
Copilot names (`userPromptSubmitted`) — check `/hooks` view lists the hook.

### Deploy

- Edit `.apm/hooks/` source, never `.claude/settings.json` / `.github/hooks/*.json` — `apm install` clobbers, `apm audit` flags drift.
- Propagate with `just install`, verify with `just audit`.
- VS Code: `/hooks` in chat lists loaded hooks; agent debug logs show tool names and inputs. `.github/hooks/` needs Workspace Trust.
