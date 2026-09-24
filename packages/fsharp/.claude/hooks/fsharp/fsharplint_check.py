#!/usr/bin/env python3
"""Block on FSharpLint findings in an F# file the agent just edited or created.

PostToolUse(Edit|Write|MultiEdit|edit|create) hook. Lints only when the nearest dotnet
local-tool manifest up from the file lists `dotnet-fsharplint`; restores it once if the
manifest's pin is not yet in the tool cache.

Only real lint findings produce output. Every failure of the hook itself — no dotnet,
failed restore, unparseable output, timeout — is silent, so a broken toolchain never
blocks the agent.
"""
import contextlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

TOOLS = frozenset({"edit", "write", "multiedit", "create"})
EXTENSIONS = frozenset({".fs", ".fsx"})
# Shared by lint, restore and retry; stays under the 60 s hook timeout.
BUDGET_SECONDS = 50
MAX_LISTED = 30

FINDING = re.compile(
    r"^.+\((?P<line>\d+),\d+,\d+,\d+\):FSharpLint (?:warning|error) "
    r"(?P<rule>FL\d+): (?P<message>.*)$",
)
UNRESTORED = "dotnet tool restore"


def as_dict(value: object) -> dict:
    """Copilot CLI's camelCase events send object fields as JSON strings."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def arg(args: dict, *names: str) -> str | None:
    return next((args[n] for n in names if isinstance(args.get(n), str)), None)


def has_fsharplint(manifest: Path) -> bool:
    try:
        text = manifest.read_text(encoding="utf-8")
    except OSError:
        return False
    tools = as_dict(text).get("tools")
    return isinstance(tools, dict) and "dotnet-fsharplint" in tools


def manifest_root(start: Path) -> Path | None:
    """Directory owning the nearest tool manifest, if that manifest lists FSharpLint.

    Probes in dotnet's own order, so the manifest found is the one `dotnet fsharplint`
    itself would use.
    """
    for d in (start, *start.parents):
        for candidate in (d / ".config" / "dotnet-tools.json", d / "dotnet-tools.json"):
            if candidate.is_file():
                return d if has_fsharplint(candidate) else None
    return None


def dotnet(args: list[str], cwd: Path, deadline: float) -> subprocess.CompletedProcess | None:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    try:
        return subprocess.run(
            ["dotnet", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=remaining,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def lint_output(file: Path, root: Path) -> str:
    """msbuild-format lint stdout; empty when the tool could not run."""
    deadline = time.monotonic() + BUDGET_SECONDS
    # `--format` is a global option: FSharpLint rejects it after the subcommand.
    command = ["fsharplint", "--format", "msbuild", "lint", str(file)]
    result = dotnet(command, root, deadline)
    if result and UNRESTORED in result.stderr:
        restore = dotnet(["tool", "restore"], root, deadline)
        result = dotnet(command, root, deadline) if restore and restore.returncode == 0 else None
    return result.stdout if result else ""


def findings_in(output: str) -> list[tuple[int, str, str]]:
    matches = (FINDING.match(line) for line in output.splitlines())
    return sorted(
        (int(m["line"]), m["rule"], m["message"]) for m in matches if m
    )


def report(path: str, findings: list[tuple[int, str, str]]) -> str:
    lines = [f"{path}:{line} {rule} {message}" for line, rule, message in findings[:MAX_LISTED]]
    if len(findings) > MAX_LISTED:
        lines.append(f"… +{len(findings) - MAX_LISTED} more")
    return (
        f"FSharpLint: {len(findings)} finding(s) in {path}. Fix them before moving on.\n\n"
        + "\n".join(lines)
    )


def output_for(payload: dict, text: str) -> dict:
    """Block response on every channel the two harnesses read.

    Claude Code reads decision/reason and hookSpecificOutput; Copilot has no PostToolUse
    block, so it gets top-level additionalContext and the text appended to the tool result.
    """
    out: dict = {
        "decision": "block",
        "reason": text,
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": text,
        },
        "additionalContext": text,
    }
    result = as_dict(payload.get("toolResult"))
    result_text = result.get("textResultForLlm")
    if result.get("resultType") == "success" and isinstance(result_text, str):
        out["modifiedResult"] = {
            "resultType": "success",
            "textResultForLlm": f"{result_text}\n\n{text}",
        }
    return out


def main() -> None:
    payload = json.load(sys.stdin)
    # `--scoped` handlers rely on Claude Code's `if:` path filter. Copilot ignores `if:`
    # and has its own unscoped handler, so a Copilot payload here would lint twice.
    if "--scoped" in sys.argv[1:] and "toolName" in payload:
        return
    tool =(payload.get("tool_name") or payload.get("toolName") or "").lower()
    args = as_dict(payload.get("tool_input") or payload.get("toolArgs"))
    path = arg(args, "file_path", "filePath", "path", "file")
    if not path or tool not in TOOLS or Path(path).suffix.lower() not in EXTENSIONS:
        return
    file = Path(path).resolve()
    root = manifest_root(file.parent)
    if root is None:
        return
    findings = findings_in(lint_output(file, root))
    if findings:
        print(json.dumps(output_for(payload, report(path, findings))))


if __name__ == "__main__":
    with contextlib.suppress(Exception):
        main()
