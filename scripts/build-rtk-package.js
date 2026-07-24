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
//   scripts/rtk/rtk-rewrite-extra.sh (authored here) -> .apm/hooks/rtk-rewrite-extra.sh + generated rtk-rewrite-extra.json
//   scripts/rtk/rtk-hook-wrapper.sh (authored here) -> .apm/hooks/rtk-hook-wrapper.sh + generated rtk-hook.json
//   scripts/rtk/rtk-shim-install.sh (authored here) -> .apm/hooks/rtk-shim-install.sh (wired to SessionStart)
//   scripts/rtk/rtk-shim-gate.sh (authored here)    -> .apm/hooks/rtk-shim-gate.sh (PreToolUse Bash deny-until-on-PATH)
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

// Authored here, not vendored: RTK_ACTIVE only reaches child processes when the shim dir is
// on $PATH, and the SessionStart installer can't edit shell rc to put it there. A PreToolUse
// gate (rtk-shim-gate.sh) enforces this by denying Bash until it's active; this section tells
// Claude what that denial means and how to get the user to resolve it.
const SHIM_ACTIVATION_ADDENDUM = `
## Shim Activation

The rtk PATH shim (\`~/.rtk/shim/rtk\`) is (re)installed automatically every session via a
\`SessionStart\` hook, but it only takes effect once \`~/.rtk/shim\` is on \`$PATH\` — which
needs a shell rc edit the installer does not make. Until then, a \`PreToolUse\` gate **denies
every Bash command** with an \`RTK shim not on PATH\` reason.

**If Bash is denied for that reason, stop and get the user to activate the shim before
anything else.** Tell them to add this line to their shell profile (\`~/.bashrc\` / \`~/.zshrc\`)
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

// Authored auto-rewrites for commands rtk's own `hook claude` has no rule for.
function generateRewriteExtraHook() {
  const destDir = path.join(APM_DIR, 'hooks');
  copyFile(path.join(AUTHORED_ROOT, 'rtk-rewrite-extra.sh'), path.join(destDir, 'rtk-rewrite-extra.sh'));

  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: './rtk-rewrite-extra.sh',
          },
        ],
      },
    ],
  };
  mkdirp(destDir);
  fs.writeFileSync(path.join(destDir, 'rtk-rewrite-extra.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

// Blocks Bash until the shim dir is on $PATH — the enforcement the SessionStart installer
// can't provide, since it may not edit the user's shell rc.
function generateShimGateHook() {
  const destDir = path.join(APM_DIR, 'hooks');
  copyFile(path.join(AUTHORED_ROOT, 'rtk-shim-gate.sh'), path.join(destDir, 'rtk-shim-gate.sh'));

  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: './rtk-shim-gate.sh',
          },
        ],
      },
    ],
  };
  mkdirp(destDir);
  fs.writeFileSync(path.join(destDir, 'rtk-shim-gate.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
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
  generateRewriteExtraHook();
  generateWrapperHook();
  generateShimInstallHook();
  generateShimGateHook();

  console.log(`Generated ${path.relative(REPO_ROOT, APM_DIR)}`);

  if (VALIDATE) {
    execFileSync('apm', ['compile', '--validate'], { cwd: OUT_DIR, stdio: 'inherit' });
  }
}

main();
