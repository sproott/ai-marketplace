#!/usr/bin/env bun
// Unit check for context-weight.ts's parsing and estimation — no scratch dir, no API calls.
// Run: bun scripts/test-context-weight.ts

import assert from 'node:assert';
import { classify, estimateTokens, listingLine, splitFrontmatter } from './context-weight.ts';

let pass = 0;

function check<T>(name: string, actual: T, expected: T): void {
  assert.deepStrictEqual(actual, expected, name);
  pass += 1;
  console.log(`ok - ${name}`);
}

function checkThat(name: string, condition: boolean): void {
  assert.ok(condition, name);
  pass += 1;
  console.log(`ok - ${name}`);
}

check('classifies an instruction by its directory', classify('instructions/sdd.instructions.md'), 'instruction');
check('classifies SKILL.md as a skill', classify('skills/specify/SKILL.md'), 'skill');
check('classifies a skill reference', classify('skills/fallow/references/mcp.md'), 'reference');
check('ignores a skill script', classify('skills/apm-install-deps/scripts/install-all.sh'), null);
check('ignores markdown inside a skill scripts dir', classify('skills/x/scripts/notes.md'), null);
check('ignores a hook', classify('hooks/hooks.json'), null);

check(
  'reads a single-line frontmatter field',
  splitFrontmatter('---\nname: specify\ndescription: Writes a spec.\n---\n\nBody.').fields,
  { name: 'specify', description: 'Writes a spec.' }
);

check(
  'folds a > block scalar into one line',
  splitFrontmatter('---\nname: caveman\ndescription: >\n  First line\n  second line.\nother: x\n---\nBody.').fields
    .description,
  'First line second line.'
);

check(
  'keeps newlines in a | block scalar',
  splitFrontmatter('---\ndescription: |\n  First line\n  second line.\n---\nBody.').fields.description,
  'First line\nsecond line.'
);

check(
  'strips quotes from a frontmatter value',
  splitFrontmatter('---\napplyTo: "**/*.ts"\n---\nBody.').fields.applyTo,
  '**/*.ts'
);

check(
  'returns the body without the frontmatter',
  splitFrontmatter('---\nname: x\n---\n\nBody text.\n').body,
  'Body text.'
);

check('treats a file with no frontmatter as all body', splitFrontmatter('Body only.').body, 'Body only.');

check(
  'falls back to the skill directory name when frontmatter has none',
  listingLine({ description: 'Does a thing.' }, 'my-skill'),
  '- my-skill: Does a thing.'
);

check('counts nothing for empty text', estimateTokens(''), 0);
checkThat('counts a short word as one token', estimateTokens('the') === 1);
checkThat(
  'estimates English prose within 25% of ~4 chars per token',
  (() => {
    const prose = 'The quick brown fox jumps over the lazy dog near the river bank every morning. '.repeat(20);
    const ratio = estimateTokens(prose) / (prose.length / 4);
    return ratio > 0.75 && ratio < 1.25;
  })()
);
checkThat(
  'grows monotonically with repeated content',
  estimateTokens('one two three') < estimateTokens('one two three four five')
);

console.log(`\n${pass} passed`);
