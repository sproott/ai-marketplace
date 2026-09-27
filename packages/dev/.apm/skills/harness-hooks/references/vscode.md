# VS Code Copilot Chat (Local harness)

Docs: <https://code.visualstudio.com/docs/agents/reference/hooks-reference>. Preview.

Session Target picks the harness. **Local** (extension host) is described here. Copilot /
Claude / Codex targets on Agent Host run those providers' own hook implementations —
Copilot target follows Copilot CLI semantics (camelCase payload, `toolArgs`).

## Config

| Scope | Path |
|---|---|
| Workspace | `.github/hooks/*.json` (needs Workspace Trust) |
| Workspace, Claude format | `.claude/settings.json`, `.claude/settings.local.json` — only with `chat.useClaudeHooks` (off by default) |
| User | `~/.copilot/hooks/*.json` |
| User, Claude format | `~/.claude/settings.json` — only with `chat.useClaudeHooks` |
| Custom agent | `hooks` in `.agent.md` frontmatter (adds to others) |
| Plugin | `hooks.json` / `hooks/hooks.json` |

`chat.useHooks` (on by default) gates everything. `chat.hookFilesLocations` adds folders or
files, or disables built-ins (`".claude/settings.json": false`). Monorepo parent discovery:
`chat.useCustomizationsInParentRepositories`.

Native format — flat handler list per PascalCase event, no `version`:

```json
{
  "hooks": {
    "PostToolUse": [
      { "type": "command", "command": "./x.sh", "windows": "powershell -File x.ps1", "cwd": ".", "env": {}, "timeout": 30 }
    ]
  }
}
```

`command` plus OS overrides `windows` / `linux` / `osx` (picked by extension host platform
— remote host, not UI machine). `cwd` relative to repo root. `timeout` seconds, default 30.

Parser also accepts:

| Format | Detected by | Behaviour |
|---|---|---|
| Copilot | numeric `version` + lowerCamelCase events | mapped to native; payload still native |
| Claude | file is `.claude/settings{,.local}.json` | nested `hooks` groups parsed, **`matcher` ignored** |

## Events

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`,
`SubagentStart`, `SubagentStop`, `Stop`. Custom agent's `Stop` becomes `SubagentStop` when
run as subagent.

No matcher, no `if`: every handler runs on every occurrence of its event.

## Payload (stdin)

Common: `timestamp` (ISO 8601), `cwd`, `session_id`, `hook_event_name`, `transcript_path`
(format unstable).

| Event | Adds |
|---|---|
| `PreToolUse` | `tool_name`, `tool_input` (object), `tool_use_id` |
| `PostToolUse` | same + `tool_response` (string or object) |
| `UserPromptSubmit` | `prompt` |
| `SessionStart` | `source` (always `"new"`) |
| `Stop` | `stop_hook_active` |
| `SubagentStart` | `agent_id`, `agent_type` |
| `SubagentStop` | `agent_id`, `agent_type`, `stop_hook_active` |
| `PreCompact` | `trigger` (`"auto"`) |

## Tool names

Copilot Chat's own snake_case namespace. Confirm in agent debug logs (Chat Debug view).

| Tool | `tool_input` |
|---|---|
| `replace_string_in_file` | `filePath`, `oldString`, `newString`, `explanation` |
| `multi_replace_string_in_file` | `explanation`, `replacements: [{filePath, oldString, newString}]` |
| `create_file` | `filePath`, `content` |
| `insert_edit_into_file` | `filePath`, `code`, `explanation` |
| `apply_patch` | `input` (V4A patch string), `explanation` |
| `edit_notebook_file` | notebook cell edit |
| `run_in_terminal` | `command`, `explanation`, `isBackground` |
| `read_file` | `filePath`, `startLine`, `endLine` |

Arg keys camelCase inside a snake_case envelope.

## Exit codes

| Exit | Effect |
|---|---|
| 0 | stdout parsed as JSON |
| 2 | blocking; stderr goes to model |
| other | non-blocking warning, continues |

## JSON output

Common: `continue` (`false` stops agent), `stopReason`, `systemMessage`. Most restrictive
outcome wins across hooks.

- `PreToolUse` → `hookSpecificOutput{hookEventName, permissionDecision: allow|deny|ask, permissionDecisionReason, updatedInput, additionalContext}`. Precedence deny > ask > allow. `updatedInput` not matching tool schema is ignored.
- `PostToolUse` → top-level `decision: "block"` + `reason`; `hookSpecificOutput.additionalContext`.
- `SessionStart`, `SubagentStart` → `hookSpecificOutput.additionalContext`.
- `Stop` → `hookSpecificOutput{decision: "block", reason}` (nested). `SubagentStop` → top-level `decision` + `reason`.
- `UserPromptSubmit`, `PreCompact` → common fields only.

## Gotchas

- Matchers ignored → hook fires for every tool; script must filter by `tool_name`.
- `if` ignored → Claude `--scoped` handler and its unscoped twin both run; a `--scoped` guard keyed on camelCase payload won't catch VS Code.
- `.github/hooks/<pkg>-<name>.json` (APM `copilot` target) is the file VS Code loads; `.claude/settings.json` only with `chat.useClaudeHooks`. Both on → same hook runs twice.
- Copilot-format event names are mapped from Copilot's vocabulary (`userPromptSubmitted`); an APM-lowercased Claude name like `userPromptSubmit` may not map. Verify the hook appears under `/hooks`.
- Edit payload shapes differ per tool: `replacements[]` array, `code` key, `apply_patch` patch under `input` key.
- Payload is snake_case like Claude; tell apart by tool names (`replace_string_in_file` vs `Edit`) or `timestamp` presence.
- `Stop` block output nests under `hookSpecificOutput`; Claude's is top-level.
