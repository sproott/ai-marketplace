#!/usr/bin/env bun
// Generates packages/fallow/.apm/ from a throwaway scratch dir produced by
// `bunx fallow@<version> agent install` — fallow ships no static "agent primitives" tree
// of its own, it writes one on demand. Unlike rtk/caveman there is no vendor/ submodule:
// the scratch dir is created fresh in a temp path on every run and removed afterward.
//
// apm.yml and README.md in the output dir are fixed, hand-authored sources except for
// apm.yml's `dependencies.mcp` field, which this script derives and rewrites in place.
//
// Usage: bun scripts/build-fallow-package.ts [--out <dir>] [--validate]

import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';

const REPO_ROOT = path.resolve(import.meta.dir, '..');

function opt(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const OUT_DIR = path.resolve(REPO_ROOT, opt('--out', 'packages/fallow'));
const VALIDATE = process.argv.includes('--validate');
const APM_DIR = path.join(OUT_DIR, '.apm');
const MANIFEST_PATH = path.join(OUT_DIR, 'apm.yml');

// ---- fs helpers ----

async function mkdirp(p: string): Promise<void> {
  await $`mkdir -p ${p}`.quiet();
}

async function copyDir(src: string, dest: string): Promise<void> {
  await $`rm -rf ${dest}`.quiet();
  await mkdirp(path.dirname(dest));
  await $`cp -r ${src} ${dest}`.quiet();
}

async function readPinnedVersion(): Promise<string> {
  const manifest = await Bun.file(MANIFEST_PATH).text();
  const match = manifest.match(/^version:\s*(.+)$/m);
  if (!match) {
    throw new Error(`${MANIFEST_PATH} has no version: field to read the fallow pin from`);
  }
  return match[1].trim().replace(/^["']|["']$/g, '');
}

async function withScratchDir<T>(fn: (scratch: string) => Promise<T>): Promise<T> {
  const scratch = (await $`mktemp -d`.text()).trim();
  try {
    return await fn(scratch);
  } finally {
    await $`rm -rf ${scratch}`.quiet();
  }
}

function listTree(root: string): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      out.push(path.relative(root, full));
      if (entry.isDirectory()) walk(full);
    }
  })(root);
  return out;
}

// ---- skill: scratch/.claude/skills/fallow/ -> .apm/skills/fallow/ (verbatim) ----

async function generateSkill(scratch: string): Promise<void> {
  await copyDir(path.join(scratch, '.claude', 'skills', 'fallow'), path.join(APM_DIR, 'skills', 'fallow'));
}

// ---- hook: scratch/.claude/hooks/fallow-gate.sh -> .apm/hooks/fallow-gate.sh (verbatim) ----
//
// The descriptor's command path is rewritten from scratch's
// `"$CLAUDE_PROJECT_DIR"/.claude/hooks/fallow-gate.sh` to `./fallow-gate.sh` — APM hooks
// resolve sibling scripts via a relative `./` path (same convention as rtk's
// `generateWrapperHook`).

async function generateHook(scratch: string): Promise<void> {
  const destDir = path.join(APM_DIR, 'hooks');
  const src = path.join(scratch, '.claude', 'hooks', 'fallow-gate.sh');
  const dest = path.join(destDir, 'fallow-gate.sh');
  await mkdirp(destDir);
  await Bun.write(dest, Bun.file(src));
  await $`chmod --reference=${src} ${dest}`.quiet();

  const descriptor = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: './fallow-gate.sh',
          },
        ],
      },
    ],
  };
  await Bun.write(path.join(destDir, 'fallow-gate.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

// ---- instruction: scratch/AGENTS.md -> .apm/instructions/fallow-task-map.instructions.md ----
//
// Only the `## Fallow` section (up to the next `## ` heading) and the
// `<!-- fallow:setup-hooks:start/end -->` marked block are vendored — the blank
// Project-Overview/Architecture-Notes/Commands/Agent-Rules scaffold is per-consumer
// fill-in-the-blank content, not a standing rule (spec Decisions).

const INSTRUCTION_DESCRIPTION =
  'Standing rule for fallow: the task-command map (which fallow command to run before a given edit/commit/PR action) and the local pre-commit/pre-push audit gate.';

function extractSection(agentsMd: string): string {
  const start = agentsMd.indexOf('\n## Fallow\n');
  if (start === -1) {
    throw new Error('scratch AGENTS.md has no "## Fallow" section to extract');
  }
  const nextHeading = agentsMd.indexOf('\n## ', start + 1);
  const end = nextHeading === -1 ? agentsMd.length : nextHeading;
  return agentsMd.slice(start, end).trim();
}

function extractSetupHooksBlock(agentsMd: string): string {
  const match = agentsMd.match(/<!-- fallow:setup-hooks:start -->[\s\S]*?<!-- fallow:setup-hooks:end -->/);
  if (!match) {
    throw new Error('scratch AGENTS.md has no fallow:setup-hooks marked block to extract');
  }
  return match[0].trim();
}

async function generateInstructions(scratch: string): Promise<void> {
  const agentsMd = await Bun.file(path.join(scratch, 'AGENTS.md')).text();
  const body = `${extractSection(agentsMd)}\n\n${extractSetupHooksBlock(agentsMd)}\n`;
  const dest = path.join(APM_DIR, 'instructions', 'fallow-task-map.instructions.md');
  await mkdirp(path.dirname(dest));
  await Bun.write(dest, `---\ndescription: ${JSON.stringify(INSTRUCTION_DESCRIPTION)}\n---\n\n${body}`);
}

// ---- mcp: scratch/.mcp.json -> apm.yml's dependencies.mcp (parsed + rewritten in place) ----

interface McpServer {
  type: string;
  command: string;
  args?: string[];
}

interface McpJson {
  mcpServers: Record<string, McpServer>;
}

interface McpEntry {
  name: string;
  registry: boolean;
  transport: string;
  command: string;
  args?: string[];
}

export function deriveMcpEntry(mcpJson: McpJson): McpEntry {
  const [name, server] = Object.entries(mcpJson.mcpServers)[0];
  return {
    name,
    registry: false,
    transport: server.type,
    command: server.command,
    ...(server.args?.length ? { args: server.args } : {}),
  };
}

function mcpEntryToYaml(entry: McpEntry): string {
  const lines = [
    '  mcp:',
    `    - name: ${entry.name}`,
    `      registry: ${entry.registry}`,
    `      transport: ${entry.transport}`,
    `      command: ${entry.command}`,
  ];
  if (entry.args) {
    lines.push(`      args: ${JSON.stringify(entry.args)}`);
  }
  return lines.join('\n');
}

async function generateMcpDependency(scratch: string): Promise<void> {
  const mcpJson: McpJson = JSON.parse(await Bun.file(path.join(scratch, '.mcp.json')).text());
  const entry = deriveMcpEntry(mcpJson);

  const manifest = await Bun.file(MANIFEST_PATH).text();
  const mcpBlock = /^ {2}mcp:(?: \[\]\n| *\n(?: {4}.*\n)*)/m;
  if (!mcpBlock.test(manifest)) {
    throw new Error(`${MANIFEST_PATH} has no "mcp:" dependency block to rewrite`);
  }
  const rewritten = manifest.replace(mcpBlock, `${mcpEntryToYaml(entry)}\n`);
  await Bun.write(MANIFEST_PATH, rewritten);
}

async function main(): Promise<void> {
  const version = await readPinnedVersion();

  await withScratchDir(async (scratch) => {
    await $`bunx fallow@${version} agent install --root ${scratch} --harness claude --approve`;

    console.log(`Scratch output (${scratch}):`);
    for (const rel of listTree(scratch)) console.log(`  ${rel}`);

    await $`rm -rf ${APM_DIR}`.quiet();
    await generateSkill(scratch);
    await generateHook(scratch);
    await generateInstructions(scratch);
    await generateMcpDependency(scratch);
  });

  if (VALIDATE) {
    await $`apm compile --validate`.cwd(OUT_DIR);
  }
}

if (import.meta.main) {
  await main();
}
