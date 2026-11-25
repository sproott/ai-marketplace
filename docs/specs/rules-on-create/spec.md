# Spec: rules-on-create Marketplace Package

## Objective

Path-scoped rules (`.claude/rules/*.md` with `paths:` frontmatter) load natively when the
agent reads a matching file. A file the agent is about to _create_ has never been read, so
its rules never load. This hook closes that gap: before a write that creates a new file
matching a rule's `paths:` globs, it denies the write once per session per rule and puts
the rule body in the denial reason, so the agent reads the rule and re-issues a compliant
write.

Ships as the marketplace package `rules-on-create`.

User stories:

- As a dev with `.claude/rules/tests.md` scoped to `src/**/test*.ts`, when the agent
  creates `src/a/test1.ts`, the first attempt is denied with the rule text and the retry
  goes through.
- As a dev, the agent is interrupted at most once per rule per session; later new files
  matching the same rule are written without a denial.
- As a dev, writes to files that already exist, and non-writing tools, are never
  interrupted.

## Assumptions

1. Rule sources, in load order: `~/.claude/rules/*.md` (user), then
   `<project root>/.claude/rules/*.md` (project), each directory's entries sorted by name.
   A missing directory is skipped. Rule name = file name without `.md`.
2. Project root = `CLAUDE_PROJECT_DIR`, else the process cwd. The hook command `cd`s to
   `${CLAUDE_PROJECT_DIR:-$PWD}` first, so relative payload paths resolve against it.
3. A rule is a file starting with `---` and containing a closing `\n---`. In that
   frontmatter, only the top-level `paths:` key is read: either a scalar
   (`paths: src/*.ts`, surrounding quotes stripped) or a block list of `- item` lines
   (quotes stripped). Other keys are ignored. A file without frontmatter or without any
   `paths:` glob is not a rule. Body = text after the closing `---`, trimmed. CRLF/CR are
   normalised to LF.
4. Glob semantics are fnmatch-like: `*` matches any run of characters including `/`
   (consecutive `*` collapse to one), `?` one character, `[...]`/`[!...]` a character
   class, `{a,b}` brace alternatives (expanded first, nestable). A glob matches if it
   matches the whole of any candidate: the absolute path, the path relative to the project
   root, or the basename. A glob that compiles to an invalid regex never matches.
5. "New file" = `existsSync(path)` is false at PreToolUse time.
6. Triggering tools: `CREATE_TOOLS` from the shared hook I/O layer (`write`, `create`,
   `apply_patch`, `str_replace_editor`, `create_file`). Host detection, tool-name
   normalisation and changed-path extraction (including `apply_patch` Add/Update/Move
   targets) are specified in `docs/specs/hook-io/spec.md`.
   The hook config matcher is `Write|apply_patch|str_replace_editor|create|write`. Claude
   Code fires on `Write` only (`Edit` cannot create a file). Copilot CLI fires on its
   matching tool names. VS Code ignores matchers and runs the hook on every tool call; the
   script filters by `CREATE_TOOLS`, which covers `create_file`. No `if:` scoping.
7. "Seen" state is a marker file `/tmp/claude-rules-on-create/<session id>/<rule name>`.
   A payload without a session id uses `nosession`, shared by every sessionless call.
8. Requires `node` on the harness's `PATH`; the bundle has no external module
   dependencies.

## Tech Stack

- Hook: TypeScript (`src/hooks/rules_on_create.ts` entry, `rules_on_create_match.ts` rule
  loading and glob matching) bundled to self-contained CommonJS by
  `bun run cli build rules-on-create`; runs under Node.js.
- Packaging: APM package (`apm.yml` + `.apm/hooks/`), targets `claude` + `copilot`.

## Behavior

Given a PreToolUse payload:

1. Read via `read('PreToolUse')`. Tool not in `CREATE_TOOLS` ⇒ exit 0, no output.
2. Keep changed paths that do not exist yet. None ⇒ exit 0, no output.
3. Load rules (Assumption 1) and match each new path (Assumptions 3–4). Matches are keyed
   by rule name; if a user rule and a project rule share a name, one entry survives (the
   last one matched). No match ⇒ exit 0, no output.
4. Session id = payload `session_id`/`sessionId`, else `nosession`. An id equal to `.` or
   `..` or containing `/`, `\` or NUL ⇒ exit 0, no output.
5. Create the session marker directory. For each matched rule, create its marker with
   exclusive-create; an existing marker means the rule was already surfaced this session
   and the rule is dropped. No unseen rules left ⇒ exit 0, no output.
6. Emit one denial through `deny` from `hook-io.ts`, in the schema of the host that sent
   the payload:
   - Claude Code / VS Code: `hookSpecificOutput` with `hookEventName: "PreToolUse"`,
     `permissionDecision: "deny"`, `permissionDecisionReason`.
   - Copilot CLI: top-level `permissionDecision: "deny"` and `permissionDecisionReason`.
     Reason text: ``Path-scoped rule(s) govern the new file(s) `<path>`, … Read them, then
     re-issue the write to comply — this block clears once per session.`` followed by one
     `### \`<rule name>\`` section per unseen rule with its body. Paths are the payload
     paths as given, deduplicated.
7. Any exception (unreadable rule file, marker directory not writable, …) ⇒ exit 0 with
   `emit(null, [failure("rules-on-create", error)])`: a `systemMessage` warning to the
   user, no denial; the write proceeds.

Markers are written before the denial is emitted, so the retry passes. A denied
`apply_patch` is denied as a whole, including any non-matching files in the same patch.

Hook timeout is 10 s.

## Commands

```
Build:           bun run cli build rules-on-create          # or: just build rules-on-create
Stale check:     bun run cli build rules-on-create --check
Deploy:          just install                               # or: cd packages/rules-on-create && apm install
Audit:           just audit
Test:            just test-bun
Single test:     bun run test packages/rules-on-create/tests/rules-on-create-hook.test.ts
Manual check:    echo '<payload json>' | node packages/rules-on-create/.apm/hooks/rules_on_create.cjs
Reset session:   rm -rf /tmp/claude-rules-on-create/<session id>
```

## Project Structure

```
packages/rules-on-create/
  apm.yml                             → name: rules-on-create, version 1.0.0, targets claude+copilot
  .apm/hooks/
    rules-on-create.json              → PreToolUse, timeout 10, one handler, matcher
                                        Write|apply_patch|str_replace_editor|create|write,
                                        command sh -c 'cd "${CLAUDE_PROJECT_DIR:-$PWD}" && exec node ./rules_on_create.cjs'
    rules_on_create.cjs               → generated Node.js bundle
  src/hooks/rules_on_create.ts        → entry: filter, session markers, denial
  src/hooks/rules_on_create_match.ts  → rule loading, frontmatter parsing, glob matching
  tests/rules-on-create-hook.test.ts  → Vitest tests
  (.claude/, .github/ …)              → apm install outputs, never hand-edited
apm.yml (root)                        → marketplace.packages entry `rules-on-create`
packages/_shared/hook-io/hook-io.ts   → shared I/O layer (docs/specs/hook-io/spec.md)
scripts/cli/src/packages/authored-hooks.ts → registers `rules-on-create` / `rules_on_create` for bundling
```

## Code Style

Use the shared I/O module for payload parsing and responses. Keep rule parsing and
matching in `rules_on_create_match.ts`, free of hook I/O. Catch unexpected hook errors at
the entry point.

## Testing Strategy

Vitest cases in `packages/rules-on-create/tests/rules-on-create-hook.test.ts` create a
temporary project with a `.claude/rules/style.md` rule scoped to
`'src/*/test[0-9].{ts,tsx}'` (exercising quotes, `*` across directories, a character class
and braces), point `HOME` at an empty temp dir and `CLAUDE_PROJECT_DIR` at the project,
use a unique session id per case, pass payload JSON to the Node bundle, and assert on
stdout. Each case removes its marker directory afterwards.

Cases:

- should deny once per session when a Claude write creates a matching path
- should include the added path when a Copilot patch matches a rule
- should deny when a VS Code create_file call targets a matching path
- should stay silent when a matching path already exists
- should stay silent when a Read call targets a matching path

Payload parsing and response rendering are tested in
`packages/_shared/hook-io/hook-io.test.ts`.

## Boundaries

- Always: deny only for new files matching a rule; surface each rule at most once per
  session; let the write through on any hook failure, warning the user; edit `src/`, then run
  `bun run cli build rules-on-create` and `apm install` to regenerate outputs.
- Ask first: reading rule locations beyond `~/.claude/rules` and `<root>/.claude/rules`,
  changing the marker location, firing on edits of existing files.
- Never: deny writes to existing files; block on hook breakage; hand-edit the generated
  `.cjs` or the `.claude/`/`.github/` outputs.

## Success Criteria

- [ ] `packages/rules-on-create` is listed in the root `apm.yml` marketplace; `just audit`
      clean.
- [ ] `bun run cli build rules-on-create --check` reports the bundle current.
- [ ] In a fixture project with a `paths:` rule, a Claude Code `Write` creating a matching
      file is denied once with the rule body in `permissionDecisionReason`; the identical
      retry in the same session produces no output.
- [ ] A Copilot CLI `apply_patch` adding a matching file gets a top-level denial.
- [ ] Writing an existing matching file, or any non-creating tool, produces no output.
- [ ] All test cases above pass via `just test-bun`.
