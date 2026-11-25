---
name: harness-hooks
description: Writes and debugs APM hooks that must behave the same on Claude Code, VS Code Copilot Chat, and Copilot CLI, using the shared TypeScript hook I/O module. Use when adding or changing a .apm/hooks primitive, or when a hook misfires on one host.
---

# Harness hooks

APM deploys one hook descriptor to every target. It renames event keys and rewrites script paths. It does not translate tool names, matchers, payloads, or exit codes, so a broken hook can deploy, pass `apm audit`, and never fire. The shared TypeScript `hook-io.ts` module translates payloads and responses so core hook logic can use normalized fields.

Write first-party hooks in TypeScript and bundle them for Node.js. Preserve vendored runtimes. Keep wrappers for vendored hooks with their package under `src/hooks/`. For package-specific host detection rules, see `references/cross-host.md`.

References, loaded when needed:

- `references/cross-host.md`: tool names, matchers, compiler output, response and exit-code differences, and the gotchas behind each rule below. Read it when you pick tool names, normalise a payload shape that `hook-io.ts` lacks, or debug a hook that misfires on one host.
- `references/claude.md`, `references/vscode.md`, `references/opencode.md`: one host's full schema. Read the relevant file when a field or event is not in `cross-host.md`. opencode needs a hand-written plugin, which this workflow does not produce.

Out of scope: primitive frontmatter (`apm-author-primitive`), manifests (`apm-package-init`), dependencies (`apm-install-deps`), and audit (`apm-audit-security`).

## 1. Choose the event and response

Pick an event that VS Code supports: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, or `Stop`. Other events deploy but never fire there.

Pick the response function:

- `context(hook, text)`: a non-blocking note that the model reads.
- `block(hook, text)`: a post-tool finding that the model must address. Copilot CLI has no post-tool block, so it falls back to `context` there.
- `deny(hook, reason)`: refuse a pending tool call.

A hook must never fail silently and never block on its own breakage. When the hook cannot do its job (a required tool is missing, a subprocess fails or times out, an unexpected error is thrown), it warns the user through `emit(response, warnings)`. The warnings go out as `systemMessage`, which Claude Code and VS Code show to the user but not to the model, so the agent does not try to repair the user's toolchain. Findings about the agent's work go through the response function, and the hook's own failures go through warnings. Checks that find the hook does not apply (an ignored tool, a skipped file type, a project that has not opted in) stay silent.

Done when the event and the response are chosen, and the hook's failure modes are listed with a warning for each.

## 2. Write the descriptor

Create `packages/<pkg>/.apm/hooks/<name>.json` in Claude's shape. Model it on `packages/rules-on-create/.apm/hooks/rules-on-create.json`.

- `matcher`: the union of the relevant tool names on all hosts. Over-match and let the script filter. Omit `matcher` for `SessionStart` and `UserPromptSubmit`.
- `command`: `sh -c 'cd "${CLAUDE_PROJECT_DIR:-$PWD}" && exec node ./<script>.cjs'`, with a `timeout`.
- Path filter: only Claude honours `if:`. To use it, add a `--scoped` handler with the `if:` and an unscoped handler without it, as in `packages/fsharp/.apm/hooks/fsharplint.json`. The script returns early for `--scoped` on any host other than Claude, so the work runs once on each host.

Done when the descriptor names the script beside it with a relative `./` path.

## 3. Write the script

Put `<script>.ts` in `packages/<pkg>/src/hooks/` and register its entry point with the package's builder. Import `read`, response helpers, and tool sets from `packages/_shared/hook-io/hook-io.ts`. TypeScript sources live outside `.apm/`; only the descriptor and generated bundle deploy.

- Read input only from `HookInput`: `tool`, `changes`, `command`, `prompt`, `session_id`, and `tool_result`. Do not read the raw payload.
- Filter by `hook.tool` in the script. VS Code ignores `matcher` and runs every handler for every tool. Use `WRITE_TOOLS` or `CREATE_TOOLS` for file writes.
- Exit 0 with no output when the hook has nothing to say.
- Collect a warning for each failure listed in step 1 and pass them to `emit(response, warnings)`. Say what failed and what was skipped, for example ``FSharpLint hook: `dotnet` is not on PATH; edited F# files were not linted.``
- Wrap the entry point in `try`/`catch` whose handler calls `emit(null, [failure('<name>', error)])`. Inner catches may fall back silently only when the fallback is a not-applicable check.

If `HookInput` lacks a field you need, add its wire schema and normalization to `packages/_shared/hook-io/hook-io.ts`. Validate consumed fields with Valibot and allow unknown fields. Add a case to `packages/_shared/hook-io/hook-io.test.ts`.

Done when the script uses only `hook-io.ts` exports for harness input and output, and every failure mode from step 1 reaches `emit` as a warning.

## 4. Build the bundle

Run `just build <pkg>` to bundle the package's hook into `.apm/hooks/<script>.cjs`. `just test` checks all hook bundles for drift, including the Caveman adapter and both Impeccable targets. `just check` also type-checks hook sources. Only Node built-ins may remain as runtime imports. Commit the generated bundle.

Done when `just check` passes.

## 5. Test every host

Add a Vitest file under `packages/<pkg>/tests/`, modelled on `packages/fsharp/tests/fsharplint.test.ts`. Feed the bundle a payload through Node for each host and assert the JSON response:

- Claude: `tool_name` and `tool_input`.
- VS Code: Claude's keys plus `timestamp`, with VS Code tool names such as `replace_string_in_file`.
- Copilot CLI: `toolName`, with `toolArgs` as a JSON string. Use raw patch text for `apply_patch`.

Also cover a tool that the hook must ignore, which must produce no output. Cover each failure mode by stubbing the tool (missing from `PATH`, a non-zero exit) and assert a `systemMessage` warning with no block or deny. For a `--scoped` handler, check that it produces no output for a host other than Claude.

Done when `just test` passes.

## 6. Deploy and verify

1. Run `just install`. Check that the hook appears in `.claude/settings.json` and in `.github/hooks/<pkg>-<name>.json`.
2. Run `just audit`. Do not block on it: APM audit often fails, including on failures that predate the change. Report any failure that involves the new hook.

Done when the hook is deployed to both targets and the audit result is reported.

## Debug a misfiring hook

1. In VS Code, run `/hooks` in chat to confirm the hook loaded. `.github/hooks/` needs Workspace Trust. The agent debug logs show tool names and inputs.
2. Check the deployed descriptor and script path in `.claude/settings.json` and `.github/hooks/<pkg>-<name>.json`. A wrong path exits 127, which does not block, so the hook is silently off. A missing warning does not prove that the script ran.
3. Replay the captured payload through the script, using the test fixtures, and compare it against `references/cross-host.md`.

Fix the TypeScript source or `.apm/hooks/` descriptor, rebuild, and redeploy. Never edit a bundle or deployed file.
