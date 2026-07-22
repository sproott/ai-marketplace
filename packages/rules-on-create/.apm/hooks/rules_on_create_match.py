#!/usr/bin/env python3
"""Match a file path against the `paths:` frontmatter globs of rule files.

Pure matcher, no I/O beyond reading rule files, so the matching logic stays unit-testable.
"""
from __future__ import annotations

import fnmatch
import os
import re
from dataclasses import dataclass


RULE_DIRS = [
    os.path.expanduser("~/.claude/rules"),
    os.path.join(os.getcwd(), ".claude", "rules"),
]


@dataclass
class Rule:
    name: str
    path: str
    globs: list[str]
    body: str


def _expand_braces(pattern: str) -> list[str]:
    match = re.search(r"\{([^{}]*)\}", pattern)
    if not match:
        return [pattern]
    pre, post = pattern[: match.start()], pattern[match.end() :]
    out: list[str] = []
    for option in match.group(1).split(","):
        out.extend(_expand_braces(pre + option + post))
    return out


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    head, body = text[3:end], text[end + 4 :]
    fm: dict = {}
    key = None
    for raw in head.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        list_item = re.match(r"\s*-\s+(.*)$", line)
        if list_item and key:
            fm.setdefault(key, []).append(list_item.group(1).strip().strip("\"'"))
            continue
        kv = re.match(r"(\w+):\s*(.*)$", line)
        if kv:
            key = kv.group(1)
            value = kv.group(2).strip().strip("\"'")
            fm[key] = value if value else []
    return fm, body.lstrip("\n")


def load_rules() -> list[Rule]:
    rules: list[Rule] = []
    for directory in RULE_DIRS:
        if not os.path.isdir(directory):
            continue
        for entry in sorted(os.listdir(directory)):
            if not entry.endswith(".md"):
                continue
            full = os.path.join(directory, entry)
            with open(full, encoding="utf-8") as handle:
                fm, body = _parse_frontmatter(handle.read())
            paths = fm.get("paths")
            if isinstance(paths, list):
                globs = paths
            elif isinstance(paths, str) and paths:
                globs = [paths]
            else:
                globs = []
            if globs:
                rules.append(Rule(entry[:-3], full, globs, body))
    return rules


def _candidates(file_path: str) -> list[str]:
    abs_path = os.path.abspath(file_path)
    rel = os.path.relpath(abs_path, os.getcwd())
    return [abs_path, rel, os.path.basename(abs_path)]


def match(file_path: str, rules: list[Rule] | None = None) -> list[Rule]:
    rules = load_rules() if rules is None else rules
    candidates = _candidates(file_path)
    matched: list[Rule] = []
    for rule in rules:
        patterns = [p for glob in rule.globs for p in _expand_braces(glob)]
        if any(fnmatch.fnmatch(c, pat) for c in candidates for pat in patterns):
            matched.append(rule)
    return matched


if __name__ == "__main__":
    import sys

    for rule in match(sys.argv[1]):
        print(rule.name)
