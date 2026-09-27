#!/usr/bin/env python3
"""Block on FSharpLint findings in F# files the agent just edited or created.

PostToolUse hook. Lints only when the nearest dotnet local-tool manifest up from a file
lists `dotnet-fsharplint`; restores it once per manifest if the pin is not yet in the
tool cache.

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

# Imports must not leave __pycache__ inside the deployed hooks dir of a consumer repo.
sys.dont_write_bytecode = True
import hook_io

EXTENSIONS = frozenset({".fs", ".fsx"})
# Shared by every lint, restore and retry of one call; stays under the 60 s hook timeout.
BUDGET_SECONDS = 50
MAX_LISTED = 30

FINDING = re.compile(
    r"^.+\((?P<line>\d+),\d+,\d+,\d+\):FSharpLint (?:warning|error) "
    r"(?P<rule>FL\d+): (?P<message>.*)$",
)
UNRESTORED = "dotnet tool restore"


def has_fsharplint(manifest: Path) -> bool:
    try:
        tools = json.loads(manifest.read_text(encoding="utf-8")).get("tools")
    except (OSError, ValueError, AttributeError):
        return False
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


def lint_output(file: Path, root: Path, deadline: float, restored: set[Path]) -> str:
    """msbuild-format lint stdout; empty when the tool could not run.

    Restores at most once per manifest root; `restored` records the roots tried.
    """
    # `--format` is a global option: FSharpLint rejects it after the subcommand.
    command = ["fsharplint", "--format", "msbuild", "lint", str(file)]
    result = dotnet(command, root, deadline)
    if result and UNRESTORED in result.stderr and root not in restored:
        restored.add(root)
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


def main() -> None:
    hook = hook_io.read("PostToolUse")
    # `--scoped` handlers rely on Claude Code's `if:` path filter. Other hosts ignore `if:`
    # and also run the unscoped handler, so linting here too would lint twice.
    if "--scoped" in sys.argv[1:] and hook.host is not hook_io.Host.CLAUDE:
        return
    if hook.tool not in hook_io.WRITE_TOOLS:
        return
    paths = dict.fromkeys(
        c.path for c in hook.changes if Path(c.path).suffix.lower() in EXTENSIONS
    )
    deadline = time.monotonic() + BUDGET_SECONDS
    restored: set[Path] = set()
    reports = []
    for path in paths:
        file = Path(path).resolve()
        root = manifest_root(file.parent)
        if root is None:
            continue
        findings = findings_in(lint_output(file, root, deadline, restored))
        if findings:
            reports.append(report(path, findings))
    if reports:
        hook_io.emit(hook_io.block(hook, "\n\n".join(reports)))


if __name__ == "__main__":
    with contextlib.suppress(Exception):
        main()
