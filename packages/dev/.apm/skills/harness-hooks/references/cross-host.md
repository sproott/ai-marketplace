# Cross-host reference

Read this when you choose tool names or matchers, normalise a payload shape that `hook-io.ts` does not cover yet, or debug a hook that fires on one host but not another. For one host's full schema, read `claude.md`, `vscode.md`, or `opencode.md` in this folder.

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

```ts
if (process.argv.includes('--scoped', 2) && hook.host !== Host.CLAUDE) return;
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

- `packages/_shared/hook-io/hook-io.ts` — TypeScript (`read`, `HookInput`, `Host`, `WRITE_TOOLS`/`CREATE_TOOLS`, `context`/`block`/`deny`, `emit`). Parses the edit shapes above. Each package builder bundles it into the hooks that import it.
- `packages/rtk/src/hooks/rtk-hook-io.sh` — Bash, RTK PreToolUse rewrites.
- `packages/caveman/src/hooks/caveman-hook-io.ts` — selects Copilot CLI only when `sessionId` is present and `session_id` is absent. It uses shared response helpers without generic `detectHost`.
- `packages/impeccable/src/hooks/hook.ts` — an explicit Claude target overrides payload detection. For the Copilot target, shared `detectHost` distinguishes Copilot CLI from VS Code.
- `packages/fallow/src/hooks/fallow-gate-io.sh` — Bash adapter for the vendored Fallow gate.

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
