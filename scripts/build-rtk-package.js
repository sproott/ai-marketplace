#!/usr/bin/env node
// Generates packages/rtk/.apm/ from the vendored vendor/rtk submodule, plus our own
// authored wrapper/installer scripts (which live in this repo, not vendor/rtk).
//
// Unlike caveman, we don't ship rtk's own hook unmodified: upstream's current hook is a
// native binary invocation with an absolute path baked in at `rtk init` time. We replace it
// with our own PATH-resolving wrapper (scripts/rtk/rtk-hook-wrapper.sh) and a PATH-shim
// installer (scripts/rtk/rtk-shim-install.sh) — see docs/specs/rtk-package/spec.md.
// apm.yml and README.md in the output dir are fixed, hand-authored sources — this script
// only ever touches .apm/.
//
// Mapping (source -> APM primitive):
//   vendor/rtk/hooks/claude/rtk-awareness.md      -> .apm/instructions/rtk-awareness.instructions.md
//   vendor/rtk/.claude/hooks/rtk-suggest.sh        -> .apm/hooks/rtk-suggest.sh + generated rtk-suggest.json
//   scripts/rtk/rtk-hook-wrapper.sh (authored here) -> .apm/hooks/rtk-hook-wrapper.sh + generated rtk-hook.json
//   scripts/rtk/rtk-shim-install.sh (authored here) -> .apm/hooks/rtk-shim-install.sh (wired to SessionStart)
//
// Usage: node scripts/build-rtk-package.js [--out <dir>] [--validate]

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const RTK_ROOT = path.resolve(REPO_ROOT, 'vendor', 'rtk');
const AUTHORED_ROOT = path.resolve(REPO_ROOT, 'scripts', 'rtk');

function opt(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const OUT_DIR = path.resolve(REPO_ROOT, opt('--out', 'packages/rtk'));
const VALIDATE = process.argv.includes('--validate');
const APM_DIR = path.join(OUT_DIR, '.apm');

// ---- fs helpers ----

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, fs.statSync(src).mode);
}

// ---- instructions: vendor/rtk/hooks/claude/rtk-awareness.md -> .apm/instructions/rtk-awareness.instructions.md ----

const INSTRUCTION_DESCRIPTION =
  'Standing rule for rtk (Rust Token Killer): meta-commands, install verification, and how the Claude Code hook rewrites commands.';

// Authored here, not vendored: the SessionStart install hook (rtk-shim-install.sh) only
// prints the PATH export line to its own stdout, which the user never sees. Without this
// section nothing durable ever tells Claude to relay that step, so shim installation silently
// stalls at "symlink created" and RTK_ACTIVE never reaches child processes.
const SHIM_ACTIVATION_ADDENDUM = `
## Shim Activation

The rtk PATH shim (\`~/.rtk/shim/rtk\`) is (re)installed automatically every session via a
\`SessionStart\` hook, but the installer never edits shell rc files — it only prints the PATH
export line to its own stdout, which the user does not see. Check once per session whether
\`~/.rtk/shim\` is on \`$PATH\`:

\`\`\`bash
echo "$PATH" | tr ':' '\\n' | grep -qx "$HOME/.rtk/shim" && echo on-path || echo not-on-path
\`\`\`

If \`not-on-path\`, tell the user to add this to their shell profile (\`~/.bashrc\` / \`~/.zshrc\`)
and open a new shell:

\`\`\`bash
export PATH="$HOME/.rtk/shim:$PATH"
\`\`\`
`;

function generateInstructions() {
  const src = path.join(RTK_ROOT, 'hooks', 'claude', 'rtk-awareness.md');
  const body = fs.readFileSync(src, 'utf8');
  const dest = path.join(APM_DIR, 'instructions', 'rtk-awareness.instructions.md');
  mkdirp(path.dirname(dest));
  fs.writeFileSync(
    dest,
    `---\ndescription: ${JSON.stringify(INSTRUCTION_DESCRIPTION)}\n---\n\n${body}\n${SHIM_ACTIVATION_ADDENDUM}`
  );
}

// ---- hooks ----
//
// Hook scripts are copied flat alongside their descriptor so APM's hook integrator
// resolves sibling references (see docs/producer/author-primitives/hooks-and-commands.md).
// Descriptors use relative `./` command paths, which resolve against the hook file's own
// directory once deployed.
//
// PreToolUse + matcher shape confirmed empirically (Task 4, docs/tasks/rtk-package/todo.md):
// apm's compiler preserves an explicit `matcher` verbatim (it only defaults to "*" when a
// descriptor omits it, as caveman's SessionStart/UserPromptSubmit entries do).

function generateSuggestHook() {
  const destDir = path.join(APM_DIR, 'hooks');
  copyFile(path.join(RTK_ROOT, '.claude', 'hooks', 'rtk-suggest.sh'), path.join(destDir, 'rtk-suggest.sh'));

  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: './rtk-suggest.sh',
          },
        ],
      },
    ],
  };
  mkdirp(destDir);
  fs.writeFileSync(path.join(destDir, 'rtk-suggest.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

function generateWrapperHook() {
  const destDir = path.join(APM_DIR, 'hooks');
  copyFile(path.join(AUTHORED_ROOT, 'rtk-hook-wrapper.sh'), path.join(destDir, 'rtk-hook-wrapper.sh'));

  // Claude Code invokes the PreToolUse command exactly as written in settings.json — it
  // appends no argv of its own, only pipes the hook JSON payload over stdin. `hook claude`
  // must therefore be hardcoded here, matching how upstream's own native hook hardcodes an
  // absolute-path + `hook claude` command at `rtk init` time (see spec Objective).
  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: './rtk-hook-wrapper.sh hook claude',
          },
        ],
      },
    ],
  };
  mkdirp(destDir);
  fs.writeFileSync(path.join(destDir, 'rtk-hook.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

function generateShimInstallHook() {
  const destDir = path.join(APM_DIR, 'hooks');
  copyFile(path.join(AUTHORED_ROOT, 'rtk-shim-install.sh'), path.join(destDir, 'rtk-shim-install.sh'));

  const descriptor = {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: './rtk-shim-install.sh',
            timeout: 5,
            statusMessage: 'Installing rtk PATH shim...',
          },
        ],
      },
    ],
  };
  mkdirp(destDir);
  fs.writeFileSync(path.join(destDir, 'rtk-shim-install.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

function main() {
  if (!fs.existsSync(RTK_ROOT) || fs.readdirSync(RTK_ROOT).length === 0) {
    console.error(`vendor/rtk not found at ${RTK_ROOT} — run "git submodule update --init"`);
    process.exit(1);
  }

  fs.rmSync(APM_DIR, { recursive: true, force: true });
  mkdirp(APM_DIR);

  generateInstructions();
  generateSuggestHook();
  generateWrapperHook();
  generateShimInstallHook();

  console.log(`Generated ${path.relative(REPO_ROOT, APM_DIR)}`);

  if (VALIDATE) {
    execFileSync('apm', ['compile', '--validate'], { cwd: OUT_DIR, stdio: 'inherit' });
  }
}

main();
