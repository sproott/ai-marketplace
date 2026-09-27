#!/usr/bin/env python3
"""Harness I/O for hook scripts: every host's stdin payload in, that host's response out.

Hook logic sees only `HookInput` and calls `context` / `block` / `deny`; which host sent
the payload, how it spelled its keys, and which schema it reads back stay in this module.

APM deploys one hook descriptor to every target, so the host is read off the payload:

    claude    Claude Code: snake_case `tool_name` / `tool_input`, response under
              `hookSpecificOutput`. The only host that honours `matcher` and `if:`.
    vscode    VS Code Copilot Chat, Copilot CLI's PascalCase registration: Claude's
              schema plus a `timestamp`; `matcher` and `if:` are ignored.
    copilot   Copilot CLI's camelCase registration: `toolName`, `toolArgs` (a JSON string,
              or raw patch text for `apply_patch`), response fields at the top level.

Canonical copy: scripts/hook-io/hook_io.py. Package copies are synced by
`just sync-hook-io`; `just test` fails when one drifts.
"""
import json
import re
import sys
from dataclasses import dataclass
from enum import Enum


class Host(Enum):
    CLAUDE = "claude"
    VSCODE = "vscode"
    COPILOT = "copilot"


# Lowercased tool names, across hosts, of calls that write files.
WRITE_TOOLS = frozenset({
    "edit", "write",
    "create", "apply_patch", "str_replace_editor",
    "replace_string_in_file", "multi_replace_string_in_file", "create_file",
    "insert_edit_into_file",
})
# The subset of WRITE_TOOLS able to create a file.
CREATE_TOOLS = frozenset({"write", "create", "apply_patch", "str_replace_editor", "create_file"})


@dataclass(frozen=True)
class FileChange:
    """One file a tool call wrote.

    `old_text` is None when the call carries the whole file (create/write); otherwise
    `new_text` replaced `old_text` somewhere in the file.
    """

    path: str
    new_text: str | None
    old_text: str | None


@dataclass(frozen=True)
class HookInput:
    host: Host
    event: str
    tool: str
    changes: tuple[FileChange, ...]
    command: str | None
    prompt: str | None
    session_id: str | None
    tool_result: str | None


# ---- input ----

PATCH_BEGIN = "*** Begin Patch"
PATCH_HEADER = re.compile(r"^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$")

PATH_KEYS = ("file_path", "filePath", "path", "file")
NEW_KEYS = ("new_string", "newString", "new_str", "newStr", "code")
OLD_KEYS = ("old_string", "oldString", "old_str", "oldStr")
CONTENT_KEYS = ("content", "file_text", "fileText", "text")


def _as_dict(value: object) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def _arg(args: dict, names: tuple[str, ...]) -> str | None:
    return next((args[n] for n in names if isinstance(args.get(n), str)), None)


def _patch_changes(patch: str) -> list[FileChange]:
    """Files an `apply_patch` V4A patch leaves behind, deleted ones excluded."""
    changes: list[FileChange] = []
    op = path = None
    new: list[str] = []
    old: list[str] = []

    def flush() -> None:
        if path and op == "Update File":
            changes.append(FileChange(path, "\n".join(new), "\n".join(old)))
        elif path and op == "Add File":
            changes.append(FileChange(path, "\n".join(new), None))

    for line in patch.splitlines():
        header = PATCH_HEADER.match(line)
        if header and header[1] == "Move to":
            path = header[2].strip()
        elif header:
            flush()
            op, path, new, old = header[1], header[2].strip(), [], []
        elif line.startswith("*** ") or line.startswith("@@"):
            continue
        elif line.startswith("+"):
            new.append(line[1:])
        elif line.startswith("-"):
            old.append(line[1:])
        elif line.startswith(" "):
            new.append(line[1:])
            old.append(line[1:])
    flush()
    return changes


def _changes(args: object) -> tuple[FileChange, ...]:
    if isinstance(args, str) and args.lstrip().startswith(PATCH_BEGIN):
        return tuple(_patch_changes(args))
    args = _as_dict(args)
    patch = args.get("input")
    if isinstance(patch, str) and patch.lstrip().startswith(PATCH_BEGIN):
        return tuple(_patch_changes(patch))
    replacements = args.get("replacements")
    if isinstance(replacements, list):
        return tuple(c for r in replacements for c in _changes(r))
    path = _arg(args, PATH_KEYS)
    if not path:
        return ()
    new = _arg(args, NEW_KEYS)
    if new is not None:
        return (FileChange(path, new, _arg(args, OLD_KEYS) or ""),)
    return (FileChange(path, _arg(args, CONTENT_KEYS), None),)


def _tool_result(payload: dict) -> str | None:
    result = _as_dict(payload.get("toolResult"))
    text = result.get("textResultForLlm")
    return text if result.get("resultType") == "success" and isinstance(text, str) else None


def parse(payload: dict, event: str) -> HookInput:
    """`event` is the Claude-cased event the hook is registered on; a payload's own
    `hook_event_name` wins over it."""
    if "toolName" in payload or "sessionId" in payload:
        host = Host.COPILOT
    elif "timestamp" in payload:
        host = Host.VSCODE
    else:
        host = Host.CLAUDE
    args = payload.get("tool_input")
    if args is None:
        args = payload.get("toolArgs")
    command = _arg(_as_dict(args), ("command",))
    prompt = payload.get("prompt")
    session = payload.get("session_id") or payload.get("sessionId")
    return HookInput(
        host=host,
        event=payload.get("hook_event_name") or event,
        tool=(payload.get("tool_name") or payload.get("toolName") or "").lower(),
        changes=_changes(args),
        command=command,
        prompt=prompt if isinstance(prompt, str) else None,
        session_id=session if isinstance(session, str) else None,
        tool_result=_tool_result(payload),
    )


def read(event: str) -> HookInput:
    return parse(json.load(sys.stdin), event)


# ---- output ----


def context(hook: HookInput, text: str) -> dict:
    """Non-blocking note the model reads alongside the tool result."""
    if hook.host is not Host.COPILOT:
        return {"hookSpecificOutput": {"hookEventName": hook.event, "additionalContext": text}}
    out: dict = {"additionalContext": text}
    # Copilot does not reliably surface top-level additionalContext; the tool result does.
    if hook.tool_result is not None:
        out["modifiedResult"] = {
            "resultType": "success",
            "textResultForLlm": f"{hook.tool_result}\n\n{text}",
        }
    return out


def block(hook: HookInput, text: str) -> dict:
    """Post-tool finding the model must address. Copilot has no post-tool block, so there
    it degrades to `context`."""
    if hook.host is not Host.COPILOT:
        return {"decision": "block", "reason": text, **context(hook, text)}
    return context(hook, text)


def deny(hook: HookInput, reason: str) -> dict:
    """Refuse a pending tool call; the model sees `reason`."""
    decision = {"permissionDecision": "deny", "permissionDecisionReason": reason}
    if hook.host is not Host.COPILOT:
        return {"hookSpecificOutput": {"hookEventName": hook.event, **decision}}
    return decision


def emit(response: dict) -> None:
    print(json.dumps(response))
