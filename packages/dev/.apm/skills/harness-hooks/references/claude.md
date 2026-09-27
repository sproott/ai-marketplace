# Claude Code

Docs: <https://code.claude.com/docs/en/hooks>

## Config

Merged across `~/.claude/settings.json`, `.claude/settings.json`,
`.claude/settings.local.json`, managed policy, plugin `hooks/hooks.json`, skill/agent
frontmatter `hooks`. Duplicate handler runs once.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "if": "Bash(rm *)", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/x.sh", "timeout": 600 }
        ]
      }
    ]
  }
}
```

Handler `type`: `command`, `http`, `mcp_tool`, `prompt`, `agent`.
Command fields: `command`, `args` (presence = exec form, no shell), `shell`
(`bash`/`powershell`), `async`, `asyncRewake`. Common: `if`, `timeout` (s),
`statusMessage`, `once` (skill frontmatter only).

## Events

`SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`,
`PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`,
`PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`,
`TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`,
`InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`,
`WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`,
`PostModelSwitch`, `Elicitation`, `ElicitationResult`, `SessionEnd`.

## Matcher

Tool events match `tool_name`. Others match own field: `SessionStart` →
`startup|resume|clear|compact|fork`; `PreCompact` → `manual|auto`; `Notification` → type;
`SubagentStart/Stop` → agent type; `FileChanged` → filenames.

1. `"*"`, `""`, omitted → all.
2. Only `[A-Za-z0-9_\- ,|]` → exact name or list split on `|` or `,`.
3. Else → **unanchored** regex (`Edit.*` also hits `NotebookEdit`).

MCP tools: `mcp__<server>__<tool>`; whole server needs `mcp__server__.*`.
Events without matcher (`UserPromptSubmit`, `Stop`, `PostToolBatch`, …) ignore the key.

## `if`

Permission-rule syntax: `Bash(git *)`, `Edit(*.ts)`. One rule only, no `&&`/`||`.
Evaluated only on `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`,
`PermissionDenied`; elsewhere handler never runs. Best-effort: undeterminable → runs.
Bash patterns inspect subcommands and strip leading `VAR=`. `Edit(src/**)` matches
top-level `src` only.

## Payload (stdin)

Common: `session_id`, `prompt_id`, `transcript_path` (lags), `cwd`, `scratchpad_dir`,
`permission_mode`, `effort.level`, `hook_event_name`; subagent adds `agent_id`,
`agent_type`.
Tool events: `tool_name`, `tool_input`, `tool_use_id`. `PostToolUse`: `tool_response`,
`duration_ms`. MCP: `mcp_server{name,source}`.

| Tool | `tool_input` |
|---|---|
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all` |
| `Write` | `file_path`, `content` |
| `Bash` / `PowerShell` | `command`, `description`, `timeout` (ms), `run_in_background` |
| `Read` | `file_path`, `offset`, `limit` |
| `Glob` | `pattern`, `path` |
| `Grep` | `pattern`, `path`, `glob`, `output_mode`, `-i`, `multiline` |
| `WebFetch` | `url`, `prompt` |
| `WebSearch` | `query`, `allowed_domains`, `blocked_domains` |
| `Agent` | `prompt`, `description`, `subagent_type`, `model` |

`file_path` always absolute. Windows uses backslashes.

## Exit codes

| Exit | Effect |
|---|---|
| 0 | stdout parsed as JSON only if it starts `{` and ends `}` |
| 2 | blocks, even if JSON says allow |
| 1 / other | non-blocking notice |
| timeout | fail-open (`WorktreeCreate`: any non-zero fails) |

## JSON output

Universal: `continue` (`false` stops all), `stopReason`, `systemMessage`,
`terminalSequence`, `suppressOutput` (no effect).

- `PreToolUse` → `hookSpecificOutput{hookEventName, permissionDecision: allow|deny|ask|defer, permissionDecisionReason, updatedInput, additionalContext}`. `updatedInput` replaces whole input. Precedence deny > defer > ask > allow.
- `PostToolUse` → `decision: "block"` + `reason`; `updatedToolOutput`, `updatedMCPToolOutput`, `classifierContext`.
- `PermissionRequest` → `hookSpecificOutput.decision.behavior`.
- `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, `ConfigChange` → `decision: "block"` + `reason`.
- `hookSpecificOutput.additionalContext` on most events. Cap 10,000 chars.

## Env

`CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_EFFORT`,
`CLAUDE_CODE_REMOTE`. No `CLAUDE_MODEL`.

## Gotchas

- Wrong script path → exit 127 → non-blocking; gate silently off.
- Exit 1 never blocks.
- Unanchored regex over-matches.
- `if` on non-tool event → handler never runs.
- `MultiEdit` gone.
