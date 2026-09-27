# opencode

Docs: <https://opencode.ai/docs/plugins/>, <https://opencode.ai/docs/permissions/>.

No declarative hooks, no stdin payload, no exit codes. APM hook primitives have no
opencode output; a check needs its own plugin.

## Plugins

Auto-loaded from `.opencode/plugins/` (project) and `~/.config/opencode/plugins/`
(global). npm plugins via `opencode.json` `{"plugin": ["pkg"]}`; deps in
`.opencode/package.json` (bun install at startup). Load order: global config → project
config → global dir → project dir. Every hook runs; no short-circuit.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool === "read" && output.args.filePath.includes(".env")) {
      throw new Error("Do not read .env files")
    }
  },
})
```

| Hook | Use |
|---|---|
| `tool.execute.before(input, output)` | mutate `output.args`; `throw` to block |
| `tool.execute.after(input, output)` | inspect/amend result |
| `event({ event })` | any bus event, switch on `event.type` |
| `experimental.session.compacting(input, output)` | push `output.context` / replace `output.prompt` |

`input.tool` = tool name; `output.args` = mutable args, camelCase (`filePath`).
Custom tools: `tool: { name: tool({ description, args, execute }) }` — colliding name
overrides built-in.

Event types: `command.executed`, `file.edited`, `file.watcher.updated`,
`installation.updated`, `lsp.client.diagnostics`, `lsp.updated`, `message.*`,
`permission.asked`, `permission.replied`, `server.connected`, `session.created`,
`session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`,
`session.status`, `session.updated`, `todo.updated`, `shell.env`, `tool.execute.*`,
`tui.prompt.append`, `tui.command.execute`, `tui.toast.show`.

## Tool names

`read`, `edit`, `write`, `patch`, `glob`, `grep`, `bash`, `task`, `skill`, `lsp`,
`question`, `webfetch`, `websearch`. Permission-only keys: `external_directory`,
`doom_loop`.

## `permission` block

In `opencode.json` or agent frontmatter; per-agent under `agent.<name>.permission`.

```json
{
  "permission": {
    "*": "ask",
    "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
    "edit": "deny"
  }
}
```

- Values `allow`/`ask`/`deny`; string or pattern → action map.
- Glob patterns (`*`, `?`), not regex. Last match wins — catch-all first.
- `edit` key covers `edit`, `write`, `patch`.
- Defaults: allow all, except `doom_loop`/`external_directory` ask, `.env` reads deny.

## Gotchas

- Only `throw` blocks; return values don't.
- Arg keys camelCase, per tool.
- Claude/Copilot hook configs inert here, no warning.
