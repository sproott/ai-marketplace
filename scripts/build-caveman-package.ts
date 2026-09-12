#!/usr/bin/env bun
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
// Usage: bun scripts/build-caveman-package.ts [--out <dir>] [--validate]

import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const CAVEMAN_ROOT = path.resolve(REPO_ROOT, 'vendor', 'caveman');

function opt(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const OUT_DIR = path.resolve(REPO_ROOT, opt('--out', 'packages/caveman'));
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

async function copyDir(srcDir: string, destDir: string, skip?: string[]): Promise<void> {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skip && skip.includes(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else if (entry.isFile()) await copyFile(src, dest);
  }
}

// ---- skills: skills/<name>/ -> .apm/skills/<name>/ ----

async function generateSkills(): Promise<void> {
  const srcRoot = path.join(CAVEMAN_ROOT, 'skills');
  const destRoot = path.join(APM_DIR, 'skills');
  for (const name of fs.readdirSync(srcRoot)) {
    const srcSkillDir = path.join(srcRoot, name);
    if (!fs.statSync(srcSkillDir).isDirectory()) continue;
    await copyDir(srcSkillDir, path.join(destRoot, name), ['README.md', 'SECURITY.md']);
  }
}

// ---- agents: agents/cavecrew-*.md -> .apm/agents/cavecrew-*.agent.md ----

async function generateAgents(): Promise<void> {
  const srcDir = path.join(CAVEMAN_ROOT, 'agents');
  const destDir = path.join(APM_DIR, 'agents');
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.startsWith('cavecrew-') || !file.endsWith('.md')) continue;
    const name = file.slice(0, -'.md'.length);
    await copyFile(path.join(srcDir, file), path.join(destDir, `${name}.agent.md`));
  }
}

// ---- instructions: src/rules/caveman-activate.md -> .apm/instructions/caveman-activate.instructions.md ----

const INSTRUCTION_DESCRIPTION =
  'Always-on caveman-style compressed response rule: terse fragments, dropped filler, full technical accuracy preserved.';

async function generateInstructions(): Promise<void> {
  const src = path.join(CAVEMAN_ROOT, 'src', 'rules', 'caveman-activate.md');
  const body = await Bun.file(src).text();
  const dest = path.join(APM_DIR, 'instructions', 'caveman-activate.instructions.md');
  await mkdirp(path.dirname(dest));
  await Bun.write(dest, `---\ndescription: ${JSON.stringify(INSTRUCTION_DESCRIPTION)}\n---\n\n${body}`);
}

// ---- hooks: src/hooks/*.js, caveman-statusline.{sh,ps1} -> .apm/hooks/*, plus caveman.json descriptor ----
//
// Hook scripts are copied flat alongside the descriptor so APM's hook
// integrator resolves sibling require()s (see docs/producer/author-primitives/
// hooks-and-commands.md: referencing a script inside a package hook
// directory deploys the whole hook bundle). Commands use relative `./`
// paths, not ${CLAUDE_PLUGIN_ROOT}, since the scripts sit next to the
// descriptor — that resolves against the hook file's own directory.
//
// The descriptor commands invoke `node` because that's the runtime deployed
// consumers run the hooks under (Claude Code's own hook execution), not this
// build script's runtime.

async function generateHooks(): Promise<void> {
  const srcDir = path.join(CAVEMAN_ROOT, 'src', 'hooks');
  const destDir = path.join(APM_DIR, 'hooks');
  for (const file of fs.readdirSync(srcDir)) {
    if (file.endsWith('.js') || file === 'caveman-statusline.sh' || file === 'caveman-statusline.ps1') {
      await copyFile(path.join(srcDir, file), path.join(destDir, file));
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
  await mkdirp(destDir);
  await Bun.write(path.join(destDir, 'caveman.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

// ---- prompts: commands/<name>.md -> .apm/prompts/<name>.prompt.md ----
//
// caveman-init is excluded: it downloads and runs caveman's own standalone
// installer script from GitHub, which doesn't apply here (this repo deploys
// caveman via the vendored submodule + apm, not caveman's own installer).

const PROMPT_NAMES = ['caveman', 'caveman-commit', 'caveman-review', 'caveman-stats'];

async function generatePrompts(): Promise<void> {
  const srcDir = path.join(CAVEMAN_ROOT, 'commands');
  const destDir = path.join(APM_DIR, 'prompts');
  for (const name of PROMPT_NAMES) {
    await copyFile(path.join(srcDir, `${name}.md`), path.join(destDir, `${name}.prompt.md`));
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(CAVEMAN_ROOT) || fs.readdirSync(CAVEMAN_ROOT).length === 0) {
    console.error(`vendor/caveman not found at ${CAVEMAN_ROOT} — run "git submodule update --init"`);
    process.exit(1);
  }

  await $`rm -rf ${APM_DIR}`.quiet();
  await mkdirp(APM_DIR);

  await generateSkills();
  await generateAgents();
  await generateInstructions();
  await generateHooks();
  await generatePrompts();

  console.log(`Generated ${path.relative(REPO_ROOT, APM_DIR)}`);

  if (VALIDATE) {
    await $`apm compile --validate`.cwd(OUT_DIR);
  }
}

await main();
