#!/usr/bin/env bun
// Unit check for build-caveman-package.ts's rewriteSkillDescription — no vendor checkout.
// Run: bun scripts/test-build-caveman-package.ts

import assert from 'node:assert';
import { rewriteSkillDescription } from './build-caveman-package.ts';

let pass = 0;

function check<T>(name: string, actual: T, expected: T): void {
  assert.deepStrictEqual(actual, expected, name);
  pass += 1;
  console.log(`ok - ${name}`);
}

function throws(name: string, fn: () => unknown, match: RegExp): void {
  assert.throws(fn, match, name);
  pass += 1;
  console.log(`ok - ${name}`);
}

check(
  'replaces a single-line description in place',
  rewriteSkillDescription('---\nname: x\ndescription: old text\n---\n\nBody.\n', 'new'),
  '---\nname: x\ndescription: new\n---\n\nBody.\n'
);

check(
  'consumes wrapped continuation lines so no old text survives',
  rewriteSkillDescription(
    '---\nname: x\ndescription: old text\n  wrapped on\n  three lines\nallowed-tools: Read\n---\n\nBody.\n',
    'new'
  ),
  '---\nname: x\ndescription: new\nallowed-tools: Read\n---\n\nBody.\n'
);

check(
  'consumes continuation lines when description is the last key',
  rewriteSkillDescription('---\nname: x\ndescription: old\n  more old\n---\n\nBody.\n', 'new'),
  '---\nname: x\ndescription: new\n---\n\nBody.\n'
);

check(
  'leaves the body untouched even when it contains a --- rule',
  rewriteSkillDescription('---\ndescription: old\n---\n\nIntro\n\n---\n\nMore.\n', 'new'),
  '---\ndescription: new\n---\n\nIntro\n\n---\n\nMore.\n'
);

throws(
  'rejects a file with no frontmatter',
  () => rewriteSkillDescription('# Just a heading\n', 'new'),
  /no frontmatter/
);

throws(
  'rejects frontmatter with no description field',
  () => rewriteSkillDescription('---\nname: x\n---\n\nBody.\n', 'new'),
  /no description/
);

console.log(`\n${pass} passed`);
