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

// `fallow agent install` emits the task-command table twice — once in the `## Fallow`
// section's generated:task-matrix block, once again under `## Fallow task map` inside the
// setup-hooks block. Both land in the same instruction file, so the second copy is dropped
// here; the gate prose above it is unique and stays.
function stripDuplicateTaskMap(setupHooksBlock: string): string {
  const heading = setupHooksBlock.indexOf('\n## Fallow task map\n');
  if (heading === -1) {
    throw new Error(
      'setup-hooks block has no "## Fallow task map" heading — upstream layout changed, ' +
        're-check whether the task-command table is still duplicated before removing this guard',
    );
  }
  const endMarker = '<!-- fallow:setup-hooks:end -->';
  const kept = setupHooksBlock
    .slice(0, heading)
    .trimEnd()
    // The gate prose points at the table it used to precede; after the cut the only
    // remaining copy sits above this block.
    .replace('the task map below', 'the task map above');
  return `${kept}\n\n${endMarker}`;
}

function extractSetupHooksBlock(agentsMd: string): string {
  const match = agentsMd.match(/<!-- fallow:setup-hooks:start -->[\s\S]*?<!-- fallow:setup-hooks:end -->/);
  if (!match) {
    throw new Error('scratch AGENTS.md has no fallow:setup-hooks marked block to extract');
  }
  return stripDuplicateTaskMap(match[0].trim());
}

async function generateInstructions(scratch: string): Promise<void> {
  const agentsMd = await Bun.file(path.join(scratch, 'AGENTS.md')).text();
  const body = `${extractSection(agentsMd)}\n\n${extractSetupHooksBlock(agentsMd)}\n`;
  const dest = path.join(APM_DIR, 'instructions', 'fallow-task-map.instructions.md');
  await mkdirp(path.dirname(dest));
  await Bun.write(dest, `---\ndescription: ${JSON.stringify(INSTRUCTION_DESCRIPTION)}\n---\n\n${body}`);
}

// ---- cli-reference split: references/cli-reference.md -> references/cli/<part>.md + index ----
//
// Upstream ships the whole command catalogue as one ~190KB file. Reading it to answer a
// single flag question costs roughly a third of a 200k context window, so it is split per
// top-level section and cli-reference.md is rewritten as an index. The path stays put so
// existing links to the file keep resolving; links carrying a section anchor are remapped
// onto the part that now owns that anchor.

export interface CliSection {
  heading: string;
  anchor: string;
  file: string;
  body: string;
}

/** GitHub's heading-anchor slug: lowercase, punctuation dropped, spaces to hyphens. */
export function githubAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** `` `dead-code`: Dead Code Analysis `` -> `dead-code`; prose headings fall back to the anchor. */
function partFileName(heading: string, anchor: string): string {
  const command = heading.match(/^`([a-z0-9-]+)`\s*:/i);
  return `${command ? command[1] : anchor}.md`;
}

export function splitTopLevelSections(markdown: string): { preamble: string; sections: CliSection[] } {
  const lines = markdown.split('\n');
  const sections: CliSection[] = [];
  const preamble: string[] = [];
  let current: { heading: string; body: string[] } | null = null;
  let fenced = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^## (.+)$/);
    if (heading) {
      if (current) sections.push(finishSection(current));
      current = { heading: heading[1].trim(), body: [] };
      continue;
    }
    (current ? current.body : preamble).push(line);
  }
  if (current) sections.push(finishSection(current));

  return { preamble: preamble.join('\n').trim(), sections };
}

function finishSection(raw: { heading: string; body: string[] }): CliSection {
  const anchor = githubAnchor(raw.heading);
  return {
    heading: raw.heading,
    anchor,
    file: partFileName(raw.heading, anchor),
    body: raw.body.join('\n').trim(),
  };
}

/**
 * Rewrites `cli-reference.md#anchor` and bare `#anchor` links onto the split parts.
 * `prefix` is the path of the `cli/` directory relative to the file being rewritten;
 * `bareAnchors` additionally remaps same-document `](#anchor)` links, which only the
 * part files themselves carry.
 */
export function remapCliLinks(
  text: string,
  sections: CliSection[],
  prefix: string,
  bareAnchors = false,
): string {
  const byAnchor = new Map(sections.map((s) => [s.anchor, s.file]));
  let out = text.replace(/([\w./-]*cli-reference\.md)#([a-z0-9-]+)/g, (whole, _path, anchor) => {
    const file = byAnchor.get(anchor);
    return file ? `${prefix}${file}` : whole;
  });
  if (bareAnchors) {
    out = out.replace(/\]\(#([a-z0-9-]+)\)/g, (whole, anchor) => {
      const file = byAnchor.get(anchor);
      return file ? `](${prefix}${file})` : whole;
    });
  }
  return out;
}

export function buildIndex(preamble: string, sections: CliSection[]): string {
  const commands = sections.filter((s) => /^`/.test(s.heading));
  const topics = sections.filter((s) => !/^`/.test(s.heading));
  const row = (s: CliSection) => `- [${s.heading}](cli/${s.file})`;
  const parts = [preamble, '## Commands', commands.map(row).join('\n')];
  if (topics.length) parts.push('## Reference', topics.map(row).join('\n'));
  return `${parts.join('\n\n')}\n`;
}

async function splitCliReference(): Promise<void> {
  const skillDir = path.join(APM_DIR, 'skills', 'fallow');
  const referencePath = path.join(skillDir, 'references', 'cli-reference.md');
  const source = await Bun.file(referencePath).text();

  const { preamble, sections: all } = splitTopLevelSections(source);
  // The hand-maintained TOC is replaced by the generated index below.
  const sections = all.filter((s) => s.anchor !== 'table-of-contents');
  if (!sections.length) {
    throw new Error(`${referencePath} has no "## " sections to split — upstream layout changed`);
  }

  const partsDir = path.join(skillDir, 'references', 'cli');
  await mkdirp(partsDir);
  for (const section of sections) {
    const body = remapCliLinks(`# ${section.heading}\n\n${section.body}\n`, sections, '', true);
    await Bun.write(path.join(partsDir, section.file), body);
  }

  await Bun.write(referencePath, buildIndex(preamble, sections));

  // Sibling docs reach the parts through `cli/`; SKILL.md sits one level up.
  for (const rel of ['references/gotchas.md', 'references/patterns.md', 'references/mcp.md', 'SKILL.md']) {
    const full = path.join(skillDir, rel);
    if (!fs.existsSync(full)) continue;
    const prefix = rel === 'SKILL.md' ? 'references/cli/' : 'cli/';
    await Bun.write(full, remapCliLinks(await Bun.file(full).text(), sections, prefix));
  }
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
    await splitCliReference();
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
