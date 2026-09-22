#!/usr/bin/env bun
// Unit check for build-fallow-package.ts's deriveMcpEntry — no scratch dir, no shellout.
// Run: bun scripts/test-build-fallow-package.ts
//
// The expected shape below was cross-checked against a real
// `apm mcp install fallow -- fallow-mcp` run, which independently wrote:
//   { name: fallow, registry: false, transport: stdio, command: fallow-mcp }
// into a scratch apm.yml's dependencies.mcp — confirming deriveMcpEntry produces the same
// shape APM's own MCP installer does.

import assert from 'node:assert';
import {
  buildIndex,
  deriveMcpEntry,
  githubAnchor,
  remapCliLinks,
  splitTopLevelSections,
} from './build-fallow-package.ts';

let pass = 0;

function check<T>(name: string, actual: T, expected: T): void {
  assert.deepStrictEqual(actual, expected, name);
  pass += 1;
  console.log(`ok - ${name}`);
}

check(
  'derives stdio entry with no args (matches scratch .mcp.json / apm mcp install shape)',
  deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp', args: [] } } }),
  { name: 'fallow', registry: false, transport: 'stdio', command: 'fallow-mcp' }
);

check(
  'includes args only when non-empty',
  deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp', args: ['--foo'] } } }),
  { name: 'fallow', registry: false, transport: 'stdio', command: 'fallow-mcp', args: ['--foo'] }
);

// ---- cli-reference split ----

const SAMPLE = [
  '# Fallow CLI Reference',
  '',
  'Intro line.',
  '',
  '## Table of Contents',
  '',
  '- [x](#global-flags)',
  '',
  '## `dead-code`: Dead Code Analysis',
  '',
  'See [flags](#global-flags).',
  '',
  '```bash',
  '## not a heading, inside a fence',
  '```',
  '',
  '## Global Flags',
  '',
  'Flag prose.',
].join('\n');

const split = splitTopLevelSections(SAMPLE);
const sections = split.sections.filter((s) => s.anchor !== 'table-of-contents');

check('strips backticks and punctuation when slugging a heading', githubAnchor('`dead-code`: Dead Code Analysis'), 'dead-code-dead-code-analysis');

check('keeps the title block as preamble', split.preamble, '# Fallow CLI Reference\n\nIntro line.');

check(
  'names a command part after the command and a prose part after its anchor',
  sections.map((s) => s.file),
  ['dead-code.md', 'global-flags.md']
);

check(
  'ignores a ## line inside a fenced code block',
  sections.find((s) => s.file === 'dead-code.md')?.body.includes('## not a heading, inside a fence'),
  true
);

check(
  'rewrites a same-document anchor link onto the sibling part',
  remapCliLinks('See [flags](#global-flags).', sections, '', true),
  'See [flags](global-flags.md).'
);

check(
  'rewrites an anchored cli-reference link onto the owning part',
  remapCliLinks('See [x](cli-reference.md#global-flags).', sections, 'cli/'),
  'See [x](cli/global-flags.md).'
);

check(
  'leaves a bare cli-reference link pointing at the index',
  remapCliLinks('See [x](references/cli-reference.md).', sections, 'references/cli/'),
  'See [x](references/cli-reference.md).'
);

check(
  'leaves an anchor no part owns untouched',
  remapCliLinks('See [x](cli-reference.md#nope).', sections, 'cli/'),
  'See [x](cli-reference.md#nope).'
);

check(
  'groups commands and prose topics under separate index headings',
  buildIndex(split.preamble, sections),
  [
    '# Fallow CLI Reference',
    '',
    'Intro line.',
    '',
    '## Commands',
    '',
    '- [`dead-code`: Dead Code Analysis](cli/dead-code.md)',
    '',
    '## Reference',
    '',
    '- [Global Flags](cli/global-flags.md)',
    '',
  ].join('\n')
);

console.log(`\n${pass} passed`);
