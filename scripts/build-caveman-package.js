#!/usr/bin/env node
// Generates packages/caveman/.apm/ from the vendored vendor/caveman submodule.
//
// caveman ships primitives in its own native layout (skills/, agents/,
// src/rules/, src/hooks/), not APM's .apm/ layout, and vendor/caveman is
// never modified. This script reads the native layout and writes the APM
// primitive tree. apm.yml and README.md in the output dir are fixed,
// hand-authored sources — this script only ever touches .apm/.
//
// Mapping (native source -> APM primitive):
//   skills/<name>/                          -> .apm/skills/<name>/        (drop README.md, SECURITY.md)
//   agents/cavecrew-*.md                    -> .apm/agents/cavecrew-*.agent.md
//   src/rules/caveman-activate.md           -> .apm/instructions/caveman-activate.instructions.md
//   src/hooks/*.js, caveman-statusline.*    -> .apm/hooks/* + generated caveman.json descriptor
//   commands/<name>.md (excl. caveman-init) -> .apm/prompts/<name>.prompt.md
//
// Usage: node scripts/build-caveman-package.js [--out <dir>] [--validate]

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CAVEMAN_ROOT = path.resolve(REPO_ROOT, 'vendor', 'caveman');

function opt(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const OUT_DIR = path.resolve(REPO_ROOT, opt('--out', 'packages/caveman'));
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

function copyDir(srcDir, destDir, skip) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skip && skip.includes(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) copyFile(src, dest);
  }
}

// ---- skills: skills/<name>/ -> .apm/skills/<name>/ ----

function generateSkills() {
  const srcRoot = path.join(CAVEMAN_ROOT, 'skills');
  const destRoot = path.join(APM_DIR, 'skills');
  for (const name of fs.readdirSync(srcRoot)) {
    const srcSkillDir = path.join(srcRoot, name);
    if (!fs.statSync(srcSkillDir).isDirectory()) continue;
    copyDir(srcSkillDir, path.join(destRoot, name), ['README.md', 'SECURITY.md']);
  }
}

// ---- agents: agents/cavecrew-*.md -> .apm/agents/cavecrew-*.agent.md ----

function generateAgents() {
  const srcDir = path.join(CAVEMAN_ROOT, 'agents');
  const destDir = path.join(APM_DIR, 'agents');
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.startsWith('cavecrew-') || !file.endsWith('.md')) continue;
    const name = file.slice(0, -'.md'.length);
    copyFile(path.join(srcDir, file), path.join(destDir, `${name}.agent.md`));
  }
}

// ---- instructions: src/rules/caveman-activate.md -> .apm/instructions/caveman-activate.instructions.md ----

const INSTRUCTION_DESCRIPTION =
  'Always-on caveman-style compressed response rule: terse fragments, dropped filler, full technical accuracy preserved.';

function generateInstructions() {
  const src = path.join(CAVEMAN_ROOT, 'src', 'rules', 'caveman-activate.md');
  const body = fs.readFileSync(src, 'utf8');
  const dest = path.join(APM_DIR, 'instructions', 'caveman-activate.instructions.md');
  mkdirp(path.dirname(dest));
  fs.writeFileSync(dest, `---\ndescription: ${JSON.stringify(INSTRUCTION_DESCRIPTION)}\n---\n\n${body}`);
}

// ---- hooks: src/hooks/*.js, caveman-statusline.{sh,ps1} -> .apm/hooks/*, plus caveman.json descriptor ----
//
// Hook scripts are copied flat alongside the descriptor so APM's hook
// integrator resolves sibling require()s (see docs/producer/author-primitives/
// hooks-and-commands.md: referencing a script inside a package hook
// directory deploys the whole hook bundle). Commands use relative `./`
// paths, not ${CLAUDE_PLUGIN_ROOT}, since the scripts sit next to the
// descriptor — that resolves against the hook file's own directory.

function generateHooks() {
  const srcDir = path.join(CAVEMAN_ROOT, 'src', 'hooks');
  const destDir = path.join(APM_DIR, 'hooks');
  for (const file of fs.readdirSync(srcDir)) {
    if (file.endsWith('.js') || file === 'caveman-statusline.sh' || file === 'caveman-statusline.ps1') {
      copyFile(path.join(srcDir, file), path.join(destDir, file));
    }
  }

  const descriptor = {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node ./caveman-activate.js',
            timeout: 5,
            statusMessage: 'Loading caveman mode...',
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node ./caveman-mode-tracker.js',
            timeout: 5,
            statusMessage: 'Tracking caveman mode...',
          },
        ],
      },
    ],
  };
  mkdirp(destDir);
  fs.writeFileSync(path.join(destDir, 'caveman.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

// ---- prompts: commands/<name>.md -> .apm/prompts/<name>.prompt.md ----
//
// caveman-init is excluded: it downloads and runs caveman's own standalone
// installer script from GitHub, which doesn't apply here (this repo deploys
// caveman via the vendored submodule + apm, not caveman's own installer).

const PROMPT_NAMES = ['caveman', 'caveman-commit', 'caveman-review', 'caveman-stats'];

function generatePrompts() {
  const srcDir = path.join(CAVEMAN_ROOT, 'commands');
  const destDir = path.join(APM_DIR, 'prompts');
  for (const name of PROMPT_NAMES) {
    copyFile(path.join(srcDir, `${name}.md`), path.join(destDir, `${name}.prompt.md`));
  }
}

function main() {
  if (!fs.existsSync(CAVEMAN_ROOT) || fs.readdirSync(CAVEMAN_ROOT).length === 0) {
    console.error(`vendor/caveman not found at ${CAVEMAN_ROOT} — run "git submodule update --init"`);
    process.exit(1);
  }

  fs.rmSync(APM_DIR, { recursive: true, force: true });
  mkdirp(APM_DIR);

  generateSkills();
  generateAgents();
  generateInstructions();
  generateHooks();
  generatePrompts();

  console.log(`Generated ${path.relative(REPO_ROOT, APM_DIR)}`);

  if (VALIDATE) {
    execFileSync('apm', ['compile', '--validate'], { cwd: OUT_DIR, stdio: 'inherit' });
  }
}

main();
