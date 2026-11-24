#!/usr/bin/env bun
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
//   scripts/rtk/rtk-hook-io.sh (authored here)       -> .apm/hooks/rtk-hook-io.sh (sourced by the two authored hooks)
//   scripts/rtk/rtk-rewrite-extra.sh (authored here) -> .apm/hooks/rtk-rewrite-extra.sh + generated rtk-rewrite-extra.json
//   scripts/rtk/rtk-hook-wrapper.sh (authored here) -> .apm/hooks/rtk-hook-wrapper.sh + generated rtk-hook.json
//   scripts/rtk/rtk-shim-install.sh (authored here) -> .apm/hooks/rtk-shim-install.sh (wired to SessionStart)
//   scripts/rtk/rtk-shim-gate.sh (authored here)    -> .apm/hooks/rtk-shim-gate.sh (PreToolUse Bash deny-until-on-PATH)
//
// Usage: bun scripts/build-rtk-package.ts [--out <dir>] [--validate]

import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const RTK_ROOT = path.resolve(REPO_ROOT, 'vendor', 'rtk');
const AUTHORED_ROOT = path.resolve(REPO_ROOT, 'scripts', 'rtk');

function opt(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const OUT_DIR = path.resolve(REPO_ROOT, opt('--out', 'packages/rtk'));
const VALIDATE = process.argv.includes('--validate');
const APM_DIR = path.join(OUT_DIR, '.apm');

// ---- fs helpers ----

async function mkdirp(p: string): Promise<void> {
  await $`mkdir -p ${p}`.quiet();
}

async function copyFile(src: string, dest: string): Promise<void> {
  await mkdirp(path.dirname(dest));
  await Bun.write(dest, Bun.file(src));
  await $`chmod --reference=${src} ${dest}`.quiet();
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

// Sourced by rtk-rewrite-extra.sh and rtk-shim-gate.sh once deployed, so it has to land in
// the same flat hooks dir they do. Carries no descriptor of its own — apm bundles every
// script under the hooks source dir, descriptor-referenced or not.
async function generateHookIoLibrary(): Promise<void> {
  const destDir = path.join(APM_DIR, 'hooks');
  await mkdirp(destDir);
  await copyFile(path.join(AUTHORED_ROOT, 'rtk-hook-io.sh'), path.join(destDir, 'rtk-hook-io.sh'));
}

// Authored auto-rewrites for commands rtk's own native hook has no rule for.
async function generateRewriteExtraHook(): Promise<void> {
  const destDir = path.join(APM_DIR, 'hooks');
  await copyFile(path.join(AUTHORED_ROOT, 'rtk-rewrite-extra.sh'), path.join(destDir, 'rtk-rewrite-extra.sh'));

  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash|bash|powershell',
        hooks: [
          {
            type: 'command',
            command: './rtk-rewrite-extra.sh',
          },
        ],
      },
    ],
  };
  await mkdirp(destDir);
  await Bun.write(path.join(destDir, 'rtk-rewrite-extra.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

// Blocks Bash until the shim dir is on $PATH — the enforcement the SessionStart installer
// can't provide, since it may not edit the user's shell rc.
async function generateShimGateHook(): Promise<void> {
  const destDir = path.join(APM_DIR, 'hooks');
  await copyFile(path.join(AUTHORED_ROOT, 'rtk-shim-gate.sh'), path.join(destDir, 'rtk-shim-gate.sh'));

  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash|bash|powershell',
        hooks: [
          {
            type: 'command',
            command: './rtk-shim-gate.sh',
          },
        ],
      },
    ],
  };
  await mkdirp(destDir);
  await Bun.write(path.join(destDir, 'rtk-shim-gate.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

async function generateWrapperHook(): Promise<void> {
  const destDir = path.join(APM_DIR, 'hooks');
  await copyFile(path.join(AUTHORED_ROOT, 'rtk-hook-wrapper.sh'), path.join(destDir, 'rtk-hook-wrapper.sh'));

  // Hosts invoke the PreToolUse command exactly as written — they append no argv of their
  // own, only pipe the hook JSON payload over stdin, so the rtk subcommand has to be written
  // out here. It is `hook auto` rather than a fixed agent because apm deploys this one
  // descriptor to every declared target while `rtk hook` takes the agent as a subcommand
  // (`claude`, `copilot`, …); the wrapper resolves which one from its deployed path.
  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash|bash|powershell',
        hooks: [
          {
            type: 'command',
            command: './rtk-hook-wrapper.sh hook auto',
          },
        ],
      },
    ],
  };
  await mkdirp(destDir);
  await Bun.write(path.join(destDir, 'rtk-hook.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

async function generateShimInstallHook(): Promise<void> {
  const destDir = path.join(APM_DIR, 'hooks');
  await copyFile(path.join(AUTHORED_ROOT, 'rtk-shim-install.sh'), path.join(destDir, 'rtk-shim-install.sh'));

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
  await mkdirp(destDir);
  await Bun.write(path.join(destDir, 'rtk-shim-install.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(RTK_ROOT) || fs.readdirSync(RTK_ROOT).length === 0) {
    console.error(`vendor/rtk not found at ${RTK_ROOT} — run "git submodule update --init"`);
    process.exit(1);
  }

  await $`rm -rf ${APM_DIR}`.quiet();
  await mkdirp(APM_DIR);

  await generateHookIoLibrary();
  await generateRewriteExtraHook();
  await generateWrapperHook();
  await generateShimInstallHook();
  await generateShimGateHook();

  console.log(`Generated ${path.relative(REPO_ROOT, APM_DIR)}`);

  if (VALIDATE) {
    await $`apm compile --validate`.cwd(OUT_DIR);
  }
}

await main();
