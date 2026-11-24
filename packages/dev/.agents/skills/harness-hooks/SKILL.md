---
name: harness-hooks
description: Writes and debugs APM hooks that must behave the same on Claude Code, VS Code Copilot Chat, and Copilot CLI, using the shared hook_io module. Use when adding or changing a .apm/hooks primitive, or when a hook misfires on one host.
---

# Harness hooks

APM deploys one hook descriptor to every target. It renames event keys and rewrites script paths. It does not translate tool names, matchers, payloads, or exit codes, so a broken hook can deploy, pass `apm audit`, and never fire. The shared `hook_io` Python module translates payloads and responses, so hook logic never reads host-specific keys.

Write hooks in Python with `hook_io`. Use another runtime only to wrap a vendored hook. The wrapper then owns the I/O, as in `scripts/assets/caveman/caveman-hook-io.js`.

References, loaded when needed:

- `references/cross-host.md`: tool names, matchers, compiler output, response and exit-code differences, and the gotchas behind each rule below. Read it when you pick tool names, normalise a payload shape that `hook_io` lacks, or debug a hook that misfires on one host.
- `references/claude.md`, `references/vscode.md`, `references/opencode.md`: one host's full schema. Read the relevant file when a field or event is not in `cross-host.md`. opencode needs a hand-written plugin, which this workflow does not produce.

Out of scope: primitive frontmatter (`apm-author-primitive`), manifests (`apm-package-init`), dependencies (`apm-install-deps`), and audit (`apm-audit-security`).

## 1. Choose the event and response

Pick an event that VS Code supports: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, or `Stop`. Other events deploy but never fire there.

Pick the response function:

- `hook_io.context(hook, text)`: a non-blocking note that the model reads.
- `hook_io.block(hook, text)`: a post-tool finding that the model must address. Copilot CLI has no post-tool block, so it falls back to `context` there.
- `hook_io.deny(hook, reason)`: refuse a pending tool call.

Done when the event and the response are chosen.

## 2. Write the descriptor

Create `packages/<pkg>/.apm/hooks/<name>.json` in Claude's shape. Model it on `packages/rules-on-create/.apm/hooks/rules-on-create.json`.

- `matcher`: the union of the relevant tool names on all hosts. Over-match and let the script filter. Omit `matcher` for `SessionStart` and `UserPromptSubmit`.
- `command`: `sh -c 'cd "${CLAUDE_PROJECT_DIR:-$PWD}" && exec python3 ./<script>.py'`, with a `timeout`.
- Path filter: only Claude honours `if:`. To use it, add a `--scoped` handler with the `if:` and an unscoped handler without it, as in `packages/fsharp/.apm/hooks/fsharplint.json`. The script returns early for `--scoped` on any host other than Claude, so the work runs once on each host.

Done when the descriptor names the script beside it with a relative `./` path.

## 3. Write the script

Put `<script>.py` beside the descriptor in `.apm/hooks/`. Use this skeleton:

```python
import contextlib
import sys

# Imports must not leave __pycache__ inside the deployed hooks dir of a consumer repo.
sys.dont_write_bytecode = True
import hook_io


def main() -> None:
    hook = hook_io.read("PostToolUse")
    if "--scoped" in sys.argv[1:] and hook.host is not hook_io.Host.CLAUDE:
        return
    if hook.tool not in hook_io.WRITE_TOOLS:
        return
    ...
    hook_io.emit(hook_io.block(hook, text))


if __name__ == "__main__":
    with contextlib.suppress(Exception):
        main()
```

- Read input only from `HookInput`: `tool`, `changes`, `command`, `prompt`, `session_id`, and `tool_result`. Do not read the raw payload.
- Filter by `hook.tool` in the script. VS Code ignores `matcher` and runs every handler for every tool. Use `WRITE_TOOLS` or `CREATE_TOOLS` for file writes.
- Exit 0 with no output when the hook has nothing to say. A crash must not block the agent, so keep the `suppress` guard.

If `HookInput` lacks a field you need, change the canonical `scripts/assets/hook-io/hook_io.py`, never a package copy. Add a case for the change to `scripts/assets/hook-io/test-hook-io.sh`.

Done when the script uses only `hook_io` for input and output.

## 4. Sync hook_io

Run `just sync-hook-io`. It copies the canonical module into every `.apm/hooks/` directory whose scripts contain `import hook_io`. `just test` fails when a copy drifts.

Done when `bun run cli sync-hook-io --check` passes.

## 5. Test every host

Add `tests/shell/test-<name>.sh`, modelled on `tests/shell/test-fsharplint-hook.sh`. Feed the script a payload for each host and assert the JSON response:

- Claude: `tool_name` and `tool_input`.
- VS Code: Claude's keys plus `timestamp`, with VS Code tool names such as `replace_string_in_file`.
- Copilot CLI: `toolName`, with `toolArgs` as a JSON string. Use raw patch text for `apply_patch`.

Also cover a tool that the hook must ignore, which must produce no output. For a `--scoped` handler, check that it produces no output for a host other than Claude.

Done when `just test` passes. It discovers `test-*.sh` automatically.

## 6. Deploy and verify

1. Run `just install`. Check that the hook appears in `.claude/settings.json` and in `.github/hooks/<pkg>-<name>.json`.
2. Run `just audit`. Do not block on it: APM audit often fails, including on failures that predate the change. Report any failure that involves the new hook.

Done when the hook is deployed to both targets and the audit result is reported.

## Debug a misfiring hook

1. In VS Code, run `/hooks` in chat to confirm the hook loaded. `.github/hooks/` needs Workspace Trust. The agent debug logs show tool names and inputs.
2. Check the deployed descriptor and script path in `.claude/settings.json` and `.github/hooks/<pkg>-<name>.json`. A wrong path exits 127, which does not block, so the hook is silently off.
3. Replay the captured payload through the script, using the shell test's helpers, and compare it against `references/cross-host.md`.

Fix the `.apm/hooks/` source and redeploy. Never edit the deployed files: `apm install` overwrites them.
