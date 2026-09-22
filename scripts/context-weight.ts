#!/usr/bin/env bun
// Reports how many tokens this repo's authored primitives cost an agent, grouped by
// package and source file.
//
// Three buckets, because the same file is not paid for at the same rate:
//   always-on  instruction bodies — APM compiles these into CLAUDE.md / AGENTS.md, so they
//              sit in every request of every session.
//   startup    the `- name: description` line each skill contributes to the skill listing.
//   on-demand  SKILL.md bodies and references/, read only when that skill actually runs.
//
// Counts come from the estimator below unless --exact is passed, which asks
// /v1/messages/count_tokens for the real per-model number (needs credentials).
//
// Run: bun scripts/context-weight.ts [--exact] [--json] [--summary] [--all]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type Bucket = 'alwaysOn' | 'startup' | 'onDemand';
export type Kind = 'instruction' | 'skill' | 'reference' | 'prompt' | 'agent';

export interface Entry {
  file: string;
  kind: Kind;
  scoped: boolean;
  alwaysOn: number;
  startup: number;
  onDemand: number;
}

export interface PackageWeight {
  name: string;
  dir: string;
  files: Entry[];
  alwaysOn: number;
  startup: number;
  onDemand: number;
}

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const CACHE_FILE = path.join(REPO_ROOT, '.cache', 'context-weight-tokens.json');
const SKIP_DIRS = new Set(['apm_modules', 'vendor', 'node_modules', '.git', '.jj', 'build']);
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_WINDOW = 200_000;

// ---- Token counting ----

/**
 * Approximate Claude token count for `text`, within roughly ±15% on markdown prose.
 * Splits the way a BPE pre-tokenizer does (leading space stays with its word) and charges
 * each piece by class, since letters merge into long tokens but punctuation rarely does.
 * Use --exact for numbers you intend to quote.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  const pieces = text.match(/\s?[A-Za-z]+|\s?\d+|\s?[^\sA-Za-z\d]+|\s+/g) ?? [];
  let total = 0;

  for (const piece of pieces) {
    const body = piece.trimStart();
    const len = body.length;
    if (len === 0) {
      total += Math.max(1, Math.round(piece.length / 4));
      continue;
    }
    if (/^[A-Za-z]/.test(body)) total += Math.max(1, Math.round(len / 4.7));
    else if (/^\d/.test(body)) total += Math.ceil(len / 3);
    else total += len;
  }

  return total;
}

type Counter = (text: string) => Promise<number>;

function estimateCounter(): Counter {
  return async (text) => estimateTokens(text);
}

async function exactCounter(model: string): Promise<Counter> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const cache = readCache();
  let dirty = false;

  const flush = (): void => {
    if (!dirty) return;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
    dirty = false;
  };
  process.on('exit', flush);

  return async (text) => {
    if (text.trim().length === 0) return 0;
    const key = `${model}:${crypto.createHash('sha256').update(text).digest('hex')}`;
    const hit = cache[key];
    if (typeof hit === 'number') return hit;

    const resp = await client.messages.countTokens({
      model,
      messages: [{ role: 'user', content: text }],
    });
    cache[key] = resp.input_tokens;
    dirty = true;
    return resp.input_tokens;
  };
}

function readCache(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

// ---- Source parsing ----

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

export function splitFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: {}, body: text };

  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!field) continue;

    const [, key, rawValue] = field;
    const block = /^([|>])([+-]?)$/.exec(rawValue.trim());
    if (!block) {
      fields[key] = rawValue.trim().replace(/^["'](.*)["']$/, '$1');
      continue;
    }

    const folded: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s+\S/.test(lines[i + 1]))) {
      i += 1;
      folded.push(lines[i].trim());
    }
    fields[key] = folded.join(block[1] === '>' ? ' ' : '\n').trim();
  }

  return { fields, body: text.slice(match[0].length).trim() };
}

export function classify(relPath: string): Kind | null {
  if (!relPath.endsWith('.md')) return null;
  const segments = relPath.split('/');
  const top = segments[0];

  if (top === 'instructions') return 'instruction';
  if (top === 'prompts') return 'prompt';
  if (top === 'agents') return 'agent';
  if (top === 'skills') {
    if (segments.includes('scripts')) return null;
    return segments.at(-1) === 'SKILL.md' ? 'skill' : 'reference';
  }
  return null;
}

/** The line a skill or agent contributes to the listing an agent sees before it picks one. */
export function listingLine(fields: Record<string, string>, fallbackName: string): string {
  const name = fields.name ?? fallbackName;
  const description = fields.description ?? '';
  return `- ${name}: ${description}`;
}

// ---- Scanning ----

function findPackageDirs(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    if (fs.existsSync(path.join(dir, '.apm'))) found.push(dir);
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!child.isDirectory() || SKIP_DIRS.has(child.name)) continue;
      if (child.name.startsWith('.')) continue;
      walk(path.join(dir, child.name));
    }
  };

  walk(root);
  return found.sort();
}

function listFiles(dir: string): string[] {
  const found: string[] = [];

  const walk = (current: string): void => {
    for (const child of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, child.name);
      if (child.isDirectory()) walk(full);
      else if (child.isFile()) found.push(path.relative(dir, full));
    }
  };

  walk(dir);
  return found.sort();
}

async function weighPackage(dir: string, count: Counter, includeAll: boolean): Promise<PackageWeight> {
  const apmDir = path.join(dir, '.apm');
  const files: Entry[] = [];

  for (const relPath of listFiles(apmDir)) {
    const kind = classify(relPath);
    if (kind === null) continue;
    if (!includeAll && (kind === 'prompt' || kind === 'agent')) continue;

    const text = fs.readFileSync(path.join(apmDir, relPath), 'utf8');
    const { fields, body } = splitFrontmatter(text);
    const entry: Entry = {
      file: relPath,
      kind,
      scoped: kind === 'instruction' && 'applyTo' in fields,
      alwaysOn: 0,
      startup: 0,
      onDemand: 0,
    };

    if (kind === 'instruction') {
      entry.alwaysOn = await count(body);
    } else if (kind === 'reference') {
      entry.onDemand = await count(text);
    } else {
      const fallbackName = path.basename(path.dirname(relPath));
      entry.startup = await count(listingLine(fields, fallbackName));
      entry.onDemand = await count(body);
    }

    files.push(entry);
  }

  return {
    name: path.relative(REPO_ROOT, dir) || path.basename(dir),
    dir,
    files,
    alwaysOn: sum(files, 'alwaysOn'),
    startup: sum(files, 'startup'),
    onDemand: sum(files, 'onDemand'),
  };
}

function sum(entries: readonly { alwaysOn: number; startup: number; onDemand: number }[], bucket: Bucket): number {
  return entries.reduce((acc, entry) => acc + entry[bucket], 0);
}

// ---- Reporting ----

const NUM = new Intl.NumberFormat('en-US');

function cell(value: number, width: number): string {
  return (value === 0 ? '·' : NUM.format(value)).padStart(width);
}

function renderPackage(pkg: PackageWeight, sortBy: Bucket | 'name'): string[] {
  const lines = [`${pkg.name}  (${pkg.files.length} files)`];
  const ordered = [...pkg.files].sort((a, b) =>
    sortBy === 'name' ? a.file.localeCompare(b.file) : b[sortBy] - a[sortBy] || a.file.localeCompare(b.file)
  );

  lines.push(`  ${'always'.padStart(9)} ${'startup'.padStart(8)} ${'on-demand'.padStart(10)}  file`);
  for (const entry of ordered) {
    const mark = entry.scoped ? ' *' : '';
    lines.push(`  ${cell(entry.alwaysOn, 9)} ${cell(entry.startup, 8)} ${cell(entry.onDemand, 10)}  ${entry.file}${mark}`);
  }
  lines.push(`  ${cell(pkg.alwaysOn, 9)} ${cell(pkg.startup, 8)} ${cell(pkg.onDemand, 10)}  subtotal`);

  return lines;
}

function renderSummary(packages: PackageWeight[], window: number): string[] {
  const nameWidth = Math.max(7, ...packages.map((p) => p.name.length));
  const lines = [
    `${'package'.padEnd(nameWidth)} ${'always'.padStart(9)} ${'startup'.padStart(8)} ${'on-demand'.padStart(10)} ${'total'.padStart(10)}`,
  ];

  for (const pkg of packages) {
    const total = pkg.alwaysOn + pkg.startup + pkg.onDemand;
    lines.push(
      `${pkg.name.padEnd(nameWidth)} ${cell(pkg.alwaysOn, 9)} ${cell(pkg.startup, 8)} ${cell(pkg.onDemand, 10)} ${cell(total, 10)}`
    );
  }

  const alwaysOn = sum(packages, 'alwaysOn');
  const startup = sum(packages, 'startup');
  const onDemand = sum(packages, 'onDemand');
  const resident = alwaysOn + startup;

  lines.push(
    `${'TOTAL'.padEnd(nameWidth)} ${cell(alwaysOn, 9)} ${cell(startup, 8)} ${cell(onDemand, 10)} ${cell(alwaysOn + startup + onDemand, 10)}`
  );
  lines.push('');
  lines.push(
    `resident every request: ${NUM.format(resident)} tokens — ${((resident / window) * 100).toFixed(1)}% of a ${NUM.format(window)}-token window`
  );

  return lines;
}

// ---- CLI ----

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function opt(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const HELP = `bun scripts/context-weight.ts [options]

Weighs every APM instruction and skill in this repo, grouped by package and source file.

  --exact           count via /v1/messages/count_tokens instead of estimating (needs credentials)
  --model <id>      model whose tokenizer to count against (default ${DEFAULT_MODEL})
  --package <list>  comma-separated package names to include
  --all             also weigh prompts and agents
  --summary         per-package totals only
  --sort <bucket>   alwaysOn | startup | onDemand | name (default onDemand)
  --window <n>      context window used for the resident-% line (default ${DEFAULT_WINDOW})
  --json            machine-readable output
`;

async function main(): Promise<void> {
  if (flag('help')) {
    console.log(HELP);
    return;
  }

  const exact = flag('exact');
  const model = opt('model', DEFAULT_MODEL);
  const includeAll = flag('all');
  const window = Number(opt('window', String(DEFAULT_WINDOW)));
  const sortBy = opt('sort', 'onDemand') as Bucket | 'name';
  const only = new Set(
    opt('package', '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  );

  const count = exact ? await exactCounter(model) : estimateCounter();

  const packages: PackageWeight[] = [];
  for (const dir of findPackageDirs(REPO_ROOT)) {
    const pkg = await weighPackage(dir, count, includeAll);
    if (pkg.files.length === 0) continue;
    if (only.size > 0 && !only.has(pkg.name) && !only.has(path.basename(dir))) continue;
    packages.push(pkg);
  }

  packages.sort((a, b) => b.alwaysOn + b.startup + b.onDemand - (a.alwaysOn + a.startup + a.onDemand));

  if (flag('json')) {
    console.log(
      JSON.stringify(
        {
          counter: exact ? { mode: 'exact', model } : { mode: 'estimate' },
          window,
          packages,
          totals: {
            alwaysOn: sum(packages, 'alwaysOn'),
            startup: sum(packages, 'startup'),
            onDemand: sum(packages, 'onDemand'),
          },
        },
        null,
        2
      )
    );
    return;
  }

  const out: string[] = [];
  if (!flag('summary')) {
    for (const pkg of packages) {
      out.push(...renderPackage(pkg, sortBy), '');
    }
  }
  out.push(...renderSummary(packages, window));
  out.push('');
  out.push('always    instruction bodies compiled into CLAUDE.md / AGENTS.md');
  out.push('startup   the skill listing line (name + description)');
  out.push('on-demand SKILL.md body and references/, paid only when the skill runs');
  if (packages.some((pkg) => pkg.files.some((entry) => entry.scoped))) {
    out.push('*         instruction has applyTo — scoped to matching files on harnesses that honor rules files');
  }
  if (!exact) out.push(`counts are estimates (±15%); run with --exact --model ${model} for real numbers`);

  console.log(out.join('\n'));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (!flag('exact')) throw error;
    console.error(`exact counting failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error('it needs ANTHROPIC_API_KEY or an `ant auth login` profile; drop --exact to estimate instead.');
    process.exit(1);
  }
}
