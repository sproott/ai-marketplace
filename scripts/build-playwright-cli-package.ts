#!/usr/bin/env bun
// Generates packages/playwright-cli/.apm/ from the vendored vendor/playwright-cli submodule.
// Upstream ships its skill at skills/playwright-cli/; it is copied verbatim.
//
// Usage: bun scripts/build-playwright-cli-package.ts [--out <dir>]

import path from 'node:path';
import { $ } from 'bun';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const SRC = path.resolve(REPO_ROOT, 'vendor', 'playwright-cli', 'skills', 'playwright-cli');

const i = process.argv.indexOf('--out');
const OUT_DIR = path.resolve(REPO_ROOT, i === -1 ? 'packages/playwright-cli' : process.argv[i + 1]);
const APM_DIR = path.join(OUT_DIR, '.apm');

await $`rm -rf ${APM_DIR}`.quiet();
await $`mkdir -p ${path.join(APM_DIR, 'skills')}`.quiet();
await $`cp -r ${SRC} ${path.join(APM_DIR, 'skills', 'playwright-cli')}`.quiet();
