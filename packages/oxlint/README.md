# Oxlint and Oxfmt on edit

Install this hook in the repository that will use it (without `-g`):

```sh
apm install oxlint@sproott-ai
```

Use the repository's package manager to install `oxlint` and `oxfmt` as dev dependencies. Add both scripts to the repository root's `package.json`:

```json
{
  "scripts": {
    "lint:oxlint": "oxlint --format=agent --deny-warnings --no-error-on-unmatched-pattern",
    "format:oxfmt": "oxfmt --no-error-on-unmatched-pattern"
  }
}
```

For a project using [Effect's patched Oxlint](https://github.com/Effect-TS/tsgo), replace `oxlint` in `lint:oxlint` with `effect-tsgo oxlint --type-aware`. Keep any project-specific flags in the corresponding script. Omit file and directory arguments, `--fix`, and formatter check mode. The hook supplies `--fix` to lint and passes only the edited paths to both scripts. Leave existing whole-project `lint` and `format` scripts as they are.

The hook runs each script at most once per edit, from the repository root, with repository-relative paths. Nested `package.json` scripts are ignored. The root `packageManager` field or a root lockfile selects npm, pnpm, Yarn, or Bun; the default is npm. The hook does not install tools.

Oxlint runs first on edited JS, TS, Vue, Svelte, and Astro files. Oxfmt receives the edited files and handles supported formats. Missing scripts produce setup guidance, and configured scripts still run. Nonzero exits from completed scripts go back to the agent as findings, including warnings if your lint script uses `--deny-warnings`. A missing package manager or a script timeout does not block the agent.

Install only in trusted repositories: the hook executes their package scripts. Requires Node.js on the harness's `PATH` and a POSIX shell. Supports Claude Code, VS Code Copilot Chat, and Copilot CLI.
