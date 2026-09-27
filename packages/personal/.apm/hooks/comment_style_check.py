#!/usr/bin/env python3
"""Warn when an ADDED comment line carries a clause the comment-style rule bans.

PostToolUse hook. Catches the three banned clauses that have a clean
surface marker — rejected path, history, editorialising — on comment lines the tool
call actually introduced. Measurement and restatement have no such marker and stay a
judgement call.

Never blocks: the markers occur in legitimate contract sentences, so a false positive
must cost a glance, not a retry.
"""
import contextlib
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

# Imports must not leave __pycache__ inside the deployed hooks dir of a consumer repo.
sys.dont_write_bytecode = True
import hook_io

Markers = tuple[list[str], list[tuple[str, str]]]

# Extensions whose `#`/`--`/`;` are prose or data, never comments.
SKIP_EXT = set(
    ".md .mdx .markdown .rst .txt .adoc .org .json".split()
    + ".csv .tsv .lock .svg .patch .diff".split(),
)

C_LIKE = (["//"], [("/*", "*/")])
HASH = (["#"], [])
FSHARP = (["//"], [("(*", "*)")])
ML = ([], [("(*", "*)")])
HASKELL = (["--"], [("{-", "-}")])
MARKERS = {ext: markers for markers, exts in [
    (C_LIKE, ".c .h .cpp .cc .hpp .cs .java .js .jsx .mjs .cjs .ts .tsx .go .rs"),
    (C_LIKE, ".swift .kt .kts .scala .php .dart .zig .gradle .proto .scss .less"),
    (([], [("/*", "*/")]), ".css"),
    (FSHARP, ".fs .fsi .fsx"),
    (ML, ".ml .mli"),
    (HASH, ".py .pyi .sh .bash .zsh .fish .rb .pl .pm .nix .yaml .yml .toml"),
    (HASH, ".r .jl .tf .tfvars .ps1 .ex .exs"),
    (HASKELL, ".hs .hs-boot .lhs .cabal .elm .purs"),
    ((["--"], [("/*", "*/")]), ".sql"),
    ((["--"], [("--[[", "]]")]), ".lua"),
    ((["%"], []), ".erl .tex"),
    (([";"], []), ".el .lisp .clj .cljs .scm .rkt"),
    (([], [("<!--", "-->")]), ".html .htm .xml"),
    ((["//"], [("/*", "*/"), ("<!--", "-->")]), ".vue"),
] for ext in exts.split()}
DEFAULT_MARKERS = (["//", "#", "--"], [("/*", "*/")])
BASENAME_MARKERS = dict.fromkeys(
    "makefile dockerfile justfile rakefile gemfile vagrantfile".split(),
    HASH,
)

CLAUSES = [
    ("narrates a rejected path",
     [r"rather than", r"instead of", r"as opposed to", r"which would",
      r"\bnot an?\b", r"\bnot the\b", r"we stop at"]),
    ("narrates history",
     [r"previously", r"used to\b", r"no longer", r"formerly", r"\bonce was\b"]),
    ("editorialises the choice",
     [r"\bcleaner\b", r"\bsimpler\b", r"the right way", r"\bbetter\b", r"\bnicer\b",
      r"more elegant"]),
]


def markers_for(path: str) -> Markers | None:
    base = Path(path).name.lower()
    ext = Path(base).suffix
    if base in BASENAME_MARKERS:
        return BASENAME_MARKERS[base]
    return None if ext in SKIP_EXT else MARKERS.get(ext, DEFAULT_MARKERS)


def _comment_at(
    line: str, markers: Markers, closer: str | None,
) -> tuple[str, str | None]:
    """Comment text on one line, plus the block-comment closer still open at its end.

    Quote state is tracked so a marker inside a string literal (`"http://x"`) is not
    read as a comment opener.
    """
    line_markers, blocks = markers
    parts, i, quote = [], 0, None
    while i < len(line):
        if closer:
            end = line.find(closer, i)
            if end == -1:
                return " ".join([*parts, line[i:]]), closer
            parts.append(line[i:end])
            i, closer = end + len(closer), None
        elif quote:
            if line[i] == quote:
                quote = None
            i += 2 if line[i] == "\\" else 1
        elif line[i] in "\"'`":
            quote = line[i]
            i += 1
        else:
            marker = next((m for m in line_markers if line.startswith(m, i)), None)
            if marker:
                return " ".join([*parts, line[i + len(marker):]]), None
            block = next((b for b in blocks if line.startswith(b[0], i)), None)
            if block:
                i, closer = i + len(block[0]), block[1]
            else:
                i += 1
    return " ".join(parts), closer


def comments_in(lines: list[str], markers: Markers) -> list[tuple[int, str]]:
    """(index, comment text) per line carrying comment prose."""
    out, closer = [], None
    for idx, line in enumerate(lines):
        if idx == 0 and line.startswith("#!"):
            continue
        stripped = line.lstrip()
        # A continuation line of a C-style block reaching this hook without its opener.
        if closer is None and stripped.startswith("* ") and ("/*", "*/") in markers[1]:
            out.append((idx, stripped[1:]))
            continue
        text, closer = _comment_at(line, markers, closer)
        text = text.strip().lstrip("/*-#;%!").strip()
        if text:
            out.append((idx, text))
    return out


def added_indices(lines: list[str], old_text: str | None) -> set[int]:
    """Return the indices of lines old_text does not already account for (multiset)."""
    budget = Counter(line.strip() for line in (old_text or "").splitlines())
    added = set()
    for idx, line in enumerate(lines):
        if budget[line.strip()]:
            budget[line.strip()] -= 1
        else:
            added.add(idx)
    return added


def git_head_text(path: str) -> str | None:
    try:
        return subprocess.run(
            ["git", "-C", str(Path(path).resolve().parent),
             "show", f"HEAD:./{Path(path).name}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout
    except Exception:
        return None


def file_line_numbers(path: str) -> dict[str, int]:
    """First 1-based line number per stripped line text in the file as written."""
    try:
        lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return {}
    numbers = {}
    for n, line in enumerate(lines, 1):
        numbers.setdefault(line.strip(), n)
    return numbers


def findings_for(
    lines: list[str], old_text: str | None, markers: Markers,
) -> list[tuple[str, str, str, str]]:
    added = added_indices(lines, old_text)
    out = []
    for idx, comment in comments_in(lines, markers):
        if idx not in added:
            continue
        for label, patterns in CLAUSES:
            matches = (re.search(p, comment, re.IGNORECASE) for p in patterns)
            hit = next(filter(None, matches), None)
            if hit:
                out.append((lines[idx].strip(), comment, label, hit.group(0)))
                break
    return out


def main() -> None:
    hook = hook_io.read("PostToolUse")
    if hook.tool not in hook_io.WRITE_TOOLS:
        return
    blocks = []
    for change in hook.changes:
        markers = markers_for(change.path)
        if markers is None or change.new_text is None:
            continue
        # A whole-file change has no old text of its own, so the baseline comes from git.
        old_text = change.old_text if change.old_text is not None else git_head_text(change.path)
        findings = findings_for(change.new_text.splitlines(), old_text, markers)
        numbers = file_line_numbers(change.path) if findings else {}
        for raw, comment, label, phrase in findings:
            loc = f"{change.path}:{numbers[raw]}" if raw in numbers else change.path
            blocks.append(f'- {loc} — {label}: "{phrase}"\n    {comment}')
    if not blocks:
        return

    context = (
        f"comment-style check: {len(blocks)} added comment line(s) match a clause "
        f"the comment-style rule says to cut. Warning only — nothing was blocked, "
        f"and these markers do occur in legitimate contract sentences. Re-read each "
        f"one and cut the offending clause if it is the banned kind; keep any "
        f"non-obvious-intent core.\n\n" + "\n".join(blocks)
    )
    hook_io.emit(hook_io.context(hook, context))


if __name__ == "__main__":
    with contextlib.suppress(Exception):
        main()
