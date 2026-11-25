import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { context, emit, read, WRITE_TOOLS } from "../../../_shared/hook-io/hook-io.ts";

type Markers = readonly [readonly string[], readonly (readonly [string, string])[]];

const SKIP_EXT = new Set(".md .mdx .markdown .rst .txt .adoc .org .json .csv .tsv .lock .svg .patch .diff".split(" "));
const C_LIKE: Markers = [["//"], [["/*", "*/"]]];
const HASH: Markers = [["#"], []];
const DEFAULT_MARKERS: Markers = [["//", "#", "--"], [["/*", "*/"]]];
const HASH_BASENAMES = new Set("makefile dockerfile justfile rakefile gemfile vagrantfile".split(" "));
const MARKER_GROUPS: readonly (readonly [Markers, string])[] = [
  [C_LIKE, ".c .h .cpp .cc .hpp .cs .java .js .jsx .mjs .cjs .ts .tsx .go .rs"],
  [C_LIKE, ".swift .kt .kts .scala .php .dart .zig .gradle .proto .scss .less"],
  [[[], [["/*", "*/"]]], ".css"],
  [[["//"], [["(*", "*)"]]], ".fs .fsi .fsx"],
  [[[], [["(*", "*)"]]], ".ml .mli"],
  [HASH, ".py .pyi .sh .bash .zsh .fish .rb .pl .pm .nix .yaml .yml .toml"],
  [HASH, ".r .jl .tf .tfvars .ps1 .ex .exs"],
  [[["--"], [["{-", "-}"]]], ".hs .hs-boot .lhs .cabal .elm .purs"],
  [[["--"], [["/*", "*/"]]], ".sql"],
  [[["--"], [["--[[", "]]"]]], ".lua"],
  [[["%"], []], ".erl .tex"],
  [[[";"], []], ".el .lisp .clj .cljs .scm .rkt"],
  [[[], [["<!--", "-->"]]], ".html .htm .xml"],
  [[["//"], [["/*", "*/"], ["<!--", "-->"]]], ".vue"],
];
const MARKERS = new Map(MARKER_GROUPS.flatMap(([markers, extensions]) =>
  extensions.split(" ").map((ext) => [ext, markers] as const),
));

const CLAUSES = [
  ["narrates a rejected path", [
    /rather than/i, /instead of/i, /as opposed to/i, /which would/i,
    /\bnot an?\b/i, /\bnot the\b/i, /we stop at/i,
  ]],
  ["narrates history", [/previously/i, /used to\b/i, /no longer/i, /formerly/i, /\bonce was\b/i]],
  ["editorialises the choice", [
    /\bcleaner\b/i, /\bsimpler\b/i, /the right way/i, /\bbetter\b/i, /\bnicer\b/i, /more elegant/i,
  ]],
] as const;

function markersFor(path: string): Markers | undefined {
  const base = basename(path).toLowerCase();
  const ext = extname(base);

  if (HASH_BASENAMES.has(base)) return HASH;

  return SKIP_EXT.has(ext) ? undefined : MARKERS.get(ext) ?? DEFAULT_MARKERS;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);

  if (lines.at(-1) === "") lines.pop();

  return lines;
}

function commentAt(line: string, [lineMarkers, blocks]: Markers, closer: string | undefined): [string, string | undefined] {
  const parts: string[] = [];
  let i = 0;
  let quote: string | undefined;

  while (i < line.length) {
    const char = line[i];

    if (closer !== undefined) {
      const end = line.indexOf(closer, i);

      if (end === -1) return [[...parts, line.slice(i)].join(" "), closer];

      parts.push(line.slice(i, end));
      i = end + closer.length;
      closer = undefined;
    } else if (quote !== undefined) {
      if (char === quote) quote = undefined;

      i += char === "\\" ? 2 : 1;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      i += 1;
    } else {
      const marker = lineMarkers.find((candidate) => line.startsWith(candidate, i));

      if (marker !== undefined) return [[...parts, line.slice(i + marker.length)].join(" "), undefined];

      const block = blocks.find(([opener]) => line.startsWith(opener, i));

      if (block !== undefined) {
        i += block[0].length;
        closer = block[1];
      } else {
        i += 1;
      }
    }
  }

  return [parts.join(" "), closer];
}

function* commentsIn(lines: readonly string[], markers: Markers): Generator<[number, string]> {
  let closer: string | undefined;

  for (const [index, line] of lines.entries()) {
    if (index === 0 && line.startsWith("#!")) continue;

    const stripped = line.trimStart();

    // A replacement snippet can start inside a block comment.
    if (closer === undefined && stripped.startsWith("* ") && markers[1].some(([open, close]) => open === "/*" && close === "*/")) {
      yield [index, stripped.slice(1)];
      continue;
    }

    const [text, nextCloser] = commentAt(line, markers, closer);
    closer = nextCloser;
    const comment = text.trim().replace(/^[/*#;%!-]+/u, "").trim();

    if (comment) yield [index, comment];
  }
}

function addedIndices(lines: readonly string[], oldText: string | null): Set<number> {
  const budget = new Map<string, number>();
  const added = new Set<number>();

  for (const line of splitLines(oldText ?? "")) {
    const key = line.trim();
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }

  for (const [index, line] of lines.entries()) {
    const key = line.trim();
    const count = budget.get(key) ?? 0;

    if (count > 0) budget.set(key, count - 1);
    else added.add(index);
  }

  return added;
}

function gitHeadText(path: string): string | null {
  let absolute = resolve(path);

  try {
    absolute = realpathSync(path);
  } catch {
    // A path in the tool payload can be absent even when Git tracks it.
  }

  try {
    return execFileSync("git", ["-C", dirname(absolute), "show", `HEAD:./${basename(absolute)}`], {
      encoding: "utf8",
      maxBuffer: Infinity,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

function fileLineNumbers(path: string): Map<string, number> {
  const numbers = new Map<string, number>();

  try {
    for (const [index, line] of splitLines(readFileSync(path, "utf8")).entries()) {
      const key = line.trim();

      if (!numbers.has(key)) numbers.set(key, index + 1);
    }
  } catch {
    return numbers;
  }

  return numbers;
}

function findingsFor(lines: readonly string[], oldText: string | null, markers: Markers) {
  const added = addedIndices(lines, oldText);
  const findings: { raw: string; comment: string; label: string; phrase: string }[] = [];

  for (const [index, comment] of commentsIn(lines, markers)) {
    const line = lines[index];

    if (line === undefined || !added.has(index)) continue;

    for (const [label, patterns] of CLAUSES) {
      const hit = patterns.find((pattern) => pattern.test(comment))?.exec(comment)?.[0];

      if (hit !== undefined) {
        findings.push({ raw: line.trim(), comment, label, phrase: hit });
        break;
      }
    }
  }

  return findings;
}

function main(): void {
  const hook = read("PostToolUse");

  if (!WRITE_TOOLS.has(hook.tool)) return;

  const blocks: string[] = [];

  for (const change of hook.changes) {
    const markers = markersFor(change.path);

    if (markers === undefined || change.new_text === null) continue;

    const oldText = change.old_text ?? gitHeadText(change.path);
    const findings = findingsFor(splitLines(change.new_text), oldText, markers);

    if (findings.length === 0) continue;

    const numbers = fileLineNumbers(change.path);

    for (const { raw, comment, label, phrase } of findings) {
      const number = numbers.get(raw);
      const location = number === undefined ? change.path : `${change.path}:${number}`;
      blocks.push(`- ${location} — ${label}: "${phrase}"\n    ${comment}`);
    }
  }

  if (blocks.length === 0) return;

  emit(context(hook,
    `comment-style check: ${blocks.length} added comment line(s) match a clause ` +
    "the comment-style rule says to cut. Warning only — nothing was blocked, " +
    "and these markers do occur in legitimate contract sentences. Re-read each " +
    "one and cut the offending clause if it is the banned kind; keep any " +
    `non-obvious-intent core.\n\n${blocks.join("\n")}`,
  ));
}

try {
  main();
} catch {
  // An advisory hook must not interrupt the agent.
}
