# Spec: personal Marketplace Package

## Objective

`packages/personal` bundles sproott's own working conventions for coding agents: how to
write code comments, how to treat git signing failures, and how to name and shape tests.
It ships three instructions, one skill, and one hook that warns about comment clauses the
comment-style instruction says to cut. It is distributed through this repo's marketplace
as `personal`.

User stories:

- As a dev, the agent writes comments only for non-obvious intent, and gets a warning
  when an edit adds a comment that narrates history, a rejected path, or editorialises.
- As a dev, when a signed commit fails because KeePass is locked, the agent tells me and
  waits, and never disables signing or switches keys.
- As a dev, tests the agent writes or reviews use `should … when …` names, one behaviour
  per case, Arrange–Act–Assert, and a failure message on every assertion.

Success looks like: an agent in a repo that installs `personal` follows these conventions
without being told, and the comment-style hook catches the clause kinds a phrase match can
detect.

## Tech Stack

- APM CLI (`apm`), version recorded in `packages/personal/apm.lock.yaml`.
- Instructions: `.apm/instructions/<name>.instructions.md` with `description` frontmatter
  and optional `applyTo`.
- Skill: Anthropic Agent Skills format (`SKILL.md` with `name` + `description`).
- Hook: TypeScript (`src/hooks/comment_style_check.ts`) bundled to self-contained
  CommonJS by `bun run cli build personal`; runs under Node.js.
- Packaging: APM package `personal` (`apm.yml`, `includes: auto`), targets `claude` +
  `copilot`, no dependencies. Root `apm.yml` lists it under `marketplace.packages` with
  `source: ./packages/personal`, version `1.0.0`.

## Primitives

### Instruction: comment-style

- **File:** `.apm/instructions/comment-style.instructions.md`
- **Purpose:** keep code comments sparse and limited to non-obvious intent, in every
  language.
- **Scope:** global (no `applyTo`).
- **Requires of the agent:** before writing a comment, cut every clause that restates the
  code, describes another line, states what adjacent code or the compiler already proves,
  narrates a rejected path, narrates history, carries a measurement, or editorialises the
  choice. Keep only the part that says why a reader could get the line wrong; in doc
  comments, keep contract facts (units, invariants, preconditions, side effects, errors).
  Delete the comment only when nothing survives the cuts.

### Instruction: git-signing

- **File:** `.apm/instructions/git-signing.instructions.md`
- **Purpose:** explain that signing fails intermittently because the SSH signing key lives
  in KeePass and works only while the database is unlocked.
- **Scope:** global (no `applyTo`).
- **Requires of the agent:** on a signing error from any signing git operation, do not
  retry blindly, disable signing, or switch keys; tell the user KeePass likely needs
  unlocking, wait, then rerun the same command unchanged.

### Instruction: writing-tests

- **File:** `.apm/instructions/writing-tests.instructions.md`
- **Purpose:** short standing form of the test naming and structure conventions.
- **Scope:** `applyTo: "**/*.{test,spec}.*,**/*{Test,Tests,Spec}.{fs,cs,ts,tsx,js,jsx,java,kt,scala},**/*_test.{go,py,rb,exs},**/test_*.py,**/*_spec.rb"`.
- **Requires of the agent:** name cases `should <behaviour> when <condition>` without
  restating the unit; name the concrete error for failure cases; group by feature;
  Arrange–Act–Assert separated by blank lines; one behaviour per case; a failure message on
  every assertion; fail explicitly on impossible branches; fresh setup per case; FIRST.
  Points to the `writing-tests` skill for detail.

### Skill: writing-tests

- **File:** `.apm/skills/writing-tests/SKILL.md`
- **Purpose:** the full naming and structure guidance behind the writing-tests
  instruction. It triggers when writing or reviewing test cases or naming tests. It does
  not cover when to write tests or the red-green cycle.
- **Requires of the agent:** the instruction's rules, plus: the group path and case name
  read as a sentence; name behaviour, not mechanism; banned names (`works`,
  `handles errors`, …); multiple assertions only for facets of one outcome; unwrap helpers
  (`createOrFail`, `okOrFail`) still fail with a message; DAMP over DRY; a smells table
  mapping each smell to its fix. Examples are in F#/Expecto.

### Hook: comment-style

After an agent edits or creates a file, this hook scans only the comment lines the edit
_added_ for phrases that signal three of the comment-style instruction's clause kinds, and
warns the agent with each hit. It never blocks: the phrases also occur in legitimate
contract sentences, so the agent re-reads and decides.

User stories:

- As a dev, when the agent adds `# previously this used X` to a Python file, it receives a
  warning naming the file, line, clause kind and matched phrase.
- As a dev, comments that were already in the file, or that sit in context lines of a
  patch, never produce warnings.
- As a dev, edits to prose and data files (Markdown, JSON, …) are never scanned.

#### Assumptions

1. Checked clause kinds and their case-insensitive trigger patterns:
   - **narrates a rejected path**: `rather than`, `instead of`, `as opposed to`,
     `which would`, `not a`/`not an` (word-bounded), `not the`, `we stop at`.
   - **narrates history**: `previously`, `used to`, `no longer`, `formerly`, `once was`.
   - **editorialises the choice**: `cleaner`, `simpler`, `the right way`, `better`,
     `nicer`, `more elegant`.
     The other clause kinds in the instruction (restates the code, describes another line,
     states what is proven, carries a measurement) are not checked. A comment line reports
     at most one finding: the first kind, in the order above, with a matching pattern.
2. Comment syntax is chosen by file name:
   - basenames `makefile dockerfile justfile rakefile gemfile vagrantfile`
     (case-insensitive) ⇒ `#`;
   - skipped extensions: `.md .mdx .markdown .rst .txt .adoc .org .json .csv .tsv .lock
     .svg .patch .diff`;
   - C-like (`//`, `/* */`): `.c .h .cpp .cc .hpp .cs .java .js .jsx .mjs .cjs .ts .tsx
     .go .rs .swift .kt .kts .scala .php .dart .zig .gradle .proto .scss .less`;
   - `.css` ⇒ `/* */`; `.fs .fsi .fsx` ⇒ `//`, `(* *)`; `.ml .mli` ⇒ `(* *)`;
   - `#`: `.py .pyi .sh .bash .zsh .fish .rb .pl .pm .nix .yaml .yml .toml .r .jl .tf
     .tfvars .ps1 .ex .exs`;
   - `--`, `{- -}`: `.hs .hs-boot .lhs .cabal .elm .purs`; `.sql` ⇒ `--`, `/* */`;
     `.lua` ⇒ `--`, `--[[ ]]`;
   - `%`: `.erl .tex`; `;`: `.el .lisp .clj .cljs .scm .rkt`;
   - `<!-- -->`: `.html .htm .xml`; `.vue` ⇒ `//`, `/* */`, `<!-- -->`;
   - any other extension ⇒ `//`, `#`, `--`, `/* */`.
3. "Added" lines: the edit's new text is compared with its old text as multisets of
   trimmed lines; a new line is added when the old text has no unconsumed equal line.
   Old text comes from the change itself (Edit `old_string`, patch removed + context
   lines); when the change has none (whole-file writes, `apply_patch` Add File), the
   file's committed `HEAD` content from git is used, via the symlink-resolved path; no
   git or untracked file ⇒ every line counts as added.
4. Triggering tools: `WRITE_TOOLS` from the shared hook I/O layer. Host detection,
   tool-name normalisation and per-file old/new text extraction are specified in
   `docs/specs/hook-io/spec.md`. The hook config matcher is
   `Edit|Write|apply_patch|str_replace_editor|edit|create|write`; VS Code ignores matchers
   and runs the hook on every tool call, and the script filters by `WRITE_TOOLS`, which
   covers the VS Code edit tools. No `if:` scoping.
5. Requires `node` on the harness's `PATH`; `git` is optional. The bundle has no external
   module dependencies.

#### Behavior

Given a PostToolUse payload:

1. Read via `read('PostToolUse')`. Tool not in `WRITE_TOOLS` ⇒ exit 0, no output.
2. For each changed file: skip it when its name maps to a skipped extension or the change
   carries no new text. Otherwise determine its old text (Assumption 3; `git show` has a
   5 s timeout).
3. Split new text into lines (all Unicode line terminators). Walk lines extracting comment
   text:
   - line 0 starting with `#!` is skipped;
   - outside a block comment, a line whose trimmed text starts with `* ` is a comment when
     the language has `/* */` (a snippet may begin inside a block comment);
   - otherwise scan left to right, skipping `"`, `'` and `` ` `` quoted runs (backslash
     escapes), taking the text inside block delimiters, or the rest of the line after a
     line marker; an unclosed block carries to the next line. Block openers are checked
     before line markers, so `--[[` opens a Lua block and code after its `]]` is not
     comment text.
   - leading `/ * # ; % ! -` characters are stripped from the extracted text.
4. For each comment on an added line, test the clause patterns (Assumption 1); record
   `(trimmed source line, comment, kind, matched phrase)`.
5. Locate each finding by reading the file on disk: the line number of the first line
   whose trimmed text equals the finding's trimmed source line; not found or unreadable ⇒
   path only.
6. No findings ⇒ exit 0, no output. Otherwise emit one non-blocking `context` response in
   the host's schema (rendering per `docs/specs/hook-io/spec.md`): Claude Code and VS Code
   get `hookSpecificOutput.additionalContext`; Copilot CLI gets top-level
   `additionalContext` and, on a successful tool result, `modifiedResult` appending the
   text to `textResultForLlm`. Text: `comment-style check: N added comment line(s) match a
   clause the comment-style rule says to cut. Warning only — …`, a blank line, then per
   finding `- <path>[:<line>] — <kind>: "<phrase>"` followed by an indented line with the
   comment text.
7. Any unexpected exception ⇒ exit 0 with `emit(null, [failure("comment-style", error)])`: a `systemMessage` warning to the user, no block.

Hook timeout is 10 s. The hook config is `.apm/hooks/comment-style.json`: PostToolUse, one
handler, command
`sh -c 'cd "${CLAUDE_PROJECT_DIR:-$PWD}" && exec node ./comment_style_check.cjs'`, which
`apm install` rewrites to each target's deployed script path.

#### Code Style

Use the shared I/O module for payload parsing and responses. Keep the trigger patterns in
step with the instruction's clause list. Catch unexpected hook errors at the entry point.

## Commands

```
Build hook:      bun run cli build personal            # or: just build personal
Stale check:     bun run cli build personal --check
Deploy:          just install                          # or: cd packages/personal && apm install
Audit:           just audit
Test:            just test-bun
Single test:     bun run test packages/personal/tests/comment-style-check.test.ts
Manual check:    echo '<payload json>' | node packages/personal/.apm/hooks/comment_style_check.cjs
```

## Project Structure

```
packages/personal/
  apm.yml                                    → name: personal, version 1.0.0, targets claude+copilot,
                                               no dependencies, includes: auto
  apm.lock.yaml                              → deployed files and their hashes
  .gitignore                                 → ignores apm_modules/, __pycache__/
  .apm/
    instructions/
      comment-style.instructions.md          → global comment rule (enforced in part by the hook)
      git-signing.instructions.md            → global signing-failure rule
      writing-tests.instructions.md          → test conventions, applyTo test-file globs
    skills/
      writing-tests/SKILL.md                 → full test naming and structure guidance
    hooks/
      comment-style.json                     → PostToolUse hook config
      comment_style_check.cjs                → generated Node.js bundle
  src/hooks/comment_style_check.ts           → hook source
  tests/comment-style-check.test.ts          → Vitest tests
  .claude/                                   → apm install output (claude): rules/writing-tests.md,
                                               skills/writing-tests/, hooks/personal/, settings.json,
                                               apm-hooks.json
  .agents/skills/writing-tests/              → apm install output (copilot skill)
  .github/                                   → apm install output (copilot): instructions/*.instructions.md,
                                               hooks/personal-comment-style.json, hooks/scripts/personal/
packages/_shared/hook-io/hook-io.ts          → shared I/O layer (docs/specs/hook-io/spec.md)
scripts/cli/src/packages/authored-hooks.ts   → registers `personal` / `comment_style_check` for bundling
```

`.claude/`, `.agents/` and `.github/` are generated by `apm install` and never
hand-edited.

## Testing Strategy

The instructions and the skill are Markdown. They are checked by `apm install` (deploys
them) and `just audit` (no drift between sources and deployed outputs).

The hook has Vitest cases in `packages/personal/tests/comment-style-check.test.ts`. Each
case runs the hook under `node` in a fresh temp directory with payload JSON on stdin and
asserts on stdout. Most cases run the generated bundle; the Lua cases run the TypeScript
source directly. The symlink case builds a real git repository in the temp directory.
`just test-bun` also runs `bun run cli build personal --check`, so a stale bundle fails.

Cases:

- should warn only about added comments when a Copilot patch includes context lines
- should warn only about new comments when a write names a symlink
- Lua comments
  - should warn when a history comment appears inside a Lua block
  - should stay silent when a history phrase appears in code after a Lua block

Payload parsing and response rendering are tested in
`packages/_shared/hook-io/hook-io.test.ts`.

## Boundaries

- Always: edit primitives under `.apm/` and the hook under `src/`, then run
  `bun run cli build personal` and `apm install` to regenerate outputs; keep the hook's
  trigger patterns in step with the comment-style instruction; keep the writing-tests
  instruction and skill consistent; the hook warns and never blocks, scans only added
  comment lines, and on any hook failure warns the user without blocking.
- Ask first: adding or removing a primitive; changing an instruction's rules or
  `applyTo`; blocking on hook findings; adding clause kinds or patterns; scanning skipped
  file types.
- Never: rewrite the agent's file from the hook; hand-edit the generated `.cjs` or the
  `.claude/`/`.agents/`/`.github/` outputs; make the git-signing instruction suggest
  disabling signing or switching keys.

## Success Criteria

- [ ] `packages/personal/apm.yml` is valid: `name: personal`, targets `claude` + `copilot`.
- [ ] Three instructions (`comment-style`, `git-signing`, `writing-tests`) and one skill
      (`writing-tests`) exist under `.apm/`; only `writing-tests.instructions.md` has
      `applyTo`.
- [ ] `apm install` in `packages/personal` deploys the instructions to
      `.github/instructions/`, the scoped instruction to `.claude/rules/writing-tests.md`,
      the skill to `.claude/skills/writing-tests/` and `.agents/skills/writing-tests/`, and
      the hook to `.claude/` and `.github/hooks/`; `apm.lock.yaml` records each with its
      hash.
- [ ] `bun run cli build personal --check` reports the bundle current; `just audit` clean.
- [ ] A Claude Code `Edit` adding `# previously b` to `x.py` yields
      `hookSpecificOutput.additionalContext` containing `narrates history`, and no
      `decision`.
- [ ] A Copilot CLI edit with a successful `toolResult` yields `modifiedResult` that keeps
      the original text and appends the warning.
- [ ] Comments present before the edit, and edits to `.md`/`.json` files, yield no output.
- [ ] All test cases above pass via `just test-bun`.
