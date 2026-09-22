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
//
// Every skill's description sits in the agent's context for the whole session, whether or
// not the skill ever runs — seven caveman skills cost ~600 tokens of listing before a
// single one fires. Upstream writes them as prose paragraphs; these rewrites keep the
// trigger phrases a model matches on and drop the restatement around them.

const SKILL_DESCRIPTIONS: Record<string, string> = {
  caveman:
    'Ultra-compressed response mode, ~65% fewer output tokens, full technical accuracy. Levels: lite, full, ultra, wenyan. Triggers: caveman mode, talk like caveman, /caveman, be brief, fewer tokens.',
  cavecrew:
    'When to delegate to a caveman subagent instead of working inline: investigator (locate code), builder (1-2 file edit), reviewer (diff review). Their output is compressed, so main context lasts longer. Triggers: use cavecrew, spawn investigator/builder/reviewer, save context.',
  'caveman-commit':
    'Conventional Commits message, subject under 50 chars, body only when the why is not obvious. Triggers: write a commit, commit message, /caveman-commit.',
  'caveman-compress':
    'Compress a memory file (CLAUDE.md, todos, preferences) into caveman format, preserving code and structure; the original is kept as FILE.original.md. Trigger: /caveman-compress <path>.',
  'caveman-help': 'Reference card for caveman modes, skills, and commands. Trigger: /caveman-help.',
  'caveman-review':
    'Ultra-compressed PR review comments, one line each: location, problem, fix. Triggers: review this PR, code review, /caveman-review.',
  'caveman-stats':
    'Real token usage and savings for this session, read from the session log. Trigger: /caveman-stats.',
};

/**
 * Replaces the frontmatter `description:` value. Upstream wraps long descriptions across
 * continuation lines, so every following line that is not itself a `key:` belongs to the
 * value being replaced.
 */
export function rewriteSkillDescription(skillMd: string, description: string): string {
  const frontmatter = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    throw new Error('SKILL.md has no frontmatter block to rewrite');
  }
  const lines = frontmatter[1].split('\n');
  const start = lines.findIndex((l) => /^description:/.test(l));
  if (start === -1) {
    throw new Error('SKILL.md frontmatter has no description: field to rewrite');
  }
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_-]+:/.test(lines[end])) end += 1;

  lines.splice(start, end - start, `description: ${description}`);
  return `---\n${lines.join('\n')}\n---${skillMd.slice(frontmatter[0].length)}`;
}

async function generateSkills(): Promise<void> {
  const srcRoot = path.join(CAVEMAN_ROOT, 'skills');
  const destRoot = path.join(APM_DIR, 'skills');
  const rewritten = new Set<string>();

  for (const name of fs.readdirSync(srcRoot)) {
    const srcSkillDir = path.join(srcRoot, name);
    if (!fs.statSync(srcSkillDir).isDirectory()) continue;
    const destSkillDir = path.join(destRoot, name);
    await copyDir(srcSkillDir, destSkillDir, ['README.md', 'SECURITY.md']);

    const description = SKILL_DESCRIPTIONS[name];
    if (!description) continue;
    const skillMd = path.join(destSkillDir, 'SKILL.md');
    await Bun.write(skillMd, rewriteSkillDescription(await Bun.file(skillMd).text(), description));
    rewritten.add(name);
  }

  const missing = Object.keys(SKILL_DESCRIPTIONS).filter((n) => !rewritten.has(n));
  if (missing.length) {
    throw new Error(
      `SKILL_DESCRIPTIONS names skills upstream no longer ships: ${missing.join(', ')} — ` +
        'drop the entry or update it to the new name',
    );
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

if (import.meta.main) {
  await main();
}
